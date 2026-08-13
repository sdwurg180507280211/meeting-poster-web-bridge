'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  compileManifest,
  slotFrom,
  TEXT_MAX_WIDTH,
  SCHEDULE_MAX_WIDTH,
} = require('./compile-manifest');

function textLayer(name, position, bounds, extras = {}) {
  return {
    name,
    type: 'ArtLayer',
    kind: 'LayerKind.TEXT',
    parent: '05_可编辑文字',
    visible: extras.visible ?? true,
    bounds,
    text: {
      font: extras.font || 'PingFangSC-Regular',
      sizePx: extras.sizePx || 20,
      color: extras.color || '191919',
      tracking: String(extras.tracking || 0),
      justification: extras.justification || 'Justification.LEFT',
      position,
      contents: extras.contents || name,
    },
  };
}

test('slotFrom keeps PSD baseline typography but does not infer maxWidth from current ink bounds', () => {
  const layer = textLayer('主席姓名', [419, 701], [358, 683, 479, 704], {
    font: 'PingFangSC-Semibold',
    sizePx: 21,
    tracking: 90,
    justification: 'Justification.CENTER',
  });
  const slot = slotFrom(layer, { source: 'chair.name', suffix: ' 教授', maxWidth: TEXT_MAX_WIDTH.chairName });
  assert.equal(slot.x, 419);
  assert.equal(slot.y, 701);
  assert.equal(slot.maxWidth, 172);
  assert.equal(slot.weight, 'semibold');
  assert.equal(slot.align, 'center');
  assert.equal(slot.suffix, ' 教授');
});

test('formal width limits are independent from placeholder text length', () => {
  assert.deepEqual(SCHEDULE_MAX_WIDTH, { time: 122, content: 190, speaker: 132, chair: 128 });
  assert.equal(TEXT_MAX_WIDTH.meetingTime, 470);
  assert.equal(TEXT_MAX_WIDTH.chairHospital, 194);
});

test('compileManifest preserves optional schedule cells instead of turning initial visibility into a permanent rule', () => {
  const names = [
    '标题_会议主席', '标题_会议讲者', '标题_会议日程',
    '表头_时间', '表头_内容', '表头_讲者', '表头_主席',
    '主席姓名', '主席医院', '讲者一姓名', '讲者一医院', '讲者二姓名', '讲者二医院',
    '会议时间', '会议地点', '二维码说明', '排名说明',
    '第一行_时间', '第一行_内容', '第一行_讲者', '第一行_主席', '第一行_圆点',
    '第二行_时间', '第二行_内容', '第二行_讲者', '第二行_主席_默认隐藏', '第二行_圆点',
    '第三行_时间', '第三行_内容', '第三行_讲者', '第三行_主席_默认隐藏', '第三行_圆点',
    '第四行_时间', '第四行_内容', '第四行_讲者_默认隐藏', '第四行_主席', '第四行_圆点_默认隐藏',
  ];
  const texts = names.map((name, index) => textLayer(name, [100 + index, 200 + index], [0, 0, index + 10, 20], {
    visible: !name.includes('默认隐藏'),
    font: name.includes('标题') || name.includes('表头') || name.includes('圆点') ? 'PingFangSC-Semibold' : 'PingFangSC-Regular',
    justification: name.includes('内容') ? 'Justification.LEFT' : 'Justification.CENTER',
    contents: index % 2 ? 'x' : '这是完全不同长度的示例文字',
  }));
  const layers = [
    ...texts,
    { name: '圆形裁切底层_勿删', parent: '主席头像_可替换', bounds: [342, 496, 510, 664] },
    { name: '圆形裁切底层_勿删', parent: '讲者一头像_可替换', bounds: [220, 836, 385, 1001] },
    { name: '圆形裁切底层_勿删', parent: '讲者二头像_可替换', bounds: [458, 836, 622, 1000] },
    { name: '二维码图片_可替换', parent: '04_二维码_可替换', bounds: [338, 1576, 486, 1724] },
  ];

  const manifest = compileManifest({ error: null, doc: { width: 837, height: 1880 }, layers, texts });
  assert.equal(manifest.schedule.rows.length, 4);
  assert.ok(manifest.schedule.rows[1].chair);
  assert.ok(manifest.schedule.rows[3].speaker);
  assert.ok(manifest.schedule.rows[3].dot);
  assert.equal(manifest.schedule.rows[0].content.maxWidth, 190);
  assert.equal(manifest.schedule.rows[3].speaker.maxWidth, 132);
  assert.equal(manifest.texts.meetingTime.maxWidth, 470);
  assert.equal(manifest.texts.meetingTime.prefix, '会议时间：');
  assert.equal(manifest.texts.chairName.suffix, ' 教授');
});

test('committed chronic-care manifest is exactly compiler-derived from the migration dump', () => {
  const dumpPath = path.resolve(__dirname, '../../tools/template-migration/chronic-care-2026/template-dump-20260813.json');
  const manifestPath = path.resolve(__dirname, '../templates/chronic-care-2026/manifest.json');
  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  const committed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.deepEqual(committed, compileManifest(dump));
});
