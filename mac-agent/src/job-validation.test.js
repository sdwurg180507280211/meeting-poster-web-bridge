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

function makeJob() {
  const prefix = `${OWNER_ID}/${JOB_ID}/input`;
  return {
    id: JOB_ID,
    owner_id: OWNER_ID,
    created_at: '2026-08-11T00:00:00.000Z',
    payload: {
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
        chair: {
          storagePath: `${prefix}/chair.png`,
          originalName: 'chair.png',
          crop: { zoom: 1, offsetX: 0, offsetY: 0 },
          cropMode: 'baked',
          outputSize: 1024,
        },
        speaker1: {
          storagePath: `${prefix}/speaker1.jpg`,
          originalName: 'speaker1.jpg',
          crop: { zoom: 3.5, offsetX: -100, offsetY: 100 },
        },
        speaker2: {
          storagePath: `${prefix}/speaker2.webp`,
          originalName: 'speaker2.webp',
          crop: { zoom: 0.2, offsetX: 0, offsetY: 0 },
          cropMode: 'raw',
        },
        qrCode: { storagePath: `${prefix}/qr.png`, originalName: 'qr.png' },
      },
    },
  };
}

test('validates and normalizes a legitimate job', () => {
  const normalized = validateJob(makeJob());
  assert.equal(normalized.id, JOB_ID);
  assert.equal(normalized.ownerId, OWNER_ID);
  assert.equal(normalized.assets.chair.cropMode, 'baked');
  assert.equal(normalized.assets.chair.outputSize, 1024);
  assert.equal(normalized.assets.speaker1.cropMode, 'raw');
  assert.equal(normalized.assets.speaker1.localExtension, 'jpg');
  assert.equal(normalized.meeting.schedule.length, 4);
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

test('enforces crop mode and baked output bounds while preserving old raw jobs', () => {
  const oldJob = makeJob();
  delete oldJob.payload.assets.speaker1.cropMode;
  assert.equal(validateJob(oldJob).assets.speaker1.cropMode, 'raw');

  const tooSmall = makeJob();
  tooSmall.payload.assets.chair.outputSize = 255;
  assert.throws(() => validateJob(tooSmall), /必须为 1024/);

  const notInteger = makeJob();
  notInteger.payload.assets.chair.outputSize = 1024.5;
  assert.throws(() => validateJob(notInteger), /必须为 1024/);

  const rawWithOutput = makeJob();
  rawWithOutput.payload.assets.speaker1.outputSize = 1024;
  assert.throws(() => validateJob(rawWithOutput), /raw 模式不应包含/);

  const bakedJpeg = makeJob();
  bakedJpeg.payload.assets.speaker1.cropMode = 'baked';
  bakedJpeg.payload.assets.speaker1.outputSize = 1024;
  bakedJpeg.payload.assets.speaker1.crop = { zoom: 1, offsetX: 0, offsetY: 0 };
  assert.throws(() => validateJob(bakedJpeg), /必须是 PNG/);
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
