(() => {
  'use strict';

  const importButton = document.getElementById('importSpeakerZip');
  const zipInput = document.getElementById('speakerZipFile');
  if (!importButton || !zipInput) return;

  const MAX_ARCHIVE_BYTES = 80 * 1024 * 1024;
  const MAX_RESUME_BYTES = 32 * 1024 * 1024;
  const MAX_RESUME_COUNT = 80;
  const AVATAR_SIZE = 1024;
  const SUPPORTED_DOCUMENT = /\.(?:pptx|docx)$/i;
  const SUPPORTED_IMAGE = /\.(?:png|jpe?g|webp)$/i;
  const ROLE_DEFS = [
    ['chair', '会议主席'],
    ['speaker1', '讲者一'],
    ['speaker2', '讲者二'],
  ];

  let busy = false;

  function basename(path) {
    return String(path || '').split('/').pop() || '';
  }

  function stripExtension(name) {
    return basename(name).replace(/\.(?:pptx|docx)$/i, '');
  }

  function normalizeSpaces(value) {
    return String(value || '')
      .normalize('NFKC')
      .replace(/[\u00a0\u3000]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .trim();
  }

  function extractNameFromFilename(filename, fallbackText = '') {
    let stem = normalizeSpaces(stripExtension(filename));
    stem = stem
      .replace(/^(?:\d+[\s_-]*)+/u, '')
      .replace(/\s*[-–—]\s*20\d{2}.*$/u, '')
      .replace(/20\d{2}.*$/u, '')
      .trim();

    const afterIntro = stem.match(/(?:专家介绍|专家简介)\s*[-_：:]?\s*([\u4e00-\u9fff]{2,4})/u);
    if (afterIntro) return afterIntro[1];

    const beforeDescriptor = stem.match(/([\u4e00-\u9fff]{2,4})\s*(?:教授简介|主任简介|个人简介|专家介绍|专家简介|简历模板|简历|简介)/u);
    if (beforeDescriptor) return beforeDescriptor[1];

    const plain = stem
      .replace(/(?:教授简介|主任简介|个人简介|专家介绍|专家简介|简历模板|简历|简介)/gu, ' ')
      .replace(/[-_]/g, ' ')
      .trim();
    const plainMatch = plain.match(/(?:^|\s)([\u4e00-\u9fff]{2,4})(?:\s|$)/u)
      || plain.match(/([\u4e00-\u9fff]{2,4})/u);
    if (plainMatch) return plainMatch[1];

    const lines = String(fallbackText || '').split(/\r?\n/).map(normalizeSpaces).filter(Boolean);
    for (const rawLine of lines.slice(0, 30)) {
      const line = rawLine.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])/gu, '');
      const match = line.match(/^([\u4e00-\u9fff]{2,4})(?:\s|教授|主任医师|副主任医师|主治医师|医师|博士|简介|个人简介|$)/u);
      if (match) return match[1];
    }
    return '';
  }

  const INSTITUTION_PATTERNS = [
    /(?:中国人民解放军|解放军)总医院(?:第[一二三四五六七八九十]+医学中心)?/u,
    /空军特色医学中心/u,
    /[\u4e00-\u9fff]{2,24}大学附属[\u4e00-\u9fff]{2,18}医院/u,
    /[\u4e00-\u9fff]{2,30}(?:人民医院|国际医院|中心医院|妇幼保健院|儿童医院|肿瘤医院|胸科医院|口腔医院|中医院|医院)/u,
    /[\u4e00-\u9fff]{2,20}医学中心/u,
  ];

  function normalizeInstitution(value) {
    return String(value || '')
      .replace(/^(?:目前|现任|任职于?|就职于?|工作于|曾任|曾先后工作于)/u, '')
      .trim();
  }

  function institutionsFromLine(line) {
    const found = [];
    for (const pattern of INSTITUTION_PATTERNS) {
      const match = line.match(pattern);
      const hospital = normalizeInstitution(match?.[0]);
      if (hospital && !found.includes(hospital)) found.push(hospital);
    }
    return found;
  }

  function extractHospital(text) {
    const lines = String(text || '')
      .split(/\r?\n/)
      .map(normalizeSpaces)
      .filter(Boolean);
    const candidates = [];

    lines.forEach((line, index) => {
      const found = institutionsFromLine(line);
      for (const hospital of found) {
        let score = 1000 - Math.min(index, 100) * 3;
        if (/(?:现任|任职|就职|主任|副主任|主治医师|主任医师|副主任医师|教授|重症医学科|呼吸|感染科)/u.test(line)) score += 300;
        if (/(?:曾任|曾先后|访问学者|进修|毕业于|美国|德国|英国|加拿大|澳大利亚)/u.test(line)) score -= 550;
        score += Math.min(hospital.length, 30);
        candidates.push({ hospital, score, index });
      }
    });

    candidates.sort((a, b) => b.score - a.score || a.index - b.index || b.hospital.length - a.hospital.length);
    return candidates[0]?.hospital || '';
  }

  function parseXmlText(xml) {
    const documentXml = new DOMParser().parseFromString(String(xml || ''), 'application/xml');
    if (documentXml.querySelector('parsererror')) throw new Error('简历 XML 无法解析');
    const nodes = Array.from(documentXml.getElementsByTagNameNS('*', 't'));
    return nodes.map(node => normalizeSpaces(node.textContent)).filter(Boolean).join('\n');
  }

  function mimeForPath(path) {
    const lower = String(path || '').toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
    if (lower.endsWith('.webp')) return 'image/webp';
    return '';
  }

  async function readInnerDocument(entry) {
    const bytes = await entry.async('uint8array');
    if (!bytes.length || bytes.length > MAX_RESUME_BYTES) throw new Error(`${basename(entry.name)} 文件过大或为空`);
    const inner = await window.JSZip.loadAsync(bytes);
    const isDocx = /\.docx$/i.test(entry.name);
    const textPaths = Object.keys(inner.files)
      .filter(path => isDocx
        ? path === 'word/document.xml'
        : /^ppt\/slides\/slide\d+\.xml$/i.test(path))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const textParts = [];
    for (const path of textPaths) {
      const xml = await inner.file(path)?.async('text');
      if (xml) textParts.push(parseXmlText(xml));
    }

    const mediaPrefix = isDocx ? 'word/media/' : 'ppt/media/';
    const imageEntries = Object.keys(inner.files)
      .filter(path => path.startsWith(mediaPrefix) && SUPPORTED_IMAGE.test(path));
    const images = [];
    for (const path of imageEntries) {
      const media = inner.file(path);
      if (!media) continue;
      const imageBytes = await media.async('uint8array');
      if (!imageBytes.length || imageBytes.length > MAX_RESUME_BYTES) continue;
      const type = mimeForPath(path);
      if (!type) continue;
      images.push({ path, blob: new Blob([imageBytes], { type }) });
    }

    return { text: textParts.join('\n'), images };
  }

  async function imageMetrics(blob) {
    const bitmap = await createImageBitmap(blob);
    try {
      return { width: bitmap.width, height: bitmap.height };
    } finally {
      bitmap.close?.();
    }
  }

  async function detectFaces(blob) {
    if (typeof window.FaceDetector !== 'function') return [];
    const bitmap = await createImageBitmap(blob);
    try {
      const detector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 4 });
      return await detector.detect(bitmap);
    } catch (_) {
      return [];
    } finally {
      bitmap.close?.();
    }
  }

  function faceArea(face) {
    const box = face?.boundingBox;
    return Math.max(0, Number(box?.width || 0) * Number(box?.height || 0));
  }

  async function choosePortrait(images) {
    const scored = [];
    for (const image of images) {
      let metrics;
      try { metrics = await imageMetrics(image.blob); }
      catch (_) { continue; }
      const { width, height } = metrics;
      if (width < 120 || height < 120) continue;
      const area = width * height;
      const ratio = width / height;
      const portraitShape = Math.max(0, 1 - Math.abs(ratio - 0.72));
      const saneShape = ratio >= 0.38 && ratio <= 1.25 ? 1 : 0;
      const faces = await detectFaces(image.blob);
      const largestFaceArea = Math.max(0, ...faces.map(faceArea));
      const score =
        (faces.length ? 10_000_000 : 0)
        + largestFaceArea * 12
        + saneShape * 800_000
        + portraitShape * 700_000
        + Math.min(area, 5_000_000) * 0.08;
      scored.push({ ...image, width, height, faces, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored[0] || null;
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function cropBoxFromFace(width, height, face) {
    const box = face?.boundingBox;
    if (!box) return null;
    const fw = Number(box.width || 0);
    const fh = Number(box.height || 0);
    if (!(fw > 0 && fh > 0)) return null;
    const cx = Number(box.x || 0) + fw / 2;
    const cy = Number(box.y || 0) + fh / 2;
    const side = Math.min(Math.max(fw, fh) * 2.65, width, height);
    let x = cx - side / 2;
    let y = cy - side * 0.42;
    x = clamp(x, 0, Math.max(0, width - side));
    y = clamp(y, 0, Math.max(0, height - side));
    return { x, y, side };
  }

  function fallbackCropBox(width, height) {
    const side = Math.min(width, height);
    if (height > width) {
      const spare = height - side;
      return { x: 0, y: spare * 0.18, side };
    }
    return { x: (width - side) / 2, y: 0, side };
  }

  async function cropAvatar(portrait, fileName) {
    const bitmap = await createImageBitmap(portrait.blob);
    try {
      const faces = portrait.faces || [];
      const mainFace = [...faces].sort((a, b) => faceArea(b) - faceArea(a))[0];
      const crop = cropBoxFromFace(bitmap.width, bitmap.height, mainFace)
        || fallbackCropBox(bitmap.width, bitmap.height);
      const canvas = document.createElement('canvas');
      canvas.width = AVATAR_SIZE;
      canvas.height = AVATAR_SIZE;
      const context = canvas.getContext('2d', { alpha: true });
      if (!context) throw new Error('浏览器无法创建头像画布');
      context.clearRect(0, 0, AVATAR_SIZE, AVATAR_SIZE);
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = 'high';
      context.drawImage(bitmap, crop.x, crop.y, crop.side, crop.side, 0, 0, AVATAR_SIZE, AVATAR_SIZE);
      context.fillStyle = '#000000';
      context.fillRect(0, 0, 1, 1);
      context.fillRect(AVATAR_SIZE - 1, 0, 1, 1);
      context.fillRect(0, AVATAR_SIZE - 1, 1, 1);
      context.fillRect(AVATAR_SIZE - 1, AVATAR_SIZE - 1, 1, 1);
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob(value => value ? resolve(value) : reject(new Error('头像 PNG 生成失败')), 'image/png', 1);
      });
      return new File([blob], fileName, { type: 'image/png', lastModified: Date.now() });
    } finally {
      bitmap.close?.();
    }
  }

  async function parseResume(entry) {
    const parsed = await readInnerDocument(entry);
    const name = extractNameFromFilename(entry.name, parsed.text);
    const hospital = extractHospital(parsed.text);
    const portrait = await choosePortrait(parsed.images);
    if (!name) throw new Error(`${basename(entry.name)} 未识别到讲者姓名`);
    if (!hospital) throw new Error(`${name} 未识别到医院/单位`);
    if (!portrait) throw new Error(`${name} 未找到可用人物照片`);
    const avatar = await cropAvatar(portrait, `${name}-cropped.png`);
    return {
      sourceFile: basename(entry.name),
      name,
      hospital,
      avatar,
      portraitSource: basename(portrait.path),
    };
  }

  function randomInt(maxExclusive) {
    if (!(maxExclusive > 0)) return 0;
    const range = 0x100000000;
    const limit = range - (range % maxExclusive);
    const buffer = new Uint32Array(1);
    let value;
    do {
      crypto.getRandomValues(buffer);
      value = buffer[0];
    } while (value >= limit);
    return value % maxExclusive;
  }

  function pickRandomThree(speakers) {
    const copy = [...speakers];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = randomInt(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy.slice(0, 3);
  }

  function setInputValue(id, value) {
    const input = document.getElementById(id);
    if (!input) throw new Error(`找不到字段：${id}`);
    input.value = String(value || '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function setFileInput(input, file, { bakedAvatar = false } = {}) {
    if (!input) throw new Error('找不到素材输入框');
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (bakedAvatar) input.dataset.avatarCropApplied = '1';
    input.files = transfer.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (bakedAvatar) delete input.dataset.avatarCropApplied;
  }

  function makeQrFile() {
    if (typeof window.qrcode !== 'function') throw new Error('二维码组件未加载');
    const qr = window.qrcode(0, 'M');
    qr.addData(`POSTER-${crypto.randomUUID()}`);
    qr.make();
    const modules = qr.getModuleCount();
    const margin = 4;
    const cells = modules + margin * 2;
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, size, size);
    const cell = size / cells;
    context.fillStyle = '#000000';
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (!qr.isDark(row, col)) continue;
        const x1 = Math.round((col + margin) * cell);
        const y1 = Math.round((row + margin) * cell);
        const x2 = Math.round((col + margin + 1) * cell);
        const y2 = Math.round((row + margin + 1) * cell);
        context.fillRect(x1, y1, x2 - x1, y2 - y1);
      }
    }
    return new Promise((resolve, reject) => {
      canvas.toBlob(blob => {
        if (!blob) return reject(new Error('随机二维码生成失败'));
        resolve(new File([blob], 'qr-random.png', { type: 'image/png', lastModified: Date.now() }));
      }, 'image/png', 1);
    });
  }

  async function applySelection(selected, qrFile = null) {
    if (!Array.isArray(selected) || selected.length !== 3) throw new Error('需要恰好 3 位讲者');
    ROLE_DEFS.forEach(([role], index) => {
      const speaker = selected[index];
      if (!speaker?.name || !speaker?.hospital || !(speaker.avatar instanceof File)) {
        throw new Error(`第 ${index + 1} 位讲者资料不完整`);
      }
      setInputValue(`${role}-name`, speaker.name);
      setInputValue(`${role}-hospital`, speaker.hospital);
      setFileInput(document.getElementById(`${role}-file`), speaker.avatar, { bakedAvatar: true });
      const readout = document.getElementById(`${role}-crop-readout`);
      if (readout) readout.textContent = '已自动裁剪 · 成品头像 PNG';
      document.dispatchEvent(new CustomEvent('avatar-crop-applied', {
        detail: { key: role, file: speaker.avatar, cropMode: 'baked', outputSize: AVATAR_SIZE },
      }));
    });

    const qr = qrFile || await makeQrFile();
    setFileInput(document.getElementById('qrFile'), qr);
    return selected;
  }

  function showImportFeedback(message, isError = false) {
    importButton.title = String(message || '');
    const status = document.getElementById('speakerImportStatus');
    if (status) {
      status.hidden = false;
      status.textContent = message;
      status.classList.toggle('bad', isError);
      clearTimeout(showImportFeedback.timer);
      showImportFeedback.timer = setTimeout(() => { status.hidden = true; }, isError ? 7000 : 5000);
    }
  }

  async function importArchive(file) {
    if (!window.JSZip?.loadAsync) throw new Error('ZIP 解析组件未加载，请刷新页面重试');
    if (!file || !/\.zip$/i.test(file.name)) throw new Error('请选择 .zip 格式的讲者简历包');
    if (!file.size || file.size > MAX_ARCHIVE_BYTES) throw new Error('简历包为空或超过 80 MiB');

    const archive = await window.JSZip.loadAsync(file);
    const entries = Object.values(archive.files)
      .filter(entry => !entry.dir)
      .filter(entry => !entry.name.includes('__MACOSX/'))
      .filter(entry => !/(?:^|\/)\._/.test(entry.name))
      .filter(entry => SUPPORTED_DOCUMENT.test(entry.name));
    if (!entries.length) throw new Error('ZIP 中没有找到 PPTX / DOCX 简历');
    if (entries.length > MAX_RESUME_COUNT) throw new Error(`简历数量超过 ${MAX_RESUME_COUNT} 份限制`);

    const usable = [];
    const skipped = [];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      importButton.textContent = `解析 ${i + 1}/${entries.length}`;
      try {
        usable.push(await parseResume(entry));
      } catch (error) {
        skipped.push(`${basename(entry.name)}：${error.message || error}`);
      }
    }

    if (usable.length < 3) {
      const detail = skipped.slice(0, 4).join('；');
      throw new Error(`仅识别到 ${usable.length} 位可用讲者，至少需要 3 位${detail ? `。${detail}` : ''}`);
    }

    const selected = pickRandomThree(usable);
    await applySelection(selected);
    return { total: entries.length, usable, skipped, selected };
  }

  importButton.addEventListener('click', () => {
    if (!busy) zipInput.click();
  });

  zipInput.addEventListener('change', async () => {
    const file = zipInput.files?.[0];
    zipInput.value = '';
    if (!file || busy) return;
    busy = true;
    importButton.disabled = true;
    importButton.textContent = '读取简历…';
    showImportFeedback('正在解析讲者简历包…');
    try {
      const result = await importArchive(file);
      const names = result.selected.map(speaker => speaker.name).join(' / ');
      importButton.textContent = '导入完成';
      showImportFeedback(`已识别 ${result.usable.length}/${result.total} 位，随机填入：${names}${result.skipped.length ? `；跳过 ${result.skipped.length} 份` : ''}`);
      document.dispatchEvent(new CustomEvent('speaker-resume-imported', { detail: result }));
    } catch (error) {
      console.error(error);
      importButton.textContent = '导入失败';
      showImportFeedback(error.message || String(error), true);
    } finally {
      busy = false;
      importButton.disabled = false;
      setTimeout(() => { if (!busy) importButton.textContent = '导入讲者简历'; }, 1600);
    }
  });

  window.posterSpeakerImporter = Object.freeze({
    extractNameFromFilename,
    extractHospital,
    pickRandomThree,
    parseResume,
    applySelection,
    importArchive,
  });
})();
