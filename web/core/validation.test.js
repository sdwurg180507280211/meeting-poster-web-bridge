'use strict';

const assert = require('node:assert/strict');
const validation = require('./validation.js');

const fallbackUuid = validation.createUuid({
  getRandomValues(bytes) {
    bytes.fill(0);
    return bytes;
  },
});
assert.equal(fallbackUuid, '00000000-0000-4000-8000-000000000000');
assert.equal(validation.isUuidV4(fallbackUuid), true);
assert.throws(() => validation.createUuid({}), /安全随机数/);

assert.equal(validation.validateImageFile({ name: 'avatar.png', type: 'image/png', size: 1024 }, '头像'), null);
assert.match(validation.validateImageFile({ name: 'avatar.png', type: '', size: 1024 }, '头像'), /只支持/);
assert.match(validation.validateImageFile({ name: 'avatar.png', type: 'image/png', size: 0 }, '头像'), /空文件/);
assert.match(validation.validateImageFile({
  name: 'avatar.png',
  type: 'image/png',
  size: validation.MAX_FILE_BYTES + 1,
}, '头像'), /15 MiB/);

const meeting = {
  meetingTime: '2026年8月11日 19:00-20:30',
  meetingLocation: '线上',
  chair: { name: '主席', title: '教授', hospital: '示例医院' },
  speakers: [
    { name: '讲者一', title: '教授', hospital: '示例医院' },
    { name: '讲者二', title: '教授', hospital: '示例医院' },
  ],
  schedule: [
    { time: '19:00-19:30', content: '主题分享', speaker: '讲者一', chair: '主席' },
    { time: '', content: '', speaker: '', chair: '' },
    { time: '', content: '', speaker: '', chair: '' },
    { time: '', content: '', speaker: '', chair: '' },
  ],
  outputName: '系列会议海报',
};
assert.deepEqual(validation.validateMeeting(meeting), []);

const scheduleWithoutContent = structuredClone(meeting);
scheduleWithoutContent.schedule[0].content = '';
assert.deepEqual(
  validation.validateMeeting(scheduleWithoutContent),
  [],
  '日程行有时间和人员时，内容允许留空',
);
assert.match(validation.validateMeeting({ ...meeting, meetingTime: '' })[0], /会议日期和时间/);
assert.ok(validation.validateMeeting({ ...meeting, outputName: '海'.repeat(101) }).some(error => /输出文件名/.test(error)));

const assets = {
  chair: { storagePath: 'u/j/input/chair.png', originalName: 'chair.png', crop: { zoom: 1, offsetX: 0, offsetY: 0 } },
  speaker1: { storagePath: 'u/j/input/speaker1.jpg', originalName: 'speaker1.jpg', crop: { zoom: 1, offsetX: 0, offsetY: 0 } },
  speaker2: { storagePath: 'u/j/input/speaker2.webp', originalName: 'speaker2.webp', crop: { zoom: 1, offsetX: 0, offsetY: 0 } },
  qrCode: { storagePath: 'u/j/input/qr.png', originalName: 'qr.png' },
};
assert.deepEqual(validation.validatePayload({ meeting, assets }), []);
const bakedAssets = {
  ...assets,
  chair: {
    ...assets.chair,
    cropMode: 'baked',
    outputSize: 1024,
  },
};
assert.deepEqual(validation.validatePayload({ meeting, assets: bakedAssets }), []);
assert.ok(validation.validatePayload({
  meeting,
  assets: { ...bakedAssets, chair: { ...bakedAssets.chair, outputSize: 0 } },
}).some(error => /裁剪输出尺寸/.test(error)));
assert.ok(validation.validatePayload({
  meeting,
  assets: { ...assets, chair: { ...assets.chair, outputSize: 1024 } },
}).some(error => /原始图片不能携带/.test(error)));
assert.ok(validation.validatePayload({ meeting, assets, padding: 'x'.repeat(validation.MAX_PAYLOAD_BYTES) })
  .some(error => /任务内容过大/.test(error)));

console.log('validation tests passed');
