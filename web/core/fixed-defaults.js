(() => {
  document.title = '简化版 Photoshop 海报编辑器';
  const metaDescription = document.querySelector('meta[name="description"]');
  if (metaDescription) metaDescription.content = '简化版 Photoshop 海报编辑器：直接在海报上编辑文字、时间与素材，并通过本地 Photoshop PSD 母版生成 PNG。';

  const brandTitle = document.querySelector('.brand h1');
  const brandSubtitle = document.querySelector('.brand p');
  if (brandTitle) brandTitle.textContent = '简化版 Photoshop 海报编辑器';
  if (brandSubtitle) brandSubtitle.textContent = '海报内直接编辑 · Photoshop 母版生成 PNG';

  const location = document.getElementById('meetingLocation');
  if (location) location.value = '线上';

  ['chair-title', 'speaker1-title', 'speaker2-title'].forEach(id => {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = '教授';
    input.readOnly = true;
  });
})();
