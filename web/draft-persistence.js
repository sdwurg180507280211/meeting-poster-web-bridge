(() => {
  const FORM_KEY = 'meetingPosterEditorDraftV2';
  const DB_NAME = 'meetingPosterEditorFilesV1';
  const STORE = 'files';
  const form = document.getElementById('posterForm');
  if (!form) return;

  const scalarIds = [
    'meetingTime', 'outputName',
    'chair-name', 'chair-hospital',
    'speaker1-name', 'speaker1-hospital',
    'speaker2-name', 'speaker2-hospital',
    ...Array.from({ length: 4 }, (_, i) => [`s-time-${i}`, `s-content-${i}`, `s-speaker-${i}`, `s-chair-${i}`]).flat(),
    'chair-zoom', 'chair-x', 'chair-y',
    'speaker1-zoom', 'speaker1-x', 'speaker1-y',
    'speaker2-zoom', 'speaker2-x', 'speaker2-y',
  ];
  const fileIds = ['chair-file', 'speaker1-file', 'speaker2-file', 'qrFile'];

  let saveTimer = null;

  function emitInput(el) {
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function prepareCropRanges() {
    for (const id of ['chair-zoom', 'speaker1-zoom', 'speaker2-zoom']) {
      const el = document.getElementById(id);
      if (el) el.min = '100';
    }
  }

  function readDraft() {
    try { return JSON.parse(localStorage.getItem(FORM_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function snapshot() {
    const data = {};
    for (const id of scalarIds) {
      const el = document.getElementById(id);
      if (el) data[id] = el.value;
    }
    return data;
  }

  function saveNow() {
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(snapshot()));
    } catch (err) {
      console.warn('保存海报草稿失败', err);
    }
  }

  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  }

  function restoreScalars() {
    prepareCropRanges();
    const draft = readDraft();
    for (const [id, value] of Object.entries(draft)) {
      const el = document.getElementById(id);
      if (!el || value == null) continue;
      const normalized = /-(?:zoom)$/.test(id)
        ? String(Math.max(100, Number(value) || 100))
        : String(value);
      el.value = normalized;
      emitInput(el);
    }
    document.dispatchEvent(new CustomEvent('poster-draft-scalars-restored'));
  }

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
    });
  }

  async function putFile(id, file) {
    if (!file) return;
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({
          blob: file,
          name: file.name || `${id}.png`,
          type: file.type || 'application/octet-stream',
          lastModified: file.lastModified || Date.now(),
        }, id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn(`保存本地素材失败：${id}`, err);
    }
  }

  async function deleteFile(id) {
    if (!id) return;
    try {
      const db = await openDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch (err) {
      console.warn(`删除本地素材失败：${id}`, err);
    }
  }

  async function getFile(id) {
    try {
      const db = await openDb();
      const record = await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
      });
      db.close();
      if (!record?.blob) return null;
      return new File([record.blob], record.name || `${id}.png`, {
        type: record.type || record.blob.type || 'application/octet-stream',
        lastModified: record.lastModified || Date.now(),
      });
    } catch (err) {
      console.warn(`恢复本地素材失败：${id}`, err);
      return null;
    }
  }

  async function restoreFiles() {
    for (const id of fileIds) {
      const input = document.getElementById(id);
      if (!input) continue;
      const file = await getFile(id);
      if (!file) continue;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.dataset.restoringDraft = '1';
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => { delete input.dataset.restoringDraft; }, 0);
      } catch (err) {
        console.warn(`恢复文件输入失败：${id}`, err);
      }
    }
    document.dispatchEvent(new CustomEvent('poster-draft-files-restored'));
  }

  prepareCropRanges();
  restoreScalars();
  setTimeout(restoreScalars, 80);

  form.addEventListener('input', scheduleSave, true);
  form.addEventListener('change', scheduleSave, true);

  for (const id of fileIds) {
    const input = document.getElementById(id);
    input?.addEventListener('change', () => {
      if (input.dataset.restoringDraft === '1') return;
      putFile(id, input.files?.[0]);
    });
  }

  document.addEventListener('qr-crop-applied', e => {
    if (e.detail?.file) putFile('qrFile', e.detail.file);
  });
  document.addEventListener('avatar-crop-applied', e => {
    const key = e.detail?.key;
    const file = e.detail?.file;
    if (key && file) putFile(`${key}-file`, file);
    scheduleSave();
  });

  document.addEventListener('avatar-image-reset', e => {
    const key = e.detail?.key;
    if (key) deleteFile(`${key}-file`);
    scheduleSave();
  });
  document.addEventListener('qr-image-reset', () => {
    deleteFile('qrFile');
  });

  window.addEventListener('load', () => {
    setTimeout(restoreFiles, 60);
  }, { once: true });

  window.posterDraft = {
    save: saveNow,
    restore: () => { restoreScalars(); restoreFiles(); },
    removeFile: deleteFile,
  };
})();
