(() => {
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
  const MAX_ZOOM = 2.5;
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
    applied: false,
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
  const zoomFor = key => document.getElementById(`${key}-zoom`);
  const xFor = key => document.getElementById(`${key}-x`);
  const yFor = key => document.getElementById(`${key}-y`);

  function emitInput(el) {
    if (!el) return;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

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
      // 缩小到裁剪框以内时也允许移动，方便把小图摆到圆形区域中的任意位置。
      maxX: Math.abs(dw - side) / 2 / side * 100,
      maxY: Math.abs(dh - side) / 2 / side * 100,
    };
  }

  function normalizeOffsets() {
    const st = currentState();
    if (!st) return;
    const m = stageMetrics();
    st.offsetX = clamp(st.offsetX, -m.maxX, m.maxX);
    st.offsetY = clamp(st.offsetY, -m.maxY, m.maxY);
  }

  function render() {
    const st = currentState();
    if (!st?.sourceImage) return;
    normalizeOffsets();
    const m = stageMetrics();
    image.style.width = `${m.dw}px`;
    image.style.height = `${m.dh}px`;
    image.style.transform = `translate(-50%, -50%) translate(${(st.offsetX / 100) * m.side}px, ${(st.offsetY / 100) * m.side}px)`;
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

  function resetCrop() {
    const st = currentState();
    if (!st) return;
    st.zoom = 1;
    st.offsetX = 0;
    st.offsetY = 0;
    render();
  }

  function syncFromControls(key) {
    const st = states[key];
    st.zoom = clamp(Number(zoomFor(key)?.value || 100) / 100, MIN_ZOOM, MAX_ZOOM);
    st.offsetX = Number(xFor(key)?.value || 0);
    st.offsetY = Number(yFor(key)?.value || 0);
  }

  function resetControls(key) {
    const z = zoomFor(key), x = xFor(key), y = yFor(key);
    if (z) z.value = '100';
    if (x) x.value = '0';
    if (y) y.value = '0';
    emitInput(z); emitInput(x); emitInput(y);
  }

  function showModal(key) {
    activeKey = key;
    const st = states[key];
    if (!st?.sourceImage) return;
    syncFromControls(key);
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

  function loadFile(key, file, { reset = true, open = true } = {}) {
    if (!file) return;
    const st = states[key];
    st.file = file;
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(file);
    if (reset) resetControls(key);

    const im = new Image();
    im.onload = () => {
      st.sourceImage = im;
      if (reset) {
        st.zoom = 1;
        st.offsetX = 0;
        st.offsetY = 0;
      } else {
        syncFromControls(key);
      }
      st.applied = !reset;
      if (open) showModal(key);
    };
    im.onerror = () => alert('头像图片读取失败，请换一张图片重试。');
    im.src = st.url;
  }

  function open(key) {
    if (!defs[key]) return;
    const input = inputFor(key);
    const st = states[key];
    if (st.sourceImage && input?.files?.[0] === st.file) {
      showModal(key);
      return;
    }
    const file = input?.files?.[0];
    if (file) loadFile(key, file, { reset: false, open: true });
    else input?.click();
  }

  Object.keys(defs).forEach(key => {
    const input = inputFor(key);
    const z = zoomFor(key);
    if (z) z.min = String(Math.round(MIN_ZOOM * 100));
    if (!input) return;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      const restoring = input.dataset.restoringDraft === '1';
      loadFile(key, file, { reset: !restoring, open: !restoring });
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
  stage.addEventListener('wheel', e => {
    const st = currentState();
    if (!st?.sourceImage) return;
    e.preventDefault();
    const next = Math.round(st.zoom * 100) + (e.deltaY < 0 ? 5 : -5);
    setZoom(next, e);
  }, { passive: false });

  stage.addEventListener('pointerdown', e => {
    const st = currentState();
    if (e.button !== 0 || !st?.sourceImage) return;
    dragging = true;
    pointerId = e.pointerId;
    startClientX = e.clientX;
    startClientY = e.clientY;
    startOffsetX = st.offsetX;
    startOffsetY = st.offsetY;
    stage.setPointerCapture(e.pointerId);
    stage.classList.add('dragging');
    e.preventDefault();
  });

  stage.addEventListener('pointermove', e => {
    const st = currentState();
    if (!dragging || e.pointerId !== pointerId || !st) return;
    const rect = stage.getBoundingClientRect();
    st.offsetX = startOffsetX + (e.clientX - startClientX) / rect.width * 100;
    st.offsetY = startOffsetY + (e.clientY - startClientY) / rect.height * 100;
    render();
  });

  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    stage.classList.remove('dragging');
    try { stage.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  applyBtn?.addEventListener('click', () => {
    const st = currentState();
    if (!activeKey || !st) return;
    normalizeOffsets();
    const z = zoomFor(activeKey), x = xFor(activeKey), y = yFor(activeKey);
    if (z) z.value = String(Math.round(st.zoom * 100));
    if (x) x.value = String(Math.round(st.offsetX));
    if (y) y.value = String(Math.round(st.offsetY));
    emitInput(z); emitInput(x); emitInput(y);
    st.applied = true;

    const readout = document.getElementById(`${activeKey}-crop-readout`);
    if (readout) readout.textContent = `已应用 · ${Math.round(st.zoom * 100)}%`;

    document.dispatchEvent(new CustomEvent('avatar-crop-applied', {
      detail: {
        key: activeKey,
        zoom: Number(z?.value || 100) / 100,
        offsetX: Number(x?.value || 0),
        offsetY: Number(y?.value || 0),
      }
    }));
    closeModal();
  });

  resetBtn?.addEventListener('click', resetCrop);
  closeBtn?.addEventListener('click', closeModal);
  cancelBtn?.addEventListener('click', closeModal);
  modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });

  window.posterAvatarCrop = { open };
})();
