// 与 v10 语义命名模板对齐；Logo、主标题、副标题固定，只检查存在。
// 图片几何不在这里维护：运行时由 Web 项目配置随 render contract 注入。
const CN = ['一', '二', '三', '四'];

const ROOT_GROUPS = [
  '00_参考校验', '01_Logo_可替换_固定尺寸', '02_标题素材_可替换',
  '03_头像_可替换', '04_二维码_可替换', '05_可编辑文字', '06_无文字底图',
];

const FIXED_LAYERS = {
  MAIN_TITLE: '01_主标题_医路长安_智能对象_可替换',
  SUBTITLE: '02_副标题_慢性病规范诊疗交流项目_智能对象_可替换',
};

const LAYERS = {
  TEXT: {
    CHAIR_NAME: '主席姓名', CHAIR_HOSPITAL: '主席医院',
    SPEAKER1_NAME: '讲者一姓名', SPEAKER1_HOSPITAL: '讲者一医院',
    SPEAKER2_NAME: '讲者二姓名', SPEAKER2_HOSPITAL: '讲者二医院',
    MEETING_TIME: '会议时间', MEETING_LOCATION: '会议地点',
    scheduleTime: (i) => `第${CN[i]}行_时间`,
    scheduleContent: (i) => `第${CN[i]}行_内容`,
    scheduleSpeaker: (i) => [`第${CN[i]}行_讲者`, `第${CN[i]}行_讲者_默认隐藏`],
    scheduleChair: (i) => [`第${CN[i]}行_主席`, `第${CN[i]}行_主席_默认隐藏`],
    scheduleDot: (i) => [`第${CN[i]}行_圆点`, `第${CN[i]}行_圆点_默认隐藏`],
  },
  AVATAR: {
    CHAIR: '主席头像_内容_双击或右键替换',
    SPEAKER1: '讲者一头像_内容_双击或右键替换',
    SPEAKER2: '讲者二头像_内容_双击或右键替换',
  },
  QR: '二维码图片_可替换',
};

const TEXT_LAYER_LAYOUTS = [
  { name: '标题_会议主席', bounds: [352, 427, 485, 460] }, { name: '标题_会议讲者', bounds: [352, 772, 486, 805] },
  { name: '标题_会议日程', bounds: [352, 1103, 486, 1136] }, { name: '主席姓名', bounds: [362, 682, 476, 704] },
  { name: '主席医院', bounds: [341, 717, 496, 733] }, { name: '讲者一姓名', bounds: [247, 1018, 356, 1040] },
  { name: '讲者一医院', bounds: [223, 1044, 378, 1060] }, { name: '讲者二姓名', bounds: [494, 1017, 603, 1039] },
  { name: '讲者二医院', bounds: [470, 1044, 625, 1060] }, { name: '会议时间', bounds: [82, 1159, 360, 1181] },
  { name: '会议地点', bounds: [82, 1198, 235, 1220] }, { name: '表头_时间', bounds: [102, 1243, 147, 1266] },
  { name: '表头_内容', bounds: [272, 1243, 317, 1266] }, { name: '表头_讲者', bounds: [498, 1244, 544, 1267] },
  { name: '表头_主席', bounds: [658, 1244, 704, 1267] }, { name: '第一行_时间', bounds: [89, 1310, 201, 1325] },
  { name: '第一行_圆点', bounds: [232, 1313, 240, 1321] }, { name: '第一行_内容', bounds: [264, 1310, 339, 1328] },
  { name: '第一行_讲者', bounds: [485, 1308, 558, 1326] }, { name: '第一行_主席', bounds: [644, 1307, 717, 1325] },
  { name: '第二行_时间', bounds: [89, 1375, 201, 1390] }, { name: '第二行_圆点', bounds: [232, 1378, 240, 1386] },
  { name: '第二行_内容', bounds: [263, 1377, 312, 1387] }, { name: '第二行_讲者', bounds: [485, 1374, 558, 1392] },
  { name: '第二行_主席_默认隐藏', bounds: [644, 1384, 717, 1402] }, { name: '第三行_时间', bounds: [89, 1440, 201, 1455] },
  { name: '第三行_圆点', bounds: [232, 1443, 240, 1451] }, { name: '第三行_内容', bounds: [263, 1444, 312, 1454] },
  { name: '第三行_讲者', bounds: [485, 1438, 558, 1456] }, { name: '第三行_主席_默认隐藏', bounds: [644, 1449, 717, 1467] },
  { name: '第四行_时间', bounds: [89, 1505, 201, 1520] }, { name: '第四行_圆点_默认隐藏', bounds: [232, 1519, 240, 1527] },
  { name: '第四行_内容', bounds: [263, 1503, 338, 1521] }, { name: '第四行_讲者_默认隐藏', bounds: [485, 1514, 558, 1532] },
  { name: '第四行_主席', bounds: [644, 1503, 717, 1521] }, { name: '排名说明', bounds: [506, 1558, 750, 1571] },
  { name: '二维码说明', bounds: [0, 1746, 837, 1762] },
];

const FIT_TEXT_LAYERS = [
  LAYERS.TEXT.CHAIR_NAME, LAYERS.TEXT.CHAIR_HOSPITAL,
  LAYERS.TEXT.SPEAKER1_NAME, LAYERS.TEXT.SPEAKER1_HOSPITAL,
  LAYERS.TEXT.SPEAKER2_NAME, LAYERS.TEXT.SPEAKER2_HOSPITAL,
  LAYERS.TEXT.MEETING_TIME, LAYERS.TEXT.MEETING_LOCATION,
];
for (let i = 0; i < 4; i += 1) FIT_TEXT_LAYERS.push(LAYERS.TEXT.scheduleTime(i), LAYERS.TEXT.scheduleContent(i), LAYERS.TEXT.scheduleSpeaker(i), LAYERS.TEXT.scheduleChair(i));

const REQUIRED_DYNAMIC_LAYERS = [
  LAYERS.TEXT.CHAIR_NAME, LAYERS.TEXT.CHAIR_HOSPITAL,
  LAYERS.TEXT.SPEAKER1_NAME, LAYERS.TEXT.SPEAKER1_HOSPITAL,
  LAYERS.TEXT.SPEAKER2_NAME, LAYERS.TEXT.SPEAKER2_HOSPITAL,
  LAYERS.TEXT.MEETING_TIME, LAYERS.TEXT.MEETING_LOCATION,
  LAYERS.AVATAR.CHAIR, LAYERS.AVATAR.SPEAKER1, LAYERS.AVATAR.SPEAKER2, LAYERS.QR,
];
for (let i = 0; i < 4; i += 1) REQUIRED_DYNAMIC_LAYERS.push(LAYERS.TEXT.scheduleTime(i), LAYERS.TEXT.scheduleContent(i), LAYERS.TEXT.scheduleSpeaker(i), LAYERS.TEXT.scheduleChair(i), LAYERS.TEXT.scheduleDot(i));

module.exports = {
  ROOT_GROUPS, FIXED_LAYERS, LAYERS,
  FIT_TEXT_LAYERS, REQUIRED_DYNAMIC_LAYERS, TEXT_LAYER_LAYOUTS,
  MIN_FONT_SIZE: 12, SCHEDULE_ROWS: 4, EXPECTED_WIDTH: 837, EXPECTED_HEIGHT: 1880,
};
