'use strict';

const fs = require('fs/promises');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', 'templates');
const PROJECT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(message) {
  throw new Error(`模板无效：${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) fail(`${label} 必须是正整数`);
  return number;
}

function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) fail(`${label} 必须是数字`);
  return number;
}

function validateTextSlot(slot, label, options = {}) {
  if (!isObject(slot)) fail(`${label} 缺失`);
  if (!options.allowDynamic) {
    const hasSource = typeof slot.source === 'string' && slot.source.trim();
    const hasText = typeof slot.text === 'string' && slot.text.length > 0;
    if (!hasSource && !hasText) fail(`${label} 必须有 source 或 text`);
  }
  finiteNumber(slot.x, `${label}.x`);
  finiteNumber(slot.y, `${label}.y`);
  positiveInteger(slot.fontSize, `${label}.fontSize`);
  positiveInteger(slot.minFontSize, `${label}.minFontSize`);
  if (Number(slot.minFontSize) > Number(slot.fontSize)) fail(`${label}.minFontSize 不能大于 fontSize`);
  if (!['regular', 'semibold'].includes(slot.weight)) fail(`${label}.weight 只允许 regular / semibold`);
  if (!['left', 'center', 'right'].includes(slot.align)) fail(`${label}.align 非法`);
  if (slot.maxWidth != null) positiveInteger(slot.maxWidth, `${label}.maxWidth`);
}

function validateManifest(manifest, expectedProjectId = null) {
  if (!isObject(manifest)) fail('根对象缺失');
  if (manifest.schemaVersion !== 1) fail('只支持 schemaVersion=1');
  if (typeof manifest.projectId !== 'string' || !PROJECT_ID_PATTERN.test(manifest.projectId)) fail('projectId 非法');
  if (expectedProjectId && manifest.projectId !== expectedProjectId) fail('manifest.projectId 与目录不一致');

  const canvas = {
    width: positiveInteger(manifest.canvas?.width, 'canvas.width'),
    height: positiveInteger(manifest.canvas?.height, 'canvas.height'),
  };
  if (typeof manifest.background !== 'string' || !manifest.background.trim()) fail('background 缺失');

  if (!isObject(manifest.images)) fail('images 缺失');
  for (const key of ['chair', 'speaker1', 'speaker2', 'qrCode']) {
    const box = manifest.images[key];
    if (!isObject(box)) fail(`images.${key} 缺失`);
    finiteNumber(box.left, `images.${key}.left`);
    finiteNumber(box.top, `images.${key}.top`);
    positiveInteger(box.size, `images.${key}.size`);
  }

  if (!isObject(manifest.texts)) fail('texts 缺失');
  for (const [key, slot] of Object.entries(manifest.texts)) validateTextSlot(slot, `texts.${key}`);

  if (!isObject(manifest.schedule) || !Array.isArray(manifest.schedule.rows) || manifest.schedule.rows.length !== 4) {
    fail('schedule.rows 必须固定为 4 行');
  }
  for (const row of manifest.schedule.rows) finiteNumber(row, 'schedule.rows[]');
  if (!isObject(manifest.schedule.columns)) fail('schedule.columns 缺失');
  for (const key of ['time', 'content', 'speaker', 'chair']) {
    validateTextSlot(manifest.schedule.columns[key], `schedule.columns.${key}`, { allowDynamic: true });
  }
  return manifest;
}

async function assertFile(filePath, label) {
  let stat;
  try {
    stat = await fs.stat(filePath);
  } catch (_) {
    throw new Error(`${label}不存在：${filePath}`);
  }
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${label}不是有效文件：${filePath}`);
}

// 字体不随模板入库：由环境变量提供（RENDER_FONT_REGULAR / RENDER_FONT_SEMIBOLD）。
// 未来切换可分发字体（如思源黑体）只需改环境变量，不动模板目录结构。
function resolveFontPaths(env) {
  const regular = env.RENDER_FONT_REGULAR;
  const semibold = env.RENDER_FONT_SEMIBOLD;
  if (!regular || !semibold) {
    throw new Error('缺少环境变量 RENDER_FONT_REGULAR / RENDER_FONT_SEMIBOLD（字体不随模板入库，由环境提供）');
  }
  return { regular, semibold };
}

async function loadTemplate(projectId, env = process.env) {
  if (!PROJECT_ID_PATTERN.test(String(projectId || ''))) throw new Error('项目 ID 非法');
  const directory = path.join(ROOT, projectId);
  const manifestPath = path.join(directory, 'manifest.json');
  await assertFile(manifestPath, 'manifest.json');
  const manifest = validateManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')), projectId);
  const backgroundPath = path.join(directory, manifest.background);
  await assertFile(backgroundPath, 'background.png');

  const fontPaths = resolveFontPaths(env);
  await assertFile(fontPaths.regular, '正文字体');
  await assertFile(fontPaths.semibold, '粗体字体');

  return {
    directory,
    manifest,
    backgroundPath,
    fontPaths,
    fonts: {
      regular: await fs.readFile(fontPaths.regular),
      semibold: await fs.readFile(fontPaths.semibold),
    },
  };
}

module.exports = { loadTemplate, validateManifest, resolveFontPaths };
