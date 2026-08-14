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

  // 项目默认值就是各自已经校准过的 Web 布局。
  // 云端仍按 project.id + profile id 保存后续调整；即使移动端网络较慢、云端布局尚未加载，
  // 也不会先回退到另一项目的坐标。
  const profiles = Object.freeze({
    'yilu-changan-text-v1': createProfile('yilu-changan-text-v1', {
      'section-chair': { x: 268, y: 426 },
      'section-speakers': { x: 268, y: 772 },
      'section-agenda': { x: 268, y: 1103 },
      'chair-name': { x: 340, y: 682, scale: 1.004 },
      'chair-hospital': { x: 329, y: 717 },
      'meeting-time': { x: 78, y: 1159 },
      'meeting-location': { x: 80, y: 1196 },
      'agenda-0-time': { x: 91, y: 1306 },
      'agenda-1-time': { x: 91, y: 1371 },
      'agenda-2-time': { x: 91, y: 1435 },
      'agenda-3-time': { x: 91, y: 1499 },
      'agenda-0-content': { x: 262, y: 1305, scale: 1.05 },
      'agenda-1-content': { x: 262, y: 1375 },
      'agenda-2-content': { x: 262, y: 1439 },
      'agenda-3-content': { x: 262, y: 1503 },
      'agenda-1-speaker': { x: 489, y: 1377 },
      'agenda-2-speaker': { x: 491, y: 1439 },
      'agenda-0-chair': { x: 638, y: 1305 },
      'agenda-3-chair': { x: 638, y: 1503 },
    }),
    'tonghu-jiankang-text-v1': createProfile('tonghu-jiankang-text-v1', {
      'section-chair': { x: 268, y: 420 },
      'section-speakers': { x: 268, y: 782 },
      'section-agenda': { x: 268, y: 1112 },
      'speaker1-name': { x: 218, y: 1038 },
      'speaker1-hospital': { x: 209, y: 1076 },
      'speaker2-name': { x: 454, y: 1037 },
      'speaker2-hospital': { x: 445, y: 1075 },
      'meeting-time': { x: 80, y: 1158 },
      'meeting-location': { x: 80, y: 1195 },
      'agenda-head-time': { x: 94, y: 1235 },
      'agenda-head-content': { x: 266, y: 1235 },
      'agenda-head-speaker': { x: 495, y: 1235 },
      'agenda-head-chair': { x: 648, y: 1235 },
      'agenda-0-time': { x: 95, y: 1299 },
      'agenda-1-time': { x: 95, y: 1364 },
      'agenda-2-time': { x: 95, y: 1428 },
      'agenda-3-time': { x: 95, y: 1492 },
      'agenda-0-content': { x: 266, y: 1299 },
      'agenda-1-content': { x: 266, y: 1364 },
      'agenda-2-content': { x: 266, y: 1428 },
      'agenda-3-content': { x: 266, y: 1492 },
      'agenda-1-speaker': { x: 495, y: 1364 },
      'agenda-2-speaker': { x: 495, y: 1428 },
      'agenda-0-chair': { x: 642, y: 1299 },
      'agenda-3-chair': { x: 642, y: 1492 },
      'sort-note': { x: 464, y: 1545 },
      'qr-note': { x: 308, y: 1739 },
    }),
    'tongxin-hujian-text-v1': createProfile('tongxin-hujian-text-v1', {
      'section-chair': { x: 268, y: 403 },
      'section-speakers': { x: 268, y: 773 },
      'section-agenda': { x: 268, y: 1125 },
      'speaker1-name': { x: 218, y: 1035 },
      'speaker1-hospital': { x: 209, y: 1073 },
      'speaker2-name': { x: 454, y: 1034 },
      'speaker2-hospital': { x: 445, y: 1072 },
      'meeting-time': { x: 82, y: 1177 },
      'meeting-location': { x: 82, y: 1214 },
      'agenda-head-time': { x: 94, y: 1259 },
      'agenda-head-content': { x: 266, y: 1259 },
      'agenda-head-speaker': { x: 495, y: 1259 },
      'agenda-head-chair': { x: 648, y: 1259 },
      'sort-note': { x: 464, y: 1571 },
      'qr-note': { x: 292, y: 1768 },
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
