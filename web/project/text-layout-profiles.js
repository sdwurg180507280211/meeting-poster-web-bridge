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

  function createProfile(id, patches = {}) {
    const items = clone(baseProject.textItems).map(item => {
      const patch = patches[item.id];
      return patch ? { ...item, ...patch } : item;
    });
    return Object.freeze({ id, items: freezeItems(items) });
  }

  // 三个项目字段语义相同；这里定义可渲染的文字项及初始几何。
  // 每个项目经 V 工具校准后的 x / y / scale 由 Supabase 按 project.id + profile id 持久化。
  // 这些 Web 预览坐标不会进入 Render Contract，也不会改变 PSD 母版文字排版。
  const profiles = Object.freeze({
    'yilu-changan-text-v1': createProfile('yilu-changan-text-v1'),
    'tonghu-jiankang-text-v1': createProfile('tonghu-jiankang-text-v1'),
    'tongxin-hujian-text-v1': createProfile('tongxin-hujian-text-v1'),
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
