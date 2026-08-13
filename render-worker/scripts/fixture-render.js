'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { loadTemplate } = require('../src/template');
const { renderPoster } = require('../src/renderer');

const OUT = process.argv[2] || '/tmp/meeting-poster-node-fixture.png';

async function avatar(color) {
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: color } }).png().toBuffer();
}

async function qr() {
  const size = 512;
  const buffer = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = ((x >> 4) + (y >> 4)) % 2 === 0;
      const offset = (y * size + x) * 4;
      const value = dark ? 0 : 255;
      buffer[offset] = value;
      buffer[offset + 1] = value;
      buffer[offset + 2] = value;
      buffer[offset + 3] = 255;
    }
  }
  return sharp(buffer, { raw: { width: size, height: size, channels: 4 } }).jpeg({ quality: 95 }).toBuffer();
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
      chairAvatar: await avatar([230, 89, 89, 255]),
      speaker1Avatar: await avatar([89, 230, 102, 255]),
      speaker2Avatar: await avatar([102, 115, 230, 255]),
      // JPEG on purpose: renderer must normalize runtime QR input before embedding it into SVG.
      qrCode: await qr(),
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
