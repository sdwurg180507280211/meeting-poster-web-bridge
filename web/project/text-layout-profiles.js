(() => {
  'use strict';

  const baseProject = window.POSTER_PROJECT;
  if (!baseProject?.textItems?.length) {
    throw new Error('text-layout-profiles.js requires POSTER_PROJECT.textItems');
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function freezeItems(items) {
    return Object.freeze(items.map(item => Object.freeze(item)));
  }

  const profiles = Object.freeze({
    'yilu-changan-text-v1': Object.freeze({
      id: 'yilu-changan-text-v1',
      items: freezeItems(clone(baseProject.textItems)),
    }),
  });

  window.POSTER_TEXT_LAYOUT_PROFILES = Object.freeze({
    profiles,
    get(id) {
      return profiles[id] || null;
    },
    cloneItems(id) {
      const profile = profiles[id];
      return profile ? clone(profile.items) : null;
    },
  });
})();
