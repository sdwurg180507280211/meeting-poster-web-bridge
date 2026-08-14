(() => {
  'use strict';

  const baseProject = window.POSTER_PROJECT;
  if (!baseProject?.assetPreview) throw new Error('asset-layout-profiles.js requires POSTER_PROJECT.assetPreview');

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

  function createProfile(id, patches) {
    const layout = clone(baseProject.assetPreview);
    for (const key of ['chair', 'speaker1', 'speaker2', 'qr']) {
      layout[key] = { ...layout[key], ...patches[key] };
    }
    return Object.freeze({ id, layout: freezeLayout(layout) });
  }

  const profiles = Object.freeze({
    'yilu-changan-assets-v1': createProfile('yilu-changan-assets-v1', {
      chair: { left: 342, top: 496, size: 168 },
      speaker1: { left: 221, top: 836, size: 168 },
      speaker2: { left: 457, top: 836, size: 168 },
      qr: { left: 338, top: 1576, size: 148 },
    }),
    'tonghu-jiankang-assets-v1': createProfile('tonghu-jiankang-assets-v1', {
      chair: { left: 330, top: 496, size: 168 },
      speaker1: { left: 214, top: 848, size: 168 },
      speaker2: { left: 453, top: 849, size: 168 },
      qr: { left: 342, top: 1574, size: 148 },
    }),
    'tongxin-hujian-assets-v1': createProfile('tongxin-hujian-assets-v1', {
      chair: { left: 338, top: 478, size: 168 },
      speaker1: { left: 217, top: 836, size: 168 },
      speaker2: { left: 456, top: 836, size: 168 },
      qr: { left: 330, top: 1595, size: 148 },
    }),
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
