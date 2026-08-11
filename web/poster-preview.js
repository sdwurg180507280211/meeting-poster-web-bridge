(() => {
  const poster = document.getElementById('posterCanvas');
  const project = window.POSTER_PROJECT;
  const toggleButton = document.getElementById('toggleTextLayout');
  const resetButton = document.getElementById('resetTextLayout');
  const hint = document.getElementById('posterMouseHint');
  if (!poster || !project?.textItems?.length) return;

  const W = project.canvas.width;
  const H = project.canvas.height;
  const STORAGE_KEY = `posterPreviewLayout:${project.id}`;
  const elements = new Map();
  let overrides = readOverrides();
  let layoutMode = false;
  let moveable = null;
  let selected = null;

  function readOverrides() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return value && typeof value === 'object' ? value : {};
    } catch (_) {
      return {};
    }
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
        if (selected === el) moveable?.updateRect?.();
      });
    }

    el.addEventListener('click', event => {
      event.stopPropagation();
      if (layoutMode) {
        selectText(el);
        return;
      }
      openEditor(item.edit);
    });
  }

  project.textItems.forEach(renderItem);

  function createMoveable(target) {
    if (!window.Moveable) return null;
    const instance = new window.Moveable(poster, {
      target,
      draggable: true,
      scalable: true,
      keepRatio: true,
      rotatable: false,
      origin: false,
      snappable: true,
      snapContainer: poster,
      snapThreshold: 5,
    });

    instance.on('drag', event => {
      event.target.style.left = `${event.left}px`;
      event.target.style.top = `${event.top}px`;
    });

    instance.on('dragEnd', event => {
      saveTargetLayout(event.target);
    });

    instance.on('scaleStart', event => {
      const scale = Number(event.target.dataset.previewScale || 1);
      event.set?.([scale, scale]);
    });

    instance.on('scale', event => {
      const scale = Number(event.scale?.[0] || 1);
      event.target.style.transform = `scale(${scale})`;
      event.target.dataset.previewScale = String(scale);
    });

    instance.on('scaleEnd', event => {
      saveTargetLayout(event.target);
    });

    return instance;
  }

  function saveTargetLayout(target) {
    const id = target?.dataset?.previewTextId;
    if (!id) return;
    const item = project.textItems.find(entry => entry.id === id);
    if (!item) return;
    const posterRect = poster.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const scale = Number(target.dataset.previewScale || 1);
    overrides[id] = {
      x: ((targetRect.left - posterRect.left) / posterRect.width) * W,
      y: ((targetRect.top - posterRect.top) / posterRect.height) * H,
      scale,
    };
    saveOverrides();
    applyGeometry(target, item);
    moveable?.updateRect?.();
  }

  function selectText(el) {
    if (!layoutMode || selected === el) return;
    moveable?.destroy?.();
    selected?.classList.remove('is-selected');
    selected = el;
    selected.classList.add('is-selected');
    moveable = createMoveable(selected);
  }

  function clearSelection() {
    moveable?.destroy?.();
    moveable = null;
    selected?.classList.remove('is-selected');
    selected = null;
  }

  function setLayoutMode(enabled) {
    layoutMode = Boolean(enabled);
    poster.classList.toggle('is-text-layout-mode', layoutMode);
    toggleButton?.classList.toggle('active', layoutMode);
    if (toggleButton) toggleButton.textContent = layoutMode ? '完成文字布局' : '调整文字布局';
    if (resetButton) resetButton.hidden = !layoutMode;
    if (hint) hint.textContent = layoutMode
      ? '布局模式：拖动文字改位置 · 拖控制点缩放文字 · 仅影响网页展示'
      : '点击海报文字直接编辑 · 图片裁剪会影响 Photoshop 输出';
    if (!layoutMode) clearSelection();
  }

  toggleButton?.addEventListener('click', () => setLayoutMode(!layoutMode));
  resetButton?.addEventListener('click', () => {
    overrides = {};
    localStorage.removeItem(STORAGE_KEY);
    clearSelection();
    project.textItems.forEach(item => applyGeometry(elements.get(item.id), item));
  });

  poster.addEventListener('click', () => {
    if (layoutMode) clearSelection();
  });

  window.addEventListener('resize', () => {
    if (layoutMode) clearSelection();
    project.textItems.forEach(item => applyGeometry(elements.get(item.id), item));
  });
})();
