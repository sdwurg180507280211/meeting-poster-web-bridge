(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PosterValidation = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  const MAX_FILE_BYTES = 15 * 1024 * 1024;
  const MAX_PAYLOAD_BYTES = 32 * 1024;
  const AVATAR_OUTPUT_SIZE = 1024;
  const ALLOWED_IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp']);
  const IMAGE_EXTENSION_BY_TYPE = Object.freeze({
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
  });
  const LIMITS = Object.freeze({
    meetingTime: 64,
    meetingLocation: 32,
    personName: 40,
    personTitle: 40,
    hospital: 120,
    scheduleTime: 32,
    scheduleContent: 200,
    schedulePerson: 80,
    outputName: 100,
    originalName: 255,
    storagePath: 512,
  });

  function stringValue(value) {
    return typeof value === 'string' ? value.trim() : '';
  }

  function charLength(value) {
    return Array.from(String(value || '')).length;
  }

  function utf8ByteLength(value) {
    const input = String(value || '');
    let bytes = 0;
    for (let i = 0; i < input.length; i += 1) {
      const code = input.charCodeAt(i);
      if (code < 0x80) bytes += 1;
      else if (code < 0x800) bytes += 2;
      else if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length
        && input.charCodeAt(i + 1) >= 0xdc00 && input.charCodeAt(i + 1) <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    }
    return bytes;
  }

  function isUuidV4(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ''));
  }

  function createUuid(cryptoApi) {
    if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
      const generated = cryptoApi.randomUUID();
      if (isUuidV4(generated)) return generated.toLowerCase();
    }
    if (!cryptoApi || typeof cryptoApi.getRandomValues !== 'function') {
      throw new Error('当前浏览器缺少安全随机数能力，无法创建任务。请升级浏览器后重试。');
    }
    const bytes = new Uint8Array(16);
    cryptoApi.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function imageExtension(type) {
    return IMAGE_EXTENSION_BY_TYPE[String(type || '').toLowerCase()] || null;
  }

  function validateImageFile(file, label) {
    const name = label || '图片';
    if (!file) return `${name}不存在，请重新选择`;
    const type = String(file.type || '').toLowerCase();
    if (!ALLOWED_IMAGE_TYPES.includes(type)) return `${name}只支持 PNG、JPEG 或 WebP 图片`;
    if (!Number.isFinite(file.size) || file.size <= 0) return `${name}是空文件，请重新选择`;
    if (file.size > MAX_FILE_BYTES) return `${name}不能超过 15 MiB`;
    if (charLength(file.name || '') > LIMITS.originalName) return `${name}文件名不能超过 ${LIMITS.originalName} 个字符`;
    return null;
  }

  function addStringError(errors, value, label, max, required) {
    const normalized = stringValue(value);
    if (required && !normalized) errors.push(`请填写${label}`);
    if (charLength(normalized) > max) errors.push(`${label}不能超过 ${max} 个字符`);
    return normalized;
  }

  function parseClockRange(value) {
    const match = stringValue(value).match(/^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/);
    if (!match) return null;
    const startHour = Number(match[1]);
    const startMinute = Number(match[2]);
    const endHour = Number(match[3]);
    const endMinute = Number(match[4]);
    if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) return null;
    const start = startHour * 60 + startMinute;
    const end = endHour * 60 + endMinute;
    return end > start ? { start, end } : null;
  }

  function validMeetingTime(value) {
    const match = stringValue(value).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{2}:\d{2}-\d{2}:\d{2})$/);
    if (!match || !parseClockRange(match[4])) return false;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
  }

  function validatePerson(errors, person, label) {
    const value = person && typeof person === 'object' ? person : {};
    addStringError(errors, value.name, `${label}姓名`, LIMITS.personName, true);
    addStringError(errors, value.title, `${label}职称`, LIMITS.personTitle, false);
    addStringError(errors, value.hospital, `${label}医院`, LIMITS.hospital, true);
  }

  function validateMeeting(meeting) {
    const errors = [];
    const value = meeting && typeof meeting === 'object' ? meeting : {};
    const meetingTime = addStringError(errors, value.meetingTime, '会议日期和时间', LIMITS.meetingTime, true);
    if (meetingTime && !validMeetingTime(meetingTime)) errors.push('会议日期和时间格式无效，请重新选择');
    addStringError(errors, value.meetingLocation, '会议地点', LIMITS.meetingLocation, true);
    addStringError(errors, value.outputName, '输出文件名', LIMITS.outputName, true);
    validatePerson(errors, value.chair, '会议主席');

    if (!Array.isArray(value.speakers) || value.speakers.length !== 2) {
      errors.push('必须提供两位讲者的信息');
    } else {
      validatePerson(errors, value.speakers[0], '讲者一');
      validatePerson(errors, value.speakers[1], '讲者二');
    }

    if (!Array.isArray(value.schedule) || value.schedule.length < 1 || value.schedule.length > 4) {
      errors.push('会议日程必须包含 1 至 4 行');
      return errors;
    }

    let activeRows = 0;
    value.schedule.forEach((row, index) => {
      const entry = row && typeof row === 'object' ? row : {};
      const prefix = `第 ${index + 1} 行日程`;
      const time = addStringError(errors, entry.time, `${prefix}时间`, LIMITS.scheduleTime, false);
      const content = addStringError(errors, entry.content, `${prefix}内容`, LIMITS.scheduleContent, false);
      const speaker = addStringError(errors, entry.speaker, `${prefix}讲者`, LIMITS.schedulePerson, false);
      const chair = addStringError(errors, entry.chair, `${prefix}主席`, LIMITS.schedulePerson, false);
      if (!(time || content || speaker || chair)) return;
      activeRows += 1;
      if (!time) errors.push(`${prefix}必须选择时间范围`);
      else if (!parseClockRange(time)) errors.push(`${prefix}时间范围无效，请重新选择`);
      if (!content) errors.push(`${prefix}必须填写内容`);
    });
    if (!activeRows) errors.push('请至少填写一行日程');
    return errors;
  }

  function validateStoragePath(errors, asset, label) {
    const value = asset && typeof asset === 'object' ? asset : {};
    const path = addStringError(errors, value.storagePath, `${label}存储路径`, LIMITS.storagePath, true);
    addStringError(errors, value.originalName, `${label}原始文件名`, LIMITS.originalName, false);
    if (path && (path.startsWith('/') || path.includes('..') || path.includes('\\'))) {
      errors.push(`${label}存储路径无效`);
    }
    return { value, path };
  }

  function validateAvatar(errors, asset, label) {
    const { value, path } = validateStoragePath(errors, asset, label);
    if (value.cropMode !== 'baked') errors.push(`${label}必须先点击“应用裁剪”`);
    if (value.outputSize !== AVATAR_OUTPUT_SIZE) errors.push(`${label}裁剪输出必须为 ${AVATAR_OUTPUT_SIZE}×${AVATAR_OUTPUT_SIZE}`);
    if (path && !path.toLowerCase().endsWith('.png')) errors.push(`${label}应用裁剪后必须为 PNG`);
    if (!value.crop || typeof value.crop !== 'object'
      || Number(value.crop.zoom) !== 1
      || Number(value.crop.offsetX) !== 0
      || Number(value.crop.offsetY) !== 0) {
      errors.push(`${label}成品 PNG 裁剪参数必须为 zoom=1、offsetX=0、offsetY=0`);
    }
  }

  function validatePayload(payload) {
    const errors = [];
    const value = payload && typeof payload === 'object' ? payload : {};
    errors.push(...validateMeeting(value.meeting));
    const assets = value.assets && typeof value.assets === 'object' ? value.assets : {};
    validateAvatar(errors, assets.chair, '会议主席头像');
    validateAvatar(errors, assets.speaker1, '讲者一头像');
    validateAvatar(errors, assets.speaker2, '讲者二头像');
    validateStoragePath(errors, assets.qrCode, '二维码');

    let serialized = '';
    try {
      serialized = JSON.stringify(payload);
    } catch (_) {
      errors.push('任务内容无法序列化');
      return errors;
    }
    if (utf8ByteLength(serialized) > MAX_PAYLOAD_BYTES) errors.push('任务内容过大，请缩短文字或文件名后重试');
    return errors;
  }

  return Object.freeze({
    ALLOWED_IMAGE_TYPES,
    AVATAR_OUTPUT_SIZE,
    LIMITS,
    MAX_FILE_BYTES,
    MAX_PAYLOAD_BYTES,
    createUuid,
    imageExtension,
    isUuidV4,
    parseClockRange,
    utf8ByteLength,
    validateImageFile,
    validateMeeting,
    validatePayload,
    validMeetingTime,
  });
});
