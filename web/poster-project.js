(() => {
  const RENDER_PROTOCOL_VERSION = 2;
  const PROJECT_VERSION = 1;
  const AVATAR_OUTPUT_SIZE = 1024;

  const agendaPlaceholders = [
    ['00:00-00:00', '开场致辞', 'xxx 教授', 'xxx 教授'],
    ['00:00-00:00', 'xxxxx', 'xxx 教授', ''],
    ['00:00-00:00', 'xxxxx', 'xxx 教授', ''],
    ['00:00-00:00', '会议总结', '', 'xxx 教授'],
  ];

  const agendaRows = [1310, 1375, 1439, 1503];
  const agendaColumns = [
    { key: 'time', x: 91, width: 122 },
    { key: 'content', x: 262, width: 190 },
    { key: 'speaker', x: 491, width: 132 },
    { key: 'chair', x: 638, width: 128 },
  ];

  const textItems = [
    { id: 'section-chair', text: '会议主席', x: 268, y: 420, width: 300, fontSize: 28, fontWeight: 900, color: '#4b2bc9', align: 'center', letterSpacing: 3, edit: { section: 'people' } },
    { id: 'section-speakers', text: '会议讲者', x: 268, y: 762, width: 300, fontSize: 28, fontWeight: 900, color: '#4b2bc9', align: 'center', letterSpacing: 3, edit: { section: 'people' } },
    { id: 'section-agenda', text: '会议日程', x: 268, y: 1092, width: 300, fontSize: 28, fontWeight: 900, color: '#4b2bc9', align: 'center', letterSpacing: 3, edit: { section: 'schedule' } },

    { id: 'chair-name', source: { type: 'personName', inputId: 'chair-name' }, placeholder: '姓名 教授', x: 340, y: 682, width: 172, fontSize: 22, fontWeight: 800, align: 'center', edit: { section: 'people', inputId: 'chair-name' } },
    { id: 'chair-hospital', source: { type: 'input', inputId: 'chair-hospital' }, placeholder: 'XXXXXXXXXXXX医院', x: 329, y: 717, width: 194, fontSize: 18, fontWeight: 500, align: 'center', edit: { section: 'people', inputId: 'chair-hospital' } },
    { id: 'speaker1-name', source: { type: 'personName', inputId: 'speaker1-name' }, placeholder: '姓名 教授', x: 218, y: 1018, width: 174, fontSize: 22, fontWeight: 800, align: 'center', edit: { section: 'people', inputId: 'speaker1-name' } },
    { id: 'speaker1-hospital', source: { type: 'input', inputId: 'speaker1-hospital' }, placeholder: 'XXXXXXXXXXXX医院', x: 209, y: 1056, width: 192, fontSize: 18, fontWeight: 500, align: 'center', edit: { section: 'people', inputId: 'speaker1-hospital' } },
    { id: 'speaker2-name', source: { type: 'personName', inputId: 'speaker2-name' }, placeholder: '姓名 教授', x: 454, y: 1017, width: 174, fontSize: 22, fontWeight: 800, align: 'center', edit: { section: 'people', inputId: 'speaker2-name' } },
    { id: 'speaker2-hospital', source: { type: 'input', inputId: 'speaker2-hospital' }, placeholder: 'XXXXXXXXXXXX医院', x: 445, y: 1055, width: 192, fontSize: 18, fontWeight: 500, align: 'center', edit: { section: 'people', inputId: 'speaker2-hospital' } },

    { id: 'meeting-time', source: { type: 'meetingDate', inputId: 'meetingTime' }, placeholder: '会议时间：2025年03月00日', x: 80, y: 1147, width: 470, fontSize: 22, fontWeight: 800, edit: { section: 'meeting', action: 'meetingTime' } },
    { id: 'meeting-location', text: '会议地点：线上', x: 80, y: 1184, width: 290, fontSize: 22, fontWeight: 800, edit: { section: 'meeting' } },

    { id: 'agenda-head-time', text: '时间', x: 94, y: 1245, width: 90, fontSize: 23, fontWeight: 900, color: '#fff', edit: { section: 'schedule' } },
    { id: 'agenda-head-content', text: '内容', x: 266, y: 1245, width: 90, fontSize: 23, fontWeight: 900, color: '#fff', edit: { section: 'schedule' } },
    { id: 'agenda-head-speaker', text: '讲者', x: 495, y: 1245, width: 90, fontSize: 23, fontWeight: 900, color: '#fff', edit: { section: 'schedule' } },
    { id: 'agenda-head-chair', text: '主席', x: 648, y: 1245, width: 90, fontSize: 23, fontWeight: 900, color: '#fff', edit: { section: 'schedule' } },

    { id: 'sort-note', text: '*排名不分先后，以姓名首字母拼音进行排序', x: 482, y: 1560, width: 282, fontSize: 13, fontWeight: 600, align: 'right' },
    { id: 'qr-note', text: '请扫描二维码观看会议直播', x: 308, y: 1747, width: 221, fontSize: 14, fontWeight: 800, color: '#fff', align: 'center', edit: { section: 'qr' } },
  ];

  agendaRows.forEach((y, rowIndex) => {
    agendaColumns.forEach((column, columnIndex) => {
      textItems.push({
        id: `agenda-${rowIndex}-${column.key}`,
        source: { type: 'input', inputId: `s-${column.key}-${rowIndex}` },
        placeholder: agendaPlaceholders[rowIndex][columnIndex],
        x: column.x,
        y,
        width: column.width,
        fontSize: 18,
        fontWeight: 500,
        edit: {
          section: 'schedule',
          inputId: `s-${column.key}-${rowIndex}`,
          scheduleIndex: rowIndex,
          action: column.key === 'time' ? 'scheduleTime' : 'focus',
        },
      });
    });
  });

  const project = {
    id: 'chronic-care-2026',
    version: PROJECT_VERSION,
    canvas: { width: 837, height: 1880 },
    // 图片位置/尺寸只在这里维护。后端 PSD 运行时直接使用提交任务携带的同一份布局。
    assetPreview: {
      chair: { left: 342, top: 496, size: 168, label: '主席' },
      speaker1: { left: 221, top: 836, size: 168, label: '讲者一' },
      speaker2: { left: 457, top: 836, size: 168, label: '讲者二' },
      qr: { left: 338, top: 1576, size: 148 },
    },
    textItems,
  };
  window.POSTER_PROJECT = project;

  function toBox(spec) {
    return {
      left: Number(spec.left),
      top: Number(spec.top),
      width: Number(spec.size),
      height: Number(spec.size),
    };
  }

  function renderContract() {
    return {
      protocolVersion: RENDER_PROTOCOL_VERSION,
      project: {
        id: project.id,
        version: project.version,
        canvas: { ...project.canvas },
        assetLayout: {
          chair: toBox(project.assetPreview.chair),
          speaker1: toBox(project.assetPreview.speaker1),
          speaker2: toBox(project.assetPreview.speaker2),
          qrCode: toBox(project.assetPreview.qr),
        },
      },
    };
  }

  // 浏览器提交边界：头像必须先在裁剪弹窗中“应用裁剪”，生成 1024×1024 PNG。
  // raw 参数不再允许进入后端协议，避免浏览器与 Photoshop 对缩放的二次解释。
  const baseValidation = window.PosterValidation;
  if (baseValidation?.validatePayload) {
    window.PosterValidation = Object.freeze({
      ...baseValidation,
      validatePayload(payload) {
        const errors = [...baseValidation.validatePayload(payload)];
        const assets = payload?.assets || {};
        for (const [key, label] of [
          ['chair', '会议主席头像'],
          ['speaker1', '讲者一头像'],
          ['speaker2', '讲者二头像'],
        ]) {
          const asset = assets[key] || {};
          if (asset.cropMode !== 'baked') errors.push(`${label}必须先点击“应用裁剪”`);
          if (asset.outputSize !== AVATAR_OUTPUT_SIZE) errors.push(`${label}裁剪输出必须为 ${AVATAR_OUTPUT_SIZE}×${AVATAR_OUTPUT_SIZE}`);
          if (!String(asset.storagePath || '').toLowerCase().endsWith('.png')) errors.push(`${label}应用裁剪后必须为 PNG`);
          if (Number(asset.crop?.zoom) !== 1 || Number(asset.crop?.offsetX) !== 0 || Number(asset.crop?.offsetY) !== 0) {
            errors.push(`${label}已是成品 PNG，不能再次携带 raw 裁剪参数`);
          }
        }
        return errors;
      },
    });
  }

  // app.js 保持现有稳定上传逻辑；只在 poster_jobs.insert 的最后边界注入 render contract。
  // 这样图片几何仍只由上面的 assetPreview 配置维护，Agent/Worker 不再各存一份 168/148。
  const supabaseLib = window.supabase;
  if (supabaseLib?.createClient && !supabaseLib.__posterRenderContractWrapped) {
    const originalCreateClient = supabaseLib.createClient.bind(supabaseLib);
    supabaseLib.createClient = (...args) => {
      const client = originalCreateClient(...args);
      const originalFrom = client.from.bind(client);
      client.from = (table) => {
        const query = originalFrom(table);
        if (table !== 'poster_jobs' || typeof query?.insert !== 'function') return query;
        const originalInsert = query.insert.bind(query);
        query.insert = (values, options) => {
          const single = !Array.isArray(values);
          const rows = single ? [values] : values;
          const patched = rows.map(row => {
            if (!row || typeof row !== 'object' || !row.payload || typeof row.payload !== 'object') return row;
            const contract = renderContract();
            return {
              ...row,
              payload: {
                ...row.payload,
                protocolVersion: contract.protocolVersion,
                project: contract.project,
              },
            };
          });
          return originalInsert(single ? patched[0] : patched, options);
        };
        return query;
      };
      return client;
    };
    Object.defineProperty(supabaseLib, '__posterRenderContractWrapped', { value: true });
  }
})();
