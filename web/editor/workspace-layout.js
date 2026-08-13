(() => {
  'use strict';

  const workspace = document.getElementById('editorWorkspace');
  const inspector = document.getElementById('inspector');
  if (!workspace || !inspector || workspace.dataset.inspectorResizeReady === '1') return;

  workspace.dataset.inspectorResizeReady = '1';

  const STORAGE_KEY = 'meetingPosterInspectorWidthV1';
  const DEFAULT_WIDTH = 390;
  const MIN_WIDTH = 320;
  const MAX_WIDTH = 760;
  const MIN_STAGE_WIDTH = 520;
  const KEYBOARD_STEP = 20;

  const handle = document.createElement('div');
  handle.className = 'inspector-resize-handle';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', '调整右侧编辑面板宽度');
  handle.tabIndex = 0;
  workspace.appendChild(handle);

  let width = DEFAULT_WIDTH;
  let drag = null;
  let resizeFrame = 0;

  function readStoredWidth() {
    try {
      const value = Number(localStorage.getItem(STORAGE_KEY));
      return Number.isFinite(value) && value > 0 ? value : DEFAULT_WIDTH;
    } catch (_) {
      return DEFAULT_WIDTH;
    }
  }

  function saveWidth() {
    try { localStorage.setItem(STORAGE_KEY, String(Math.round(width))); }
    catch (_) {}
  }

  function widthBounds() {
    const maxByWorkspace = Math.max(MIN_WIDTH, workspace.clientWidth - MIN_STAGE_WIDTH);
    return {
      min: MIN_WIDTH,
      max: Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, maxByWorkspace)),
    };
  }

  function clampWidth(value) {
    const bounds = widthBounds();
    return Math.min(bounds.max, Math.max(bounds.min, Number(value) || DEFAULT_WIDTH));
  }

  function notifyResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      window.dispatchEvent(new Event('resize'));
      document.dispatchEvent(new CustomEvent('poster-inspector-resized', { detail: { width } }));
    });
  }

  function applyWidth(next, { persist = false } = {}) {
    width = clampWidth(next);
    workspace.style.setProperty('--inspector-width', `${Math.round(width)}px`);
    const bounds = widthBounds();
    handle.setAttribute('aria-valuemin', String(bounds.min));
    handle.setAttribute('aria-valuemax', String(bounds.max));
    handle.setAttribute('aria-valuenow', String(Math.round(width)));
    handle.title = `拖动调整右侧宽度 · 当前 ${Math.round(width)}px`;
    if (persist) saveWidth();
    notifyResize();
  }

  function finishDrag(event) {
    if (!drag || (event && event.pointerId !== drag.pointerId)) return;
    try {
      if (handle.hasPointerCapture?.(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
    } catch (_) {}
    drag = null;
    workspace.classList.remove('is-resizing-inspector');
    document.body.classList.remove('is-resizing-inspector');
    saveWidth();
  }

  handle.addEventListener('pointerdown', event => {
    if (!event.isPrimary || event.button !== 0) return;
    event.preventDefault();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: width,
    };
    workspace.classList.add('is-resizing-inspector');
    document.body.classList.add('is-resizing-inspector');
    try { handle.setPointerCapture(event.pointerId); } catch (_) {}
  });

  handle.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    const delta = drag.startX - event.clientX;
    applyWidth(drag.startWidth + delta);
  });

  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);

  handle.addEventListener('keydown', event => {
    let next = width;
    if (event.key === 'ArrowLeft') next += KEYBOARD_STEP;
    else if (event.key === 'ArrowRight') next -= KEYBOARD_STEP;
    else if (event.key === 'Home') next = widthBounds().min;
    else if (event.key === 'End') next = widthBounds().max;
    else return;
    event.preventDefault();
    applyWidth(next, { persist: true });
  });

  const observer = new ResizeObserver(() => applyWidth(width));
  observer.observe(workspace);

  applyWidth(readStoredWidth());

  window.posterInspectorLayout = {
    getWidth: () => width,
    setWidth: value => applyWidth(value, { persist: true }),
  };
})();
