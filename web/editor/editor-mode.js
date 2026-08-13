(() => {
  const poster = document.getElementById('posterCanvas');
  const workspace = document.getElementById('editorWorkspace');
  const inspector = document.getElementById('inspector');
  const project = window.POSTER_PROJECT;
  if (!poster || !workspace || !inspector || !project) return;

  const W = project.canvas.width;
  const H = project.canvas.height;
  const avatarSpec = project.assetPreview;
  const qrSpec = project.assetPreview.qr;

  function pct(value, total) {
    return `${(value / total) * 100}%`;
  }

  function showTab(name) {
    document.querySelectorAll('.inspector-tab').forEach(button => {
      button.classList.toggle('active', button.dataset.tab === name);
    });
    document.getElementById('editTab')?.classList.toggle('active', name === 'edit');
    document.getElementById('taskTab')?.classList.toggle('active', name === 'task');
  }

  function expandInspector() {
    workspace.classList.remove('inspector-collapsed');
  }

  function collapseInspector() {
    workspace.classList.add('inspector-collapsed');
  }

  function openSection(name) {
    document.querySelectorAll('.editor-section').forEach(section => {
      if (section.dataset.section === name) section.open = true;
    });
    showTab('edit');
    expandInspector();
  }

  function openTextEditor(edit) {
    if (!edit) return;
    openSection(edit.section);
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

  window.posterEditor = { openSection, showTab, expandInspector };

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

    function openAvatarEditor() {
      if (poster.classList.contains('is-asset-layout-mode')) return;
      openSection('people');
      if (window.posterAvatarCrop?.open) window.posterAvatarCrop.open(key);
      else if (!file?.files?.length) file?.click();
    }

    slot.addEventListener('click', openAvatarEditor);
    slot.addEventListener('dblclick', openAvatarEditor);
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

  function openQrEditor() {
    if (poster.classList.contains('is-asset-layout-mode')) return;
    openSection('qr');
    if (window.posterQrCrop?.open) window.posterQrCrop.open();
    else if (!qrInput?.files?.length) qrInput?.click();
  }

  qrSlot.addEventListener('click', openQrEditor);
  qrSlot.addEventListener('dblclick', openQrEditor);
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

  document.addEventListener('dblclick', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !poster.contains(target)) return;

    if (poster.classList.contains('is-asset-layout-mode')) {
      const slot = target.closest('.canvas-asset-slot');
      if (!slot) return;
      event.preventDefault();
      event.stopPropagation();
      const key = slot.dataset.key;
      if (key === 'qr') {
        openSection('qr');
        if (window.posterQrCrop?.open) window.posterQrCrop.open();
        else if (!qrInput?.files?.length) qrInput?.click();
        return;
      }
      const file = document.getElementById(`${key}-file`);
      openSection('people');
      if (window.posterAvatarCrop?.open) window.posterAvatarCrop.open(key);
      else if (!file?.files?.length) file?.click();
      return;
    }

    if (poster.classList.contains('is-text-layout-mode')) {
      const preview = target.closest('.poster-preview-text');
      if (!preview) return;
      const item = project.textItems?.find(candidate => candidate.id === preview.dataset.previewTextId);
      if (!item?.edit) return;
      event.preventDefault();
      event.stopPropagation();
      openTextEditor(item.edit);
    }
  }, true);

  document.getElementById('collapseInspector')?.addEventListener('click', collapseInspector);
  document.getElementById('toggleInspector')?.addEventListener('click', () => {
    workspace.classList.toggle('inspector-collapsed');
  });
  document.getElementById('openInspector')?.addEventListener('click', expandInspector);
  document.querySelectorAll('.inspector-tab').forEach(button => {
    button.addEventListener('click', () => showTab(button.dataset.tab));
  });
  window.__posterShowTaskTab = () => {
    showTab('task');
    expandInspector();
  };
  document.getElementById('jobStatus')?.addEventListener('click', () => showTab('task'));
})();