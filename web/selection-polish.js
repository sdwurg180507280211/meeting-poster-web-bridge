(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  if (!poster) return;

  const MOVEABLE_SELECTOR = '.moveable-control-box,.moveable-control,.moveable-line,.moveable-area';
  let clearing = false;

  function asElement(target) {
    if (target instanceof Element) return target;
    return target?.parentElement || null;
  }

  function contextFor(kind) {
    if (kind === 'text') {
      const api = window.posterTextLayout;
      if (!api?.isEnabled?.()) return null;
      return {
        kind,
        api,
        dockSelector: '.text-layout-dock',
        selectableSelector: '.poster-preview-text',
        selected: () => api.getSelectedIds?.() || [],
      };
    }
    if (kind === 'asset') {
      const api = window.posterAssetLayout;
      if (!api?.isEnabled?.()) return null;
      return {
        kind,
        api,
        dockSelector: '.asset-layout-dock',
        selectableSelector: '.canvas-asset-slot',
        selected: () => api.getSelectedKeys?.() || [],
      };
    }
    return null;
  }

  function activeContext() {
    return contextFor('asset') || contextFor('text');
  }

  function clearSelection(context = activeContext()) {
    if (!context || clearing || context.selected().length === 0) return false;
    clearing = true;
    try {
      if (typeof context.api.clearSelection === 'function') {
        context.api.clearSelection();
      } else {
        // The current editors keep selection private. Re-entering the same mode clears
        // selection and Moveable without touching layout data, undo history or the PSD contract.
        context.api.setEnabled?.(false);
        context.api.setEnabled?.(true);
      }
      document.dispatchEvent(new CustomEvent('poster-selection-cleared', {
        detail: { mode: context.kind },
      }));
      return true;
    } finally {
      clearing = false;
    }
  }

  function protectedTarget(context, element) {
    if (!context || !element) return false;
    if (element.closest(context.dockSelector)) return true;
    if (element.closest(MOVEABLE_SELECTOR)) return true;
    if (element.closest(context.selectableSelector)) return true;
    return false;
  }

  document.addEventListener('pointerdown', event => {
    if (clearing || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const context = activeContext();
    if (!context || context.selected().length === 0) return;

    const element = asElement(event.target);
    if (protectedTarget(context, element)) return;

    // Ctrl/Cmd + blank poster drag is the existing additive marquee gesture in text mode.
    // It intentionally preserves the current selection until the marquee editor resolves it.
    if (context.kind === 'text' && element && poster.contains(element) && (event.metaKey || event.ctrlKey)) return;

    clearSelection(context);
  }, true);

  document.addEventListener('focusin', event => {
    if (clearing) return;
    const context = activeContext();
    if (!context || context.selected().length === 0) return;

    const element = asElement(event.target);
    if (!element || protectedTarget(context, element)) return;
    if (!element.matches('input,textarea,select,button,a,[contenteditable="true"],summary,[tabindex]')) return;

    clearSelection(context);
  }, true);

  window.posterSelectionPolish = Object.freeze({
    clear: () => clearSelection(),
    activeMode: () => activeContext()?.kind || null,
    selectedCount: () => activeContext()?.selected().length || 0,
  });
})();
