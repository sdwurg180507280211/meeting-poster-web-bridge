(() => {
  'use strict';

  const cfg = window.POSTER_CONFIG || {};
  const supabaseLib = window.supabase;
  const project = window.POSTER_PROJECT;
  const debugEl = document.getElementById('debug');
  const cloudState = document.getElementById('cloudState');
  const jobStatus = document.getElementById('jobStatus');
  const submitBtn = document.getElementById('submitBtn');
  const resultPreview = document.getElementById('resultPreview');
  const downloads = document.getElementById('downloads');
  const progressSteps = document.getElementById('progressSteps');
  const historyList = document.getElementById('historyList');
  const refreshHistoryBtn = document.getElementById('refreshHistory');
  const clearLocalDataBtn = document.getElementById('clearLocalData');
  const validation = window.PosterValidation;

  const ACTIVE_JOB_KEY = 'meetingPosterActiveJobV1';
  const AVATAR_OUTPUT_SIZE = validation?.AVATAR_OUTPUT_SIZE || 1024;
  const peopleDef = [['chair','会议主席'], ['speaker1','讲者一'], ['speaker2','讲者二']];
  const peopleState = {};
  let qrPreviewUrl = '';
  let client = null;
  let user = null;
  let activeJob = null;
  let pollState = null;
  let pollGeneration = 0;
  let submitBusy = false;

  window.posterTimeControlsState = window.posterTimeControlsState || {
    ready: false,
    failed: false,
    reason: '时间选择组件正在加载',
  };

  function log(msg) {
    debugEl.textContent += `${new Date().toLocaleTimeString()} ${msg}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }
  function uuid() {
    if (!validation) throw new Error('页面校验组件未加载，请刷新后重试');
    return validation.createUuid(window.crypto);
  }
  function val(id) { return document.getElementById(id).value.trim(); }
  // 姓名未填时职称/医院不随行显示，避免“教授”残留（fixed-defaults 将职称固定为“教授”）。
  function person(name, title, hospital) {
    return { name, title: name ? title : '', hospital: name ? hospital : '' };
  }
  function safeDownloadName(name) {
    return (String(name || '系列会议海报').trim() || '系列会议海报').replace(/[\\/:*?"<>|]/g, '_');
  }
  function readLocalStorage(key) {
    try { return localStorage.getItem(key); }
    catch (err) { log(`无法读取本机状态：${err.message}`); return null; }
  }
  function writeLocalStorage(key, value) {
    try { localStorage.setItem(key, value); }
    catch (err) { log(`无法保存本机状态：${err.message}`); }
  }
  function removeLocalStorage(key) {
    try { localStorage.removeItem(key); }
    catch (err) { log(`无法清除本机状态：${err.message}`); }
  }
  function saveActiveJob(id) {
    const nextJob = id || null;
    if (nextJob !== activeJob) {
      activeJob = nextJob;
      stopPolling();
    }
    if (activeJob) writeLocalStorage(ACTIVE_JOB_KEY, activeJob);
    else removeLocalStorage(ACTIVE_JOB_KEY);
  }
  function stopPolling() {
    pollGeneration += 1;
    if (pollState?.timer) clearTimeout(pollState.timer);
    if (pollState) pollState.cancelled = true;
    pollState = null;
  }
  function setSubmitBusy(busy) {
    submitBusy = Boolean(busy);
    refreshSubmitAvailability();
  }
  function refreshSubmitAvailability() {
    const timeReady = window.posterTimeControlsState?.ready === true;
    submitBtn.disabled = submitBusy || !timeReady;
  }

  function buildPeople() {
    const root = document.getElementById('people');
    root.innerHTML = '';
    peopleDef.forEach(([key, label]) => {
      peopleState[key] = { file: null, url: '', baked: false };
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
              <label>姓名<input id="${key}-name" maxlength="40" required></label>
              <label>职称（可选）<input id="${key}-title" maxlength="40"></label>
            </div>
            <label style="margin-top:10px">医院<input id="${key}-hospital" maxlength="120" required></label>
          </div>
        </div>`;
      root.appendChild(wrap);
      document.getElementById(`${key}-file`).addEventListener('change', event => onAvatarFile(key, label, event.target));
    });
  }

  function onAvatarFile(key, label, input) {
    const file = input.files?.[0];
    if (!file) return;
    const fileError = validation?.validateImageFile(file, `${label}头像`);
    if (fileError) {
      input.value = '';
      document.dispatchEvent(new CustomEvent('avatar-image-reset', { detail: { key } }));
      alert(fileError);
      return;
    }

    const state = peopleState[key];
    state.file = file;
    state.baked = input.dataset.avatarCropApplied === '1' || input.dataset.restoringDraft === '1';
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    const img = document.getElementById(`${key}-img`);
    if (img) img.src = state.url;
  }

  function clearAvatar(key) {
    const state = peopleState[key];
    if (!state) return;
    if (state.url) URL.revokeObjectURL(state.url);
    state.file = null;
    state.url = '';
    state.baked = false;
    const img = document.getElementById(`${key}-img`);
    if (img) {
      img.onload = null;
      img.removeAttribute('src');
      img.style.width = '';
      img.style.height = '';
      img.style.left = '';
      img.style.top = '';
    }
  }

  document.addEventListener('avatar-image-reset', event => {
    const key = event.detail?.key;
    if (key) clearAvatar(key);
  });

  document.addEventListener('avatar-crop-applied', event => {
    const key = event.detail?.key;
    const state = key ? peopleState[key] : null;
    if (!state) return;
    if (event.detail?.file) state.file = event.detail.file;
    state.baked = true;
  });

  function buildSchedule() {
    const root = document.getElementById('schedule');
    root.innerHTML = '';
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.className = 'schedule-row';
      row.innerHTML = `<input id="s-time-${i}" maxlength="32" placeholder="时间"><input id="s-content-${i}" maxlength="200" placeholder="日程内容"><input id="s-speaker-${i}" maxlength="80" placeholder="讲者"><input id="s-chair-${i}" maxlength="80" placeholder="主席">`;
      root.appendChild(row);
    }
  }

  document.getElementById('qrFile').addEventListener('change', event => {
    const file = event.target.files[0];
    const img = document.getElementById('qrPreview');
    if (!file) { img.style.display = 'none'; return; }
    const fileError = validation?.validateImageFile(file, '二维码');
    if (fileError) {
      event.target.value = '';
      if (qrPreviewUrl) URL.revokeObjectURL(qrPreviewUrl);
      qrPreviewUrl = '';
      img.removeAttribute('src');
      img.style.display = 'none';
      document.dispatchEvent(new CustomEvent('qr-image-reset'));
      alert(fileError);
      return;
    }
    if (qrPreviewUrl) URL.revokeObjectURL(qrPreviewUrl);
    qrPreviewUrl = URL.createObjectURL(file);
    img.src = qrPreviewUrl;
    img.style.display = 'block';
  });

  async function init() {
    if (!supabaseLib?.createClient) throw new Error('云端连接组件加载失败，请刷新页面重试');
    if (!validation) throw new Error('页面校验组件加载失败，请刷新页面重试');
    if (!project?.buildRenderContract) throw new Error('项目渲染协议组件未加载，请刷新页面重试');
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR_PROJECT') || !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
      cloudState.textContent = '请先配置 config.js';
      cloudState.className = 'badge bad';
      return;
    }
    client = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    window.POSTER_APP_CLIENT = client;
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    let { session } = sessionResult.data;
    if (!session) {
      const result = await client.auth.signInAnonymously();
      if (result.error) throw result.error;
      session = result.data.session;
    }
    user = session.user;
    cloudState.textContent = '云端已连接';
    cloudState.className = 'badge';
    log(`anonymous user ${user.id}`);

    await loadHistory();
    await restoreActiveJob();
  }

  async function restoreActiveJob() {
    let stored = readLocalStorage(ACTIVE_JOB_KEY);
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
      removeLocalStorage(ACTIVE_JOB_KEY);
      return;
    }
    saveActiveJob(data.id);
    log(`恢复任务 ${data.id} (${data.status})`);
    await presentJob(data);
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
      chair: person(val('chair-name'), val('chair-title'), val('chair-hospital')),
      speakers: [
        person(val('speaker1-name'), val('speaker1-title'), val('speaker1-hospital')),
        person(val('speaker2-name'), val('speaker2-title'), val('speaker2-hospital'))
      ],
      schedule,
      outputName: document.getElementById('outputName').value.trim() || '系列会议海报'
    };
  }

  async function uploadFile(path, file) {
    const { error } = await client.storage.from(cfg.BUCKET || 'poster-assets').upload(path, file, {
      contentType: String(file.type || '').toLowerCase(),
      upsert: false
    });
    if (error) throw error;
  }

  async function cleanupUploads(paths) {
    if (!paths.length) return;
    try {
      const { error } = await client.storage.from(cfg.BUCKET || 'poster-assets').remove(paths);
      if (error) throw error;
      log(`已清理 ${paths.length} 个未关联素材`);
    } catch (err) {
      console.error('清理未关联素材失败', err);
      log(`未关联素材清理失败：${err.message || err}`);
    }
  }

  document.getElementById('posterForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !user) { alert('Supabase 尚未连接'); return; }
    const uploadedPaths = [];
    let jobCreated = false;
    let jobId = null;
    try {
      if (window.posterTimeControlsState?.ready !== true) {
        throw new Error(window.posterTimeControlsState?.reason || '时间选择组件尚未就绪，请刷新页面重试');
      }
      setSubmitBusy(true);
      downloads.innerHTML = '';
      resultPreview.style.display = 'none';

      const qr = document.getElementById('qrFile').files[0];
      const files = {};
      for (const [key, label] of peopleDef) {
        const state = peopleState[key];
        const file = state.file;
        if (!file) throw new Error(`请上传${label}头像`);
        if (!state.baked) throw new Error(`${label}头像必须先点击“应用裁剪”`);
        const fileError = validation.validateImageFile(file, `${label}头像`);
        if (fileError) throw new Error(fileError);
        if (file.type !== 'image/png') throw new Error(`${label}应用裁剪后必须为 PNG`);
        files[key] = file;
      }
      if (!qr) throw new Error('请上传二维码');
      const qrError = validation.validateImageFile(qr, '二维码');
      if (qrError) throw new Error(qrError);

      const meeting = collectMeeting();
      const meetingErrors = validation.validateMeeting(meeting);
      if (meetingErrors.length) throw new Error(meetingErrors[0]);

      jobId = uuid();
      const base = `${user.id}/${jobId}/input`;
      const assets = {};
      for (const [key] of peopleDef) {
        const file = files[key];
        const path = `${base}/${key}.png`;
        assets[key] = {
          storagePath: path,
          crop: { zoom: 1, offsetX: 0, offsetY: 0 },
          cropMode: 'baked',
          outputSize: AVATAR_OUTPUT_SIZE,
          originalName: String(file.name || ''),
        };
      }
      const qrPath = `${base}/qr.${validation.imageExtension(qr.type)}`;
      assets.qrCode = { storagePath: qrPath, originalName: String(qr.name || '') };

      const contract = project.buildRenderContract();
      const payload = {
        meeting,
        assets,
        protocolVersion: contract.protocolVersion,
        project: contract.project,
      };
      const payloadErrors = validation.validatePayload(payload);
      if (payloadErrors.length) throw new Error(payloadErrors[0]);

      setStatus('正在上传素材…', 'uploading');
      for (const [key] of peopleDef) {
        await uploadFile(assets[key].storagePath, files[key]);
        uploadedPaths.push(assets[key].storagePath);
      }
      await uploadFile(qrPath, qr);
      uploadedPaths.push(qrPath);

      const { error } = await client.from('poster_jobs').insert({ id: jobId, owner_id: user.id, payload });
      if (error) throw error;
      jobCreated = true;

      saveActiveJob(jobId);
      setStatus('任务已提交，等待你的 Mac Photoshop 接单…', 'pending');
      log(`job ${jobId} created`);
      await loadHistory();
      startPolling();
    } catch (err) {
      console.error(err);
      if (!jobCreated) {
        await cleanupUploads(uploadedPaths);
        setStatus(`提交失败：${err.message || err}`, 'failed');
        setSubmitBusy(false);
        return;
      }
      saveActiveJob(jobId);
      setStatus('任务已提交，正在恢复状态跟踪…', 'pending');
      log(`任务已创建，但提交后的页面刷新失败：${err.message || err}`);
      setSubmitBusy(true);
      startPolling();
    }
  });

  function setStatus(text, status) {
    jobStatus.textContent = text;
    jobStatus.className = `status-box ${status === 'succeeded' ? 'ok' : ['failed', 'cancelled'].includes(status) ? 'bad' : ''}`;
    const map = {
      pending: '① 已提交 → 等待 Mac',
      claimed: '② Mac Agent 已接单',
      rendering: '③ Photoshop 正在生成',
      uploading: '④ 正在上传结果',
      succeeded: '⑤ 已完成',
      failed: '生成失败',
      cancelled: '已取消',
    };
    progressSteps.textContent = map[status] || '';
  }

  function statusLabel(status) {
    return ({ pending: '等待接单', claimed: '已接单', rendering: '生成中', uploading: '上传中', succeeded: '已完成', failed: '失败', cancelled: '已取消' })[status] || status;
  }

  function startPolling() {
    if (!client || !activeJob) return;
    if (pollState && !pollState.cancelled && pollState.jobId === activeJob) return;
    stopPolling();
    const state = {
      cancelled: false,
      generation: pollGeneration,
      jobId: activeJob,
      timer: null,
    };
    pollState = state;

    const tick = async () => {
      if (!isCurrentPoll(state)) return;
      try {
        await pollJob(state);
      } catch (err) {
        console.error(err);
        if (isCurrentPoll(state)) log(`poll error ${err.message || err}`);
      }
      if (isCurrentPoll(state)) state.timer = setTimeout(tick, 2000);
    };
    void tick();
  }

  function isCurrentPoll(state) {
    return pollState === state
      && !state.cancelled
      && state.generation === pollGeneration
      && state.jobId === activeJob;
  }

  async function pollJob(state) {
    const { data, error } = await client.from('poster_jobs').select('*').eq('id', state.jobId).single();
    if (!isCurrentPoll(state)) return;
    if (error) { log(`poll error ${error.message}`); return; }
    if (!data || data.id !== state.jobId) return;
    await presentJob(data);
  }

  async function presentJob(data) {
    const label = {
      pending: '等待 Mac Photoshop 接单…',
      claimed: 'Mac Agent 已接单，正在准备素材…',
      rendering: 'Photoshop 正在生成正式海报…',
      uploading: 'Photoshop 已完成，正在上传结果…',
      succeeded: '生成完成',
      failed: `生成失败：${data.error_message || '未知错误'}`,
      cancelled: '任务已取消',
    };
    setStatus(label[data.status] || data.status, data.status);

    if (['pending', 'claimed', 'rendering', 'uploading'].includes(data.status)) {
      setSubmitBusy(true);
      if (!pollState || pollState.jobId !== data.id) startPolling();
      return;
    }

    saveActiveJob(null);
    setSubmitBusy(false);
    if (data.status === 'succeeded') {
      try { await showResults(data); }
      catch (err) {
        console.error(err);
        log(`结果链接加载失败：${err.message || err}`);
        setStatus('海报已生成，但结果链接暂时加载失败，请从历史任务重试', 'succeeded');
      }
    }
    await loadHistory();
  }

  async function downloadAs(url, filename) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const link = document.createElement('a');
      const objectUrl = URL.createObjectURL(blob);
      link.href = objectUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
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
    await presentJob(data);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  window.openHistoryJob = openHistoryJob;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[ch]);
  }

  async function clearLocalData() {
    const firstConfirmed = window.confirm('这会清除本机保存的文字草稿、头像、二维码和当前匿名会话。旧任务将不再显示。是否继续？');
    if (!firstConfirmed) return;
    const finalConfirmed = window.confirm('请再次确认：清除后无法在此浏览器恢复这些草稿和匿名历史身份。');
    if (!finalConfirmed) return;

    clearLocalDataBtn.disabled = true;
    setSubmitBusy(true);
    stopPolling();
    let signOutError = null;
    const localErrors = [];

    if (client) {
      try {
        const { error } = await client.auth.signOut({ scope: 'local' });
        if (error) throw error;
      } catch (err) {
        signOutError = err;
        console.error('匿名会话退出失败', err);
      }
    }

    try {
      if (!window.posterDraft?.clearAll) throw new Error('本地草稿清理组件未加载');
      await window.posterDraft.clearAll();
    } catch (err) {
      localErrors.push(err);
      console.error('IndexedDB 草稿清理失败', err);
    }

    try { localStorage.clear(); }
    catch (err) { localErrors.push(err); console.error('localStorage 清理失败', err); }
    try { sessionStorage.clear(); }
    catch (err) { console.warn('sessionStorage 清理失败', err); }

    if (localErrors.length) {
      alert(`部分本机数据未能清除：${localErrors.map(err => err.message || err).join('；')}。请检查浏览器隐私设置后重试。`);
      user = null;
      cloudState.textContent = '本机数据清理未完成';
      cloudState.className = 'badge bad';
      clearLocalDataBtn.disabled = false;
      setSubmitBusy(true);
      return;
    }

    const message = signOutError
      ? '本机草稿和历史身份已清除。云端退出请求失败，但旧身份已从此浏览器移除；页面将重新载入。'
      : '本机草稿、素材和匿名历史身份已清除。页面将使用全新的匿名身份重新载入。';
    alert(message);
    window.location.reload();
  }

  refreshHistoryBtn?.addEventListener('click', loadHistory);
  clearLocalDataBtn?.addEventListener('click', clearLocalData);
  document.addEventListener('poster-time-controls-state', refreshSubmitAvailability);
  buildPeople();
  buildSchedule();
  refreshSubmitAvailability();
  init().catch(err => {
    console.error(err);
    cloudState.textContent = '连接失败';
    cloudState.className = 'badge bad';
    log(err.message);
  });
})();
