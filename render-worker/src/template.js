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

function validateBox(value, label, canvas) {
  if (!isObject(value)) fail(`${label} 缺失`);
  const box = {
    left: Number(value.left),
    top: Number(value.top),
    width: Number(value.width),
    height: Number(value.height),
  };
  if (!Object.values(box).every(Number.isFinite)) fail(`${label} 坐标必须是数字`);
  if (!Object.values(box).every(Number.isInteger)) fail(`${label} 坐标必须是整数像素`);
  if (box.left < 0 || box.top < 0 || box.width <= 0 || box.height <= 0) fail(`${label} 尺寸非法`);
  if (box.left + box.width > canvas.width || box.top + box.height > canvas.height) fail(`${label} 超出画布`);
  return box;
}

function validateTextStyle(slot, label) {
  if (!isObject(slot)) fail(`${label} 缺失`);
  positiveInteger(slot.fontSize, `${label}.fontSize`);
  positiveInteger(slot.minFontSize, `${label}.minFontSize`);
  if (Number(slot.minFontSize) > Number(slot.fontSize)) fail(`${label}.minFontSize 不能大于 fontSize`);
  if (!['regular', 'semibold'].includes(slot.weight)) fail(`${label}.weight 只允许 regular / semibold`);
  if (!['left', 'center', 'right'].includes(slot.align)) fail(`${label}.align 非法`);
}

function validateTextSlot(slot, label, canvas) {
  if (!isObject(slot)) fail(`${label} 缺失`);
  if (typeof slot.source !== 'string' || !slot.source.trim()) fail(`${label}.source 缺失`);
  validateBox(slot.box, `${label}.box`, canvas);
  validateTextStyle(slot, label);
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
  if (!isObject(manifest.fonts)) fail('fonts 缺失');
  for (const key of ['regular', 'semibold']) {
    if (typeof manifest.fonts[key] !== 'string' || !manifest.fonts[key].trim()) fail(`fonts.${key} 缺失`);
  }
  if (!isObject(manifest.texts)) fail('texts 缺失');
  for (const [key, slot] of Object.entries(manifest.texts)) validateTextSlot(slot, `texts.${key}`, canvas);

  if (!isObject(manifest.schedule) || !Array.isArray(manifest.schedule.rows) || manifest.schedule.rows.length !== 4) {
    fail('schedule.rows 必须固定为 4 行');
  }
  for (const row of manifest.schedule.rows) positiveInteger(row, 'schedule.rows[]');
  if (!isObject(manifest.schedule.columns)) fail('schedule.columns 缺失');
  if (!isObject(manifest.schedule.text)) fail('schedule.text 缺失');
  for (const key of ['time', 'content', 'speaker', 'chair']) {
    validateBox(manifest.schedule.columns[key]?.box, `schedule.columns.${key}.box`, canvas);
    validateTextStyle(manifest.schedule.text[key], `schedule.text.${key}`);
  }
  if (manifest.schedule.dot) {
    positiveInteger(manifest.schedule.dot.size, 'schedule.dot.size');
    if (!Number.isInteger(Number(manifest.schedule.dot.left)) || Number(manifest.schedule.dot.left) < 0) fail('schedule.dot.left 非法');
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

async function loadTemplate(projectId) {
  if (!PROJECT_ID_PATTERN.test(String(projectId || ''))) throw new Error('项目 ID 非法');
  const directory = path.join(ROOT, projectId);
  const manifestPath = path.join(directory, 'manifest.json');
  await assertFile(manifestPath, 'manifest.json');
  const manifest = validateManifest(JSON.parse(await fs.readFile(manifestPath, 'utf8')), projectId);
  const backgroundPath = path.join(directory, manifest.background);
  const fontPaths = {
    regular: path.join(directory, manifest.fonts.regular),
    semibold: path.join(directory, manifest.fonts.semibold),
  };
  await assertFile(backgroundPath, 'background.png');
  await assertFile(fontPaths.regular, '正文字体');
  await assertFile(fontPaths.semibold, '粗体字体');
  return {
    directory,
    manifest,
    backgroundPath,
    fonts: {
      regular: await fs.readFile(fontPaths.regular),
      semibold: await fs.readFile(fontPaths.semibold),
    },
  };
}

module.exports = { loadTemplate, validateManifest, validateBox };
