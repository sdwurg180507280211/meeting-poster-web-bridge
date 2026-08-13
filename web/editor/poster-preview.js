(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const project = window.POSTER_PROJECT;
  if (!poster || !project?.textItems?.length) return;

  const W = project.canvas.width;
  const H = project.canvas.height;
  const STORAGE_KEY = `posterPreviewLayout:${project.id}`;
  const HISTORY_LIMIT = 60;
  const elements = new Map();
  const itemsById = new Map(project.textItems.map(item => [item.id, item]));
  let overrides = readOverrides();
  let layoutMode = false;
  let moveable = null;
  let moveableTimer = null;
  let selected = new Set();
  let marquee = null;
  let suppressPosterClick = false;
  const undoStack = [];
  const redoStack = [];

  function readOverrides() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
  }

  function cloneOverrides(value = overrides) {
    return JSON.parse(JSON.stringify(value || {}));
  }

  function saveOverrides() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
  }

  function layoutFor(item) {
    return { ...item, ...(overrides[item.id] || {}) };
  }

  function canvasScale() {
    return (poster.getBoundingClientRect().width || W) / W;
  }

  function applyGeometry(el, item) {
    if (!el || !item) return;
    const layout = layoutFor(item);
    const scale = Number(layout.scale || 1);
    const pxScale = canvasScale();
    el.style.left = `${(layout.x / W) * 100}%`;
    el.style.top = `${(layout.y / H) * 100}%`;
    el.style.width = `${(layout.width / W) * 100}%`;
    el.style.fontSize = `${layout.fontSize * pxScale}px`;
    el.style.fontWeight = String(layout.fontWeight || 500);
    el.style.color = layout.color || '#111';
    el.style.textAlign = layout.align || 'left';
    el.style.letterSpacing = `${Number(layout.letterSpacing || 0) * pxScale}px`;
    el.style.transformOrigin = '0 0';
    el.style.transform = `scale(${scale})`;
    el.dataset.previewScale = String(scale);
  }

  function applyAllGeometry() {
    project.textItems.forEach(item => applyGeometry(elements.get(item.id), item));
  }

  function resolveText(item) {
    if (typeof item.text === 'string') return item.text;
    const source = item.source;
    const input = source?.inputId ? document.getElementById(source.inputId) : null;
    const value = input?.value?.trim() || '';
    if (source?.type === 'personName') {
      const name = value.replace(/\s*教授\s*$/u, '').trim();
      return name ? `${name} 教授` : item.placeholder || '';
    }
    if (source?.type === 'meetingDate') {
      const date = value.split(/\s+/)[0] || '';
      return date ? `会议时间：${date}` : item.placeholder || '';
    }
    return value || item.placeholder || '';
  }

  function openEditor(edit) {
    if (!edit) return;
    window.posterEditor?.openSection?.(edit.section);
    if (edit.action === 'meetingTime') {
      window.posterTimeControls?.openMeeting?.();
      return;
    }
    if (edit.action === 'scheduleTime') {
      window.posterTimeControls?.openSchedule?.(edit.scheduleIndex);
      return;
    }
    if (edit.inputId) document.getElementById(edit.inputId)?.focus();
  }

  const dock = document.createElement('div');
  dock.className = 'text-layout-dock';
  dock.innerHTML = `
    <button type="button" class="text-layout-mode-btn" data-layout-mode title="选择文字并调整网页预览位置"><span class="tool-key">V</span><span>选择文字</span></button>
    <div class="text-layout-tools" data-layout-tools hidden>
      <span class="text-layout-count" data-layout-count>未选择</span>
      <button type="button" data-layout-action="undo" title="撤销 · Ctrl/Cmd+Z">↶</button>
      <button type="button" data-layout-action="redo" title="重做 · Ctrl/Cmd+Shift+Z">↷</button>
      <button type="button" data-layout-action="reset" title="重置当前项目的网页文字布局">重置</button>
    </div>`;
  document.querySelector('.stage-area')?.appendChild(dock);

  const modeButton = dock.querySelector('[data-layout-mode]');
  const tools = dock.querySelector('[data-layout-tools]');
  const countLabel = dock.querySelector('[data-layout-count]');

  function snapshotBeforeChange() {
    return cloneOverrides();
  }

  function commitHistory(before) {
    if (!before) return;
    if (JSON.stringify(before) === JSON.stringify(overrides)) return;
    undoStack.push(before);
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack.length = 0;
    updateToolbarState();
  }

  function restoreSnapshot(snapshot) {
    overrides = cloneOverrides(snapshot);
    saveOverrides();
    applyAllGeometry();
    scheduleMoveableRebuild();
    updateToolbarState();
  }

  function undo() {
    if (!undoStack.length) return;
    const current = cloneOverrides();
    const previous = undoStack.pop();
    redoStack.push(current);
    restoreSnapshot(previous);
  }

  function redo() {
    if (!redoStack.length) return;
    const current = cloneOverrides();
    const next = redoStack.pop();
    undoStack.push(current);
    restoreSnapshot(next);
  }

  function captureTargetLayout(target) {
    const id = target?.dataset?.previewTextId;
    if (!id) return;
    const item = itemsById.get(id);
    if (!item) return;
    const posterRect = poster.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    overrides[id] = {
      ...(overrides[id] || {}),
      x: ((targetRect.left - posterRect.left) / posterRect.width) * W,
      y: ((targetRect.top - posterRect.top) / posterRect.height) * H,
      scale: Number(target.dataset.previewScale || 1),
    };
  }

  function saveSelectedFromDom(before) {
    selected.forEach(el => captureTargetLayout(el));
    saveOverrides();
    selected.forEach(el => applyGeometry(el, itemsById.get(el.dataset.previewTextId)));
    commitHistory(before);
    moveable?.updateRect?.();
  }

  function destroyMoveable() {
    if (moveableTimer) {
      clearTimeout(moveableTimer);
      moveableTimer = null;
    }
    moveable?.destroy?.();
    moveable = null;
  }

  function createMoveable(targets) {
    if (!window.Moveable || !targets.length) return null;
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
    });
    let operationBefore = null;

    if (grouped) {
      instance.on('dragGroupStart', () => { operationBefore = snapshotBeforeChange(); });
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
      instance.on('dragStart', () => { operationBefore = snapshotBeforeChange(); });
      instance.on('drag', event => {
        event.target.style.left = `${event.left}px`;
        event.target.style.top = `${event.top}px`;
      });
      instance.on('dragEnd', () => {
        saveSelectedFromDom(operationBefore);
        operationBefore = null;
      });
      instance.on('scaleStart', event => {
        operationBefore = snapshotBeforeChange();
        const scale = Number(event.target.dataset.previewScale || 1);
        event.set?.([scale, scale]);
      });
      instance.on('scale', event => {
        const scale = Number(event.scale?.[0] || 1);
        event.target.style.transform = `scale(${scale})`;
        event.target.dataset.previewScale = String(scale);
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
    if (!layoutMode || !selected.size) return;
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
    for (const el of elements.values()) {
      const active = selected.has(el);
      el.classList.toggle('is-selected', active);
      el.classList.toggle('is-selected-multi', active && selected.size > 1);
    }
  }

  function updateToolbarState() {
    const count = selected.size;
    countLabel.textContent = count ? `已选 ${count} 项` : '未选择';
    dock.querySelector('[data-layout-action="undo"]').disabled = undoStack.length === 0;
    dock.querySelector('[data-layout-action="redo"]').disabled = redoStack.length === 0;
  }

  function setSelection(next) {
    selected = new Set([...next].filter(el => el && elements.has(el.dataset.previewTextId)));
    updateSelectionClasses();
    updateToolbarState();
    scheduleMoveableRebuild();
  }

  function clearSelection() {
    setSelection([]);
  }

  function selectElement(el, additive = false) {
    if (!layoutMode || !el) return;
    if (!additive) {
      if (selected.has(el)) return;
      setSelection([el]);
      return;
    }
    const next = new Set(selected);
    if (next.has(el)) next.delete(el);
    else next.add(el);
    setSelection(next);
  }

  function renderItem(item) {
    const el = document.createElement('div');
    el.className = 'poster-preview-text';
    el.dataset.previewTextId = item.id;
    el.textContent = resolveText(item);
    applyGeometry(el, item);
    poster.appendChild(el);
    elements.set(item.id, el);

    if (item.source?.inputId) {
      document.getElementById(item.source.inputId)?.addEventListener('input', () => {
        el.textContent = resolveText(item);
        if (selected.has(el)) moveable?.updateRect?.();
      });
    }

    el.addEventListener('pointerdown', event => {
      if (!layoutMode || event.button !== 0) return;
      event.stopPropagation();
      selectElement(el, event.metaKey || event.ctrlKey);
    });

    el.addEventListener('click', event => {
      event.stopPropagation();
      if (layoutMode) return;
      openEditor(item.edit);
    });
  }

  project.textItems.forEach(renderItem);

  function localPoint(event) {
    const rect = poster.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
      y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
    };
  }

  function startMarquee(event) {
    if (!layoutMode || event.button !== 0 || event.target !== poster) return;
    event.preventDefault();
    event.stopPropagation();
    const point = localPoint(event);
    const box = document.createElement('div');
    box.className = 'text-selection-marquee';
    poster.appendChild(box);
    marquee = {
      pointerId: event.pointerId,
      start: point,
      current: point,
      box,
      additive: event.metaKey || event.ctrlKey,
      baseSelection: new Set(selected),
      moved: false,
    };
    try { poster.setPointerCapture(event.pointerId); } catch (_) {}
  }

  function updateMarquee(event) {
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    const point = localPoint(event);
    marquee.current = point;
    const left = Math.min(marquee.start.x, point.x);
    const top = Math.min(marquee.start.y, point.y);
    const width = Math.abs(point.x - marquee.start.x);
    const height = Math.abs(point.y - marquee.start.y);
    marquee.moved = marquee.moved || Math.hypot(width, height) > 3;
    Object.assign(marquee.box.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });
  }

  function finishMarquee(event) {
    if (!marquee || event.pointerId !== marquee.pointerId) return;
    const state = marquee;
    marquee = null;
    try {
      if (poster.hasPointerCapture?.(state.pointerId)) poster.releasePointerCapture(state.pointerId);
    } catch (_) {}
    state.box.remove();

    if (!state.moved) {
      if (!state.additive) clearSelection();
      return;
    }

    const posterRect = poster.getBoundingClientRect();
    const x1 = posterRect.left + Math.min(state.start.x, state.current.x);
    const y1 = posterRect.top + Math.min(state.start.y, state.current.y);
    const x2 = posterRect.left + Math.max(state.start.x, state.current.x);
    const y2 = posterRect.top + Math.max(state.start.y, state.current.y);
    const next = state.additive ? new Set(state.baseSelection) : new Set();
    for (const el of elements.values()) {
      const rect = el.getBoundingClientRect();
      const intersects = rect.right >= x1 && rect.left <= x2 && rect.bottom >= y1 && rect.top <= y2;
      if (intersects) next.add(el);
    }
    setSelection(next);
    suppressPosterClick = true;
  }

  poster.addEventListener('pointerdown', startMarquee);
  poster.addEventListener('pointermove', updateMarquee);
  poster.addEventListener('pointerup', finishMarquee);
  poster.addEventListener('pointercancel', finishMarquee);
  poster.addEventListener('click', event => {
    if (!layoutMode || event.target !== poster) return;
    if (suppressPosterClick) {
      suppressPosterClick = false;
      return;
    }
    clearSelection();
  });

  function setItemPosition(id, x, y) {
    const item = itemsById.get(id);
    if (!item) return;
    overrides[id] = {
      ...(overrides[id] || {}),
      x,
      y,
    };
    applyGeometry(elements.get(id), item);
  }

  function nudgeSelection(dx, dy) {
    if (!selected.size) return;
    const before = snapshotBeforeChange();
    for (const el of selected) {
      const id = el.dataset.previewTextId;
      const item = itemsById.get(id);
      const layout = layoutFor(item);
      setItemPosition(id, Math.round(Number(layout.x || 0) + dx), Math.round(Number(layout.y || 0) + dy));
    }
    saveOverrides();
    commitHistory(before);
    moveable?.updateRect?.();
  }

  function resetLayout() {
    if (!Object.keys(overrides).length) return;
    const before = snapshotBeforeChange();
    overrides = {};
    localStorage.removeItem(STORAGE_KEY);
    applyAllGeometry();
    commitHistory(before);
    scheduleMoveableRebuild();
  }

  function setLayoutMode(enabled) {
    layoutMode = Boolean(enabled);
    poster.classList.toggle('is-text-layout-mode', layoutMode);
    dock.classList.toggle('is-active', layoutMode);
    modeButton.classList.toggle('active', layoutMode);
    modeButton.querySelector('span:last-child').textContent = layoutMode ? '完成布局' : '选择文字';
    tools.hidden = !layoutMode;
    if (!layoutMode) clearSelection();
    updateToolbarState();
  }

  modeButton.addEventListener('click', () => setLayoutMode(!layoutMode));

  dock.addEventListener('click', event => {
    const action = event.target.closest('button')?.dataset?.layoutAction;
    if (action === 'undo') undo();
    else if (action === 'redo') redo();
    else if (action === 'reset') resetLayout();
  });

  function isEditingTarget(target) {
    return target instanceof Element && Boolean(target.closest('input,textarea,select,[contenteditable="true"]'));
  }

  document.addEventListener('keydown', event => {
    if (!layoutMode) return;
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

  updateToolbarState();
  window.posterTextLayout = Object.freeze({
    setEnabled: setLayoutMode,
    isEnabled: () => layoutMode,
    getSelectedIds: () => [...selected].map(el => el.dataset.previewTextId),
    clearSelection,
    nudge: nudgeSelection,
    undo,
    redo,
    reset: resetLayout,
  });
})();