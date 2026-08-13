(() => {
  'use strict';

  const STORAGE_KEY = 'meetingPosterProjectV1';
  const DEFAULT_PROJECT_ID = 'chronic-care-2026';

  const projects = Object.freeze([
    Object.freeze({
      id: 'chronic-care-2026',
      name: '医路长安',
      version: 1,
      textLayoutProfile: 'yilu-changan-text-v1',
      assetLayoutProfile: 'yilu-changan-assets-v1',
      previewSrc: '../assets/poster-base.jpg',
    }),
    Object.freeze({
      id: 'tonghu-jiankang',
      name: '同护健康',
      version: 1,
      textLayoutProfile: 'tonghu-jiankang-text-v1',
      assetLayoutProfile: 'tonghu-jiankang-assets-v1',
      previewSrc: '../assets/tonghu-jiankang-base.jpg',
    }),
    Object.freeze({
      id: 'tongxin-hujian',
      name: '同心护健',
      version: 1,
      textLayoutProfile: 'tongxin-hujian-text-v1',
      assetLayoutProfile: 'tongxin-hujian-assets-v1',
      previewSrc: '../assets/tongxin-hujian-base.jpg',
    }),
  ]);

  const byId = new Map(projects.map(project => [project.id, project]));

  function readStoredProject() {
    try { return localStorage.getItem(STORAGE_KEY) || ''; }
    catch (_) { return ''; }
  }

  function projectFromUrl() {
    try { return new URL(window.location.href).searchParams.get('project') || ''; }
    catch (_) { return ''; }
  }

  function resolveActiveProject() {
    const fromUrl = projectFromUrl();
    if (byId.has(fromUrl)) return byId.get(fromUrl);
    const stored = readStoredProject();
    if (byId.has(stored)) return byId.get(stored);
    return byId.get(DEFAULT_PROJECT_ID);
  }

  const active = resolveActiveProject();
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

  function installPreview() {
    const poster = document.getElementById('posterCanvas');
    if (!poster) throw new Error('海报画布未加载');
    poster.dataset.projectId = active.id;
    poster.dataset.projectName = active.name;
    poster.dataset.textLayoutProfile = active.textLayoutProfile;
    poster.dataset.assetLayoutProfile = active.assetLayoutProfile;
    poster.style.setProperty('--poster-base-image', `url("${active.previewSrc}")`);
    poster.setAttribute('aria-label', `${active.name}海报编辑画布`);
  }

  function selectProject(id) {
    if (!byId.has(id) || id === active.id) return;
    localStorage.setItem(STORAGE_KEY, id);
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    window.location.assign(url.toString());
  }

  function installSwitcher() {
    const topbar = document.querySelector('.topbar');
    const actions = document.querySelector('.topbar-actions');
    if (!topbar || !actions) throw new Error('项目切换器挂载点不存在');

    const host = document.createElement('div');
    host.id = 'projectSwitcher';
    host.className = 'project-switcher';
    host.innerHTML = `
      <span class="project-switcher-label">项目</span>
      <select id="projectSelect" aria-label="选择海报项目"></select>`;
    topbar.insertBefore(host, actions);

    const select = host.querySelector('#projectSelect');
    projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = project.name;
      select.appendChild(option);
    });
    select.value = active.id;
    select.addEventListener('change', () => selectProject(select.value));
  }

  window.POSTER_PROJECT_REGISTRY = Object.freeze({
    storageKey: STORAGE_KEY,
    defaultProjectId: DEFAULT_PROJECT_ID,
    projects,
    active,
    get(id) { return byId.get(id) || null; },
    select: selectProject,
  });

  installPreview();
  installSwitcher();
})();
