(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const button = document.querySelector('[data-layout-mode]');
  const dock = button?.closest('.text-layout-dock');
  const textLayout = window.posterTextLayout;
  const assetLayout = window.posterAssetLayout;
  const assetDock = document.querySelector('.asset-layout-dock');
  if (!poster || !button || !dock || !textLayout || !assetLayout) return;

  if (assetDock) assetDock.hidden = true;
  const MOVEABLE_SELECTOR = '.moveable-control-box,.moveable-control,.moveable-line,.moveable-area';
  let active = false;
  let context = 'text';

  function sync() {
    dock.classList.toggle('is-active', active);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  function activate(kind) {
    context = kind === 'asset' ? 'asset' : 'text';
    if (!active) return;
    if (context === 'asset') {
      textLayout.setEnabled(false);
      assetLayout.setEnabled(true);
    } else {
      assetLayout.setEnabled(false);
      textLayout.setEnabled(true);
    }
    sync();
  }

  function setEnabled(enabled) {
    active = Boolean(enabled);
    if (!active) {
      textLayout.setEnabled(false);
      assetLayout.setEnabled(false);
      sync();
      return;
    }
    activate('text');
  }

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    setEnabled(!active);
  }, true);

  poster.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(MOVEABLE_SELECTOR)) return;
    if (target.closest('.canvas-asset-slot')) activate('asset');
    else if (target.closest('.poster-preview-text') || target === poster) activate('text');
  }, true);

  sync();
  window.posterLayoutTool = Object.freeze({
    setEnabled,
    isEnabled: () => active,
    getContext: () => context,
  });
})();
