(() => {
  const poster = document.getElementById('posterCanvas');
  if (!poster) return;

  const W = 837;
  const H = 1880;

  async function loadRealPosterBase() {
    let canvas = poster.querySelector('.poster-real-base-canvas');
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.className = 'poster-real-base-canvas';
      canvas.width = W;
      canvas.height = H;
      Object.assign(canvas.style, {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        display: 'block',
        pointerEvents: 'none',
        zIndex: '0',
      });
      poster.prepend(canvas);
    }

    const response = await fetch(`poster-real-base.css?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`底板资源读取失败：HTTP ${response.status}`);
    const cssText = await response.text();
    const match = cssText.match(/data:image\/jpeg;base64,([^"')\s]+)/i);
    if (!match) throw new Error('底板 CSS 中未找到 JPEG 数据');

    const binary = atob(match[1]);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);

    const blob = new Blob([bytes], { type: 'image/jpeg' });
    const bitmap = await createImageBitmap(blob);
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('无法创建底板 Canvas');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(bitmap, 0, 0, W, H);
    bitmap.close?.();

    poster.dataset.realBase = 'loaded';
    console.info('[poster-base] real poster base rendered to canvas');
  }

  loadRealPosterBase().catch(err => {
    poster.dataset.realBase = 'failed';
    console.error('[poster-base] load failed', err);
  });
})();
