(() => {
  'use strict';

  const modal = document.getElementById('avatarCropModal');
  const stage = document.getElementById('avatarCropStage');
  const image = document.getElementById('avatarCropImage');
  const zoomRange = document.getElementById('avatarCropZoom');
  const zoomValue = document.getElementById('avatarCropZoomValue');
  const title = document.getElementById('avatarCropTitle');
  const applyBtn = document.getElementById('applyAvatarCrop');
  const cancelBtn = document.getElementById('cancelAvatarCrop');
  const closeBtn = document.getElementById('closeAvatarCrop');
  const resetBtn = document.getElementById('resetAvatarCropModal');
  if (!modal || !stage || !image || !zoomRange) return;

  const MIN_ZOOM = 0.2;
  const MAX_ZOOM = 3.5;
  const OUTPUT_SIZE = 1024;
  zoomRange.min = String(Math.round(MIN_ZOOM * 100));
  zoomRange.max = String(Math.round(MAX_ZOOM * 100));

  const defs = {
    chair: { label: '会议主席' },
    speaker1: { label: '讲者一' },
    speaker2: { label: '讲者二' },
  };

  const states = Object.fromEntries(Object.keys(defs).map(key => [key, {
    file: null,
    url: '',
    sourceImage: null,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
  }]));

  let activeKey = null;
  let dragging = false;
  let pointerId = null;
  let startClientX = 0;
  let startClientY = 0;
  let startOffsetX = 0;
  let startOffsetY = 0;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const inputFor = key => document.getElementById(`${key}-file`);

  function currentState() {
    return activeKey ? states[activeKey] : null;
  }

  function stageMetrics() {
    const st = currentState();
    const rect = stage.getBoundingClientRect();
    const side = rect.width || 1;
    if (!st?.sourceImage) return { side, dw: side, dh: side, maxX: 0, maxY: 0 };
    const nw = st.sourceImage.naturalWidth || 1;
    const nh = st.sourceImage.naturalHeight || 1;
    const base = Math.max(side / nw, side / nh);
    const dw = nw * base * st.zoom;
    const dh = nh * base * st.zoom;
    return {
      side,
      dw,
      dh,
      maxX: Math.abs(dw - side) / 2 / side * 100,
      maxY: Math.abs(dh - side) / 2 / side * 100,
    };
  }

  function normalizeOffsets() {
    const st = currentState();
    if (!st) return;
    const metrics = stageMetrics();
    st.offsetX = clamp(st.offsetX, -metrics.maxX, metrics.maxX);
    st.offsetY = clamp(st.offsetY, -metrics.maxY, metrics.maxY);
  }

  function render() {
    const st = currentState();
    if (!st?.sourceImage) return;
    normalizeOffsets();
    const metrics = stageMetrics();
    image.style.width = `${metrics.dw}px`;
    image.style.height = `${metrics.dh}px`;
    image.style.transform = `translate(-50%, -50%) translate(${(st.offsetX / 100) * metrics.side}px, ${(st.offsetY / 100) * metrics.side}px)`;
    zoomRange.value = String(Math.round(st.zoom * 100));
    if (zoomValue) zoomValue.textContent = `${Math.round(st.zoom * 100)}%`;
  }

  function setZoom(percent, anchor = null) {
    const st = currentState();
    if (!st) return;
    const before = stageMetrics();
    const oldZoom = st.zoom;
    st.zoom = clamp(Number(percent) / 100, MIN_ZOOM, MAX_ZOOM);

    if (anchor && oldZoom > 0) {
      const rect = stage.getBoundingClientRect();
      const ax = anchor.clientX - (rect.left + rect.width / 2);
      const ay = anchor.clientY - (rect.top + rect.height / 2);
      const ratio = st.zoom / oldZoom;
      const desiredDx = (st.offsetX / 100) * before.side - ax * (ratio - 1);
      const desiredDy = (st.offsetY / 100) * before.side - ay * (ratio - 1);
      st.offsetX = desiredDx / before.side * 100;
      st.offsetY = desiredDy / before.side * 100;
    }
    render();
  }

  function resetCrop(st) {
    st.zoom = 1;
    st.offsetX = 0;
    st.offsetY = 0;
  }

  function showModal(key) {
    activeKey = key;
    const st = states[key];
    if (!st?.sourceImage) return;
    if (title) title.textContent = `裁剪${defs[key].label}头像`;
    image.src = st.url;
    modal.hidden = false;
    document.body.classList.add('crop-modal-open');
    requestAnimationFrame(render);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('crop-modal-open');
    dragging = false;
    stage.classList.remove('dragging');
  }

  function loadFile(key, file, { open = true } = {}) {
    if (!file) return;
    const st = states[key];
    st.file = file;
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(file);
    resetCrop(st);

    const loaded = new Image();
    loaded.onload = () => {
      st.sourceImage = loaded;
      if (open) showModal(key);
    };
    loaded.onerror = () => alert('头像图片读取失败，请换一张图片重试。');
    loaded.src = st.url;
  }

  function open(key) {
    if (!defs[key]) return;
    const input = inputFor(key);
    const file = input?.files?.[0];
    const st = states[key];
    if (file && st.sourceImage && file === st.file) {
      showModal(key);
      return;
    }
    if (file) loadFile(key, file, { open: true });
    else input?.click();
  }

  function resetAndChooseNew() {
    if (!activeKey) return;
    const key = activeKey;
    const st = states[key];
    const input = inputFor(key);

    if (st.url) URL.revokeObjectURL(st.url);
    st.file = null;
    st.url = '';
    st.sourceImage = null;
    resetCrop(st);
    image.removeAttribute('src');
    image.style.width = '';
    image.style.height = '';
    image.style.transform = '';
    if (input) input.value = '';

    const readout = document.getElementById(`${key}-crop-readout`);
    if (readout) readout.textContent = '尚未选择';

    document.dispatchEvent(new CustomEvent('avatar-image-reset', { detail: { key } }));
    closeModal();
    setTimeout(() => input?.click(), 0);
  }

  Object.keys(defs).forEach(key => {
    const input = inputFor(key);
    if (!input) return;
    input.addEventListener('change', () => {
      if (input.dataset.avatarCropApplied === '1') return;
      const file = input.files?.[0];
      if (!file) return;
      const restoring = input.dataset.restoringDraft === '1';
      loadFile(key, file, { open: !restoring });
    });

    const host = input.parentElement;
    if (host && !host.querySelector('.avatar-crop-open')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'avatar-crop-open';
      btn.textContent = '裁剪头像';
      btn.addEventListener('click', () => open(key));
      const readout = document.createElement('div');
      readout.className = 'avatar-crop-readout';
      readout.id = `${key}-crop-readout`;
      readout.textContent = '尚未调整';
      host.append(btn, readout);
    }
  });

  zoomRange.addEventListener('input', () => setZoom(zoomRange.value));
  stage.addEventListener('wheel', event => {
    const st = currentState();
    if (!st?.sourceImage) return;
    event.preventDefault();
    const next = Math.round(st.zoom * 100) + (event.deltaY < 0 ? 5 : -5);
    setZoom(next, event);
  }, { passive: false });

  stage.addEventListener('pointerdown', event => {
    const st = currentState();
    if (event.button !== 0 || !st?.sourceImage) return;
    dragging = true;
    pointerId = event.pointerId;
    startClientX = event.clientX;
    startClientY = event.clientY;
    startOffsetX = st.offsetX;
    startOffsetY = st.offsetY;
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
    event.preventDefault();
  });

  stage.addEventListener('pointermove', event => {
    const st = currentState();
    if (!dragging || event.pointerId !== pointerId || !st) return;
    const rect = stage.getBoundingClientRect();
    st.offsetX = startOffsetX + (event.clientX - startClientX) / rect.width * 100;
    st.offsetY = startOffsetY + (event.clientY - startClientY) / rect.height * 100;
    render();
  });

  function endDrag(event) {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('dragging');
    try { stage.releasePointerCapture(event.pointerId); } catch (_) {}
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  async function buildCroppedFile(key) {
    const st = states[key];
    if (!st?.sourceImage) throw new Error('尚未选择头像图片');
    normalizeOffsets();

    const nw = st.sourceImage.naturalWidth || 1;
    const nh = st.sourceImage.naturalHeight || 1;
    const base = Math.max(OUTPUT_SIZE / nw, OUTPUT_SIZE / nh);
    const dw = nw * base * st.zoom;
    const dh = nh * base * st.zoom;
    const dx = (OUTPUT_SIZE - dw) / 2 + (st.offsetX / 100) * OUTPUT_SIZE;
    const dy = (OUTPUT_SIZE - dh) / 2 + (st.offsetY / 100) * OUTPUT_SIZE;

    const canvas = document.createElement('canvas');
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('浏览器无法创建头像裁剪画布');
    ctx.clearRect(0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(st.sourceImage, dx, dy, dw, dh);

    // 四角锚点位于最终圆形蒙版外，仅用于让 Photoshop 智能对象保留完整 1024×1024 边界。
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 1, 1);
    ctx.fillRect(OUTPUT_SIZE - 1, 0, 1, 1);
    ctx.fillRect(0, OUTPUT_SIZE - 1, 1, 1);
    ctx.fillRect(OUTPUT_SIZE - 1, OUTPUT_SIZE - 1, 1, 1);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(
        value => value ? resolve(value) : reject(new Error('头像裁剪 PNG 生成失败')),
        'image/png',
        1
      );
    });
    return new File([blob], `${key}-cropped.png`, {
      type: 'image/png',
      lastModified: Date.now(),
    });
  }

  applyBtn?.addEventListener('click', async () => {
    const key = activeKey;
    const st = currentState();
    if (!key || !st) return;

    try {
      applyBtn.disabled = true;
      applyBtn.textContent = '正在应用…';
      const file = await buildCroppedFile(key);
      const input = inputFor(key);
      if (!input) throw new Error('找不到头像文件输入框');

      const dt = new DataTransfer();
      dt.items.add(file);
      input.dataset.avatarCropApplied = '1';
      input.files = dt.files;
      input.dispatchEvent(new Event('change', { bubbles: true }));
      delete input.dataset.avatarCropApplied;

      if (st.url) URL.revokeObjectURL(st.url);
      st.file = file;
      st.url = URL.createObjectURL(file);
      st.sourceImage = null;
      resetCrop(st);

      const appliedImage = new Image();
      appliedImage.onload = () => { st.sourceImage = appliedImage; };
      appliedImage.src = st.url;

      const readout = document.getElementById(`${key}-crop-readout`);
      if (readout) readout.textContent = '已应用 · 成品头像 PNG';

      document.dispatchEvent(new CustomEvent('avatar-crop-applied', {
        detail: { key, file, cropMode: 'baked', outputSize: OUTPUT_SIZE }
      }));
      closeModal();
    } catch (err) {
      console.error(err);
      alert(`头像裁剪失败：${err.message || err}`);
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = '应用裁剪';
    }
  });

  resetBtn?.addEventListener('click', resetAndChooseNew);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) closeModal(); });

  window.posterAvatarCrop = Object.freeze({ open });
})();
