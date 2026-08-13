'use strict';

// One-time migration tool: PSD template dump -> runtime manifest.
// The dump provides baseline typography/coordinates. It does NOT provide text-box limits:
// layer.bounds is only the current text's ink bounds, so maxWidth is an explicit design rule below.

const fs = require('fs');
const path = require('path');

const DEFAULT_DUMP = path.resolve(
  __dirname,
  '../../tools/template-migration/chronic-care-2026/template-dump-20260813.json'
);
const DEFAULT_OUT_DIR = path.resolve(__dirname, '../templates/chronic-care-2026');
const PROJECT_ID = 'chronic-care-2026';
const CANVAS = Object.freeze({ width: 837, height: 1880 });

// Formal available widths in the 837x1880 design. These are design constraints, not measured ink bounds.
const TEXT_MAX_WIDTH = Object.freeze({
  chairName: 172,
  chairHospital: 194,
  speaker1Name: 174,
  speaker1Hospital: 192,
  speaker2Name: 174,
  speaker2Hospital: 192,
  meetingTime: 470,
  meetingLocation: 290,
});
const SCHEDULE_MAX_WIDTH = Object.freeze({
  time: 122,
  content: 190,
  speaker: 132,
  chair: 128,
});

const TEXT_MAP = Object.freeze([
  { layer: '标题_会议主席', key: 'sectionChair', text: '会议主席' },
  { layer: '标题_会议讲者', key: 'sectionSpeakers', text: '会议讲者' },
  { layer: '标题_会议日程', key: 'sectionAgenda', text: '会议日程' },
  { layer: '表头_时间', key: 'agendaHeadTime', text: '时间' },
  { layer: '表头_内容', key: 'agendaHeadContent', text: '内容' },
  { layer: '表头_讲者', key: 'agendaHeadSpeaker', text: '讲者' },
  { layer: '表头_主席', key: 'agendaHeadChair', text: '主席' },
  { layer: '主席姓名', key: 'chairName', source: 'chair.name', suffix: ' 教授' },
  { layer: '主席医院', key: 'chairHospital', source: 'chair.hospital' },
  { layer: '讲者一姓名', key: 'speaker1Name', source: 'speakers.0.name', suffix: ' 教授' },
  { layer: '讲者一医院', key: 'speaker1Hospital', source: 'speakers.0.hospital' },
  { layer: '讲者二姓名', key: 'speaker2Name', source: 'speakers.1.name', suffix: ' 教授' },
  { layer: '讲者二医院', key: 'speaker2Hospital', source: 'speakers.1.hospital' },
  { layer: '会议时间', key: 'meetingTime', source: 'meetingTime', prefix: '会议时间：' },
  { layer: '会议地点', key: 'meetingLocation', source: 'meetingLocation', prefix: '会议地点：' },
  { layer: '二维码说明', key: 'qrNote', text: '请扫描二维码观看会议直播' },
  { layer: '排名说明', key: 'sortNote', text: '*排名不分先后,以姓名首字母拼音进行排序' },
]);

// Actual PSD text layers. "默认隐藏" describes the source PSD's initial visibility only;
// it is not a permanent runtime rule. A non-empty job value renders that cell.
const SCHEDULE_LAYERS = Object.freeze([
  {
    time: '第一行_时间',
    content: '第一行_内容',
    speaker: '第一行_讲者',
    chair: '第一行_主席',
    dot: '第一行_圆点',
  },
  {
    time: '第二行_时间',
    content: '第二行_内容',
    speaker: '第二行_讲者',
    chair: '第二行_主席_默认隐藏',
    dot: '第二行_圆点',
  },
  {
    time: '第三行_时间',
    content: '第三行_内容',
    speaker: '第三行_讲者',
    chair: '第三行_主席_默认隐藏',
    dot: '第三行_圆点',
  },
  {
    time: '第四行_时间',
    content: '第四行_内容',
    speaker: '第四行_讲者_默认隐藏',
    chair: '第四行_主席',
    dot: '第四行_圆点_默认隐藏',
  },
]);

function fail(message) {
  throw new Error(`manifest compile failed: ${message}`);
}

function hexColor(text) {
  const raw = String(text?.color || '').toUpperCase();
  return /^[0-9A-F]{6}$/.test(raw) ? `#${raw}` : '#191919';
}

function fontRole(text) {
  return /semibold/i.test(String(text?.font || '')) ? 'semibold' : 'regular';
}

function alignment(text) {
  const key = String(text?.justification || '').replace('Justification.', '').toUpperCase();
  return ({ LEFT: 'left', CENTER: 'center', RIGHT: 'right' })[key] || 'left';
}

function slotFrom(info, patch = {}) {
  if (!info?.text) fail(`not a text layer: ${info?.name || '-'}`);
  const text = info.text;
  const position = text.position;
  if (!Array.isArray(position) || position.length !== 2) fail(`missing textItem.position: ${info.name}`);

  return {
    x: Number(position[0]),
    y: Number(position[1]),
    fontSize: Number(text.sizePx || 20),
    minFontSize: 12,
    weight: fontRole(text),
    align: alignment(text),
    tracking: Number(text.tracking || 0),
    color: hexColor(text),
    ...patch,
  };
}

function requireText(byName, name) {
  const info = byName.get(name);
  if (!info?.text) fail(`missing text layer: ${name}`);
  return info;
}

function findLayer(dump, name, parent = null) {
  const hits = (dump.layers || []).filter((layer) => layer.name === name && (parent == null || layer.parent === parent));
  if (hits.length !== 1) fail(`expected one layer ${parent ? `${parent}/` : ''}${name}, found ${hits.length}`);
  return hits[0];
}

function imageSpecFromBounds(layer, label) {
  const bounds = layer?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4) fail(`missing bounds: ${label}`);
  const width = Math.round(Number(bounds[2]) - Number(bounds[0]));
  const height = Math.round(Number(bounds[3]) - Number(bounds[1]));
  if (width <= 0 || height <= 0 || Math.abs(width - height) > 1) fail(`${label} is not a square`);
  return {
    left: Math.round(Number(bounds[0])),
    top: Math.round(Number(bounds[1])),
    size: Math.round((width + height) / 2),
  };
}

function compileManifest(dump) {
  if (!dump || dump.error) fail(dump?.error || 'invalid dump');
  if (Number(dump.doc?.width) !== CANVAS.width || Number(dump.doc?.height) !== CANVAS.height) {
    fail(`canvas must be ${CANVAS.width}x${CANVAS.height}`);
  }

  const byName = new Map();
  for (const info of dump.texts || []) {
    if (!info?.name) continue;
    if (byName.has(info.name)) fail(`duplicate text layer name: ${info.name}`);
    byName.set(info.name, info);
  }

  const texts = {};
  for (const rule of TEXT_MAP) {
    const { layer, key, source, text, prefix, suffix } = rule;
    const patch = source ? { source } : { text };
    if (prefix) patch.prefix = prefix;
    if (suffix) patch.suffix = suffix;
    if (TEXT_MAX_WIDTH[key]) patch.maxWidth = TEXT_MAX_WIDTH[key];
    texts[key] = slotFrom(requireText(byName, layer), patch);
  }

  const scheduleRows = SCHEDULE_LAYERS.map((rowLayers) => ({
    time: slotFrom(requireText(byName, rowLayers.time), { maxWidth: SCHEDULE_MAX_WIDTH.time }),
    content: slotFrom(requireText(byName, rowLayers.content), { maxWidth: SCHEDULE_MAX_WIDTH.content }),
    speaker: slotFrom(requireText(byName, rowLayers.speaker), { maxWidth: SCHEDULE_MAX_WIDTH.speaker }),
    chair: slotFrom(requireText(byName, rowLayers.chair), { maxWidth: SCHEDULE_MAX_WIDTH.chair }),
    dot: slotFrom(requireText(byName, rowLayers.dot), { text: '●' }),
  }));

  const images = {
    chair: imageSpecFromBounds(findLayer(dump, '圆形裁切底层_勿删', '主席头像_可替换'), 'chair'),
    speaker1: imageSpecFromBounds(findLayer(dump, '圆形裁切底层_勿删', '讲者一头像_可替换'), 'speaker1'),
    speaker2: imageSpecFromBounds(findLayer(dump, '圆形裁切底层_勿删', '讲者二头像_可替换'), 'speaker2'),
    qrCode: imageSpecFromBounds(findLayer(dump, '二维码图片_可替换'), 'qrCode'),
  };

  return {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    canvas: { ...CANVAS },
    background: 'background.png',
    images,
    texts,
    schedule: { rows: scheduleRows },
  };
}

function main() {
  const dumpPath = process.argv[2] || DEFAULT_DUMP;
  const outDir = process.argv[3] || DEFAULT_OUT_DIR;
  const dump = JSON.parse(fs.readFileSync(dumpPath, 'utf8'));
  const manifest = compileManifest(dump);
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, 'manifest.json');
  fs.writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`written: ${outPath}`);
  console.log(`texts: ${Object.keys(manifest.texts).length}, schedule rows: ${manifest.schedule.rows.length}`);
}

if (require.main === module) main();

module.exports = {
  compileManifest,
  slotFrom,
  TEXT_MAX_WIDTH,
  SCHEDULE_MAX_WIDTH,
};
