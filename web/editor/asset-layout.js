(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const project = window.POSTER_PROJECT;
  if (!poster || !project?.assetPreview || !project?.assetLayoutProfile) return;

  const W = Number(project.canvas?.width || 837);
  const H = Number(project.canvas?.height || 1880);
  const PROFILE_ID = project.assetLayoutProfile;
  const STORAGE_KEY = `posterAssetLayout:${project.id}:${PROFILE_ID}`;
  const KEYS = ['chair', 'speaker1', 'speaker2', 'qr'];
  const LABELS = Object.freeze({ chair: '主席头像', speaker1: '讲者一头像', speaker2: '讲者二头像', qr: '二维码' });
  const HISTORY_LIMIT = 60;
  const MIN_SIZE = 24;

  const slots = new Map();
  KEYS.forEach(key => {
    const slot = poster.querySelector(`.canvas-asset-slot[data-key="${key}"]`);
    if (slot) slots.set(key, slot);
  });
  if (slots.size !== KEYS.length) return;

  let active = false;
  let selected = new Set();
  let moveable = null;
  let moveableTimer = null;
  const undoStack = [];
  const redoStack = [];

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function pct(value, total) {
    return `${(value / total) * 100}%`;
  }

  function normalizeSpec(key, value) {
    const source = project.assetPreview[key] || {};
    let size = Math.round(Number(value?.size ?? source.size ?? MIN_SIZE));
    if (!Number.isFinite(size)) size = MIN_SIZE;
    size = Math.max(MIN_SIZE, Math.min(Math.min(W, H), size));

    let left = Math.round(Number(value?.left ?? source.left ?? 0));
    let top = Math.round(Number(value?.top ?? source.top ?? 0));
    if (!Number.isFinite(left)) left = 0;
    if (!Number.isFinite(top)) top = 0;
    left = Math.max(0, Math.min(W - size, left));
    top = Math.max(0, Math.min(H - size, top));

    return { left, top, size };
  }

  function currentLayout() {
    const result = {};
    KEYS.forEach(key => {
      result[key] = normalizeSpec(key, project.assetPreview[key]);
    });
    return result;
  }

  function setProjectSpec(key, value) {
    const normalized = normalizeSpec(key, value);
    Object.assign(project.assetPreview[key], normalized);
    return normalized;
  }

  function applyGeometry(key) {
    const slot = slots.get(key);
    if (!slot) return;
    const spec = normalizeSpec(key, project.assetPreview[key]);
    Object.assign(project.assetPreview[key], spec);
    slot.style.left = pct(spec.left, W);
    slot.style.top = pct(spec.top, H);
    slot.style.width = pct(spec.size, W);
    slot.style.height = pct(spec.size, H);
    slot.style.transform = 'none';
    slot.style.transformOrigin = '0 0';
  }

  function applyAllGeometry() {
    KEYS.forEach(applyGeometry);
  }

  function readStoredLayout() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function saveLayout() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(currentLayout()));
    document.dispatchEvent(new CustomEvent('poster-asset-layout-changed', {
      detail: { projectId: project.id, profileId: PROFILE_ID, layout: currentLayout() },
    }));
  }

  function installStoredLayout() {
    const stored = readStoredLayout();
    if (!stored) {
      applyAllGeometry();
      return;
    }
    KEYS.forEach(key => {
      if (stored[key]) setProjectSpec(key, stored[key]);
    });
    applyAllGeometry();
  }

  function snapshot() {
    return clone(currentLayout());
  }

  function updateToolbar() {
    const count = selected.size;
    countLabel.textContent = count ? `已选 ${count} 项` : '未选择';
    if (count === 1) {
      const key = [...selected][0];
      const spec = normalizeSpec(key, project.assetPreview[key]);
      readout.textContent = `${LABELS[key]} · X ${spec.left} · Y ${spec.top} · ${spec.size}×${spec.size}`;
    } else {
      readout.textContent = count > 1 ? '批量移动 · 尺寸单独调整' : '';
    }
  }

  function commitHistory(before) {
    if (!before || JSON.stringify(before) === JSON.stringify(currentLayout())) return;
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateToolbar();
  }

  function restoreSnapshot(value) {
    KEYS.forEach(key => setProjectSpec(key, value[key] || project.assetPreview[key]));
    applyAllGeometry();
    saveLayout();
    scheduleMoveableRebuild();
    updateToolbar();
  }

  function undo() {
    if (!undoStack.length) return;
    const current = snapshot();
    const previous = undoStack.pop();
    redoStack.push(current);
    restoreSnapshot(previous);
  }

  function redo() {
    if (!redoStack.length) return;
    const current = snapshot();
    const next = redoStack.pop();
    undoStack.push(current);
    restoreSnapshot(next);
  }

  function captureSlot(key) {
    const slot = slots.get(key);
    if (!slot) return;
    const posterRect = poster.getBoundingClientRect();
    const rect = slot.getBoundingClientRect();
    if (!posterRect.width || !posterRect.height) return;
    const left = ((rect.left - posterRect.left) / posterRect.width) * W;
    const top = ((rect.top - posterRect.top) / posterRect.height) * H;
    const sizeFromWidth = (rect.width / posterRect.width) * W;
    const sizeFromHeight = (rect.height / posterRect.height) * H;
    setProjectSpec(key, { left, top, size: (sizeFromWidth + sizeFromHeight) / 2 });
  }

  function saveSelectedFromDom(before) {
    selected.forEach(key => captureSlot(key));
    selected.forEach(applyGeometry);
    saveLayout();
    commitHistory(before);
    moveable?.updateRect?.();
    updateToolbar();
  }

  function destroyMoveable() {
    if (moveableTimer) {
      clearTimeout(moveableTimer);
      moveableTimer = null;
    }
    moveable?.destroy?.();
    moveable = null;
  }

  function createMoveable(keys) {
    if (!window.Moveable || !keys.length) return null;
    const targets = keys.map(key => slots.get(key)).filter(Boolean);
    if (!targets.length) return null;
    const grouped = targets.length > 1;
    const instance = new window.Moveable(poster, {
      target: grouped ? targets : targets[0],
      draggable: true,
      scalable: !grouped,
      keepRatio: true,
      rotatable: false,
      origin: false,
      snappable: true,
      snapContainer: poster,
      snapThreshold: 5,
      throttleDrag: 0,
      throttleScale: 0,
    });
    let operationBefore = null;

    if (grouped) {
      instance.on('dragGroupStart', () => { operationBefore = snapshot(); });
      instance.on('dragGroup', event => {
        for (const child of event.events || []) {
          child.target.style.left = `${child.left}px`;
          child.target.style.top = `${child.top}px`;
        }
      });
      instance.on('dragGroupEnd', () => {
        saveSelectedFromDom(operationBefore);
        operationBefore = null;
      });
    } else {
      instance.on('dragStart', () => { operationBefore = snapshot(); });
      instance.on('drag', event => {
        event.target.style.left = `${event.left}px`;
        event.target.style.top = `${event.top}px`;
      });
      instance.on('dragEnd', () => {
        saveSelectedFromDom(operationBefore);
        operationBefore = null;
      });
      instance.on('scaleStart', event => {
        operationBefore = snapshot();
        event.set?.([1, 1]);
      });
      instance.on('scale', event => {
        const scale = Number(event.scale?.[0] || 1);
        const translate = event.drag?.beforeTranslate || [0, 0];
        event.target.style.transformOrigin = '0 0';
        event.target.style.transform = `translate(${translate[0]}px, ${translate[1]}px) scale(${scale})`;
      });
      instance.on('scaleEnd', () => {
        saveSelectedFromDom(operationBefore);
        operationBefore = null;
      });
    }
    return instance;
  }

  function rebuildMoveable() {
    if (moveableTimer) {
      clearTimeout(moveableTimer);
      moveableTimer = null;
    }
    moveable?.destroy?.();
    moveable = null;
    if (!active || !selected.size) return;
    moveable = createMoveable([...selected]);
  }

  function scheduleMoveableRebuild() {
    if (moveableTimer) clearTimeout(moveableTimer);
    moveableTimer = setTimeout(() => {
      moveableTimer = null;
      rebuildMoveable();
    }, 0);
  }

  function updateSelectionClasses() {
    slots.forEach((slot, key) => {
      const isSelected = selected.has(key);
      slot.classList.toggle('is-layout-selected', isSelected);
      slot.classList.toggle('is-layout-selected-multi', isSelected && selected.size > 1);
    });
  }

  function setSelection(next) {
    selected = new Set([...next].filter(key => slots.has(key)));
    updateSelectionClasses();
    updateToolbar();
    scheduleMoveableRebuild();
  }

  function clearSelection() {
    setSelection([]);
  }

  function selectKey(key, additive = false) {
    if (!active || !slots.has(key)) return;
    if (!additive) {
      if (selected.has(key)) return;
      setSelection([key]);
      return;
    }
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSelection(next);
  }

  const dock = document.createElement('div');
  dock.className = 'asset-layout-dock';
  dock.innerHTML = `
    <button type="button" class="asset-layout-mode-btn" data-asset-layout-mode aria-label="A 素材工具" data-tool-tip="A · 素材工具\n本项目的头像/二维码工具。选择后可拖动或缩放；双击重新裁剪。位置和尺寸会同步 Photoshop。"><span class="tool-key">A</span><span>素材工具</span></button>
    <div class="asset-layout-tools" data-asset-layout-tools hidden>
      <span class="asset-layout-count" data-asset-layout-count>未选择</span>
      <span class="asset-layout-readout" data-asset-layout-readout></span>
    </div>`;
  document.querySelector('.stage-area')?.appendChild(dock);

  const modeButton = dock.querySelector('[data-asset-layout-mode]');
  const tools = dock.querySelector('[data-asset-layout-tools]');
  const countLabel = dock.querySelector('[data-asset-layout-count]');
  const readout = dock.querySelector('[data-asset-layout-readout]');

  function nudgeSelection(dx, dy) {
    if (!selected.size) return;
    const before = snapshot();
    selected.forEach(key => {
      const spec = normalizeSpec(key, project.assetPreview[key]);
      setProjectSpec(key, { ...spec, left: spec.left + dx, top: spec.top + dy });
      applyGeometry(key);
    });
    saveLayout();
    commitHistory(before);
    moveable?.updateRect?.();
    updateToolbar();
  }

  function setMode(enabled) {
    active = Boolean(enabled);
    if (active) window.posterTextLayout?.setEnabled?.(false);
    poster.classList.toggle('is-asset-layout-mode', active);
    dock.classList.toggle('is-active', active);
    modeButton.classList.toggle('active', active);
    tools.hidden = !active;
    if (!active) clearSelection();
    updateToolbar();
  }

  slots.forEach((slot, key) => {
    slot.addEventListener('pointerdown', event => {
      if (!active || event.button !== 0) return;
      selectKey(key, event.metaKey || event.ctrlKey);
    });
    const suppressOpenEditor = event => {
      if (!active) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    slot.addEventListener('click', suppressOpenEditor, true);
    slot.addEventListener('dblclick', suppressOpenEditor, true);
  });

  modeButton.addEventListener('click', () => setMode(!active));
  document.querySelector('[data-layout-mode]')?.addEventListener('click', () => {
    if (active) setMode(false);
  }, true);

  function isEditingTarget(target) {
    return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
  }

  document.addEventListener('keydown', event => {
    if (!active) return;
    if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'z') {
      if (isEditingTarget(event.target)) return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      clearSelection();
      return;
    }
    if (isEditingTarget(event.target) || !selected.size) return;
    const step = event.shiftKey ? 10 : 1;
    const delta = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    }[event.key];
    if (!delta) return;
    event.preventDefault();
    nudgeSelection(delta[0], delta[1]);
  });

  window.addEventListener('resize', () => {
    applyAllGeometry();
    scheduleMoveableRebuild();
  });

  installStoredLayout();
  updateToolbar();

  window.posterAssetLayout = Object.freeze({
    setEnabled: setMode,
    isEnabled: () => active,
    getSelectedKeys: () => [...selected],
    getLayout: () => clone(currentLayout()),
    getStorageKey: () => STORAGE_KEY,
    clearSelection,
    nudge: nudgeSelection,
    undo,
    redo,
  });
})();
