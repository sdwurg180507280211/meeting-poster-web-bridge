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
  let zoom = 1;
  let fitWidth = poster.getBoundingClientRect().width || 1;

  function notifyGeometryChange() {
    nextFrame(() => window.dispatchEvent(new Event('resize')));
  }

  function updateReadout() {
    value.textContent = `${Math.round(zoom * 100)}%`;
  }

  function setZoom(next) {
    zoom = Math.min(2.2, Math.max(.7, Math.round(next * 10) / 10));
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
    poster.style.width = `${Math.max(220, Math.round(fitWidth * zoom))}px`;
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

  window.addEventListener('resize', () => {
    if (zoom !== 1) return;
    fitWidth = poster.getBoundingClientRect().width || fitWidth;
    updateReadout();
  });
})();
