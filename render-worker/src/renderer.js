'use strict';

// Render kernel: schemaVersion 1 manifest, render protocol v2 job payload, PNG-only.
// 文字定位使用 PSD textItem.position 基线模型：x = 锚点（align 决定 text-anchor），y = 基线（baseline）。
// 字体由环境变量 RENDER_FONT_REGULAR / RENDER_FONT_SEMIBOLD 提供，经 resvg-js fontFiles 显式加载，
// SVG 内用真实 family 名 + 字重匹配（fontkit 读取），不依赖系统字体、不依赖 @font-face。

const fs = require('fs/promises');
const { Resvg } = require('@resvg/resvg-js');
const fontkit = require('fontkit');

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
  if (Object.prototype.hasOwnProperty.call(slot, 'text')) return slot.text;
  const raw = String(valueAt(meeting, slot.source) ?? '').trim();
  if (!raw) return '';
  return `${slot.prefix || ''}${raw}${slot.suffix || ''}`;
}

function dataUri(buffer, mime) {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}

// ---- 字体元数据（family / weight），缓存 ----
const fontMetaCache = new Map();
function fontMeta(buffer) {
  if (!fontMetaCache.has(buffer)) {
    const font = fontkit.create(buffer);
    fontMetaCache.set(buffer, {
      family: String(font.familyName || 'Unknown'),
      weight: Number(font.weight) || 400,
    });
  }
  return fontMetaCache.get(buffer);
}

// ---- 文本测量（fontkit 精确 advance），用于自动缩字号 ----
const layoutCache = new Map();
function fontFor(buffer) {
  if (!layoutCache.has(buffer)) layoutCache.set(buffer, fontkit.create(buffer));
  return layoutCache.get(buffer);
}

function measureText(fontBuffer, text, fontSize, tracking) {
  if (!text) return 0;
  const font = fontFor(fontBuffer);
  const scale = fontSize / font.unitsPerEm;
  const run = font.layout(text);
  let width = 0;
  for (const glyph of run.glyphs) width += glyph.advanceWidth;
  width *= scale;
  const trackingEm = Number(tracking || 0) / 1000;
  if (trackingEm) width += Math.max(0, text.length - 1) * trackingEm * fontSize;
  return width;
}

function fittedFontSize(fontBuffer, text, slot) {
  const base = Number(slot.fontSize);
  const maxWidth = Number(slot.maxWidth || 0);
  if (!maxWidth || !text) return base;
  const width = measureText(fontBuffer, text, base, slot.tracking);
  if (width <= maxWidth) return base;
  const minimum = Number(slot.minFontSize || 12);
  return Math.max(minimum, Math.min(base, Math.floor(base * maxWidth / width)));
}

// ---- SVG 构建 ----
function anchorOf(align) {
  if (align === 'center') return 'middle';
  if (align === 'right') return 'end';
  return 'start';
}

function textElement(fontBuffer, slot, text) {
  const meta = fontMeta(fontBuffer);
  const fontSize = fittedFontSize(fontBuffer, text, slot);
  const trackingPx = (Number(slot.tracking || 0) / 1000) * fontSize;
  const attrs = [
    `x="${slot.x}"`,
    `y="${slot.y}"`,
    `text-anchor="${anchorOf(slot.align || 'left')}"`,
    `font-family="${escapeXml(meta.family)}"`,
    `font-weight="${meta.weight}"`,
    `font-size="${fontSize}"`,
    `fill="${escapeXml(slot.color || DEFAULT_COLOR)}"`,
  ];
  if (trackingPx) attrs.push(`letter-spacing="${trackingPx}"`);
  return `<text ${attrs.join(' ')}>${escapeXml(text)}</text>`;
}

function avatarClipPath(key) {
  return `<clipPath id="clip-${key}" clipPathUnits="objectBoundingBox"><circle cx="0.5" cy="0.5" r="0.5"/></clipPath>`;
}

function avatarElement(key, imageBuffer, box) {
  return `<image href="${dataUri(imageBuffer, 'image/png')}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#clip-${key})"/>`;
}

function qrElement(imageBuffer, box) {
  return `<image href="${dataUri(imageBuffer, 'image/png')}" x="${box.left}" y="${box.top}" width="${box.width}" height="${box.height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function dotElement(dot, rowIndex) {
  const size = Number(dot.size || 13);
  const y = Number(dot.ys[rowIndex] ?? dot.y ?? 0);
  const cx = Number(dot.x ?? 0) + size / 2;
  const cy = y + size / 2;
  return `<circle cx="${cx}" cy="${cy}" r="${size / 2}" fill="${escapeXml(dot.color || '#5435D6')}"/>`;
}

// ---- 数据规范化 ----
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

function scheduleColumn(manifest, column, rowIndex) {
  const col = manifest.schedule.columns[column] || {};
  const hiddenRows = Array.isArray(col.hiddenRows) ? col.hiddenRows : [];
  return {
    column,
    hidden: hiddenRows.includes(rowIndex),
    slot: { ...col, y: Number(manifest.schedule.rows[rowIndex]) },
  };
}

function assetBox(value, fallback, label) {
  const v = value || fallback;
  if (!v) throw new Error(`缺少 ${label} 素材几何`);
  return {
    left: Number(v.left),
    top: Number(v.top),
    width: Number(v.width ?? v.size),
    height: Number(v.height ?? v.size),
  };
}

// ---- 主渲染（render protocol v2 payload） ----
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
  const backgroundBuffer = await fs.readFile(backgroundPath);

  // 素材几何：运行时 contract 的 assetLayout 优先，manifest.images 兜底
  const runtimeLayout = project.assetLayout || {};
  const chairBox = assetBox(runtimeLayout.chair, manifest.images?.chair, 'chair');
  const speaker1Box = assetBox(runtimeLayout.speaker1, manifest.images?.speaker1, 'speaker1');
  const speaker2Box = assetBox(runtimeLayout.speaker2, manifest.images?.speaker2, 'speaker2');
  const qrBox = assetBox(runtimeLayout.qrCode, manifest.images?.qrCode, 'qrCode');

  const parts = [];
  parts.push(`<image href="${dataUri(backgroundBuffer, 'image/png')}" x="0" y="0" width="${canvas.width}" height="${canvas.height}" preserveAspectRatio="none"/>`);

  if (!Buffer.isBuffer(assets.chairAvatar)) throw new Error('chairAvatar 素材缺失');
  if (!Buffer.isBuffer(assets.speaker1Avatar)) throw new Error('speaker1Avatar 素材缺失');
  if (!Buffer.isBuffer(assets.speaker2Avatar)) throw new Error('speaker2Avatar 素材缺失');
  if (!Buffer.isBuffer(assets.qrCode)) throw new Error('qrCode 素材缺失');
  parts.push(avatarClipPath('chair'));
  parts.push(avatarClipPath('speaker1'));
  parts.push(avatarClipPath('speaker2'));
  parts.push(avatarElement('chair', assets.chairAvatar, chairBox));
  parts.push(avatarElement('speaker1', assets.speaker1Avatar, speaker1Box));
  parts.push(avatarElement('speaker2', assets.speaker2Avatar, speaker2Box));
  parts.push(qrElement(assets.qrCode, qrBox));

  const regularFont = fonts.regular;
  const semiboldFont = fonts.semibold;
  const weightFont = (slot) => (slot.weight === 'semibold' ? semiboldFont : regularFont);

  for (const slot of Object.values(manifest.texts)) {
    const text = textValue(slot, meeting);
    if (!text) continue;
    parts.push(textElement(weightFont(slot), slot, text));
  }

  const schedule = cleanSchedule(meeting.schedule);
  for (let index = 0; index < 4; index += 1) {
    const row = schedule[index];
    if (!(row.time || row.content || row.speaker || row.chair)) continue;
    for (const column of ['time', 'content', 'speaker', 'chair']) {
      const text = row[column];
      if (!text) continue;
      const { hidden, slot } = scheduleColumn(manifest, column, index);
      if (hidden) continue;
      parts.push(textElement(weightFont(slot), slot, text));
    }
    if (manifest.schedule.dot && row.content) {
      parts.push(dotElement(manifest.schedule.dot, index));
    }
  }

  const clipPaths = parts.filter((p) => p.startsWith('<clipPath')).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><defs>${clipPaths}</defs>${parts.join('')}</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: 'width', value: canvas.width },
    font: {
      fontFiles: [fontPaths.regular, fontPaths.semibold],
      loadSystemFonts: false,
    },
  });
  return resvg.render().asPng();
}

module.exports = { renderPoster, textValue, cleanSchedule, measureText, fittedFontSize };
