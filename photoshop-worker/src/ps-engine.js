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

function repairLegacyTextLayerNames(doc, spec) {
  const layouts = Array.isArray(spec.TEXT_LAYER_LAYOUTS) ? spec.TEXT_LAYER_LAYOUTS : [];
  if (!layouts.length) return { renamed: [], unresolved: [] };

  const textGroup = Array.from(doc.layers).find((layer) => layer.name === '05_可编辑文字');
  if (!textGroup || textGroup.kind !== LayerKind.GROUP) {
    return { renamed: [], unresolved: layouts.map((item) => item.name) };
  }

  const textLayers = walkLayers(textGroup.layers, []).filter((layer) => layer.kind === LayerKind.TEXT);
  const expectedNames = new Set(layouts.map((item) => item.name));
  const usedIds = new Set();
  const renamed = [];
  const unresolved = [];

  // 先保留已经正确命名的文字层，兼容 v10 及人工修复过的模板。
  for (const layout of layouts) {
    const existing = textLayers.find((layer) => layer.name === layout.name && !usedIds.has(layer.id));
    if (existing) usedIds.add(existing.id);
  }

  for (const layout of layouts) {
    if (textLayers.some((layer) => layer.name === layout.name && usedIds.has(layer.id))) continue;

    const [left, top, right, bottom] = layout.bounds;
    const targetCenterX = (left + right) / 2;
    const targetCenterY = (top + bottom) / 2;
    let best = null;

    for (const layer of textLayers) {
      if (usedIds.has(layer.id)) continue;
      // 不挪用已经属于其他语义名称的正确图层。
      if (expectedNames.has(layer.name)) continue;
      const geometry = layerGeometry(layer);
      const dx = Math.abs(geometry.centerX - targetCenterX);
      const dy = Math.abs(geometry.centerY - targetCenterY);
      // 纵向位置更能区分不同区域；同一行再通过横向列位置判定。
      const score = dy * 8 + dx;
      if (!best || score < best.score) best = { layer, dx, dy, score };
    }

    // v9 母版为固定 837×1880；这里保留一定字体度量误差，但拒绝跨区域误配。
    if (!best || best.dy > 42 || best.dx > 220) {
      unresolved.push(layout.name);
      continue;
    }

    const oldName = best.layer.name;
    best.layer.name = layout.name;
    usedIds.add(best.layer.id);
    renamed.push({ from: oldName, to: layout.name, layerId: best.layer.id });
  }

  return { renamed, unresolved };
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

  // 固定元素只做存在性检查，绝不修改。
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
  if (!layer || layer.kind !== LayerKind.TEXT) return null;

  // 每次从新打开的母版生成；仍显式恢复基准字号，防止后续复用函数时字号累积变小。
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

  // Photoshop 27 某些构建对 placedLayerReplaceContents 的 _target 支持不稳定：
  // 显式只选中目标智能对象，再执行无 _target 的 Replace Contents 更可靠。
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

  // Replace Contents 可能让旧 DOM Layer 对象的几何缓存失效；必须重新取一次。
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

async function fitSmartObjectToBox(layer, box, { cover = false, zoom = 1, offsetX = 0, offsetY = 0 } = {}) {
  if (!layer) return;
  let geometry = layerGeometry(layer);
  if (geometry.width <= 0 || geometry.height <= 0) throw new Error(`图层“${layer.name}”没有有效尺寸`);

  const scaleX = box.width / geometry.width;
  const scaleY = box.height / geometry.height;
  const baseScale = cover ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
  await layer.scale(
    baseScale * 100, baseScale * 100,
    constants.AnchorPosition.MIDDLECENTER,
    { interpolation: constants.InterpolationMethod.BICUBIC }
  );

  geometry = layerGeometry(layer);
  await layer.translate(
    box.left + box.width / 2 - geometry.centerX,
    box.top + box.height / 2 - geometry.centerY
  );

  const safeZoom = Math.max(1, Number(zoom) || 1);
  if (Math.abs(safeZoom - 1) > 0.001) {
    await layer.scale(
      safeZoom * 100, safeZoom * 100,
      constants.AnchorPosition.MIDDLECENTER,
      { interpolation: constants.InterpolationMethod.BICUBIC }
    );
  }
  const dx = (Number(offsetX) || 0) / 100 * box.width;
  const dy = (Number(offsetY) || 0) / 100 * box.height;
  if (dx || dy) await layer.translate(dx, dy);
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
    .replace(/\.(psd|png)$/i, '')
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

async function createOutputFiles(folderEntry, baseName) {
  const requested = safeFileName(baseName);
  const entries = await folderEntry.getEntries();
  const existing = new Set(entries.map((entry) => String(entry.name || '').toLowerCase()));
  let safeName = requested;
  let suffix = 2;
  while (existing.has(`${safeName}.psd`.toLowerCase()) || existing.has(`${safeName}.png`.toLowerCase())) {
    safeName = `${requested}_${suffix}`;
    suffix += 1;
    if (suffix > 10000) throw new Error('输出目录中同名文件过多，请修改输出文件名');
  }
  const psdEntry = await folderEntry.createFile(`${safeName}.psd`, { overwrite: false });
  const pngEntry = await folderEntry.createFile(`${safeName}.png`, { overwrite: false });
  return { safeName, psdEntry, pngEntry };
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
      doc = await app.open(templateEntry);
      app.activeDocument = doc;

      const nameRepair = repairLegacyTextLayerNames(doc, spec);
      if (nameRepair.renamed.length) {
        onProgress(`已自动修复旧母版文字层命名：${nameRepair.renamed.length} 个`);
      }
      if (nameRepair.unresolved.length) {
        onProgress(`仍有 ${nameRepair.unresolved.length} 个文字层无法按坐标识别，将进入严格预检`);
      }
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
        setTextLayer(doc, spec.LAYERS.TEXT.scheduleTime(i), row.time || '');
        setTextLayer(doc, spec.LAYERS.TEXT.scheduleContent(i), row.content || '');
        setTextLayer(doc, spec.LAYERS.TEXT.scheduleSpeaker(i), row.speaker || '');
        setTextLayer(doc, spec.LAYERS.TEXT.scheduleChair(i), row.chair || '');
        setLayerVisible(doc, spec.LAYERS.TEXT.scheduleTime(i), Boolean(row.time));
        setLayerVisible(doc, spec.LAYERS.TEXT.scheduleContent(i), Boolean(row.content));
        setLayerVisible(doc, spec.LAYERS.TEXT.scheduleSpeaker(i), Boolean(row.speaker));
        setLayerVisible(doc, spec.LAYERS.TEXT.scheduleChair(i), Boolean(row.chair));
        setLayerVisible(doc, spec.LAYERS.TEXT.scheduleDot(i), Boolean(row.content));
      }

      onProgress('替换头像并自动等比铺满圆形区域');
      const avatarJobs = [
        ['主席头像', spec.LAYERS.AVATAR.CHAIR, assets.chairAvatar, spec.AVATAR_BOXES.CHAIR],
        ['讲者一头像', spec.LAYERS.AVATAR.SPEAKER1, assets.speaker1Avatar, spec.AVATAR_BOXES.SPEAKER1],
        ['讲者二头像', spec.LAYERS.AVATAR.SPEAKER2, assets.speaker2Avatar, spec.AVATAR_BOXES.SPEAKER2],
      ];
      for (const [label, layerName, asset, box] of avatarJobs) {
        try {
          onProgress(`${label}：替换图片`);
          const avatarLayer = await replaceSmartObject(doc, layerName, asset.entry);
          const before = layerGeometry(avatarLayer);
          onProgress(`${label}：替换后尺寸 ${Math.round(before.width)}×${Math.round(before.height)}，开始裁剪定位`);
          await fitSmartObjectToBox(avatarLayer, box, { cover: true, ...asset.crop });
          const afterLayer = findLayer(doc, layerName) || avatarLayer;
          const after = layerGeometry(afterLayer);
          onProgress(`${label}：完成，显示尺寸 ${Math.round(after.width)}×${Math.round(after.height)}`);
        } catch (error) {
          throw new Error(`${label}处理失败：${error && error.message ? error.message : String(error)}`);
        }
      }

      onProgress('替换二维码图片');
      const qrLayer = await replaceSmartObject(doc, spec.LAYERS.QR, assets.qrCode);
      await fitSmartObjectToBox(qrLayer, spec.QR_BOX, { cover: false });

      onProgress('检查文字宽度并自动缩小');
      spec.FIT_TEXT_LAYERS.forEach((names, index) => {
        fitText(doc, names, metrics[index], spec.MIN_FONT_SIZE);
      });

      // 到保存阶段才创建输出 Entry；模板预检或图层处理失败时不会碰现有输出。
      output = await createOutputFiles(outputFolderEntry, meeting.outputName || '系列会议海报');
      onProgress('保存 PSD 与 PNG');
      await doc.saveAs.psd(output.psdEntry, { embedColorProfile: true }, true);
      await doc.saveAs.png(output.pngEntry, { interlaced: false }, true);

      executionContext.reportProgress({ value: 1, commandName: '会议海报生成完成' });
      return {
        psdPath: output.psdEntry.nativePath,
        pngPath: output.pngEntry.nativePath,
        baseName: output.safeName,
      };
    } finally {
      // 所有修改都只存在于这次打开的工作文档中；无论成功失败，都不把修改留回母版。
      if (doc) {
        try { doc.closeWithoutSaving(); } catch (_) {}
      }
    }
  }, { commandName: '生成系列会议海报' });
}

module.exports = {
  findLayer,
  repairLegacyTextLayerNames,
  validateTemplate,
  generatePoster,
  safeFileName,
};
