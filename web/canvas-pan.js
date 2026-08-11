(() => {
  'use strict';

  const viewport = document.querySelector('.poster-viewport');
  const poster = document.getElementById('posterCanvas');
  if (!viewport || !poster || viewport.dataset.canvasPanReady === '1') return;

  viewport.dataset.canvasPanReady = '1';
  viewport.classList.add('canvas-workspace');

  const PAN_MARGIN = 360;
  const DRAG_THRESHOLD = 4;
  const INTERACTIVE_SELECTOR = [
    '.canvas-avatar-slot',
    '.canvas-qr-slot',
    '.poster-preview-text',
    '.moveable-control-box',
    '.moveable-control',
    '.moveable-line',
    '.moveable-area',
    'button',
    'input',
    'select',
    'textarea',
    'a',
    'label',
    '[contenteditable="true"]',
  ].join(',');

  const stage = document.createElement('div');
  stage.className = 'poster-pan-stage';
  poster.parentNode.insertBefore(stage, poster);
  stage.appendChild(poster);

  let drag = null;
  let suppressNextClick = false;
  let initialized = false;

  function isInteractiveTarget(target) {
    return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
  }

  function sizeStage() {
    const viewportWidth = viewport.clientWidth || 1;
    const viewportHeight = viewport.clientHeight || 1;
    const posterWidth = poster.offsetWidth || 1;
    const posterHeight = poster.offsetHeight || 1;
    stage.style.width = `${Math.ceil(Math.max(viewportWidth + PAN_MARGIN * 2, posterWidth + PAN_MARGIN * 2))}px`;
    stage.style.height = `${Math.ceil(Math.max(viewportHeight + PAN_MARGIN * 2, posterHeight + PAN_MARGIN * 2))}px`;
  }

  function centerViewport(behavior = 'auto') {
    sizeStage();
    const left = Math.max(0, (stage.offsetWidth - viewport.clientWidth) / 2);
    const top = Math.max(0, (stage.offsetHeight - viewport.clientHeight) / 2);
    viewport.scrollTo({ left, top, behavior });
  }

  function refreshWorkspace({ preserveCenter = true } = {}) {
    const oldCenterX = viewport.scrollLeft + viewport.clientWidth / 2;
    const oldCenterY = viewport.scrollTop + viewport.clientHeight / 2;
    const oldWidth = stage.offsetWidth || 1;
    const oldHeight = stage.offsetHeight || 1;

    sizeStage();

    if (!initialized) {
      initialized = true;
      centerViewport();
      return;
    }
    if (!preserveCenter) return;

    const ratioX = oldCenterX / oldWidth;
    const ratioY = oldCenterY / oldHeight;
    viewport.scrollLeft = Math.max(0, ratioX * stage.offsetWidth - viewport.clientWidth / 2);
    viewport.scrollTop = Math.max(0, ratioY * stage.offsetHeight - viewport.clientHeight / 2);
  }

  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const moved = drag.moved;
    try {
      if (viewport.hasPointerCapture?.(drag.pointerId)) viewport.releasePointerCapture(drag.pointerId);
    } catch (_) {
      // Pointer capture can already be released by the browser.
    }
    drag = null;
    viewport.classList.remove('is-panning');
    if (moved) suppressNextClick = true;
  }

  viewport.addEventListener('pointerdown', event => {
    if (!event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isInteractiveTarget(event.target)) return;

    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: viewport.scrollLeft,
      scrollTop: viewport.scrollTop,
      moved: false,
    };
  });

  viewport.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (!drag.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!drag.moved) {
      drag.moved = true;
      viewport.classList.add('is-panning');
      try { viewport.setPointerCapture(event.pointerId); } catch (_) {}
    }

    event.preventDefault();
    viewport.scrollLeft = drag.scrollLeft - dx;
    viewport.scrollTop = drag.scrollTop - dy;
  });

  viewport.addEventListener('pointerup', finishDrag);
  viewport.addEventListener('pointercancel', finishDrag);

  viewport.addEventListener('click', event => {
    if (!suppressNextClick) return;
    suppressNextClick = false;
    event.preventDefault();
    event.stopPropagation();
  }, true);

  viewport.addEventListener('dblclick', event => {
    if (isInteractiveTarget(event.target)) return;
    event.preventDefault();
    document.querySelector('.zoom-controls [data-zoom="fit"]')?.click();
    requestAnimationFrame(() => requestAnimationFrame(() => centerViewport('smooth')));
  });

  function installCenterControl() {
    const zoomControls = document.querySelector('.zoom-controls');
    if (!zoomControls || zoomControls.querySelector('[data-pan-center]')) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.panCenter = '1';
    button.className = 'pan-center-btn';
    button.textContent = '居中';
    button.title = '将海报重新居中';
    const zoomIn = zoomControls.querySelector('[data-zoom="in"]');
    zoomControls.insertBefore(button, zoomIn || null);
    button.addEventListener('click', () => centerViewport('smooth'));
  }

  function installWorkspaceHint() {
    const toolbar = document.querySelector('.stage-toolbar>div:first-child');
    if (!toolbar || toolbar.querySelector('.canvas-workspace-chip')) return;
    const chip = document.createElement('span');
    chip.className = 'canvas-workspace-chip';
    chip.textContent = '左键拖动画布 · 双击空白复位';
    toolbar.appendChild(chip);
  }

  const resizeObserver = new ResizeObserver(() => refreshWorkspace());
  resizeObserver.observe(viewport);
  resizeObserver.observe(poster);

  window.addEventListener('resize', () => refreshWorkspace());
  installCenterControl();
  installWorkspaceHint();
  requestAnimationFrame(() => refreshWorkspace({ preserveCenter: false }));

  window.posterCanvasWorkspace = {
    center: centerViewport,
    refresh: refreshWorkspace,
  };
})();
