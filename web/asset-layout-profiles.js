(() => {
  'use strict';

  const baseProject = window.POSTER_PROJECT;
  if (!baseProject?.assetPreview) {
    throw new Error('asset-layout-profiles.js requires POSTER_PROJECT.assetPreview');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function freezeLayout(layout) {
    return Object.freeze({
      chair: Object.freeze({ ...layout.chair }),
      speaker1: Object.freeze({ ...layout.speaker1 }),
      speaker2: Object.freeze({ ...layout.speaker2 }),
      qr: Object.freeze({ ...layout.qr }),
    });
  }

  function createProfile(id, patches = {}) {
    const layout = clone(baseProject.assetPreview);
    for (const key of ['chair', 'speaker1', 'speaker2', 'qr']) {
      if (patches[key]) layout[key] = { ...layout[key], ...patches[key] };
    }
    return Object.freeze({ id, layout: freezeLayout(layout) });
  }

  // 三个项目由同一 PSD 脚本生成，但底板不同，因此素材框几何也必须项目独立。
  // 当前先以医路长安现有成熟坐标作为三套 profile 的初始化基线；
  // 后续在 Web 的“A 素材布局”模式中校准后，可再把最终值固化到对应 profile。
  const profiles = Object.freeze({
    'yilu-changan-assets-v1': createProfile('yilu-changan-assets-v1'),
    'tonghu-jiankang-assets-v1': createProfile('tonghu-jiankang-assets-v1'),
    'tongxin-hujian-assets-v1': createProfile('tongxin-hujian-assets-v1'),
  });

  window.POSTER_ASSET_LAYOUT_PROFILES = Object.freeze({
    profiles,
    get(id) {
      return profiles[id] || null;
    },
    cloneLayout(id) {
      const profile = profiles[id];
      return profile ? clone(profile.layout) : null;
    },
  });
})();
