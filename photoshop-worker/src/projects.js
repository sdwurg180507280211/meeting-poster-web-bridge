'use strict';

const PROJECTS = Object.freeze([
  Object.freeze({ id: 'chronic-care-2026', name: '医路长安' }),
  Object.freeze({ id: 'tonghu-jiankang', name: '同护健康' }),
  Object.freeze({ id: 'tongxin-hujian', name: '同心护健' }),
]);

const PROJECT_BY_ID = Object.freeze(PROJECTS.reduce((map, project) => {
  map[project.id] = project;
  return map;
}, {}));

module.exports = { PROJECTS, PROJECT_BY_ID };
