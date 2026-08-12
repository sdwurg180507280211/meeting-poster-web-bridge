(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  if (!poster) return;

  const DRAG_THRESHOLD = 5;
  const MOVEABLE_SELECTOR = '.moveable-control-box,.moveable-control,.moveable-line,.moveable-area';
  let gesture = null;
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
        idOf: element => element?.dataset?.previewTextId || '',
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
        idOf: element => element?.dataset?.key || '',
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
        // Current layout modules keep selection private. Toggling the active mode is the
        // safest public way to clear that state and destroy Moveable without losing history.
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

  function selectedTarget(context, element) {
    const selectable = element?.closest(context.selectableSelector);
    if (!selectable) return null;
    const id = context.idOf(selectable);
    return id && context.selected().includes(id) ? { element: selectable, id } : null;
  }

  function reselectSingle(context, element) {
    if (!context || !element?.isConnected) return;
    clearSelection(context);
    const event = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 9876,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: element.getBoundingClientRect().left + 1,
      clientY: element.getBoundingClientRect().top + 1,
    });
    element.dispatchEvent(event);
  }

  document.addEventListener('pointerdown', event => {
    if (clearing || !event.isPrimary) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;

    const context = activeContext();
    if (!context || context.selected().length === 0) {
      gesture = null;
      return;
    }

    const element = asElement(event.target);
    const selected = selectedTarget(context, element);
    gesture = selected && !event.metaKey && !event.ctrlKey
      ? {
          mode: context.kind,
          id: selected.id,
          element: selected.element,
          startX: event.clientX,
          startY: event.clientY,
          moved: false,
          selectionSize: context.selected().length,
        }
      : null;

    if (protectedTarget(context, element)) return;

    // Ctrl/Cmd + blank poster drag is additive marquee in text mode; keep the old selection.
    if (context.kind === 'text' && poster.contains(element) && (event.metaKey || event.ctrlKey)) return;

    clearSelection(context);
  }, true);

  document.addEventListener('pointermove', event => {
    if (!gesture) return;
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (Math.hypot(dx, dy) >= DRAG_THRESHOLD) gesture.moved = true;
  }, true);

  document.addEventListener('pointerup', event => {
    const state = gesture;
    gesture = null;
    if (!state || state.moved || state.selectionSize < 2) return;
    if (event.metaKey || event.ctrlKey) return;

    // Keep a group intact on pointerdown so dragging any member moves the group. If the
    // gesture was only a click, collapse to that one member just like a desktop editor.
    setTimeout(() => {
      const context = contextFor(state.mode);
      if (!context) return;
      const current = context.selected();
      if (current.length < 2 || !current.includes(state.id)) return;
      reselectSingle(context, state.element);
    }, 0);
  }, true);

  document.addEventListener('pointercancel', () => { gesture = null; }, true);

  document.addEventListener('focusin', event => {
    if (clearing) return;
    const context = activeContext();
    if (!context || context.selected().length === 0) return;
    const element = asElement(event.target);
    if (!element || protectedTarget(context, element)) return;
    if (!element.matches('input,textarea,select,button,a,[contenteditable="true"],summary,[tabindex]')) return;
    clearSelection(context);
  }, true);

  window.addEventListener('blur', () => { gesture = null; });

  window.posterSelectionPolish = Object.freeze({
    clear: () => clearSelection(),
    activeMode: () => activeContext()?.kind || null,
    selectedCount: () => activeContext()?.selected().length || 0,
  });
})();
