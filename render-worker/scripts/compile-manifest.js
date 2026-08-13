'use strict';

// manifest compiler（一次性迁移工具）
// 输入：tools/ps-remote/template-dump-20260813.json（PS 远程提取的母版排版数据）
// 输出：render-worker/templates/chronic-care-2026/manifest.json
// 用途：把 Photoshop 中隐含的设计知识（位置/字号/颜色/字距/对齐/可见性）迁移为 manifest，
//       此后 Node 渲染不再依赖 Photoshop。

const fs = require('fs');
const path = require('path');

const DUMP = process.argv[2] || path.resolve(__dirname, '../../tools/ps-remote/template-dump-20260813.json');
const OUT_DIR = process.argv[3] || path.resolve(__dirname, '../templates/chronic-care-2026');
const PROJECT_ID = 'chronic-care-2026';
const CANVAS = { width: 837, height: 1880 };

// 图层名 → manifest 文字字段
const TEXT_MAP = [
  { layer: '标题_会议主席', key: 'sectionChair', text: '会议主席' },
  { layer: '标题_会议讲者', key: 'sectionSpeakers', text: '会议讲者' },
  { layer: '标题_会议日程', key: 'sectionAgenda', text: '会议日程' },
  { layer: '表头_时间', key: 'agendaHeadTime', text: '时间' },
  { layer: '表头_内容', key: 'agendaHeadContent', text: '内容' },
  { layer: '表头_讲者', key: 'agendaHeadSpeaker', text: '讲者' },
  { layer: '表头_主席', key: 'agendaHeadChair', text: '主席' },
  { layer: '主席姓名', key: 'chairName', source: 'chair.name' },
  { layer: '主席医院', key: 'chairHospital', source: 'chair.hospital' },
  { layer: '讲者一姓名', key: 'speaker1Name', source: 'speakers.0.name' },
  { layer: '讲者一医院', key: 'speaker1Hospital', source: 'speakers.0.hospital' },
  { layer: '讲者二姓名', key: 'speaker2Name', source: 'speakers.1.name' },
  { layer: '讲者二医院', key: 'speaker2Hospital', source: 'speakers.1.hospital' },
  { layer: '会议时间', key: 'meetingTime', source: 'meetingTime' },
  { layer: '会议地点', key: 'meetingLocation', source: 'meetingLocation' },
  { layer: '二维码说明', key: 'qrNote', text: '请扫描二维码观看会议直播' },
  { layer: '排名说明', key: 'sortNote', text: '*排名不分先后,以姓名首字母拼音进行排序' },
];

const SCHEDULE_LAYERS = {
  time: ['第一行_时间', '第二行_时间', '第三行_时间', '第四行_时间'],
  content: ['第一行_内容', '第二行_内容', '第三行_内容', '第四行_内容'],
  speaker: ['第一行_讲者', '第二行_讲者', '第三行_讲者', '第四行_讲者'],
  chair: ['第一行_主席', '第二行_主席', '第三行_主席', '第四行_主席'],
};
// 每列是否存在"正常层"（非 _默认隐藏 变体）：无正常层的行该列永远隐藏
const SCHEDULE_NORMAL_LAYERS = {
  speaker: ['第一行_讲者', '第二行_讲者', '第三行_讲者'],
  chair: ['第一行_主席', '第四行_主席'],
};
const DOT_NORMAL_LAYERS = ['第一行_圆点', '第二行_圆点', '第三行_圆点'];

function hexColor(text) {
  const raw = String(text?.color || '').toUpperCase();
  if (!/^[0-9A-F]{6}$/.test(raw)) return '#191919';
  return `#${raw}`;
}

function slotFrom(text, patch = {}) {
  const weight = String(text?.font || '').toLowerCase().includes('semibold') ? 'semibold' : 'regular';
  const alignMap = { CENTER: 'center', LEFT: 'left', RIGHT: 'right' };
  const align = alignMap[String(text?.justification || '').replace('Justification.', '')] || 'left';
  const pos = text?.position || [0, 0];
  const bounds = text?.bounds || null;
  const width = bounds ? Math.round(bounds[2] - bounds[0]) : 0;
  return {
    x: Number(pos[0]),
    y: Number(pos[1]),
    fontSize: Number(text?.sizePx || 20),
    minFontSize: 12,
    weight,
    align,
    tracking: Number(text?.tracking || 0),
    color: hexColor(text),
    ...(width > 0 ? { maxWidth: width } : {}),
    ...patch,
  };
}

function main() {
  const dump = JSON.parse(fs.readFileSync(DUMP, 'utf8'));
  const byName = new Map();
  for (const t of dump.texts || []) byName.set(t.name, t.text);

  const texts = {};
  for (const { layer, key, text, source } of TEXT_MAP) {
    const entry = byName.get(layer);
    if (!entry) {
      console.warn(`[warn] 缺少图层：${layer}`);
      continue;
    }
    texts[key] = slotFrom(entry, source ? { source } : { text });
  }

  // schedule
  const rows = [];
  for (const name of SCHEDULE_LAYERS.time) {
    const entry = byName.get(name);
    if (entry) rows.push(Number(entry.position[1]));
  }
  while (rows.length < 4) rows.push(0);

  const columns = {};
  for (const column of ['time', 'content', 'speaker', 'chair']) {
    const base = byName.get(SCHEDULE_LAYERS[column][0]);
    if (!base) {
      console.warn(`[warn] schedule 列缺基线图层：${column}`);
      continue;
    }
    const normal = SCHEDULE_NORMAL_LAYERS[column] || SCHEDULE_LAYERS[column];
    const hiddenRows = [];
    SCHEDULE_LAYERS[column].forEach((layerName, index) => {
      const layer = byName.get(layerName);
      const isNormal = normal.includes(layerName);
      if (!layer || !isNormal) hiddenRows.push(index);
    });
    columns[column] = { ...slotFrom(base), hiddenRows: hiddenRows.length ? hiddenRows : undefined };
  }

  // 圆点：只画有正常层的行
  const dotYs = [];
  const dotHidden = [];
  SCHEDULE_LAYERS.time.forEach((_, index) => {
    const dotName = DOT_NORMAL_LAYERS[index];
    const dotLayer = byName.get(dotName);
    if (dotLayer) dotYs.push(Number(dotLayer.position[1]));
    else dotHidden.push(index);
  });
  const dot = { size: 13, color: '#5435D6', x: 236.5, ys: dotYs, hiddenRows: dotHidden };

  // images：从 PSD 智能对象/裁切层 bounds 取（chair/speaker1/speaker2 用"圆形裁切底层_勿删"，qr 用智能对象）
  const imageBounds = {
    chair: [342, 496, 510, 664],
    speaker1: [220, 836, 385, 1001],
    speaker2: [458, 836, 622, 1000],
    qrCode: [338, 1576, 486, 1724],
  };
  const images = {};
  for (const [key, b] of Object.entries(imageBounds)) {
    const size = Math.round(b[2] - b[0]);
    images[key] = { left: Math.round(b[0]), top: Math.round(b[1]), size };
  }

  const manifest = {
    schemaVersion: 1,
    projectId: PROJECT_ID,
    canvas: CANVAS,
    background: 'background.png',
    images,
    texts,
    schedule: {
      rows,
      columns,
      dot,
    },
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const outPath = path.join(OUT_DIR, 'manifest.json');
  fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log('written:', outPath);
  console.log('texts:', Object.keys(texts).length, '| schedule rows:', rows, '| dot:', JSON.stringify(dot));
  console.log('hiddenRows:', JSON.stringify(Object.fromEntries(Object.entries(columns).map(([k, v]) => [k, v.hiddenRows]))));
}

main();
