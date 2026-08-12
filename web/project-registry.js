(() => {
  'use strict';

  const STORAGE_KEY = 'meetingPosterProjectV1';
  const DEFAULT_PROJECT_ID = 'chronic-care-2026';
  const CONTENT_PROFILE = 'meeting-series-common-v1';
  const SHARED_LAYOUT = Object.freeze({
    chair: Object.freeze({ left: 342, top: 496, size: 168, label: '主席' }),
    speaker1: Object.freeze({ left: 221, top: 836, size: 168, label: '讲者一' }),
    speaker2: Object.freeze({ left: 457, top: 836, size: 168, label: '讲者二' }),
    qr: Object.freeze({ left: 338, top: 1576, size: 148 }),
  });

  const projects = Object.freeze([
    Object.freeze({
      id: 'chronic-care-2026',
      name: '医路长安',
      version: 1,
      contentProfile: CONTENT_PROFILE,
      templateProfile: 'meeting-poster-v10',
      preview: Object.freeze({ type: 'asset', src: './assets/poster-base.jpg', theme: 'yilu' }),
      assetPreview: SHARED_LAYOUT,
    }),
    Object.freeze({
      id: 'tonghu-jiankang',
      name: '同护健康',
      version: 1,
      contentProfile: CONTENT_PROFILE,
      templateProfile: 'meeting-poster-v10',
      preview: Object.freeze({ type: 'placeholder', theme: 'tonghu' }),
      assetPreview: SHARED_LAYOUT,
    }),
    Object.freeze({
      id: 'tongxin-hujian',
      name: '同心护健',
      version: 1,
      contentProfile: CONTENT_PROFILE,
      templateProfile: 'meeting-poster-v10',
      preview: Object.freeze({ type: 'placeholder', theme: 'tongxin' }),
      assetPreview: SHARED_LAYOUT,
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
  if (!posterProject) return;

  posterProject.id = active.id;
  posterProject.version = active.version;
  posterProject.name = active.name;
  posterProject.contentProfile = active.contentProfile;
  posterProject.templateProfile = active.templateProfile;
  posterProject.preview = active.preview;
  posterProject.assetPreview = {
    chair: { ...active.assetPreview.chair },
    speaker1: { ...active.assetPreview.speaker1 },
    speaker2: { ...active.assetPreview.speaker2 },
    qr: { ...active.assetPreview.qr },
  };

  const previousRuntime = window.POSTER_RUNTIME || {};
  window.POSTER_RUNTIME = Object.freeze({
    ...previousRuntime,
    projectId: active.id,
    projectName: active.name,
    projectVersion: active.version,
    contentProfile: active.contentProfile,
    templateProfile: active.templateProfile,
    previewMode: active.preview.type,
  });

  function installPreviewState() {
    const poster = document.getElementById('posterCanvas');
    if (!poster) return;
    poster.dataset.projectId = active.id;
    poster.dataset.projectName = active.name;
    poster.dataset.projectTheme = active.preview.theme || '';
    poster.classList.toggle('is-project-placeholder', active.preview.type === 'placeholder');
    if (active.preview.type === 'asset' && active.preview.src) {
      poster.style.setProperty('--poster-base-image', `url("${active.preview.src}")`);
    } else {
      poster.style.removeProperty('--poster-base-image');
    }
    poster.setAttribute('aria-label', `${active.name}海报编辑画布`);
  }

  function selectProject(id) {
    if (!byId.has(id) || id === active.id) return;
    try { localStorage.setItem(STORAGE_KEY, id); } catch (_) {}
    const url = new URL(window.location.href);
    url.searchParams.set('project', id);
    window.location.assign(url.toString());
  }

  function installSwitcher() {
    const topbar = document.querySelector('.topbar');
    const actions = document.querySelector('.topbar-actions');
    if (!topbar || !actions || document.getElementById('projectSwitcher')) return;

    const host = document.createElement('div');
    host.id = 'projectSwitcher';
    host.className = 'project-switcher';
    host.innerHTML = `
      <span class="project-switcher-label">项目</span>
      <select id="projectSelect" aria-label="选择海报项目"></select>
      <span id="projectPreviewState" class="project-preview-state"></span>`;
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

    const state = host.querySelector('#projectPreviewState');
    if (active.preview.type === 'placeholder') {
      state.textContent = '网页占位底板 · 正式输出使用本地 PSD';
      state.classList.add('placeholder');
    } else {
      state.textContent = '网页底板已载入 · 正式输出使用本地 PSD';
      state.classList.add('ready');
    }
  }

  window.POSTER_PROJECT_REGISTRY = Object.freeze({
    storageKey: STORAGE_KEY,
    defaultProjectId: DEFAULT_PROJECT_ID,
    contentProfile: CONTENT_PROFILE,
    projects,
    active,
    get(id) { return byId.get(id) || null; },
    select: selectProject,
  });

  installPreviewState();
  installSwitcher();
})();
