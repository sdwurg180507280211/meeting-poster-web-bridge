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
    assetPreview: {
      chair: { left: 342, top: 496, size: 168, label: '主席' },
      speaker1: { left: 221, top: 836, size: 168, label: '讲者一' },
      speaker2: { left: 457, top: 836, size: 168, label: '讲者二' },
      qr: { left: 338, top: 1576, size: 148 },
    },
    textItems,
  };

  function toBox(spec) {
    return {
      left: Number(spec.left),
      top: Number(spec.top),
      width: Number(spec.size),
      height: Number(spec.size),
    };
  }

  project.buildRenderContract = () => ({
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
  });

  window.POSTER_PROJECT = project;
  window.POSTER_RUNTIME = Object.freeze({
    webVersion: '1.1.0',
    renderProtocolVersion: RENDER_PROTOCOL_VERSION,
    avatarOutputSize: AVATAR_OUTPUT_SIZE,
    projectId: project.id,
    projectVersion: project.version,
    canvas: Object.freeze({ ...project.canvas }),
  });
})();
