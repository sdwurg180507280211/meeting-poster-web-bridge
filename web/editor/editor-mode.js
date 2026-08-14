(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const project = window.POSTER_PROJECT;
  if (!poster || !project) return;

  const W = project.canvas.width;
  const H = project.canvas.height;
  const avatarSpec = project.assetPreview;
  const qrSpec = project.assetPreview.qr;
  const itemsById = new Map((project.textItems || []).map(item => [item.id, item]));
  const MOBILE_QUERY = '(max-width: 760px)';
  const MOBILE_EDITOR_GAP = 10;
  const MOBILE_EDITOR_MARGIN = 12;
  let mobileEdit = null;

  function pct(value, total) {
    return `${(value / total) * 100}%`;
  }

  function createAvatarSlot(key, spec) {
    const slot = document.createElement('div');
    slot.className = 'canvas-avatar-slot canvas-asset-slot';
    slot.dataset.key = key;
    slot.style.left = pct(spec.left, W);
    slot.style.top = pct(spec.top, H);
    slot.style.width = pct(spec.size, W);
    slot.style.height = pct(spec.size, H);
    slot.innerHTML = `<img alt="${spec.label}头像">`;
    poster.appendChild(slot);

    const img = slot.querySelector('img');
    const file = document.getElementById(`${key}-file`);
    const zoom = document.getElementById(`${key}-zoom`);
    const sx = document.getElementById(`${key}-x`);
    const sy = document.getElementById(`${key}-y`);

    function syncPreview() {
      if (!img.naturalWidth) return;
      const box = slot.getBoundingClientRect().width || 1;
      const z = Number(zoom?.value || 100) / 100;
      const x = Number(sx?.value || 0);
      const y = Number(sy?.value || 0);
      const cover = Math.max(box / img.naturalWidth, box / img.naturalHeight);
      const width = img.naturalWidth * cover * z;
      const height = img.naturalHeight * cover * z;
      img.style.inset = 'auto';
      img.style.width = `${width}px`;
      img.style.height = `${height}px`;
      img.style.left = `${(box - width) / 2 + (x / 100) * box}px`;
      img.style.top = `${(box - height) / 2 + (y / 100) * box}px`;
      img.style.transform = 'none';
      img.style.objectFit = 'initial';
    }

    file?.addEventListener('change', () => {
      const selectedFile = file.files?.[0];
      if (!selectedFile) return;
      const url = URL.createObjectURL(selectedFile);
      img.onload = () => {
        syncPreview();
        URL.revokeObjectURL(url);
      };
      img.src = url;
      img.style.display = 'block';
    });

    [zoom, sx, sy].forEach(control => control?.addEventListener('input', syncPreview));

    slot.addEventListener('click', () => {
      if (poster.classList.contains('is-asset-layout-mode')) return;
      if (window.posterAvatarCrop?.open) window.posterAvatarCrop.open(key);
      else if (!file?.files?.length) file?.click();
    });

    document.addEventListener('avatar-crop-applied', event => {
      if (event.detail?.key === key) syncPreview();
    });
    window.addEventListener('resize', syncPreview);
  }

  ['chair', 'speaker1', 'speaker2'].forEach(key => createAvatarSlot(key, avatarSpec[key]));

  const qrSlot = document.createElement('div');
  qrSlot.className = 'canvas-qr-slot canvas-asset-slot';
  qrSlot.dataset.key = 'qr';
  qrSlot.style.left = pct(qrSpec.left, W);
  qrSlot.style.top = pct(qrSpec.top, H);
  qrSlot.style.width = pct(qrSpec.size, W);
  qrSlot.style.height = pct(qrSpec.size, H);
  qrSlot.innerHTML = '<img alt="二维码">';
  poster.appendChild(qrSlot);

  const qrImg = qrSlot.querySelector('img');
  const qrInput = document.getElementById('qrFile');

  qrSlot.addEventListener('click', () => {
    if (poster.classList.contains('is-asset-layout-mode')) return;
    if (window.posterQrCrop?.open) window.posterQrCrop.open();
    else if (!qrInput?.files?.length) qrInput?.click();
  });

  document.addEventListener('qr-crop-applied', event => {
    const url = event.detail?.previewUrl;
    if (!url) return;
    qrImg.src = url;
    qrImg.style.display = 'block';
    qrImg.style.width = '100%';
    qrImg.style.height = '100%';
    qrImg.style.objectFit = 'cover';
    qrImg.style.transform = 'none';
  });

  function isMobileViewport() {
    return window.matchMedia?.(MOBILE_QUERY)?.matches === true;
  }

  function mobileTitle(item) {
    if (item?.source?.type === 'personName') return '编辑姓名';
    if (item?.source?.type === 'meetingDate') return '编辑会议时间';
    if (item?.edit?.action === 'scheduleTime') return '编辑日程时间';
    if (item?.id?.includes('hospital')) return '编辑医院';
    return '编辑文字';
  }

  function mobilePlaceholder(item) {
    if (item?.source?.type === 'personName') return '请输入姓名';
    if (item?.source?.type === 'meetingDate') return '例如：2026年8月12日 19:00-21:30';
    if (item?.edit?.action === 'scheduleTime') return '例如：19:00-19:30';
    return item?.placeholder || '请输入文字';
  }

  function normalizeMobileValue(item, value) {
    let next = String(value || '').replace(/\u00a0/g, ' ').trim();
    if (item?.source?.type === 'personName') next = next.replace(/\s*教授\s*$/u, '').trim();
    if (item?.source?.type === 'meetingDate') next = next.replace(/^会议时间\s*[:：]\s*/u, '').trim();
    return next;
  }

  function ensureMobileEditor() {
    let layer = document.querySelector('.mobile-text-popover-layer');
    if (layer) return layer;

    layer = document.createElement('div');
    layer.className = 'mobile-text-popover-layer';
    layer.hidden = true;
    layer.innerHTML = `
      <div class="mobile-text-popover" role="dialog" aria-modal="true" aria-labelledby="mobileTextTitle">
        <div class="mobile-text-popover-head">
          <strong id="mobileTextTitle">编辑文字</strong>
          <button type="button" data-mobile-text-close aria-label="关闭">×</button>
        </div>
        <input class="mobile-text-popover-input" type="text" autocomplete="off" enterkeyhint="done" inputmode="text" />
        <div class="mobile-text-popover-actions">
          <button type="button" data-mobile-text-cancel>取消</button>
          <button type="button" class="primary" data-mobile-text-apply>完成</button>
        </div>
      </div>`;
    document.body.appendChild(layer);

    const field = layer.querySelector('.mobile-text-popover-input');
    const close = () => closeMobileEditor(false);
    layer.querySelector('[data-mobile-text-close]')?.addEventListener('click', close);
    layer.querySelector('[data-mobile-text-cancel]')?.addEventListener('click', close);
    layer.querySelector('[data-mobile-text-apply]')?.addEventListener('click', () => closeMobileEditor(true));
    layer.addEventListener('click', event => {
      if (event.target === layer) closeMobileEditor(false);
    });
    field?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        closeMobileEditor(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        closeMobileEditor(false);
      }
    });
    return layer;
  }

  function mobileViewportSnapshot(source = window.visualViewport) {
    return {
      offsetTop: Math.max(0, Number(source?.offsetTop || 0)),
      offsetLeft: Math.max(0, Number(source?.offsetLeft || 0)),
      width: Math.max(1, Number(source?.width || window.innerWidth || 1)),
      height: Math.max(1, Number(source?.height || window.innerHeight || 1)),
    };
  }

  function syncMobileEditor(source = window.visualViewport) {
    const layer = document.querySelector('.mobile-text-popover-layer:not([hidden])');
    const state = mobileEdit;
    if (!layer || !state?.anchor || !isMobileViewport()) return;

    const viewport = mobileViewportSnapshot(source);
    layer.style.left = `${viewport.offsetLeft}px`;
    layer.style.top = `${viewport.offsetTop}px`;
    layer.style.right = 'auto';
    layer.style.bottom = 'auto';
    layer.style.width = `${viewport.width}px`;
    layer.style.height = `${viewport.height}px`;

    const panel = layer.querySelector('.mobile-text-popover');
    if (!panel) return;
    const anchorRect = state.anchor.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || Math.min(340, viewport.width - MOBILE_EDITOR_MARGIN * 2);
    const panelHeight = panelRect.height || 150;

    const anchorCenter = anchorRect.left - viewport.offsetLeft + anchorRect.width / 2;
    const minLeft = MOBILE_EDITOR_MARGIN;
    const maxLeft = Math.max(minLeft, viewport.width - panelWidth - MOBILE_EDITOR_MARGIN);
    const left = Math.min(maxLeft, Math.max(minLeft, anchorCenter - panelWidth / 2));

    const anchorTop = anchorRect.top - viewport.offsetTop;
    const anchorBottom = anchorRect.bottom - viewport.offsetTop;
    const minTop = MOBILE_EDITOR_MARGIN;
    const maxTop = Math.max(minTop, viewport.height - panelHeight - MOBILE_EDITOR_MARGIN);
    const below = anchorBottom + MOBILE_EDITOR_GAP;
    const above = anchorTop - panelHeight - MOBILE_EDITOR_GAP;
    let top = below <= maxTop ? below : above;
    top = Math.min(maxTop, Math.max(minTop, top));

    panel.style.left = `${Math.round(left)}px`;
    panel.style.top = `${Math.round(top)}px`;
  }

  function openMobileEditor(item, anchor) {
    const inputId = item?.source?.inputId;
    const input = inputId ? document.getElementById(inputId) : null;
    if (!input || input.disabled || !anchor) return false;

    const layer = ensureMobileEditor();
    const field = layer.querySelector('.mobile-text-popover-input');
    layer.querySelector('#mobileTextTitle').textContent = mobileTitle(item);
    field.placeholder = mobilePlaceholder(item);
    field.value = String(input.value || '');
    mobileEdit = { item, input, anchor };
    anchor.classList.add('is-mobile-editing');
    layer.hidden = false;
    document.body.classList.add('mobile-text-editor-open');
    syncMobileEditor();
    requestAnimationFrame(() => {
      syncMobileEditor();
      field.focus({ preventScroll: true });
      field.select();
      requestAnimationFrame(() => syncMobileEditor());
    });
    return true;
  }

  function closeMobileEditor(commit) {
    const layer = document.querySelector('.mobile-text-popover-layer');
    const state = mobileEdit;
    if (!layer || !state) {
      if (layer) layer.hidden = true;
      mobileEdit = null;
      document.body.classList.remove('mobile-text-editor-open');
      return;
    }

    if (commit) {
      const field = layer.querySelector('.mobile-text-popover-input');
      const value = normalizeMobileValue(state.item, field?.value || '');
      if (state.input.value !== value) {
        state.input.value = value;
        state.input.dispatchEvent(new Event('input', { bubbles: true }));
        state.input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    state.anchor?.classList.remove('is-mobile-editing');
    mobileEdit = null;
    layer.hidden = true;
    document.body.classList.remove('mobile-text-editor-open');
  }

  const visualViewport = window.visualViewport;
  visualViewport?.addEventListener('resize', () => syncMobileEditor());
  visualViewport?.addEventListener('scroll', () => syncMobileEditor());
  window.addEventListener('resize', () => syncMobileEditor());
  window.posterMobileTextEditor = Object.freeze({ syncViewport: syncMobileEditor });

  document.addEventListener('click', event => {
    if (!isMobileViewport() || window.posterLayoutTool?.isEnabled?.()) return;
    const target = event.target instanceof Element ? event.target : null;
    const preview = target?.closest('.poster-preview-text');
    if (!preview || !poster.contains(preview)) return;
    const item = itemsById.get(preview.dataset.previewTextId);
    if (!item?.source?.inputId) return;
    if (!openMobileEditor(item, preview)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
  }, true);

  document.addEventListener('dblclick', event => {
    if (isMobileViewport()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !poster.contains(target)) return;
    const preview = target.closest('.poster-preview-text');
    if (!preview) return;
    event.preventDefault();
    event.stopPropagation();
    window.posterTextLayout?.beginInlineEdit?.(preview.dataset.previewTextId);
  }, true);

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && mobileEdit) closeMobileEditor(false);
  });
})();
