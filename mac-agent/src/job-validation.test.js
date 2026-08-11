'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_MAX_PAYLOAD_BYTES,
  HARD_MAX_INPUT_BYTES,
  safeResultFileName,
  validateImageBuffer,
  validateImageMetadata,
  validateJob,
} = require('./job-validation');

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const OWNER_ID = '22222222-2222-4222-8222-222222222222';

function bakedAvatar(storagePath, originalName) {
  return {
    storagePath,
    originalName,
    crop: { zoom: 1, offsetX: 0, offsetY: 0 },
    cropMode: 'baked',
    outputSize: 1024,
  };
}

function makeJob() {
  const prefix = `${OWNER_ID}/${JOB_ID}/input`;
  return {
    id: JOB_ID,
    owner_id: OWNER_ID,
    created_at: '2026-08-11T00:00:00.000Z',
    payload: {
      protocolVersion: 2,
      project: {
        id: 'chronic-care-2026',
        version: 1,
        canvas: { width: 837, height: 1880 },
        assetLayout: {
          chair: { left: 342, top: 496, width: 168, height: 168 },
          speaker1: { left: 221, top: 836, width: 168, height: 168 },
          speaker2: { left: 457, top: 836, width: 168, height: 168 },
          qrCode: { left: 338, top: 1576, width: 148, height: 148 },
        },
      },
      meeting: {
        meetingTime: '2026年8月11日 19:00-20:30',
        meetingLocation: '线上会议室',
        chair: { name: '主席', title: '教授', hospital: '示例医院' },
        speakers: [
          { name: '讲者一', title: '教授', hospital: '第一医院' },
          { name: '讲者二', title: '', hospital: '第二医院' },
        ],
        schedule: [
          { time: '19:00-19:30', content: '主题一', speaker: '讲者一', chair: '主席' },
          { time: '', content: '', speaker: '', chair: '' },
          { time: '', content: '', speaker: '', chair: '' },
          { time: '', content: '', speaker: '', chair: '' },
        ],
        outputName: '系列会议海报',
      },
      assets: {
        chair: bakedAvatar(`${prefix}/chair.png`, 'chair-cropped.png'),
        speaker1: bakedAvatar(`${prefix}/speaker1.png`, 'speaker1-cropped.png'),
        speaker2: bakedAvatar(`${prefix}/speaker2.png`, 'speaker2-cropped.png'),
        qrCode: { storagePath: `${prefix}/qr.png`, originalName: 'qr.png' },
      },
    },
  };
}

test('validates and normalizes a legitimate v2 baked job', () => {
  const normalized = validateJob(makeJob());
  assert.equal(normalized.id, JOB_ID);
  assert.equal(normalized.ownerId, OWNER_ID);
  assert.equal(normalized.assets.chair.cropMode, 'baked');
  assert.equal(normalized.assets.chair.outputSize, 1024);
  assert.equal(normalized.assets.speaker1.localExtension, 'png');
  assert.equal(normalized.meeting.schedule.length, 4);
  assert.equal(normalized.meeting.__renderContract.protocolVersion, 2);
  assert.deepEqual(
    normalized.meeting.__renderContract.project.assetLayout.chair,
    { left: 342, top: 496, width: 168, height: 168 },
  );
});

test('rejects raw avatars and non-PNG baked avatars', () => {
  const raw = makeJob();
  raw.payload.assets.chair.cropMode = 'raw';
  assert.throws(() => validateJob(raw), /raw 模式已禁用/);

  const jpeg = makeJob();
  jpeg.payload.assets.speaker1.storagePath = `${OWNER_ID}/${JOB_ID}/input/speaker1.jpg`;
  assert.throws(() => validateJob(jpeg), /baked 成品必须是 PNG/);

  const wrongCrop = makeJob();
  wrongCrop.payload.assets.speaker2.crop.zoom = 0.8;
  assert.throws(() => validateJob(wrongCrop), /baked 裁剪参数/);
});

test('requires render protocol and validates layout generically without hardcoded box sizes', () => {
  const oldProtocol = makeJob();
  oldProtocol.payload.protocolVersion = 1;
  assert.throws(() => validateJob(oldProtocol), /协议版本必须为 2/);

  const outsideCanvas = makeJob();
  outsideCanvas.payload.project.assetLayout.chair.left = 800;
  assert.throws(() => validateJob(outsideCanvas), /超出项目画布范围/);

  const nonSquare = makeJob();
  nonSquare.payload.project.assetLayout.qrCode.width = 140;
  assert.throws(() => validateJob(nonSquare), /必须是正方形/);

  const alternateValidSize = makeJob();
  alternateValidSize.payload.project.assetLayout.chair.width = 180;
  alternateValidSize.payload.project.assetLayout.chair.height = 180;
  assert.equal(validateJob(alternateValidSize).meeting.__renderContract.project.assetLayout.chair.width, 180);
});

test('rejects cross-owner, cross-job, nested, and prefix-confusion storage paths', () => {
  const invalidPaths = [
    `33333333-3333-4333-8333-333333333333/${JOB_ID}/input/chair.png`,
    `${OWNER_ID}/44444444-4444-4444-8444-444444444444/input/chair.png`,
    `${OWNER_ID}/${JOB_ID}/input/nested/chair.png`,
    `${OWNER_ID}/${JOB_ID}/input-evil/chair.png`,
    `${OWNER_ID}/${JOB_ID}/input/../chair.png`,
  ];
  for (const storagePath of invalidPaths) {
    const job = makeJob();
    job.payload.assets.chair.storagePath = storagePath;
    assert.throws(() => validateJob(job), /不属于当前用户和任务|文件名或类型/);
  }
});

test('requires the expected asset filename and supported extension', () => {
  const wrongName = makeJob();
  wrongName.payload.assets.chair.storagePath = `${OWNER_ID}/${JOB_ID}/input/speaker1.png`;
  assert.throws(() => validateJob(wrongName), /文件名或类型/);

  const wrongType = makeJob();
  wrongType.payload.assets.qrCode.storagePath = `${OWNER_ID}/${JOB_ID}/input/qr.svg`;
  assert.throws(() => validateJob(wrongType), /文件名或类型/);
});

test('enforces payload byte limit before processing fields', () => {
  const job = makeJob();
  job.payload.padding = '海'.repeat(DEFAULT_MAX_PAYLOAD_BYTES);
  assert.throws(() => validateJob(job), /payload 超过/);
});

test('validates storage metadata, response type, file size, and magic bytes', () => {
  const asset = validateJob(makeJob()).assets.chair;
  assert.deepEqual(
    validateImageMetadata(asset, { size: 1024, contentType: 'image/png' }),
    { size: 1024, contentType: 'image/png' },
  );
  assert.throws(
    () => validateImageMetadata(asset, { size: HARD_MAX_INPUT_BYTES + 1, contentType: 'image/png' }),
    /超过/,
  );
  assert.throws(
    () => validateImageMetadata(asset, { size: 10, contentType: 'image/jpeg' }),
    /MIME 类型/,
  );

  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(validateImageBuffer(asset, png, 'image/png'), 'png');
  const disguisedJpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00]);
  assert.throws(() => validateImageBuffer(asset, disguisedJpeg, 'image/png'), /文件头/);
});

test('rejects path traversal in Photoshop output filenames', () => {
  assert.equal(safeResultFileName('海报.psd', '.psd'), '海报.psd');
  assert.throws(() => safeResultFileName('../海报.psd', '.psd'), /不得包含目录/);
  assert.throws(() => safeResultFileName('海报.png', '.psd'), /必须是/);
});
