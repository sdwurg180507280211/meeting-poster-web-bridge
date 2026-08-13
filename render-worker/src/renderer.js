'use strict';

const sharp = require('sharp');
const { validateBox } = require('./template');

const DEFAULT_COLOR = '#191919';

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;',
  }[char]));
}

function valueAt(root, path) {
  return String(path || '').split('.').reduce((value, key) => {
    if (value == null) return undefined;
    if (/^\d+$/.test(key)) return Array.isArray(value) ? value[Number(key)] : undefined;
    return value[key];
  }, root);
}

function textValue(slot, meeting) {
  const raw = String(valueAt(meeting, slot.source) ?? '').trim();
  if (!raw) return '';
  return `${slot.prefix || ''}${raw}${slot.suffix || ''}`;
}

function fontDataUri(buffer) {
  return `data:font/otf;base64,${buffer.toString('base64')}`;
}

function svgStyle(template) {
  return `
    @font-face { font-family: PosterRegular; src: url('${fontDataUri(template.fonts.regular)}'); }
    @font-face { font-family: PosterSemibold; src: url('${fontDataUri(template.fonts.semibold)}'); }
  `;
}

async function measuredWidth(template, text, slot, fontSize) {
  if (!text) return 0;
  const width = Math.max(2048, Math.ceil(slot.box.width * 4));
  const height = Math.max(128, Math.ceil(fontSize * 3));
  const family = slot.weight === 'semibold' ? 'PosterSemibold' : 'PosterRegular';
  const tracking = Number(slot.letterSpacing || 0);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>${svgStyle(template)}</style>
      <text x="8" y="8" dominant-baseline="hanging" font-family="${family}" font-size="${fontSize}" letter-spacing="${tracking}">${escapeXml(text)}</text>
    </svg>`);
  const trimmed = await sharp(svg).trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const metadata = await sharp(trimmed).metadata();
  return Number(metadata.width || 0);
}

async function fittedFontSize(template, text, slot) {
  const base = Number(slot.fontSize);
  const minimum = Number(slot.minFontSize);
  const width = await measuredWidth(template, text, slot, base);
  if (!width || width <= slot.box.width) return base;
  return Math.max(minimum, Math.min(base, Math.floor(base * slot.box.width / width)));
}

async function renderText(template, text, slot) {
  if (!text) return null;
  const fontSize = await fittedFontSize(template, text, slot);
  const family = slot.weight === 'semibold' ? 'PosterSemibold' : 'PosterRegular';
  const box = slot.box;
  const x = slot.align === 'center' ? box.width / 2 : slot.align === 'right' ? box.width : 0;
  const anchor = slot.align === 'center' ? 'middle' : slot.align === 'right' ? 'end' : 'start';
  const tracking = Number(slot.letterSpacing || 0);
  const svg = Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="${box.width}" height="${box.height}">
      <style>${svgStyle(template)}</style>
      <text x="${x}" y="0" dominant-baseline="hanging" text-anchor="${anchor}" font-family="${family}" font-size="${fontSize}" letter-spacing="${tracking}" fill="${escapeXml(slot.color || DEFAULT_COLOR)}">${escapeXml(text)}</text>
    </svg>`);
  return { input: svg, left: box.left, top: box.top };
}

async function renderAvatar(input, box) {
  const size = box.width;
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`);
  return sharp(input)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

async function renderQr(input, box) {
  return sharp(input).resize(box.width, box.height, { fit: 'fill', kernel: sharp.kernel.nearest }).png().toBuffer();
}

function normalizeRuntimeBox(value, label, canvas) {
  const box = validateBox(value, label, canvas);
  if (box.width !== box.height) throw new Error(`${label} 必须是正方形`);
  return box;
}

function cleanSchedule(schedule) {
  const rows = Array.isArray(schedule) ? schedule.slice(0, 4) : [];
  while (rows.length < 4) rows.push({});
  return rows.map((row, index) => ({
    time: String(row?.time || '').trim(),
    content: String(row?.content || '').trim(),
    speaker: index === 0 ? '' : String(row?.speaker || '').trim(),
    chair: String(row?.chair || '').trim(),
  }));
}

function scheduleSlot(manifest, column, rowIndex) {
  const base = manifest.schedule.columns[column];
  const rowTop = Number(manifest.schedule.rows[rowIndex]);
  const template = manifest.schedule.text[column] || manifest.schedule.text.default;
  return {
    ...template,
    box: {
      left: base.box.left,
      top: rowTop,
      width: base.box.width,
      height: base.box.height,
    },
  };
}

async function renderPoster({ template, payload, assets }) {
  const { manifest } = template;
  if (payload?.schemaVersion !== 1) throw new Error('只支持 schemaVersion=1');
  if (payload.projectId !== manifest.projectId) throw new Error(`项目 ${payload.projectId} 没有匹配模板`);
  const meeting = payload.meeting || {};
  const canvas = manifest.canvas;
  const background = sharp(template.backgroundPath);
  const metadata = await background.metadata();
  if (metadata.width !== canvas.width || metadata.height !== canvas.height) {
    throw new Error(`background.png 应为 ${canvas.width}×${canvas.height}，当前为 ${metadata.width}×${metadata.height}`);
  }

  const assetLayout = payload.assetLayout || {};
  const boxes = {
    chairAvatar: normalizeRuntimeBox(assetLayout.chair, 'assetLayout.chair', canvas),
    speaker1Avatar: normalizeRuntimeBox(assetLayout.speaker1, 'assetLayout.speaker1', canvas),
    speaker2Avatar: normalizeRuntimeBox(assetLayout.speaker2, 'assetLayout.speaker2', canvas),
    qrCode: normalizeRuntimeBox(assetLayout.qrCode, 'assetLayout.qrCode', canvas),
  };

  const layers = [];
  for (const key of ['chairAvatar', 'speaker1Avatar', 'speaker2Avatar']) {
    if (!Buffer.isBuffer(assets[key])) throw new Error(`${key} 素材缺失`);
    layers.push({ input: await renderAvatar(assets[key], boxes[key]), left: boxes[key].left, top: boxes[key].top });
  }
  if (!Buffer.isBuffer(assets.qrCode)) throw new Error('qrCode 素材缺失');
  layers.push({ input: await renderQr(assets.qrCode, boxes.qrCode), left: boxes.qrCode.left, top: boxes.qrCode.top });

  for (const slot of Object.values(manifest.texts)) {
    const layer = await renderText(template, textValue(slot, meeting), slot);
    if (layer) layers.push(layer);
  }

  const schedule = cleanSchedule(meeting.schedule);
  for (let index = 0; index < 4; index += 1) {
    const row = schedule[index];
    if (!(row.time || row.content || row.speaker || row.chair)) continue;
    for (const column of ['time', 'content', 'speaker', 'chair']) {
      if (!row[column]) continue;
      const layer = await renderText(template, row[column], scheduleSlot(manifest, column, index));
      if (layer) layers.push(layer);
    }
    if (manifest.schedule.dot && row.content) {
      const dot = manifest.schedule.dot;
      const dotSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${dot.size}" height="${dot.size}"><circle cx="${dot.size / 2}" cy="${dot.size / 2}" r="${dot.size / 2}" fill="${escapeXml(dot.color)}"/></svg>`);
      layers.push({ input: dotSvg, left: dot.left, top: Number(manifest.schedule.rows[index]) + Number(dot.topOffset || 0) });
    }
  }

  return background.composite(layers).png({ compressionLevel: 9 }).toBuffer();
}

module.exports = { renderPoster, textValue, cleanSchedule, fittedFontSize };
