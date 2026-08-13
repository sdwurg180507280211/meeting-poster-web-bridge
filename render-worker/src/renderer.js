'use strict';

const fs = require('fs/promises');
const { Resvg } = require('@resvg/resvg-js');
const fontkit = require('fontkit');

const DEFAULT_COLOR = '#191919';
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

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
  if (Object.prototype.hasOwnProperty.call(slot, 'text')) return String(slot.text || '');
  const raw = String(valueAt(meeting, slot.source) ?? '').trim();
  if (!raw) return '';
  return `${slot.prefix || ''}${raw}${slot.suffix || ''}`;
}

function dataUri(buffer) {
  return `data:image/png;base64,${buffer.toString('base64')}`;
}

function isPng(buffer) {
  return Buffer.isBuffer(buffer)
    && buffer.length >= PNG_SIGNATURE.length
    && buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE);
}

function assertPng(buffer, label) {
  if (!isPng(buffer)) throw new Error(`${label} 必须是 PNG`);
  return buffer;
}

const parsedFonts = new Map();
function parsedFont(buffer) {
  if (!parsedFonts.has(buffer)) parsedFonts.set(buffer, fontkit.create(buffer));
  return parsedFonts.get(buffer);
}

function fontMeta(buffer, role) {
  const font = parsedFont(buffer);
  const os2Weight = Number(font['OS/2']?.usWeightClass);
  return {
    family: String(font.familyName || 'sans-serif'),
    weight: Number.isFinite(os2Weight) && os2Weight > 0 ? os2Weight : role === 'semibold' ? 600 : 400,
  };
}

function measureText(fontBuffer, text, fontSize, tracking = 0) {
  if (!text) return 0;
  const font = parsedFont(fontBuffer);
  const run = font.layout(String(text));
  const scale = Number(fontSize) / Number(font.unitsPerEm || 1000);
  let advance = 0;
  for (let index = 0; index < run.glyphs.length; index += 1) {
    const positionAdvance = Number(run.positions?.[index]?.xAdvance);
    advance += Number.isFinite(positionAdvance) ? positionAdvance : Number(run.glyphs[index]?.advanceWidth || 0);
  }
  const glyphWidth = advance * scale;
  const characterCount = Array.from(String(text)).length;
  const trackingWidth = Math.max(0, characterCount - 1) * (Number(tracking || 0) / 1000) * Number(fontSize);
  return glyphWidth + trackingWidth;
}

function fittedFontSize(fontBuffer, text, slot) {
  const base = Math.max(1, Math.round(Number(slot.fontSize)));
  const minimum = Math.max(1, Math.min(base, Math.round(Number(slot.minFontSize || 12))));
  const maxWidth = Number(slot.maxWidth || 0);
  if (!maxWidth || !text) return base;

  for (let size = base; size > minimum; size -= 1) {
    if (measureText(fontBuffer, text, size, slot.tracking) <= maxWidth + 0.5) return size;
  }
  return minimum;
}

function anchorOf(align) {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

function textElement(fontBuffer, slot, text) {
  const role = slot.weight === 'semibold' ? 'semibold' : 'regular';
  const meta = fontMeta(fontBuffer, role);
  const fontSize = fittedFontSize(fontBuffer, text, slot);
  const trackingPx = (Number(slot.tracking || 0) / 1000) * fontSize;
  const attrs = [
    `x="${Number(slot.x)}"`,
    `y="${Number(slot.y)}"`,
    `text-anchor="${anchorOf(slot.align || 'left')}"`,
    `font-family="${escapeXml(meta.family)}"`,
    `font-weight="${meta.weight}"`,
    `font-size="${fontSize}"`,
    `fill="${escapeXml(slot.color || DEFAULT_COLOR)}"`,
  ];
  if (trackingPx) attrs.push(`letter-spacing="${trackingPx}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(text)}</text>`;
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

function assetBox(value, fallback, label, canvas) {
  const source = value || fallback;
  if (!source) throw new Error(`缺少 ${label} 素材几何`);
  const box = {
    left: Number(source.left),
    top: Number(source.top),
    width: Number(source.width ?? source.size),
    height: Number(source.height ?? source.size),
  };
  if (!Object.values(box).every(Number.isFinite)) throw new Error(`${label} 素材几何必须是数字`);
  if (box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0) throw new Error(`${label} 素材几何非法`);
  if (Math.abs(box.width - box.height) > 0.001) throw new Error(`${label} 素材区域必须为正方形`);
  if (box.left + box.width > canvas.width || box.top + box.height > canvas.height) throw new Error(`${label} 素材区域超出画布`);
  return box;
}

function avatarClipPath(key, box) {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  return `<clipPath id="clip-${key}" clipPathUnits="userSpaceOnUse"><circle cx="${cx}" cy="${cy}" r="${box.width / 2}"/></clipPath>`;
}

function avatarElement(key, imageBuffer, box) {
  return `<image href="${dataUri(imageBuffer)}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${key})"/>`;
}

function qrElement(imageBuffer, box) {
  return `<image href="${dataUri(imageBuffer)}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet"/>`;
}

async function renderPoster({ template, payload, assets }) {
  const { manifest, backgroundPath, fonts, fontPaths } = template;
  if (payload?.protocolVersion !== 2) throw new Error('只支持 render protocol v2');
  const project = payload.project;
  if (!project || project.id !== manifest.projectId) throw new Error(`项目 ${project?.id || '-'} 没有匹配模板`);
  if (Number(project.canvas?.width) !== manifest.canvas.width || Number(project.canvas?.height) !== manifest.canvas.height) {
    throw new Error('任务画布与模板画布不一致');
  }

  const meeting = payload.meeting || {};
  const canvas = manifest.canvas;
  const backgroundBuffer = assertPng(await fs.readFile(backgroundPath), 'background.png');
  const runtimeLayout = project.assetLayout || {};
  const chairBox = assetBox(runtimeLayout.chair, manifest.images.chair, 'chair', canvas);
  const speaker1Box = assetBox(runtimeLayout.speaker1, manifest.images.speaker1, 'speaker1', canvas);
  const speaker2Box = assetBox(runtimeLayout.speaker2, manifest.images.speaker2, 'speaker2', canvas);
  const qrBox = assetBox(runtimeLayout.qrCode, manifest.images.qrCode, 'qrCode', canvas);

  const normalizedAssets = {
    chairAvatar: assertPng(assets.chairAvatar, 'chairAvatar'),
    speaker1Avatar: assertPng(assets.speaker1Avatar, 'speaker1Avatar'),
    speaker2Avatar: assertPng(assets.speaker2Avatar, 'speaker2Avatar'),
    qrCode: assertPng(assets.qrCode, 'qrCode'),
  };

  const defs = [
    avatarClipPath('chair', chairBox),
    avatarClipPath('speaker1', speaker1Box),
    avatarClipPath('speaker2', speaker2Box),
  ];
  const body = [
    `<image href="${dataUri(backgroundBuffer)}" x="0" y="0" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="none"/>`,
    avatarElement('chair', normalizedAssets.chairAvatar, chairBox),
    avatarElement('speaker1', normalizedAssets.speaker1Avatar, speaker1Box),
    avatarElement('speaker2', normalizedAssets.speaker2Avatar, speaker2Box),
    qrElement(normalizedAssets.qrCode, qrBox),
  ];

  const fontForSlot = (slot) => (slot.weight === 'semibold' ? fonts.semibold : fonts.regular);

  for (const slot of Object.values(manifest.texts)) {
    const text = textValue(slot, meeting);
    if (text) body.push(textElement(fontForSlot(slot), slot, text));
  }

  const schedule = cleanSchedule(meeting.schedule);
  for (let index = 0; index < 4; index += 1) {
    const dataRow = schedule[index];
    const designRow = manifest.schedule.rows[index];
    if (!(dataRow.time || dataRow.content || dataRow.speaker || dataRow.chair)) continue;

    for (const column of ['time', 'content', 'speaker', 'chair']) {
      const text = dataRow[column];
      if (!text) continue;
      const slot = designRow[column];
      body.push(textElement(fontForSlot(slot), slot, text));
    }

    if (dataRow.content) {
      const dot = designRow.dot;
      body.push(textElement(fontForSlot(dot), dot, textValue(dot, meeting) || '●'));
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><defs>${defs.join('')}</defs>${body.join('')}</svg>`;
  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: canvas.width },
    font: {
      fontFiles: [fontPaths.regular, fontPaths.semibold],
      loadSystemFonts: false,
    },
  });
  return Buffer.from(resvg.render().asPng());
}

module.exports = {
  renderPoster,
  textValue,
  cleanSchedule,
  measureText,
  fittedFontSize,
  assertPng,
};
