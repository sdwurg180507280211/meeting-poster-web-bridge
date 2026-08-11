(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const viewport = document.querySelector('.poster-viewport');
  const toolbarActions = document.querySelector('.stage-toolbar-actions');
  const hint = document.getElementById('posterMouseHint');
  const layoutButton = document.getElementById('toggleTextLayout');
  const clearLocalData = document.getElementById('clearLocalData');
  const toggleInspector = document.getElementById('toggleInspector');
  const jobStatus = document.getElementById('jobStatus');
  const taskTab = document.querySelector('.inspector-tab[data-tab="task"]');
  const project = window.POSTER_PROJECT;

  function nextFrame(fn) {
    requestAnimationFrame(() => requestAnimationFrame(fn));
  }

  function installSemanticsLegend() {
    if (!toolbarActions || toolbarActions.querySelector('.output-semantics')) return;
    const legend = document.createElement('div');
    legend.className = 'output-semantics';
    legend.setAttribute('aria-label', '网页预览与 Photoshop 输出说明');
    legend.innerHTML = [
      '<span class="sync-chip sync">同步 PSD：文字内容 · 图片裁剪结果</span>',
      '<span class="sync-chip preview">仅网页预览：文字位置 · 文字大小</span>',
    ].join('');
    toolbarActions.insertBefore(legend, toolbarActions.firstChild);
  }

  function refreshLayoutCopy() {
    if (!layoutButton) return;
    const active = layoutButton.classList.contains('active');
    layoutButton.textContent = active ? '完成预览文字布局' : '调整预览文字布局';
    if (hint) {
      hint.textContent = active
        ? '预览布局模式：可拖动/缩放文字；不会改变 PSD 中的文字位置和字号'
        : '点击文字编辑内容 · 应用后的图片裁剪结果会同步 Photoshop';
    }
  }

  function installLayoutCopy() {
    refreshLayoutCopy();
    layoutButton?.addEventListener('click', () => queueMicrotask(refreshLayoutCopy));

    const avatarHelp = document.querySelector('#avatarCropModal .crop-help');
    if (avatarHelp) avatarHelp.textContent = '圆形区域就是最终头像可见范围；点击“应用裁剪”后会固化为 1024×1024 PNG，并同步给 Photoshop。';
  }

  function installZoomControls() {
    if (!poster || !viewport || !toolbarActions || toolbarActions.querySelector('.zoom-controls')) return;

    const controls = document.createElement('div');
    controls.className = 'zoom-controls';
    controls.setAttribute('aria-label', '海报预览缩放');
    controls.innerHTML = `
      <button type="button" data-zoom="out" title="缩小预览">−</button>
      <button type="button" data-zoom="fit" title="适应窗口">适应</button>
      <span class="zoom-value">100%</span>
      <button type="button" data-zoom="in" title="放大预览">＋</button>`;

    const firstLayoutTool = toolbarActions.querySelector('.layout-tool-btn');
    toolbarActions.insertBefore(controls, firstLayoutTool || null);

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
      if (!action) return;
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
  }

  function decorateSchedule() {
    const labels = ['时间', '内容', '讲者', '主席'];
    const classes = ['time', 'content', 'speaker', 'chair'];
    document.querySelectorAll('.schedule-row').forEach(row => {
      if (row.classList.contains('schedule-card')) return;
      const inputs = Array.from(row.children).filter(el => el.tagName === 'INPUT');
      if (inputs.length !== 4) return;
      row.classList.add('schedule-card');
      inputs.forEach((input, index) => {
        const label = document.createElement('label');
        label.className = `schedule-field schedule-field-${classes[index]}`;
        const caption = document.createElement('span');
        caption.textContent = labels[index];
        input.parentNode.insertBefore(label, input);
        label.append(caption, input);
      });
    });
  }

  function installUtilityMenu() {
    if (!clearLocalData || !toggleInspector || document.querySelector('.utility-menu')) return;
    const parent = clearLocalData.parentNode;
    const menu = document.createElement('details');
    menu.className = 'utility-menu';
    const summary = document.createElement('summary');
    summary.className = 'icon-btn';
    summary.title = '更多操作';
    summary.setAttribute('aria-label', '更多操作');
    summary.textContent = '⋯';
    const popover = document.createElement('div');
    popover.className = 'utility-menu-popover';
    popover.innerHTML = '<div class="utility-menu-title">本机工具</div>';
    const note = document.createElement('small');
    note.className = 'utility-menu-note';
    note.textContent = '清除本机草稿、素材缓存与匿名历史身份。不会删除云端已生成的任务。';

    parent.insertBefore(menu, clearLocalData);
    menu.append(summary, popover);
    popover.append(clearLocalData, note);

    clearLocalData.addEventListener('click', () => {
      menu.open = false;
    });

    document.addEventListener('click', event => {
      if (menu.open && !menu.contains(event.target)) menu.open = false;
    });
  }

  function installTaskBadge() {
    if (!taskTab || !jobStatus) return;
    let badge = taskTab.querySelector('.task-tab-badge');
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'task-tab-badge';
      badge.hidden = true;
      taskTab.appendChild(badge);
    }

    function sync() {
      const text = (jobStatus.textContent || '').trim();
      badge.className = 'task-tab-badge';
      if (!text || text.includes('尚未提交')) {
        badge.hidden = true;
        return;
      }
      badge.hidden = false;
      if (/失败|failed|错误/i.test(text)) {
        badge.textContent = '!';
        badge.classList.add('bad');
      } else if (/完成|成功|succeeded/i.test(text)) {
        badge.textContent = '✓';
        badge.classList.add('ok');
      } else {
        badge.textContent = '•';
        badge.classList.add('active');
      }
    }

    new MutationObserver(sync).observe(jobStatus, { childList: true, subtree: true, characterData: true, attributes: true });
    sync();
  }

  function pulseSection(sectionName, child) {
    const section = document.querySelector(`.editor-section[data-section="${sectionName}"]`);
    if (!section) return;
    section.open = true;
    section.classList.remove('is-linked');
    child?.classList?.remove('is-linked');
    void section.offsetWidth;
    section.classList.add('is-linked');
    child?.classList?.add('is-linked');
    section.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setTimeout(() => {
      section.classList.remove('is-linked');
      child?.classList?.remove('is-linked');
    }, 1200);
  }

  function installInspectorLinking() {
    const editor = window.posterEditor;
    if (editor?.openSection && !editor.__interactionPolished) {
      const original = editor.openSection.bind(editor);
      editor.openSection = name => {
        original(name);
        nextFrame(() => pulseSection(name));
      };
      editor.__interactionPolished = true;
    }

    const people = Array.from(document.querySelectorAll('#people .person'));
    ['chair', 'speaker1', 'speaker2'].forEach((key, index) => {
      const card = people[index];
      if (card) card.dataset.personKey = key;
      const slot = document.querySelector(`.canvas-avatar-slot[data-key="${key}"]`);
      if (!slot) return;
      slot.addEventListener('click', () => {
        document.querySelectorAll('.canvas-avatar-slot.is-active').forEach(el => el.classList.remove('is-active'));
        slot.classList.add('is-active');
        pulseSection('people', card);
        setTimeout(() => slot.classList.remove('is-active'), 1400);
      });
    });

    const qrSlot = document.querySelector('.canvas-qr-slot');
    qrSlot?.addEventListener('click', () => {
      qrSlot.classList.add('is-active');
      pulseSection('qr');
      setTimeout(() => qrSlot.classList.remove('is-active'), 1400);
    });

    const inputToPreview = new Map();
    project?.textItems?.forEach(item => {
      const id = item.source?.inputId;
      if (!id) return;
      const preview = document.querySelector(`[data-preview-text-id="${item.id}"]`);
      if (preview) inputToPreview.set(id, preview);
    });

    document.getElementById('editTab')?.addEventListener('focusin', event => {
      const preview = inputToPreview.get(event.target?.id);
      if (!preview) return;
      document.querySelectorAll('.poster-preview-text.is-linked').forEach(el => el.classList.remove('is-linked'));
      preview.classList.add('is-linked');
    });
    document.getElementById('editTab')?.addEventListener('focusout', event => {
      inputToPreview.get(event.target?.id)?.classList.remove('is-linked');
    });
  }

  installSemanticsLegend();
  installLayoutCopy();
  installZoomControls();
  decorateSchedule();
  installUtilityMenu();
  installTaskBadge();
  installInspectorLinking();
})();
