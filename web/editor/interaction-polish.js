(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const viewport = document.querySelector('.poster-viewport');
  const stageArea = document.querySelector('.stage-area');
  if (!poster || !viewport || !stageArea || stageArea.querySelector('.zoom-controls')) return;

  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function installJobStatePolish() {
    const state = document.querySelector('.canvas-job-state');
    const status = document.getElementById('jobStatus');
    if (!state || !status || state.dataset.polishReady === '1') return;
    state.dataset.polishReady = '1';

    const sync = () => {
      const text = status.textContent.trim();
      state.classList.toggle('is-idle', !text || text === '准备就绪');
      state.classList.toggle('is-success', status.classList.contains('ok'));
    };

    new MutationObserver(sync).observe(status, {
      attributes: true,
      childList: true,
      characterData: true,
      subtree: true,
    });
    sync();
  }

  installJobStatePolish();

  const controls = document.createElement('div');
  controls.className = 'zoom-controls stage-zoom-controls';
  controls.setAttribute('aria-label', '海报预览缩放');
  controls.innerHTML = `
    <button type="button" data-zoom="out" title="缩小预览">−</button>
    <button type="button" data-zoom="fit" title="适应窗口">适应</button>
    <span class="zoom-value">100%</span>
    <button type="button" data-zoom="in" title="放大预览">＋</button>`;
  stageArea.appendChild(controls);

  const value = controls.querySelector('.zoom-value');
  const touchPoints = new Map();
  let zoom = 1;
  let fitWidth = poster.getBoundingClientRect().width || 1;
  let pinch = null;

  function isMobileViewport() {
    return window.matchMedia?.('(max-width: 760px)')?.matches === true;
  }

  function notifyGeometryChange() {
    nextFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function updateReadout() {
    value.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(next) {
    const minimum = isMobileViewport() ? .5 : .7;
    zoom = Math.min(2.2, Math.max(minimum, Math.round(Number(next || 1) * 20) / 20));
    if (Math.abs(zoom - 1) < .001) {
      zoom = 1;
      poster.style.removeProperty('width');
      viewport.classList.remove('is-zoomed');
      nextFrame(() => {
        fitWidth = poster.getBoundingClientRect().width || fitWidth;
        updateReadout();
        window.dispatchEvent(new Event('resize'));
      });
      return;
    }
    poster.style.width = `${Math.max(160, Math.round(fitWidth * zoom))}px`;
    viewport.classList.toggle('is-zoomed', zoom > 1);
    updateReadout();
    notifyGeometryChange();
  }

  controls.addEventListener('click', event => {
    const action = event.target?.dataset?.zoom;
    if (action === 'out') setZoom(zoom - .1);
    if (action === 'in') setZoom(zoom + .1);
    if (action === 'fit') setZoom(1);
  });

  viewport.addEventListener('wheel', event => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setZoom(zoom + (event.deltaY < 0 ? .1 : -.1));
  }, { passive: false });

  function touchDistance() {
    const points = [...touchPoints.values()];
    if (points.length < 2) return 0;
    return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
  }

  function refreshPinchStart() {
    if (!isMobileViewport() || window.posterLayoutTool?.isEnabled?.() || touchPoints.size < 2) {
      pinch = null;
      viewport.classList.remove('is-pinching');
      return;
    }
    const distance = touchDistance();
    if (!distance) return;
    pinch = { distance, zoom };
    viewport.classList.add('is-pinching');
  }

  viewport.addEventListener('pointerdown', event => {
    if (event.pointerType !== 'touch') return;
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touchPoints.size === 2) refreshPinchStart();
  });

  viewport.addEventListener('pointermove', event => {
    if (event.pointerType !== 'touch' || !touchPoints.has(event.pointerId)) return;
    touchPoints.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!pinch || touchPoints.size < 2) return;
    const distance = touchDistance();
    if (!distance) return;
    event.preventDefault();
    setZoom(pinch.zoom * (distance / pinch.distance));
  }, { passive: false });

  function endTouch(event) {
    if (event.pointerType !== 'touch') return;
    touchPoints.delete(event.pointerId);
    if (touchPoints.size >= 2) refreshPinchStart();
    else {
      pinch = null;
      viewport.classList.remove('is-pinching');
    }
  }

  viewport.addEventListener('pointerup', endTouch);
  viewport.addEventListener('pointercancel', endTouch);

  window.addEventListener('resize', () => {
    if (zoom !== 1) return;
    fitWidth = poster.getBoundingClientRect().width || fitWidth;
    updateReadout();
  });

  window.posterZoomControls = Object.freeze({
    get: () => zoom,
    set: setZoom,
    fit: () => setZoom(1),
  });
})();