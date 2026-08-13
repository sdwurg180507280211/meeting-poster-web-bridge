(() => {
  'use strict';

  const active = Object.freeze({
    id: 'chronic-care-2026',
    name: '医路长安',
    version: 1,
    textLayoutProfile: 'yilu-changan-text-v1',
    assetLayoutProfile: 'yilu-changan-assets-v1',
    previewSrc: '../assets/poster-base.jpg',
  });

  const posterProject = window.POSTER_PROJECT;
  const textLayouts = window.POSTER_TEXT_LAYOUT_PROFILES;
  const assetLayouts = window.POSTER_ASSET_LAYOUT_PROFILES;
  if (!posterProject) throw new Error('POSTER_PROJECT 未加载');

  const projectTextItems = textLayouts?.cloneItems?.(active.textLayoutProfile);
  if (!projectTextItems?.length) throw new Error(`缺少项目文字模板：${active.textLayoutProfile}`);
  const projectAssetLayout = assetLayouts?.cloneLayout?.(active.assetLayoutProfile);
  if (!projectAssetLayout) throw new Error(`缺少项目素材布局模板：${active.assetLayoutProfile}`);

  posterProject.id = active.id;
  posterProject.version = active.version;
  posterProject.name = active.name;
  posterProject.textLayoutProfile = active.textLayoutProfile;
  posterProject.assetLayoutProfile = active.assetLayoutProfile;
  posterProject.textItems = projectTextItems;
  posterProject.assetPreview = projectAssetLayout;

  window.POSTER_RUNTIME = Object.freeze({
    ...window.POSTER_RUNTIME,
    projectId: active.id,
    projectName: active.name,
    projectVersion: active.version,
    textLayoutProfile: active.textLayoutProfile,
    assetLayoutProfile: active.assetLayoutProfile,
  });

  const poster = document.getElementById('posterCanvas');
  if (!poster) throw new Error('海报画布未加载');
  poster.dataset.projectId = active.id;
  poster.dataset.projectName = active.name;
  poster.dataset.textLayoutProfile = active.textLayoutProfile;
  poster.dataset.assetLayoutProfile = active.assetLayoutProfile;
  poster.style.setProperty('--poster-base-image', `url("${active.previewSrc}")`);
  poster.setAttribute('aria-label', `${active.name}海报编辑画布`);

  window.POSTER_PROJECT_REGISTRY = Object.freeze({
    defaultProjectId: active.id,
    projects: Object.freeze([active]),
    active,
    get(id) { return id === active.id ? active : null; },
  });
})();
