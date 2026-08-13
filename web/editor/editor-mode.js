(() => {
  const poster = document.getElementById('posterCanvas');
  const project = window.POSTER_PROJECT;
  if (!poster || !project) return;

  const W = project.canvas.width;
  const H = project.canvas.height;
  const avatarSpec = project.assetPreview;
  const qrSpec = project.assetPreview.qr;

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

  document.addEventListener('dblclick', event => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target || !poster.contains(target)) return;
    const preview = target.closest('.poster-preview-text');
    if (!preview) return;
    event.preventDefault();
    event.stopPropagation();
    window.posterTextLayout?.beginInlineEdit?.(preview.dataset.previewTextId);
  }, true);
})();
