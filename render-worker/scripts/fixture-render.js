'use strict';
// fixture：真实 manifest + 真实背景 + 假数据，验证 resvg 渲染链路
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { loadTemplate } = require('../src/template.js');
const { renderPoster } = require('../src/renderer.js');

const OUT = '/tmp/rw-test/fixture.png';
const FONT_DIR = '/tmp/pingfang';
process.env.RENDER_FONT_REGULAR = path.join(FONT_DIR, 'PingFangSC-Regular.ttf');
process.env.RENDER_FONT_SEMIBOLD = path.join(FONT_DIR, 'PingFangSC-Semibold.ttf');

async function avatar(color) {
  return sharp({ create: { width: 1024, height: 1024, channels: 4, background: color } })
    .png().toBuffer();
}async function qr() {
  // 伪二维码：黑白网格
  const size = 512;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dark = ((x >> 4) + (y >> 4)) % 2 === 0;
      const i = (y * size + x) * 4;
      buf[i] = dark ? 0 : 255;
      buf[i + 1] = dark ? 0 : 255;
      buf[i + 2] = dark ? 0 : 255;
      buf[i + 3] = 255;
    }
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
}

(async () => {
  const template = await loadTemplate('chronic-care-2026');
  console.log('template ok, fonts:', template.fonts.regular.length, template.fonts.semibold.length);

  const payload = {
    protocolVersion: 2,
    project: {
      id: 'chronic-care-2026',
      canvas: { width: 837, height: 1880 },
      assetLayout: {
        chair: { left: 342, top: 496, width: 168, height: 168 },
        speaker1: { left: 220, top: 836, width: 168, height: 168 },
        speaker2: { left: 457, top: 836, width: 168, height: 168 },
        qrCode: { left: 338, top: 1576, width: 148, height: 148 },
      },
    },
    meeting: {
      chair: { name: '赵志伟 教授', title: '', hospital: '北医三院' },
      speakers: [
        { name: '张三 教授', title: '', hospital: '首都医科大学' },
        { name: '李四 教授', title: '', hospital: '北医三院' },
      ],
      meetingTime: '会议时间：2026年8月13日 19:00',
      meetingLocation: '会议地点：线上',
      schedule: [
        { time: '13:30-13:35', content: '开场致辞', speaker: '', chair: '赵志伟' },
        { time: '13:35-13:55', content: '学术报告一：慢病管理新进展', speaker: '张三', chair: '' },
        { time: '13:55-14:15', content: '学术报告二', speaker: '李四', chair: '' },
        { time: '14:15-14:30', content: '会议总结', speaker: '', chair: '张三' },
      ],
    },
  };

  const assets = {
    chairAvatar: await avatar([230, 89, 89, 255]),
    speaker1Avatar: await avatar([89, 230, 102, 255]),
    speaker2Avatar: await avatar([102, 115, 230, 255]),
    qrCode: await qr(),
  };

  const png = await renderPoster({ template, payload, assets });
  fs.writeFileSync(OUT, png);
  console.log('fixture rendered:', png.length, 'bytes ->', OUT);
})().catch((e) => { console.error('FAIL:', e.message); process.exit(1); });
