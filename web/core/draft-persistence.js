(() => {
  'use strict';

  const FORM_KEY = 'meetingPosterEditorDraftV2';
  const DB_NAME = 'meetingPosterEditorFilesV2';
  const STORE = 'files';
  const form = document.getElementById('posterForm');
  if (!form) return;

  const scalarIds = [
    'meetingTime', 'outputName',
    'chair-name', 'chair-hospital',
    'speaker1-name', 'speaker1-hospital',
    'speaker2-name', 'speaker2-hospital',
    ...Array.from({ length: 4 }, (_, i) => [`s-time-${i}`, `s-content-${i}`, `s-speaker-${i}`, `s-chair-${i}`]).flat(),
  ];
  const fileIds = ['chair-file', 'speaker1-file', 'speaker2-file', 'qrFile'];
  const avatarFileIds = new Set(['chair-file', 'speaker1-file', 'speaker2-file']);

  let saveTimer = null;
  let clearing = false;

  function emitInput(el) {
    el?.dispatchEvent(new Event('input', { bubbles: true }));
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
    if (clearing) return;
    try {
      localStorage.setItem(FORM_KEY, JSON.stringify(snapshot()));
    } catch (err) {
      console.warn('保存海报草稿失败', err);
    }
  }

  function scheduleSave() {
    if (clearing) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 180);
  }

  function restoreScalars() {
    const draft = readDraft();
    for (const [id, value] of Object.entries(draft)) {
      const el = document.getElementById(id);
      if (!el || value == null) continue;
      el.value = String(value);
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
    if (!file || clearing) return;
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
    if (clearing) return;
    for (const id of fileIds) {
      const input = document.getElementById(id);
      if (!input) continue;
      const file = await getFile(id);
      if (!file) continue;
      try {
        const dt = new DataTransfer();
        dt.items.add(file);
        input.dataset.restoringDraft = '1';
        if (avatarFileIds.has(id)) input.dataset.avatarCropApplied = '1';
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
        setTimeout(() => {
          delete input.dataset.restoringDraft;
          delete input.dataset.avatarCropApplied;
        }, 0);
      } catch (err) {
        console.warn(`恢复文件输入失败：${id}`, err);
      }
    }
    document.dispatchEvent(new CustomEvent('poster-draft-files-restored'));
  }

  function deleteDraftDatabase() {
    if (!window.indexedDB) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const req = indexedDB.deleteDatabase(DB_NAME);
      let blockedTimer = null;
      req.onsuccess = () => {
        clearTimeout(blockedTimer);
        resolve();
      };
      req.onerror = () => {
        clearTimeout(blockedTimer);
        reject(req.error || new Error('IndexedDB 删除失败'));
      };
      req.onblocked = () => {
        blockedTimer = setTimeout(() => reject(new Error('IndexedDB 正被其他页面占用，请关闭同一网站的其他标签页后重试')), 1500);
      };
    });
  }

  async function clearAll() {
    clearing = true;
    clearTimeout(saveTimer);
    const errors = [];
    try { localStorage.removeItem(FORM_KEY); }
    catch (err) { errors.push(err); }
    try { await deleteDraftDatabase(); }
    catch (err) { errors.push(err); }
    if (errors.length) {
      clearing = false;
      throw new Error(errors.map(err => err.message || err).join('；'));
    }
  }

  restoreScalars();
  setTimeout(restoreScalars, 80);

  form.addEventListener('input', scheduleSave, true);
  form.addEventListener('change', scheduleSave, true);

  document.addEventListener('qr-crop-applied', event => {
    if (event.detail?.file) putFile('qrFile', event.detail.file);
  });
  document.addEventListener('avatar-crop-applied', event => {
    const key = event.detail?.key;
    const file = event.detail?.file;
    if (key && file) putFile(`${key}-file`, file);
    scheduleSave();
  });
  document.addEventListener('avatar-image-reset', event => {
    const key = event.detail?.key;
    if (key) deleteFile(`${key}-file`);
    scheduleSave();
  });
  document.addEventListener('qr-image-reset', () => deleteFile('qrFile'));

  document.getElementById('qrFile')?.addEventListener('change', event => {
    if (event.target.dataset.restoringDraft === '1') return;
    const file = event.target.files?.[0];
    if (file) putFile('qrFile', file);
  });

  window.addEventListener('load', () => {
    setTimeout(restoreFiles, 60);
  }, { once: true });

  window.posterDraft = Object.freeze({
    save: saveNow,
    restore: () => { restoreScalars(); restoreFiles(); },
    removeFile: deleteFile,
    clearAll,
  });
})();
