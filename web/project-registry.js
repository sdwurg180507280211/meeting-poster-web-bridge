(() => {
  'use strict';

  const STORAGE_KEY = 'meetingPosterProjectV1';
  const DEFAULT_PROJECT_ID = 'yilu-changan';
  const CONTENT_PROFILE = 'meeting-series-common-v1';
  const LEGACY_RENDER_PROFILE = 'chronic-care-v10';

  const projects = Object.freeze([
    Object.freeze({
      id: 'yilu-changan',
      name: '医路长安',
      version: 1,
      contentProfile: CONTENT_PROFILE,
      renderProfile: LEGACY_RENDER_PROFILE,
      renderReady: true,
      preview: Object.freeze({ type: 'asset', src: './assets/poster-base.jpg', theme: 'yilu' }),
    }),
    Object.freeze({
      id: 'tonghu-jiankang',
      name: '同护健康',
      version: 1,
      contentProfile: CONTENT_PROFILE,
      renderProfile: null,
      renderReady: false,
      preview: Object.freeze({ type: 'placeholder', theme: 'tonghu' }),
    }),
    Object.freeze({
      id: 'tongxin-hujian',
      name: '同心护健',
      version: 1,
      contentProfile: CONTENT_PROFILE,
      renderProfile: null,
      renderReady: false,
      preview: Object.freeze({ type: 'placeholder', theme: 'tongxin' }),
    }),
  ]);

  const byId = new Map(projects.map(project => [project.id, project]));

  function readStoredProject() {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function projectFromUrl() {
    try {
      return new URL(window.location.href).searchParams.get('project') || '';
    } catch (_) {
      return '';
    }
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
  posterProject.renderProfile = active.renderProfile;
  posterProject.renderReady = active.renderReady;
  posterProject.preview = active.preview;

  const previousRuntime = window.POSTER_RUNTIME || {};
  window.POSTER_RUNTIME = Object.freeze({
    ...previousRuntime,
    projectId: active.id,
    projectName: active.name,
    projectVersion: active.version,
    contentProfile: active.contentProfile,
    renderProfile: active.renderProfile,
    renderReady: active.renderReady,
  });

  const validation = window.PosterValidation;
  if (validation?.validatePayload) {
    window.PosterValidation = Object.freeze({
      ...validation,
      validatePayload(payload) {
        const errors = [...validation.validatePayload(payload)];
        if (!active.renderReady) {
          errors.unshift(`项目“${active.name}”当前仅为占位底板，尚未导入并注册 Photoshop PSD 母版`);
        }
        return errors;
      },
    });
  }

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
      <span id="projectRenderState" class="project-render-state"></span>`;
    topbar.insertBefore(host, actions);

    const select = host.querySelector('#projectSelect');
    projects.forEach(project => {
      const option = document.createElement('option');
      option.value = project.id;
      option.textContent = `${project.name}${project.renderReady ? '' : ' · 占位'}`;
      select.appendChild(option);
    });
    select.value = active.id;
    select.addEventListener('change', () => selectProject(select.value));

    const state = host.querySelector('#projectRenderState');
    state.textContent = active.renderReady ? 'PSD 已配置' : '占位底板 · 待导入 PSD';
    state.classList.toggle('ready', active.renderReady);
    state.classList.toggle('placeholder', !active.renderReady);
  }

  function gateFormalRender() {
    if (active.renderReady) return;
    const form = document.getElementById('posterForm');
    const submit = document.getElementById('submitBtn');
    if (!form || !submit) return;

    const message = `项目“${active.name}”当前仅为占位底板。导入并注册对应 PSD 母版后才能生成正式海报。`;
    const enforceDisabled = () => {
      if (!submit.disabled) submit.disabled = true;
      submit.dataset.projectBlocked = '1';
      submit.title = message;
      const small = submit.querySelector('small');
      if (small) small.textContent = '占位项目：导入 PSD 后开放正式生成';
    };
    enforceDisabled();
    new MutationObserver(enforceDisabled).observe(submit, { attributes: true, attributeFilter: ['disabled'] });

    form.addEventListener('submit', event => {
      event.preventDefault();
      event.stopImmediatePropagation();
      window.alert(message);
    }, true);
  }

  window.POSTER_PROJECT_REGISTRY = Object.freeze({
    storageKey: STORAGE_KEY,
    defaultProjectId: DEFAULT_PROJECT_ID,
    projects,
    active,
    get(id) { return byId.get(id) || null; },
    select: selectProject,
  });

  installPreviewState();
  installSwitcher();
  gateFormalRender();
})();
