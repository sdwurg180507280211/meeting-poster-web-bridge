(() => {
  const cfg = window.POSTER_CONFIG || {};
  const supabaseLib = window.supabase;
  const debugEl = document.getElementById('debug');
  const cloudState = document.getElementById('cloudState');
  const jobStatus = document.getElementById('jobStatus');
  const submitBtn = document.getElementById('submitBtn');
  const resultPreview = document.getElementById('resultPreview');
  const downloads = document.getElementById('downloads');
  const progressSteps = document.getElementById('progressSteps');
  const historyList = document.getElementById('historyList');
  const refreshHistoryBtn = document.getElementById('refreshHistory');

  const ACTIVE_JOB_KEY = 'meetingPosterActiveJobV1';
  const peopleDef = [['chair','会议主席'], ['speaker1','讲者一'], ['speaker2','讲者二']];
  const peopleState = {};
  let client = null;
  let user = null;
  let activeJob = null;
  let pollTimer = null;

  function log(msg) {
    debugEl.textContent += `${new Date().toLocaleTimeString()} ${msg}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }
  function safeExt(name) {
    const m = String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1].replace('jpeg', 'jpg') : 'png';
  }
  function uuid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }
  function val(id) { return document.getElementById(id).value.trim(); }
  function safeDownloadName(name) {
    return (String(name || '系列会议海报').trim() || '系列会议海报').replace(/[\\/:*?"<>|]/g, '_');
  }
  function saveActiveJob(id) {
    activeJob = id || null;
    if (activeJob) localStorage.setItem(ACTIVE_JOB_KEY, activeJob);
    else localStorage.removeItem(ACTIVE_JOB_KEY);
  }
  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function buildPeople() {
    const root = document.getElementById('people');
    root.innerHTML = '';
    peopleDef.forEach(([key, label]) => {
      peopleState[key] = { file: null, url: '', crop: { zoom: 1, offsetX: 0, offsetY: 0 } };
      const wrap = document.createElement('div');
      wrap.className = 'person';
      wrap.innerHTML = `
        <div class="person-head">${label}</div>
        <div class="person-grid">
          <div>
            <div class="avatar-box"><img id="${key}-img" alt="${label}头像"></div>
            <input id="${key}-file" type="file" accept="image/png,image/jpeg,image/webp" required style="margin-top:10px;width:100%">
          </div>
          <div>
            <div class="grid2">
              <label>姓名<input id="${key}-name" required></label>
              <label>职称（可选）<input id="${key}-title"></label>
            </div>
            <label style="margin-top:10px">医院<input id="${key}-hospital" required></label>
            <div class="crop-controls">
              ${rangeHtml(key, 'zoom', '缩放', 100, 250, 100, '%')}
              ${rangeHtml(key, 'x', '左右', -100, 100, 0, '')}
              ${rangeHtml(key, 'y', '上下', -100, 100, 0, '')}
            </div>
          </div>
        </div>`;
      root.appendChild(wrap);
      document.getElementById(`${key}-file`).addEventListener('change', e => onAvatarFile(key, e.target.files[0]));
      ['zoom', 'x', 'y'].forEach(axis => document.getElementById(`${key}-${axis}`).addEventListener('input', e => {
        const v = Number(e.target.value);
        document.getElementById(`${key}-${axis}-v`).textContent = axis === 'zoom' ? `${v}%` : String(v);
        if (axis === 'zoom') peopleState[key].crop.zoom = v / 100;
        if (axis === 'x') peopleState[key].crop.offsetX = v;
        if (axis === 'y') peopleState[key].crop.offsetY = v;
        renderAvatar(key);
      }));
    });
  }

  function rangeHtml(key, axis, label, min, max, value, suffix) {
    return `<div class="range-row"><span>${label}</span><input id="${key}-${axis}" type="range" min="${min}" max="${max}" value="${value}"><span id="${key}-${axis}-v">${value}${suffix}</span></div>`;
  }

  function onAvatarFile(key, file) {
    if (!file) return;
    const st = peopleState[key];
    st.file = file;
    if (st.url) URL.revokeObjectURL(st.url);
    st.url = URL.createObjectURL(file);
    const img = document.getElementById(`${key}-img`);
    img.src = st.url;
    img.onload = () => renderAvatar(key);
  }

  function renderAvatar(key) {
    const st = peopleState[key];
    const img = document.getElementById(`${key}-img`);
    if (!st.file || !img.naturalWidth) return;
    const box = 110;
    const cover = Math.max(box / img.naturalWidth, box / img.naturalHeight) * st.crop.zoom;
    const w = img.naturalWidth * cover;
    const h = img.naturalHeight * cover;
    img.style.width = `${w}px`;
    img.style.height = `${h}px`;
    img.style.left = `${(box - w) / 2 + (st.crop.offsetX / 100) * box}px`;
    img.style.top = `${(box - h) / 2 + (st.crop.offsetY / 100) * box}px`;
  }

  function buildSchedule() {
    const root = document.getElementById('schedule');
    root.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'schedule-row';
      row.innerHTML = `<input id="s-time-${i}" placeholder="时间"><input id="s-content-${i}" placeholder="日程内容"><input id="s-speaker-${i}" placeholder="讲者"><input id="s-chair-${i}" placeholder="主席">`;
      root.appendChild(row);
    }
  }

  document.getElementById('qrFile').addEventListener('change', e => {
    const f = e.target.files[0];
    const img = document.getElementById('qrPreview');
    if (!f) { img.style.display = 'none'; return; }
    img.src = URL.createObjectURL(f);
    img.style.display = 'block';
  });

  async function init() {
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR_PROJECT') || !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
      cloudState.textContent = '请先配置 config.js';
      cloudState.className = 'badge bad';
      return;
    }
    client = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    let { data: { session } } = await client.auth.getSession();
    if (!session) {
      const r = await client.auth.signInAnonymously();
      if (r.error) throw r.error;
      session = r.data.session;
    }
    user = session.user;
    cloudState.textContent = '云端已连接';
    cloudState.className = 'badge';
    log(`anonymous user ${user.id}`);

    await loadHistory();
    await restoreActiveJob();
  }

  async function restoreActiveJob() {
    let stored = localStorage.getItem(ACTIVE_JOB_KEY);
    if (!stored) {
      const { data, error } = await client.from('poster_jobs')
        .select('id,status')
        .in('status', ['pending', 'claimed', 'rendering', 'uploading'])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!error && data?.id) stored = data.id;
    }
    if (!stored) return;

    const { data, error } = await client.from('poster_jobs').select('*').eq('id', stored).maybeSingle();
    if (error || !data) {
      localStorage.removeItem(ACTIVE_JOB_KEY);
      return;
    }
    saveActiveJob(data.id);
    log(`恢复任务 ${data.id} (${data.status})`);
    await presentJob(data, true);
  }

  function collectMeeting() {
    const schedule = [];
    for (let i = 0; i < 4; i++) schedule.push({
      time: document.getElementById(`s-time-${i}`).value.trim(),
      content: document.getElementById(`s-content-${i}`).value.trim(),
      speaker: document.getElementById(`s-speaker-${i}`).value.trim(),
      chair: document.getElementById(`s-chair-${i}`).value.trim(),
    });
    return {
      meetingTime: document.getElementById('meetingTime').value.trim(),
      meetingLocation: document.getElementById('meetingLocation').value.trim(),
      chair: { name: val('chair-name'), title: val('chair-title'), hospital: val('chair-hospital') },
      speakers: [
        { name: val('speaker1-name'), title: val('speaker1-title'), hospital: val('speaker1-hospital') },
        { name: val('speaker2-name'), title: val('speaker2-title'), hospital: val('speaker2-hospital') }
      ],
      schedule,
      outputName: document.getElementById('outputName').value.trim() || '系列会议海报'
    };
  }

  async function uploadFile(path, file) {
    const { error } = await client.storage.from(cfg.BUCKET || 'poster-assets').upload(path, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false
    });
    if (error) throw error;
  }

  document.getElementById('posterForm').addEventListener('submit', async e => {
    e.preventDefault();
    if (!client || !user) { alert('Supabase 尚未连接'); return; }
    try {
      submitBtn.disabled = true;
      downloads.innerHTML = '';
      resultPreview.style.display = 'none';
      const qr = document.getElementById('qrFile').files[0];
      for (const [key, label] of peopleDef) if (!peopleState[key].file) throw new Error(`请上传${label}头像`);
      if (!qr) throw new Error('请上传二维码');

      const meeting = collectMeeting();
      const active = meeting.schedule.filter(r => r.time || r.content || r.speaker || r.chair);
      if (!active.length) throw new Error('请至少填写一行日程');
      active.forEach(r => { if (!r.time || !r.content) throw new Error('已填写的日程必须包含时间和内容'); });

      const jobId = uuid();
      const base = `${user.id}/${jobId}/input`;
      setStatus('正在上传素材…', 'uploading');
      const assets = {};
      for (const [key] of peopleDef) {
        const st = peopleState[key];
        const path = `${base}/${key}.${safeExt(st.file.name)}`;
        await uploadFile(path, st.file);
        assets[key] = { storagePath: path, crop: st.crop, originalName: st.file.name };
      }
      const qrPath = `${base}/qr.${safeExt(qr.name)}`;
      await uploadFile(qrPath, qr);
      assets.qrCode = { storagePath: qrPath, originalName: qr.name };

      const payload = { meeting, assets };
      const { error } = await client.from('poster_jobs').insert({ id: jobId, owner_id: user.id, status: 'pending', payload });
      if (error) throw error;

      saveActiveJob(jobId);
      setStatus('任务已提交，等待你的 Mac Photoshop 接单…', 'pending');
      log(`job ${jobId} created`);
      await loadHistory();
      startPolling();
    } catch (err) {
      console.error(err);
      setStatus(`提交失败：${err.message}`, 'failed');
      submitBtn.disabled = false;
    }
  });

  function setStatus(text, status) {
    jobStatus.textContent = text;
    jobStatus.className = `status-box ${status === 'succeeded' ? 'ok' : status === 'failed' ? 'bad' : ''}`;
    const map = {
      pending: '① 已提交 → 等待 Mac',
      claimed: '② Mac Agent 已接单',
      rendering: '③ Photoshop 正在生成',
      uploading: '④ 正在上传结果',
      succeeded: '⑤ 已完成',
      failed: '生成失败'
    };
    progressSteps.textContent = map[status] || '';
  }

  function statusLabel(status) {
    return ({ pending: '等待接单', claimed: '已接单', rendering: '生成中', uploading: '上传中', succeeded: '已完成', failed: '失败' })[status] || status;
  }

  function startPolling() {
    stopPolling();
    pollTimer = setInterval(pollJob, 2000);
    pollJob();
  }

  async function pollJob() {
    if (!activeJob) return;
    const { data, error } = await client.from('poster_jobs').select('*').eq('id', activeJob).single();
    if (error) { log(`poll error ${error.message}`); return; }
    await presentJob(data, false);
  }

  async function presentJob(data, restored) {
    const label = {
      pending: '等待 Mac Photoshop 接单…',
      claimed: 'Mac Agent 已接单，正在准备素材…',
      rendering: 'Photoshop 正在生成正式海报…',
      uploading: 'Photoshop 已完成，正在上传结果…',
      succeeded: '生成完成',
      failed: `生成失败：${data.error_message || '未知错误'}`
    };
    setStatus(label[data.status] || data.status, data.status);

    if (['pending', 'claimed', 'rendering', 'uploading'].includes(data.status)) {
      submitBtn.disabled = true;
      if (restored || !pollTimer) startPolling();
      return;
    }

    stopPolling();
    submitBtn.disabled = false;
    saveActiveJob(null);
    if (data.status === 'succeeded') await showResults(data);
    await loadHistory();
  }

  async function downloadAs(url, filename) {
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const blob = await r.blob();
      const a = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
    } catch (err) {
      log('下载失败：' + err.message);
      alert('下载失败：' + err.message);
    }
  }
  window.downloadAs = downloadAs;

  async function showResults(job) {
    const bucket = client.storage.from(cfg.BUCKET || 'poster-assets');
    const [png, psd] = await Promise.all([
      bucket.createSignedUrl(job.result_png_path, 1800),
      bucket.createSignedUrl(job.result_psd_path, 1800)
    ]);
    if (png.error) throw png.error;
    if (psd.error) throw psd.error;

    const baseName = safeDownloadName(job.payload?.meeting?.outputName || '系列会议海报');
    resultPreview.src = png.data.signedUrl;
    resultPreview.style.display = 'block';
    downloads.innerHTML = '';

    const pngBtn = document.createElement('button');
    pngBtn.type = 'button';
    pngBtn.textContent = '下载 PNG';
    pngBtn.addEventListener('click', () => downloadAs(png.data.signedUrl, `${baseName}.png`));
    const psdBtn = document.createElement('button');
    psdBtn.type = 'button';
    psdBtn.textContent = '下载 PSD';
    psdBtn.addEventListener('click', () => downloadAs(psd.data.signedUrl, `${baseName}.psd`));
    downloads.append(pngBtn, psdBtn);
  }

  async function loadHistory() {
    if (!client || !user || !historyList) return;
    historyList.innerHTML = '<div class="history-empty">正在加载…</div>';
    const { data, error } = await client.from('poster_jobs')
      .select('id,status,payload,created_at,finished_at,result_psd_path,result_png_path,error_message')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) {
      historyList.innerHTML = `<div class="history-empty">加载失败：${escapeHtml(error.message)}</div>`;
      return;
    }
    if (!data?.length) {
      historyList.innerHTML = '<div class="history-empty">暂无历史任务</div>';
      return;
    }
    historyList.innerHTML = '';
    data.forEach(job => historyList.appendChild(renderHistoryItem(job)));
  }

  function renderHistoryItem(job) {
    const item = document.createElement('div');
    item.className = 'history-item';
    const name = safeDownloadName(job.payload?.meeting?.outputName || '系列会议海报');
    const time = new Date(job.created_at).toLocaleString();
    item.innerHTML = `
      <div class="history-top">
        <div><div class="history-name">${escapeHtml(name)}</div><div class="history-time">${escapeHtml(time)}</div></div>
        <span class="history-status ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span>
      </div>
      <div class="history-actions"></div>`;
    const actions = item.querySelector('.history-actions');

    if (job.status === 'succeeded') {
      const open = document.createElement('button');
      open.type = 'button';
      open.textContent = '查看 / 下载';
      open.addEventListener('click', () => openHistoryJob(job.id));
      actions.appendChild(open);
    } else if (['pending', 'claimed', 'rendering', 'uploading'].includes(job.status)) {
      const follow = document.createElement('button');
      follow.type = 'button';
      follow.textContent = '继续查看状态';
      follow.addEventListener('click', () => openHistoryJob(job.id));
      actions.appendChild(follow);
    } else if (job.status === 'failed') {
      const failed = document.createElement('span');
      failed.className = 'tip bad';
      failed.textContent = job.error_message || '生成失败';
      actions.appendChild(failed);
    }
    return item;
  }

  async function openHistoryJob(id) {
    const { data, error } = await client.from('poster_jobs').select('*').eq('id', id).single();
    if (error) { alert(`读取任务失败：${error.message}`); return; }
    saveActiveJob(data.id);
    await presentJob(data, true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.openHistoryJob = openHistoryJob;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
  }

  refreshHistoryBtn?.addEventListener('click', loadHistory);
  buildPeople();
  buildSchedule();
  init().catch(err => {
    console.error(err);
    cloudState.textContent = '连接失败';
    cloudState.className = 'badge bad';
    log(err.message);
  });
})();
