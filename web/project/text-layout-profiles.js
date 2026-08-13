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

  // 三个项目字段语义相同，但文字几何属于各自底板。
  // 当前以“医路长安”现有布局作为初始化基线；后续每个项目可在这里独立固化校准值。
  // Web 编辑器中的拖拽微调仍按 project.id 独立保存在浏览器本机，不会跨项目污染。
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
