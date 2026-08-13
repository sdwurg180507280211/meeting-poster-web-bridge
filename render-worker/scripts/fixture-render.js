'use strict';

const fs = require('fs');
const path = require('path');
const { loadTemplate } = require('../src/template');
const { renderPoster } = require('../src/renderer');

const OUT = process.argv[2] || '/tmp/meeting-poster-node-fixture.png';
const PNGS = Object.freeze({
  chair: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGN4Fhn5HwAGWQKY0tH2cwAAAABJRU5ErkJggg==',
  speaker1: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGOIfJb2HwAF5gKl81zMnQAAAABJRU5ErkJggg==',
  speaker2: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNIK372HwAFwQK/DYV5SAAAAABJRU5ErkJggg==',
  qr: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAX+XDSwAAAABJRU5ErkJggg==',
});

function fixturePng(key) {
  return Buffer.from(PNGS[key], 'base64');
}

async function main() {
  const template = await loadTemplate('chronic-care-2026');
  const payload = {
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
      meetingTime: '2026年8月13日 19:00-20:30',
      meetingLocation: '线上',
      chair: { name: '赵志伟', title: '教授', hospital: '北医三院' },
      speakers: [
        { name: '张三', title: '教授', hospital: '首都医科大学' },
        { name: '李四', title: '教授', hospital: '北医三院' },
      ],
      schedule: [
        { time: '13:30-13:35', content: '开场致辞', speaker: '', chair: '赵志伟 教授' },
        { time: '13:35-13:55', content: '学术报告一：慢病管理新进展', speaker: '张三 教授', chair: '' },
        { time: '13:55-14:15', content: '学术报告二', speaker: '李四 教授', chair: '赵志伟 教授' },
        { time: '14:15-14:30', content: '会议总结', speaker: '张三 教授', chair: '李四 教授' },
      ],
      outputName: 'Node Renderer Fixture',
    },
  };

  const png = await renderPoster({
    template,
    payload,
    assets: {
      chairAvatar: fixturePng('chair'),
      speaker1Avatar: fixturePng('speaker1'),
      speaker2Avatar: fixturePng('speaker2'),
      qrCode: fixturePng('qr'),
    },
  });

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, png);
  console.log(`fixture rendered: ${png.length} bytes -> ${OUT}`);
}

main().catch((error) => {
  console.error('FAIL:', error.stack || error.message || error);
  process.exit(1);
});
