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

  const profiles = Object.freeze({
    'yilu-changan-assets-v1': Object.freeze({
      id: 'yilu-changan-assets-v1',
      layout: freezeLayout(clone(baseProject.assetPreview)),
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
