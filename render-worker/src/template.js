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
  finiteNumber(slot.tracking ?? 0, `${label}.tracking`);
  if (slot.maxWidth != null) positiveInteger(slot.maxWidth, `${label}.maxWidth`);
  if (slot.prefix != null && typeof slot.prefix !== 'string') fail(`${label}.prefix 必须是字符串`);
  if (slot.suffix != null && typeof slot.suffix !== 'string') fail(`${label}.suffix 必须是字符串`);
}

function validateImageSpec(value, label, canvas) {
  if (!isObject(value)) fail(`${label} 缺失`);
  const left = finiteNumber(value.left, `${label}.left`);
  const top = finiteNumber(value.top, `${label}.top`);
  const size = positiveInteger(value.size, `${label}.size`);
  if (left < 0 || top < 0 || left + size > canvas.width || top + size > canvas.height) {
    fail(`${label} 超出画布`);
  }
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
    validateImageSpec(manifest.images[key], `images.${key}`, canvas);
  }

  if (!isObject(manifest.texts) || !Object.keys(manifest.texts).length) fail('texts 缺失');
  for (const [key, slot] of Object.entries(manifest.texts)) validateTextSlot(slot, `texts.${key}`);

  if (!isObject(manifest.schedule) || !Array.isArray(manifest.schedule.rows) || manifest.schedule.rows.length !== 4) {
    fail('schedule.rows 必须固定为 4 行');
  }
  manifest.schedule.rows.forEach((row, rowIndex) => {
    if (!isObject(row)) fail(`schedule.rows[${rowIndex}] 缺失`);
    for (const key of ['time', 'content', 'speaker', 'chair']) {
      validateTextSlot(row[key], `schedule.rows[${rowIndex}].${key}`, { allowDynamic: true });
    }
    validateTextSlot(row.dot, `schedule.rows[${rowIndex}].dot`);
  });
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

function resolveFontPaths(env) {
  const regular = String(env.RENDER_FONT_REGULAR || '').trim();
  const semibold = String(env.RENDER_FONT_SEMIBOLD || '').trim();
  if (!regular || !semibold) {
    throw new Error('缺少环境变量 RENDER_FONT_REGULAR / RENDER_FONT_SEMIBOLD（字体不随模板入库，由环境提供）');
  }
  return {
    regular: path.resolve(regular),
    semibold: path.resolve(semibold),
  };
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
