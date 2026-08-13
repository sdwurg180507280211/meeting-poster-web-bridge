// Photoshop DOM / batchPlay 封装。所有文档修改集中在一次 executeAsModal 中。
const photoshop = require('photoshop');
const { app, core, action, constants } = photoshop;
const { batchPlay } = action;
const { LayerKind } = constants;
const { storage } = require('uxp');
const fs = storage.localFileSystem;

function numberValue(value) {
  if (typeof value === 'number') return value;
  if (value && typeof value.value === 'number') return value.value;
  if (value && typeof value._value === 'number') return value._value;
  const result = Number(value);
  return Number.isFinite(result) ? result : 0;
}

function displayName(names) {
  return Array.isArray(names) ? names.join(' / ') : names;
}

function walkLayers(layers, output = []) {
  for (const layer of layers) {
    output.push(layer);
    if (layer.kind === LayerKind.GROUP) {
      try {
        walkLayers(layer.layers, output);
      } catch (_) {
        // 空组或宿主版本差异不影响后续查找。
      }
    }
  }
  return output;
}

function findLayer(doc, names, predicate = null) {
  const candidates = Array.isArray(names) ? names : [names];
  const all = walkLayers(doc.layers, []);
  for (const name of candidates) {
    const hit = all.find((layer) => layer.name === name && (!predicate || predicate(layer)));
    if (hit) return hit;
  }
  return null;
}

function layerWidth(layer) {
  const bounds = layer.boundsNoEffects || layer.bounds;
  return numberValue(bounds.right) - numberValue(bounds.left);
}

function layerGeometry(layer) {
  const bounds = layer.boundsNoEffects || layer.bounds;
  const left = numberValue(bounds.left);
  const top = numberValue(bounds.top);
  const right = numberValue(bounds.right);
  const bottom = numberValue(bounds.bottom);
  return {
    left, top, right, bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

function getTextSize(layer) {
  return numberValue(layer.textItem.characterStyle.size);
}

function setTextSize(layer, size) {
  layer.textItem.characterStyle.size = size;
}

function validateTemplate(doc, spec) {
  const errors = [];
  const width = numberValue(doc.width);
  const height = numberValue(doc.height);
  if (Math.round(width) !== spec.EXPECTED_WIDTH || Math.round(height) !== spec.EXPECTED_HEIGHT) {
    errors.push(`画布应为 ${spec.EXPECTED_WIDTH}×${spec.EXPECTED_HEIGHT}，当前为 ${Math.round(width)}×${Math.round(height)}`);
  }

  const rootNames = Array.from(doc.layers).map((layer) => layer.name);
  for (const groupName of spec.ROOT_GROUPS) {
    if (!rootNames.includes(groupName)) errors.push(`缺少根级文件夹：${groupName}`);
  }

  for (const names of spec.REQUIRED_DYNAMIC_LAYERS) {
    if (!findLayer(doc, names)) errors.push(`缺少动态图层：${displayName(names)}`);
  }

  for (const fixedName of Object.values(spec.FIXED_LAYERS)) {
    if (!findLayer(doc, fixedName)) errors.push(`缺少固定模板图层：${fixedName}`);
  }

  const smartTargets = [
    spec.LAYERS.AVATAR.CHAIR,
    spec.LAYERS.AVATAR.SPEAKER1,
    spec.LAYERS.AVATAR.SPEAKER2,
    spec.LAYERS.QR,
  ];
  for (const name of smartTargets) {
    const layer = findLayer(doc, name);
    if (layer && layer.kind !== LayerKind.SMARTOBJECT) {
      errors.push(`图层“${name}”必须是智能对象，当前类型不正确`);
    }
  }

  if (errors.length) {
    throw new Error(`PSD 模板校验失败：\n- ${errors.join('\n- ')}`);
  }
}

function setTextLayer(doc, names, text) {
  const layer = findLayer(doc, names);
  if (!layer) throw new Error(`未找到文字图层：${displayName(names)}`);
  if (layer.kind !== LayerKind.TEXT) throw new Error(`图层“${layer.name}”不是文字图层`);
  layer.textItem.contents = String(text == null ? '' : text);
  return layer;
}

function setOptionalTextLayer(doc, names, value) {
  const text = String(value == null ? '' : value).trim();
  const layer = setTextLayer(doc, names, text || '\u200B');
  layer.visible = Boolean(text);
  return layer;
}

function setLayerVisible(doc, names, visible) {
  const layer = findLayer(doc, names);
  if (!layer) throw new Error(`未找到图层：${displayName(names)}`);
  layer.visible = Boolean(visible);
  return layer;
}

function snapshotTextMetrics(doc, names) {
  const layer = findLayer(doc, names);
  if (!layer || layer.kind !== LayerKind.TEXT) return null;
  return {
    maxWidth: layerWidth(layer),
    baseSize: getTextSize(layer),
  };
}

function fitText(doc, names, metrics, minSize = 12) {
  if (!metrics) return null;
  const layer = findLayer(doc, names);
  if (!layer || layer.kind !== LayerKind.TEXT || !layer.visible) return null;
  setTextSize(layer, metrics.baseSize);
  let size = metrics.baseSize;
  let width = layerWidth(layer);
  while (width > metrics.maxWidth + 0.5 && size > minSize) {
    size = Math.max(minSize, size - 1);
    setTextSize(layer, size);
    width = layerWidth(layer);
  }
  return size;
}

async function selectOnlyLayer(layer) {
  if (!layer) return;
  await batchPlay([
    {
      _obj: 'select',
      _target: [{ _ref: 'layer', _id: layer.id }],
      makeVisible: false,
      _options: { dialogOptions: 'dontDisplay' },
    },
  ], {});
}

async function replaceSmartObject(doc, names, fileEntry) {
  if (!fileEntry) return null;
  const layer = findLayer(doc, names);
  if (!layer) throw new Error(`未找到智能对象图层：${displayName(names)}`);
  if (layer.kind !== LayerKind.SMARTOBJECT) throw new Error(`图层“${layer.name}”不是智能对象`);

  await selectOnlyLayer(layer);
  const token = fs.createSessionToken(fileEntry);
  const result = await batchPlay([
    {
      _obj: 'placedLayerReplaceContents',
      null: { _path: token, _kind: 'local' },
      freeTransformCenterState: { _enum: 'quadCenterState', _value: 'QCSAverage' },
      _options: { dialogOptions: 'dontDisplay' },
    },
  ], {});

  const first = Array.isArray(result) ? result[0] : null;
  if (first && first._obj === 'error') {
    throw new Error(`替换内容失败：${first.message || first.result || 'Photoshop 返回未知错误'}`);
  }

  let refreshed = findLayer(doc, names);
  if (!refreshed) {
    const active = Array.from(doc.activeLayers || [])[0];
    if (active && active.kind === LayerKind.SMARTOBJECT) {
      active.name = Array.isArray(names) ? names[0] : names;
      refreshed = active;
    }
  }
  if (!refreshed) throw new Error(`替换后无法重新获取智能对象：${displayName(names)}`);
  await selectOnlyLayer(refreshed);
  return refreshed;
}

async function fitSmartObjectToBox(layer, box) {
  if (!layer) return;
  let geometry = layerGeometry(layer);
  if (geometry.width <= 0 || geometry.height <= 0) throw new Error(`图层“${layer.name}”没有有效尺寸`);

  const scale = Math.min(box.width / geometry.width, box.height / geometry.height);
  await layer.scale(
    scale * 100, scale * 100,
    constants.AnchorPosition.MIDDLECENTER,
    { interpolation: constants.InterpolationMethod.BICUBIC }
  );

  geometry = layerGeometry(layer);
  await layer.translate(
    box.left + box.width / 2 - geometry.centerX,
    box.top + box.height / 2 - geometry.centerY
  );
}

async function placeBakedAvatarToBox(layer, box) {
  if (!layer) return;
  let geometry = layerGeometry(layer);
  if (geometry.width <= 0 || geometry.height <= 0) throw new Error(`图层“${layer.name}”没有有效尺寸`);

  const sourceTolerance = Math.max(1, Math.max(geometry.width, geometry.height) * 0.002);
  if (Math.abs(geometry.width - geometry.height) > sourceTolerance) {
    throw new Error(`网页成品头像的完整边界必须为正方形，当前为 ${Math.round(geometry.width)}×${Math.round(geometry.height)}`);
  }
  if (Math.abs(box.width - box.height) > 0.001) {
    throw new Error(`PSD 头像目标框必须为正方形，当前为 ${box.width}×${box.height}`);
  }

  const scale = box.width / geometry.width;
  await layer.scale(
    scale * 100, scale * 100,
    constants.AnchorPosition.MIDDLECENTER,
    { interpolation: constants.InterpolationMethod.BICUBIC }
  );

  geometry = layerGeometry(layer);
  await layer.translate(
    box.left + box.width / 2 - geometry.centerX,
    box.top + box.height / 2 - geometry.centerY
  );
}

function normalizeMeetingTime(value) {
  const text = String(value || '').trim();
  if (!text) return '会议时间：';
  return /^会议时间\s*[：:]/.test(text) ? text.replace(/^会议时间\s*:/, '会议时间：') : `会议时间：${text}`;
}

function normalizeMeetingLocation(value) {
  const text = String(value || '').trim();
  if (!text) return '会议地点：';
  return /^会议地点\s*[：:]/.test(text) ? text.replace(/^会议地点\s*:/, '会议地点：') : `会议地点：${text}`;
}

function safeFileName(value) {
  const cleaned = String(value || '会议海报')
    .replace(/\.png$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || '会议海报';
}

function normalizePathForCompare(value) {
  const normalized = String(value || '').replace(/\\/g, '/').replace(/\/+$/g, '');
  return /^([A-Za-z]:)/.test(normalized) ? normalized.toLowerCase() : normalized;
}

function assertTemplateNotAlreadyOpen(templateEntry) {
  const targetPath = normalizePathForCompare(templateEntry && templateEntry.nativePath);
  if (!targetPath) return;
  const hit = Array.from(app.documents).find((doc) => normalizePathForCompare(doc.path) === targetPath);
  if (hit) {
    throw new Error(`PSD 母版当前已在 Photoshop 中打开：${hit.name || hit.title || templateEntry.name}。请先关闭母版，再生成海报，避免误改母版。`);
  }
}

async function createOutputFile(folderEntry, baseName) {
  const requested = safeFileName(baseName);
  const entries = await folderEntry.getEntries();
  const existing = new Set(entries.map((entry) => String(entry.name || '').toLowerCase()));
  let safeName = requested;
  let suffix = 2;
  while (existing.has(`${safeName}.png`.toLowerCase())) {
    safeName = `${requested}_${suffix}`;
    suffix += 1;
    if (suffix > 10000) throw new Error('输出目录中同名文件过多，请修改输出文件名');
  }
  const pngEntry = await folderEntry.createFile(`${safeName}.png`, { overwrite: false });
  return { safeName, pngEntry };
}

async function generatePoster({ templateEntry, outputFolderEntry, meeting, assets, spec, onProgress = () => {} }) {
  if (!templateEntry) throw new Error('请先选择 PSD 母版');
  if (!outputFolderEntry) throw new Error('请先选择输出目录');
  assertTemplateNotAlreadyOpen(templateEntry);

  return core.executeAsModal(async (executionContext) => {
    let doc = null;
    let output = null;
    try {
      onProgress('打开 PSD 母版');
      doc = await app.open(templateEntry, undefined, false);
      app.activeDocument = doc;
      validateTemplate(doc, spec);

      const metrics = spec.FIT_TEXT_LAYERS.map((names) => snapshotTextMetrics(doc, names));
      const joinNameTitle = (name, title) => [name, title].filter(Boolean).join(' ').trim();

      onProgress('填充会议时间/地点、主席、讲者与日程');
      setTextLayer(doc, spec.LAYERS.TEXT.MEETING_TIME, normalizeMeetingTime(meeting.meetingTime));
      setTextLayer(doc, spec.LAYERS.TEXT.MEETING_LOCATION, normalizeMeetingLocation(meeting.meetingLocation));
      setTextLayer(doc, spec.LAYERS.TEXT.CHAIR_NAME, joinNameTitle(meeting.chair.name, meeting.chair.title));
      setTextLayer(doc, spec.LAYERS.TEXT.CHAIR_HOSPITAL, meeting.chair.hospital);
      setTextLayer(doc, spec.LAYERS.TEXT.SPEAKER1_NAME, joinNameTitle(meeting.speakers[0].name, meeting.speakers[0].title));
      setTextLayer(doc, spec.LAYERS.TEXT.SPEAKER1_HOSPITAL, meeting.speakers[0].hospital);
      setTextLayer(doc, spec.LAYERS.TEXT.SPEAKER2_NAME, joinNameTitle(meeting.speakers[1].name, meeting.speakers[1].title));
      setTextLayer(doc, spec.LAYERS.TEXT.SPEAKER2_HOSPITAL, meeting.speakers[1].hospital);

      for (let i = 0; i < spec.SCHEDULE_ROWS; i += 1) {
        const row = meeting.schedule[i] || {};
        setOptionalTextLayer(doc, spec.LAYERS.TEXT.scheduleTime(i), row.time);
        setOptionalTextLayer(doc, spec.LAYERS.TEXT.scheduleContent(i), row.content);
        setOptionalTextLayer(doc, spec.LAYERS.TEXT.scheduleSpeaker(i), row.speaker);
        setOptionalTextLayer(doc, spec.LAYERS.TEXT.scheduleChair(i), row.chair);
        setLayerVisible(doc, spec.LAYERS.TEXT.scheduleDot(i), Boolean(String(row.content || '').trim()));
      }

      onProgress('替换头像：网页成品固定映射');
      const avatarJobs = [
        ['主席头像', spec.LAYERS.AVATAR.CHAIR, assets.chairAvatar, spec.AVATAR_BOXES.CHAIR],
        ['讲者一头像', spec.LAYERS.AVATAR.SPEAKER1, assets.speaker1Avatar, spec.AVATAR_BOXES.SPEAKER1],
        ['讲者二头像', spec.LAYERS.AVATAR.SPEAKER2, assets.speaker2Avatar, spec.AVATAR_BOXES.SPEAKER2],
      ];
      for (const [label, layerName, asset, box] of avatarJobs) {
        try {
          onProgress(`${label}：替换图片`);
          const avatarLayer = await replaceSmartObject(doc, layerName, asset.entry);
          const outputSize = Number(asset.outputSize);
          const sourceLabel = Number.isFinite(outputSize) && outputSize > 0
            ? `${Math.round(outputSize)}×${Math.round(outputSize)}`
            : '完整方形';
          onProgress(`${label}：网页成品 ${sourceLabel}，固定映射到 ${box.width}×${box.height}`);
          await placeBakedAvatarToBox(avatarLayer, box);
          const afterLayer = findLayer(doc, layerName) || avatarLayer;
          const after = layerGeometry(afterLayer);
          onProgress(`${label}：完成，显示尺寸 ${Math.round(after.width)}×${Math.round(after.height)}`);
        } catch (error) {
          throw new Error(`${label}处理失败：${error && error.message ? error.message : String(error)}`);
        }
      }

      onProgress('替换二维码图片');
      const qrLayer = await replaceSmartObject(doc, spec.LAYERS.QR, assets.qrCode);
      await fitSmartObjectToBox(qrLayer, spec.QR_BOX);

      onProgress('检查文字宽度并自动缩小');
      spec.FIT_TEXT_LAYERS.forEach((names, index) => {
        fitText(doc, names, metrics[index], spec.MIN_FONT_SIZE);
      });

      output = await createOutputFile(outputFolderEntry, meeting.outputName || '系列会议海报');
      onProgress('保存 PNG');
      await doc.saveAs.png(output.pngEntry, { interlaced: false }, true);

      executionContext.reportProgress({ value: 1, commandName: '会议海报生成完成' });
      return {
        pngPath: output.pngEntry.nativePath,
        baseName: output.safeName,
      };
    } finally {
      if (doc) {
        try { doc.closeWithoutSaving(); } catch (_) {}
      }
    }
  }, { commandName: '生成系列会议海报' });
}

module.exports = {
  findLayer,
  validateTemplate,
  generatePoster,
  safeFileName,
};