'use strict';

const path = require('path');

const HARD_MAX_INPUT_BYTES = 15 * 1024 * 1024;
const DEFAULT_MAX_PAYLOAD_BYTES = 32 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

const IMAGE_TYPES = Object.freeze({
  png: { extension: 'png', mimeTypes: new Set(['image/png']) },
  jpg: { extension: 'jpg', mimeTypes: new Set(['image/jpeg', 'image/jpg']) },
  jpeg: { extension: 'jpg', mimeTypes: new Set(['image/jpeg', 'image/jpg']) },
  webp: { extension: 'webp', mimeTypes: new Set(['image/webp']) },
});

const ASSET_DEFINITIONS = Object.freeze({
  chair: { localKey: 'chairAvatar', storageBaseName: 'chair', crop: true },
  speaker1: { localKey: 'speaker1Avatar', storageBaseName: 'speaker1', crop: true },
  speaker2: { localKey: 'speaker2Avatar', storageBaseName: 'speaker2', crop: true },
  qrCode: { localKey: 'qrCode', storageBaseName: 'qr', crop: false },
});

function validationError(message) {
  const error = new Error(message);
  error.code = 'INVALID_JOB_PAYLOAD';
  return error;
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertUuid(value, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw validationError(`${label} 不是合法 UUID`);
  }
  return value.toLowerCase();
}

function safeText(value, label, { required = false, max = 120 } = {}) {
  if (value == null && !required) return '';
  if (typeof value !== 'string') throw validationError(`${label} 必须是文本`);
  const text = value.trim();
  if (required && !text) throw validationError(`${label} 不能为空`);
  if (text.length > max) throw validationError(`${label} 超过 ${max} 个字符`);
  if (CONTROL_CHARACTER_PATTERN.test(text)) throw validationError(`${label} 含有不允许的控制字符`);
  return text;
}

function normalizePerson(value, label) {
  if (!isPlainObject(value)) throw validationError(`${label} 格式无效`);
  return {
    name: safeText(value.name, `${label}姓名`, { required: true, max: 60 }),
    title: safeText(value.title, `${label}职称`, { max: 60 }),
    hospital: safeText(value.hospital, `${label}医院`, { required: true, max: 120 }),
  };
}

function normalizeSchedule(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw validationError('会议日程必须包含 1 到 4 行');
  }

  let activeRows = 0;
  const rows = value.map((row, index) => {
    if (!isPlainObject(row)) throw validationError(`第 ${index + 1} 行日程格式无效`);
    const normalized = {
      time: safeText(row.time, `第 ${index + 1} 行时间`, { max: 40 }),
      content: safeText(row.content, `第 ${index + 1} 行内容`, { max: 200 }),
      speaker: safeText(row.speaker, `第 ${index + 1} 行讲者`, { max: 80 }),
      chair: safeText(row.chair, `第 ${index + 1} 行主席`, { max: 80 }),
    };
    const active = Object.values(normalized).some(Boolean);
    if (active) {
      activeRows += 1;
      if (!normalized.time || !normalized.content) {
        throw validationError(`第 ${index + 1} 行日程必须同时包含时间和内容`);
      }
    }
    return normalized;
  });

  if (!activeRows) throw validationError('会议日程至少需要一行有效内容');
  while (rows.length < 4) rows.push({ time: '', content: '', speaker: '', chair: '' });
  return rows;
}

function normalizeCrop(value, label) {
  const crop = value == null ? {} : value;
  if (!isPlainObject(crop)) throw validationError(`${label}裁剪参数格式无效`);
  const zoom = crop.zoom == null ? 1 : crop.zoom;
  const offsetX = crop.offsetX == null ? 0 : crop.offsetX;
  const offsetY = crop.offsetY == null ? 0 : crop.offsetY;
  if (![zoom, offsetX, offsetY].every(Number.isFinite)) {
    throw validationError(`${label}裁剪参数必须是有限数字`);
  }
  if (zoom < 0.2 || zoom > 3.5) throw validationError(`${label}缩放必须在 0.2 到 3.5 之间`);
  if (offsetX < -100 || offsetX > 100 || offsetY < -100 || offsetY > 100) {
    throw validationError(`${label}偏移必须在 -100 到 100 之间`);
  }
  return { zoom, offsetX, offsetY };
}

function normalizeContentType(value) {
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

function imageTypeFromPath(storagePath) {
  const extension = path.posix.extname(storagePath).slice(1).toLowerCase();
  return IMAGE_TYPES[extension] || null;
}

function validateStoragePath(storagePath, ownerId, jobId, assetKey) {
  if (typeof storagePath !== 'string' || storagePath.length > 512) {
    throw validationError(`素材 ${assetKey} 的 storagePath 无效`);
  }
  if (CONTROL_CHARACTER_PATTERN.test(storagePath) || storagePath.includes('\\')) {
    throw validationError(`素材 ${assetKey} 的 storagePath 含非法字符`);
  }

  const definition = ASSET_DEFINITIONS[assetKey];
  const expectedDirectory = `${ownerId}/${jobId}/input`;
  if (path.posix.dirname(storagePath) !== expectedDirectory || path.posix.normalize(storagePath) !== storagePath) {
    throw validationError(`素材 ${assetKey} 不属于当前用户和任务的 input 目录`);
  }

  const fileName = path.posix.basename(storagePath);
  const match = fileName.match(/^([a-z0-9_-]+)\.(png|jpe?g|webp)$/i);
  if (!match || match[1].toLowerCase() !== definition.storageBaseName) {
    throw validationError(`素材 ${assetKey} 的文件名或类型不受支持`);
  }

  const imageType = imageTypeFromPath(storagePath);
  if (!imageType) throw validationError(`素材 ${assetKey} 只支持 PNG、JPEG 或 WebP`);
  return { storagePath, imageType, localExtension: imageType.extension };
}

function normalizeAsset(value, ownerId, jobId, assetKey) {
  if (!isPlainObject(value)) throw validationError(`任务缺少素材 ${assetKey}`);
  const pathDetails = validateStoragePath(value.storagePath, ownerId, jobId, assetKey);
  const definition = ASSET_DEFINITIONS[assetKey];
  const normalized = {
    storagePath: pathDetails.storagePath,
    imageType: pathDetails.imageType,
    localExtension: pathDetails.localExtension,
    originalName: safeText(value.originalName, `素材 ${assetKey} 原始文件名`, { max: 255 }),
  };

  if (!definition.crop) {
    if (value.cropMode != null || value.outputSize != null) {
      throw validationError(`素材 ${assetKey} 不支持头像裁剪模式`);
    }
    return normalized;
  }

  normalized.crop = normalizeCrop(value.crop, `素材 ${assetKey}`);
  normalized.cropMode = value.cropMode == null ? 'raw' : value.cropMode;
  if (normalized.cropMode !== 'raw' && normalized.cropMode !== 'baked') {
    throw validationError(`素材 ${assetKey} 的 cropMode 只允许 raw 或 baked`);
  }

  if (normalized.cropMode === 'baked') {
    if (value.outputSize !== 1024) {
      throw validationError(`素材 ${assetKey} 的 baked outputSize 必须为 1024`);
    }
    if (pathDetails.localExtension !== 'png') {
      throw validationError(`素材 ${assetKey} 的 baked 成品必须是 PNG`);
    }
    if (normalized.crop.zoom !== 1 || normalized.crop.offsetX !== 0 || normalized.crop.offsetY !== 0) {
      throw validationError(`素材 ${assetKey} 的 baked 裁剪参数必须为 zoom=1、offsetX=0、offsetY=0`);
    }
    normalized.outputSize = 1024;
  } else if (value.outputSize != null) {
    throw validationError(`素材 ${assetKey} 的 raw 模式不应包含 outputSize`);
  }

  return normalized;
}

function validateJob(job, { maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES } = {}) {
  if (!isPlainObject(job)) throw validationError('任务格式无效');
  const jobId = assertUuid(job.id, '任务 ID');
  const ownerId = assertUuid(job.owner_id, '任务 owner_id');
  if (!isPlainObject(job.payload)) throw validationError('任务 payload 格式无效');

  let serialized;
  try {
    serialized = JSON.stringify(job.payload);
  } catch {
    throw validationError('任务 payload 无法序列化');
  }
  if (Buffer.byteLength(serialized, 'utf8') > maxPayloadBytes) {
    throw validationError(`任务 payload 超过 ${maxPayloadBytes} 字节`);
  }

  const meeting = job.payload.meeting;
  if (!isPlainObject(meeting)) throw validationError('会议信息格式无效');
  if (!Array.isArray(meeting.speakers) || meeting.speakers.length !== 2) {
    throw validationError('讲者信息必须恰好包含两人');
  }

  const normalizedMeeting = {
    meetingTime: safeText(meeting.meetingTime, '会议时间', { required: true, max: 100 }),
    meetingLocation: safeText(meeting.meetingLocation, '会议地点', { required: true, max: 120 }),
    chair: normalizePerson(meeting.chair, '主席'),
    speakers: [normalizePerson(meeting.speakers[0], '讲者一'), normalizePerson(meeting.speakers[1], '讲者二')],
    schedule: normalizeSchedule(meeting.schedule),
    outputName: safeText(meeting.outputName || '系列会议海报', '输出名称', { required: true, max: 120 }),
  };

  if (!isPlainObject(job.payload.assets)) throw validationError('素材列表格式无效');
  const normalizedAssets = {};
  for (const assetKey of Object.keys(ASSET_DEFINITIONS)) {
    normalizedAssets[assetKey] = normalizeAsset(job.payload.assets[assetKey], ownerId, jobId, assetKey);
  }

  return { id: jobId, ownerId, meeting: normalizedMeeting, assets: normalizedAssets };
}

function validateImageMetadata(asset, metadata, maxInputBytes = HARD_MAX_INPUT_BYTES) {
  if (!asset || !asset.imageType) throw validationError('素材类型信息缺失');
  if (!isPlainObject(metadata)) throw validationError('Storage 未返回素材元数据');
  if (!Number.isSafeInteger(metadata.size) || metadata.size <= 0) {
    throw validationError('素材大小无效');
  }
  if (metadata.size > maxInputBytes || metadata.size > HARD_MAX_INPUT_BYTES) {
    throw validationError(`素材超过 ${Math.min(maxInputBytes, HARD_MAX_INPUT_BYTES)} 字节限制`);
  }
  const contentType = normalizeContentType(metadata.contentType || metadata.content_type);
  if (!asset.imageType.mimeTypes.has(contentType)) {
    throw validationError(`素材 MIME 类型 ${contentType || '未知'} 与文件扩展名不匹配`);
  }
  return { size: metadata.size, contentType };
}

function detectImageType(buffer) {
  if (!buffer || typeof buffer.length !== 'number') return null;
  if (buffer.length >= 8
    && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47
    && buffer[4] === 0x0d && buffer[5] === 0x0a && buffer[6] === 0x1a && buffer[7] === 0x0a) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12
    && buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'webp';
  return null;
}

function validateImageBuffer(asset, buffer, responseContentType, maxInputBytes = HARD_MAX_INPUT_BYTES) {
  if (!Buffer.isBuffer(buffer)) throw validationError('下载的素材不是二进制文件');
  if (buffer.length <= 0 || buffer.length > maxInputBytes || buffer.length > HARD_MAX_INPUT_BYTES) {
    throw validationError(`下载素材超过 ${Math.min(maxInputBytes, HARD_MAX_INPUT_BYTES)} 字节限制或为空`);
  }
  const detected = detectImageType(buffer);
  if (detected !== asset.imageType.extension) {
    throw validationError('素材文件头与扩展名不匹配');
  }
  const contentType = normalizeContentType(responseContentType);
  if (contentType && !asset.imageType.mimeTypes.has(contentType)) {
    throw validationError(`下载响应 MIME 类型 ${contentType} 与文件扩展名不匹配`);
  }
  return detected;
}

function safeResultFileName(value, expectedExtension) {
  if (typeof value !== 'string' || !value || value.length > 255 || CONTROL_CHARACTER_PATTERN.test(value)) {
    throw validationError('Photoshop 输出文件名无效');
  }
  if (path.basename(value) !== value || value.includes('\\')) {
    throw validationError('Photoshop 输出文件名不得包含目录');
  }
  if (path.extname(value).toLowerCase() !== expectedExtension) {
    throw validationError(`Photoshop 输出文件必须是 ${expectedExtension}`);
  }
  return value;
}

module.exports = {
  ASSET_DEFINITIONS,
  DEFAULT_MAX_PAYLOAD_BYTES,
  HARD_MAX_INPUT_BYTES,
  UUID_PATTERN,
  detectImageType,
  isPlainObject,
  safeResultFileName,
  validateImageBuffer,
  validateImageMetadata,
  validateJob,
  validateStoragePath,
};
