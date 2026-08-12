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
  FIT_TEXT_LAYERS, REQUIRED_DYNAMIC_LAYERS,
  TEMPLATE_VERSION: 'chronic-care-v10',
  MIN_FONT_SIZE: 12, SCHEDULE_ROWS: 4, EXPECTED_WIDTH: 837, EXPECTED_HEIGHT: 1880,
};
