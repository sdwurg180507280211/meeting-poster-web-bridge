'use strict';

const engine = require('./ps-engine');

const RENDER_PROTOCOL_VERSION = 2;
const AVATAR_OUTPUT_SIZE = 1024;
const originalGeneratePoster = engine.generatePoster.bind(engine);

function fail(message) {
  throw new Error(`渲染协议无效：${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeBox(value, label, canvas) {
  if (!isObject(value)) fail(`${label} 缺失`);
  const box = {
    left: Number(value.left),
    top: Number(value.top),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (!Object.values(box).every(Number.isFinite)) fail(`${label} 包含非数字坐标`);
  if (![box.left, box.top, box.width, box.height].every(Number.isInteger)) fail(`${label} 必须使用整数像素`);
  if (box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0) fail(`${label} 尺寸或位置非法`);
  if (box.left + box.width > canvas.width || box.top + box.height > canvas.height) fail(`${label} 超出画布`);
  if (box.width !== box.height) fail(`${label} 必须是正方形`);
  return box;
}

function runtimeSpec(spec, contract) {
  if (!isObject(contract) || contract.protocolVersion !== RENDER_PROTOCOL_VERSION) {
    fail(`只支持 protocolVersion=${RENDER_PROTOCOL_VERSION}`);
  }
  const project = contract.project;
  if (!isObject(project) || !isObject(project.canvas) || !isObject(project.assetLayout)) fail('project 结构缺失');
  const canvas = {
    width: Number(project.canvas.width),
    height: Number(project.canvas.height),
  };
  if (!Number.isInteger(canvas.width) || !Number.isInteger(canvas.height) || canvas.width <= 0 || canvas.height <= 0) {
    fail('项目画布尺寸非法');
  }
  if (canvas.width !== spec.EXPECTED_WIDTH || canvas.height !== spec.EXPECTED_HEIGHT) {
    fail(`项目画布 ${canvas.width}×${canvas.height} 与当前 PSD 母版 ${spec.EXPECTED_WIDTH}×${spec.EXPECTED_HEIGHT} 不一致`);
  }

  return {
    ...spec,
    AVATAR_BOXES: {
      CHAIR: normalizeBox(project.assetLayout.chair, 'chair', canvas),
      SPEAKER1: normalizeBox(project.assetLayout.speaker1, 'speaker1', canvas),
      SPEAKER2: normalizeBox(project.assetLayout.speaker2, 'speaker2', canvas),
    },
    QR_BOX: normalizeBox(project.assetLayout.qrCode, 'qrCode', canvas),
  };
}

function assertBakedAvatar(asset, label) {
  if (!isObject(asset)) fail(`${label}素材缺失`);
  if (asset.cropMode !== 'baked') fail(`${label}只允许 baked 模式`);
  if (asset.outputSize !== AVATAR_OUTPUT_SIZE) fail(`${label} baked outputSize 必须为 ${AVATAR_OUTPUT_SIZE}`);
  if (!isObject(asset.crop)
      || Number(asset.crop.zoom) !== 1
      || Number(asset.crop.offsetX) !== 0
      || Number(asset.crop.offsetY) !== 0) {
    fail(`${label}不能再次携带 raw 裁剪参数`);
  }
}

function currentSchedule(schedule) {
  if (!Array.isArray(schedule)) return schedule;
  return schedule.map((row, index) => {
    if (index !== 0 || !isObject(row)) return row;
    return { ...row, speaker: '' };
  });
}

engine.generatePoster = function generatePosterWithRenderContract(args) {
  const meeting = args?.meeting;
  const assets = args?.assets;
  if (!isObject(meeting)) fail('meeting 缺失');
  if (!isObject(assets)) fail('assets 缺失');

  assertBakedAvatar(assets.chairAvatar, '主席头像');
  assertBakedAvatar(assets.speaker1Avatar, '讲者一头像');
  assertBakedAvatar(assets.speaker2Avatar, '讲者二头像');

  const contract = meeting.__renderContract;
  const cleanMeeting = { ...meeting, schedule: currentSchedule(meeting.schedule) };
  delete cleanMeeting.__renderContract;

  return originalGeneratePoster({
    ...args,
    meeting: cleanMeeting,
    spec: runtimeSpec(args.spec, contract),
  });
};

module.exports = engine;
