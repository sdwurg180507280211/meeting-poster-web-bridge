(() => {
  const input = document.getElementById('qrFile');
  const modal = document.getElementById('qrCropModal');
  const stage = document.getElementById('qrCropStage');
  const image = document.getElementById('qrCropImage');
  const zoomRange = document.getElementById('qrCropZoom');
  const zoomValue = document.getElementById('qrCropZoomValue');
  const editBtn = document.getElementById('editQrCrop');
  const applyBtn = document.getElementById('applyQrCrop');
  const cancelBtn = document.getElementById('cancelQrCrop');
  const closeBtn = document.getElementById('closeQrCrop');
  const resetBtn = document.getElementById('resetQrCropModal');
  const preview = document.getElementById('qrPreview');
  const summary = document.getElementById('qrCropReadout');
  if (!input || !modal || !stage || !image || !zoomRange) return;

  const state = {
    originalFile: null,
    originalUrl: '',
    sourceImage: null,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    appliedFile: null,
    appliedPreviewUrl: '',
    dragging: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startOffsetX: 0,
    startOffsetY: 0,
  };

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  function stageMetrics() {
    const rect = stage.getBoundingClientRect();
    const side = rect.width || 1;
    if (!state.sourceImage) return { side, dw: side, dh: side, maxX: 0, maxY: 0 };
    const nw = state.sourceImage.naturalWidth || 1;
    const nh = state.sourceImage.naturalHeight || 1;
    const base = Math.max(side / nw, side / nh);
    const dw = nw * base * state.zoom;
    const dh = nh * base * state.zoom;
    return {
      side,
      dw,
      dh,
      maxX: Math.max(0, ((dw - side) / 2) / side * 100),
      maxY: Math.max(0, ((dh - side) / 2) / side * 100),
    };
  }

  function normalizeOffsets() {
    const m = stageMetrics();
    state.offsetX = clamp(state.offsetX, -m.maxX, m.maxX);
    state.offsetY = clamp(state.offsetY, -m.maxY, m.maxY);
  }

  function render() {
    if (!state.sourceImage) return;
    normalizeOffsets();
    const m = stageMetrics();
    image.style.width = `${m.dw}px`;
    image.style.height = `${m.dh}px`;
    image.style.transform = `translate(-50%, -50%) translate(${(state.offsetX / 100) * m.side}px, ${(state.offsetY / 100) * m.side}px)`;
    zoomRange.value = String(Math.round(state.zoom * 100));
    if (zoomValue) zoomValue.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function setZoom(percent, anchor = null) {
    const before = stageMetrics();
    const oldZoom = state.zoom;
    state.zoom = clamp(Number(percent) / 100, 1, 4);

    // 以鼠标所在位置为近似缩放中心，操作感更接近图片编辑器。
    if (anchor && oldZoom > 0) {
      const rect = stage.getBoundingClientRect();
      const ax = anchor.clientX - (rect.left + rect.width / 2);
      const ay = anchor.clientY - (rect.top + rect.height / 2);
      const ratio = state.zoom / oldZoom;
      const desiredDx = (state.offsetX / 100) * before.side - ax * (ratio - 1);
      const desiredDy = (state.offsetY / 100) * before.side - ay * (ratio - 1);
      state.offsetX = desiredDx / before.side * 100;
      state.offsetY = desiredDy / before.side * 100;
    }
    render();
  }

  function resetCrop() {
    state.zoom = 1;
    state.offsetX = 0;
    state.offsetY = 0;
    render();
  }

  function openModal() {
    if (!state.originalFile || !state.sourceImage) {
      input.click();
      return;
    }
    modal.hidden = false;
    document.body.classList.add('crop-modal-open');
    requestAnimationFrame(render);
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('crop-modal-open');
    state.dragging = false;
    stage.classList.remove('dragging');
  }

  function loadOriginal(file) {
    if (!file) return;
    state.originalFile = file;
    if (state.originalUrl) URL.revokeObjectURL(state.originalUrl);
    state.originalUrl = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      state.sourceImage = im;
      image.src = state.originalUrl;
      resetCrop();
      openModal();
    };
    im.onerror = () => alert('二维码图片读取失败，请换一张图片重试。');
    im.src = state.originalUrl;
  }

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (!file) return;
    // 只有用户真正选择了新文件才替换 original；“应用裁剪”不会触发 change。
    loadOriginal(file);
  });

  editBtn?.addEventListener('click', openModal);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  resetBtn?.addEventListener('click', resetCrop);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  zoomRange.addEventListener('input', () => setZoom(zoomRange.value));
  stage.addEventListener('wheel', e => {
    if (!state.sourceImage) return;
    e.preventDefault();
    const next = Math.round(state.zoom * 100) + (e.deltaY < 0 ? 6 : -6);
    setZoom(next, e);
  }, { passive: false });

  stage.addEventListener('pointerdown', e => {
    if (e.button !== 0 || !state.sourceImage) return;
    state.dragging = true;
    state.pointerId = e.pointerId;
    state.startClientX = e.clientX;
    state.startClientY = e.clientY;
    state.startOffsetX = state.offsetX;
    state.startOffsetY = state.offsetY;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
    e.preventDefault();
  });

  stage.addEventListener('pointermove', e => {
    if (!state.dragging || e.pointerId !== state.pointerId) return;
    const rect = stage.getBoundingClientRect();
    state.offsetX = state.startOffsetX + (e.clientX - state.startClientX) / rect.width * 100;
    state.offsetY = state.startOffsetY + (e.clientY - state.startClientY) / rect.height * 100;
    render();
  });

  function endDrag(e) {
    if (!state.dragging) return;
    state.dragging = false;
    stage.classList.remove('dragging');
    try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  async function buildCroppedFile() {
    if (!state.sourceImage) throw new Error('尚未选择二维码图片');
    const size = 1024;
    const nw = state.sourceImage.naturalWidth || 1;
    const nh = state.sourceImage.naturalHeight || 1;
    const base = Math.max(size / nw, size / nh);
    const dw = nw * base * state.zoom;
    const dh = nh * base * state.zoom;
    const dx = (size - dw) / 2 + (state.offsetX / 100) * size;
    const dy = (size - dh) / 2 + (state.offsetY / 100) * size;

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(state.sourceImage, dx, dy, dw, dh);

    const blob = await new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('二维码裁剪失败')), 'image/png', 1);
    });
    return new File([blob], 'qr-cropped.png', { type: 'image/png', lastModified: Date.now() });
  }

  applyBtn?.addEventListener('click', async () => {
    try {
      applyBtn.disabled = true;
      applyBtn.textContent = '正在应用…';
      const file = await buildCroppedFile();
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      state.appliedFile = file;

      if (state.appliedPreviewUrl) URL.revokeObjectURL(state.appliedPreviewUrl);
      state.appliedPreviewUrl = URL.createObjectURL(file);
      if (preview) {
        preview.src = state.appliedPreviewUrl;
        preview.style.display = 'block';
      }
      if (summary) summary.textContent = `已应用裁剪 · ${Math.round(state.zoom * 100)}%`;

      document.dispatchEvent(new CustomEvent('qr-crop-applied', {
        detail: {
          file,
          previewUrl: state.appliedPreviewUrl,
          zoom: state.zoom,
          offsetX: state.offsetX,
          offsetY: state.offsetY,
        }
      }));
      closeModal();
    } catch (err) {
      console.error(err);
      alert(`二维码裁剪失败：${err.message || err}`);
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = '应用裁剪';
    }
  });

  window.posterQrCrop = { open: openModal, reset: resetCrop };
})();
