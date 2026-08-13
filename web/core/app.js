(() => {
  'use strict';

  const cfg = window.POSTER_CONFIG || {};
  const supabaseLib = window.supabase;
  const project = window.POSTER_PROJECT;
  const validation = window.PosterValidation;
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

  const ACTIVE_JOB_KEY = 'meetingPosterActiveJobV1';
  const AVATAR_OUTPUT_SIZE = validation?.AVATAR_OUTPUT_SIZE || 1024;
  const peopleDef = [['chair', '会议主席'], ['speaker1', '讲者一'], ['speaker2', '讲者二']];
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

  function log(message) {
    if (!debugEl) return;
    debugEl.textContent += `${new Date().toLocaleTimeString()} ${message}\n`;
    debugEl.scrollTop = debugEl.scrollHeight;
  }

  function val(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function safeDownloadName(name) {
    return (String(name || '系列会议海报').trim() || '系列会议海报').replace(/[\\/:*?"<>|]/g, '_');
  }

  function readLocalStorage(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function writeLocalStorage(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }

  function removeLocalStorage(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }

  function stopPolling() {
    pollGeneration += 1;
    if (pollState?.timer) clearTimeout(pollState.timer);
    if (pollState) pollState.cancelled = true;
    pollState = null;
  }

  function saveActiveJob(id) {
    const next = id || null;
    if (next !== activeJob) {
      activeJob = next;
      stopPolling();
    }
    if (activeJob) writeLocalStorage(ACTIVE_JOB_KEY, activeJob);
    else removeLocalStorage(ACTIVE_JOB_KEY);
  }

  function refreshSubmitAvailability() {
    submitBtn.disabled = submitBusy || window.posterTimeControlsState?.ready !== true;
  }

  function setSubmitBusy(value) {
    submitBusy = Boolean(value);
    refreshSubmitAvailability();
  }

  function buildPeople() {
    const root = document.getElementById('people');
    root.innerHTML = '';
    for (const [key, label] of peopleDef) {
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
            <label>姓名<input id="${key}-name" maxlength="40" required></label>
            <label style="margin-top:10px">医院<input id="${key}-hospital" maxlength="120" required></label>
          </div>
        </div>`;
      root.appendChild(wrap);
      document.getElementById(`${key}-file`).addEventListener('change', event => onAvatarFile(key, label, event.target));
    }
  }

  function onAvatarFile(key, label, input) {
    const file = input.files?.[0];
    if (!file) return;
    const error = validation?.validateImageFile(file, `${label}头像`);
    if (error) {
      input.value = '';
      document.dispatchEvent(new CustomEvent('avatar-image-reset', { detail: { key } }));
      alert(error);
      return;
    }
    const state = peopleState[key];
    state.file = file;
    state.baked = input.dataset.avatarCropApplied === '1' || input.dataset.restoringDraft === '1';
    if (state.url) URL.revokeObjectURL(state.url);
    state.url = URL.createObjectURL(file);
    const image = document.getElementById(`${key}-img`);
    if (image) image.src = state.url;
  }

  function clearAvatar(key) {
    const state = peopleState[key];
    if (!state) return;
    if (state.url) URL.revokeObjectURL(state.url);
    state.file = null;
    state.url = '';
    state.baked = false;
    document.getElementById(`${key}-img`)?.removeAttribute('src');
  }

  function buildSchedule() {
    const root = document.getElementById('schedule');
    root.innerHTML = '';
    for (let index = 0; index < 4; index += 1) {
      const row = document.createElement('div');
      row.className = 'schedule-row';
      row.innerHTML = `<input id="s-time-${index}" maxlength="32" placeholder="时间"><input id="s-content-${index}" maxlength="200" placeholder="日程内容"><input id="s-speaker-${index}" maxlength="80" placeholder="讲者"><input id="s-chair-${index}" maxlength="80" placeholder="主席">`;
      root.appendChild(row);
    }
  }

  function collectMeeting() {
    const schedule = [];
    for (let index = 0; index < 4; index += 1) {
      schedule.push({
        time: val(`s-time-${index}`),
        content: val(`s-content-${index}`),
        speaker: index === 0 ? '' : val(`s-speaker-${index}`),
        chair: val(`s-chair-${index}`),
      });
    }
    return {
      meetingTime: val('meetingTime'),
      meetingLocation: '线上',
      chair: { name: val('chair-name'), title: '教授', hospital: val('chair-hospital') },
      speakers: [
        { name: val('speaker1-name'), title: '教授', hospital: val('speaker1-hospital') },
        { name: val('speaker2-name'), title: '教授', hospital: val('speaker2-hospital') },
      ],
      schedule,
      outputName: val('outputName') || '系列会议海报',
    };
  }

  async function init() {
    if (!supabaseLib?.createClient || !validation || !project?.buildRenderContract) throw new Error('页面核心组件加载失败，请刷新后重试');
    if (!cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('YOUR_PROJECT') || !cfg.SUPABASE_PUBLISHABLE_KEY || cfg.SUPABASE_PUBLISHABLE_KEY.includes('YOUR_')) {
      cloudState.textContent = '请先配置 config.js';
      cloudState.className = 'badge bad';
      return;
    }
    client = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY);
    window.POSTER_APP_CLIENT = client;
    const sessionResult = await client.auth.getSession();
    if (sessionResult.error) throw sessionResult.error;
    let session = sessionResult.data.session;
    if (!session) {
      const signIn = await client.auth.signInAnonymously();
      if (signIn.error) throw signIn.error;
      session = signIn.data.session;
    }
    user = session.user;
    cloudState.textContent = '云端已连接';
    cloudState.className = 'badge';
    await loadHistory();
    await restoreActiveJob();
  }

  async function uploadFile(path, file) {
    const { error } = await client.storage.from(cfg.BUCKET || 'poster-assets').upload(path, file, {
      contentType: String(file.type || '').toLowerCase(),
      upsert: false,
    });
    if (error) throw error;
  }

  async function cleanupUploads(paths) {
    if (!paths.length) return;
    try { await client.storage.from(cfg.BUCKET || 'poster-assets').remove(paths); } catch (_) {}
  }

  document.getElementById('posterForm').addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !user) return alert('Supabase 尚未连接');
    const uploaded = [];
    let jobCreated = false;
    let jobId = null;
    try {
      if (window.posterTimeControlsState?.ready !== true) throw new Error(window.posterTimeControlsState?.reason || '时间组件尚未就绪');
      setSubmitBusy(true);
      downloads.innerHTML = '';
      resultPreview.style.display = 'none';

      const files = {};
      for (const [key, label] of peopleDef) {
        const state = peopleState[key];
        if (!state.file) throw new Error(`请上传${label}头像`);
        if (!state.baked || state.file.type !== 'image/png') throw new Error(`${label}头像必须先应用裁剪为 PNG`);
        const error = validation.validateImageFile(state.file, `${label}头像`);
        if (error) throw new Error(error);
        files[key] = state.file;
      }
      const qr = document.getElementById('qrFile').files?.[0];
      if (!qr) throw new Error('请上传二维码');
      const qrError = validation.validateImageFile(qr, '二维码');
      if (qrError) throw new Error(qrError);

      const meeting = collectMeeting();
      const meetingErrors = validation.validateMeeting(meeting);
      if (meetingErrors.length) throw new Error(meetingErrors[0]);

      jobId = validation.createUuid(window.crypto);
      const base = `${user.id}/${jobId}/input`;
      const assets = {};
      for (const [key] of peopleDef) {
        const path = `${base}/${key}.png`;
        assets[key] = {
          storagePath: path,
          crop: { zoom: 1, offsetX: 0, offsetY: 0 },
          cropMode: 'baked',
          outputSize: AVATAR_OUTPUT_SIZE,
          originalName: String(files[key].name || ''),
        };
      }
      const qrPath = `${base}/qr.${validation.imageExtension(qr.type)}`;
      assets.qrCode = { storagePath: qrPath, originalName: String(qr.name || '') };
      const contract = project.buildRenderContract();
      const payload = { meeting, assets, protocolVersion: contract.protocolVersion, project: contract.project };
      const payloadErrors = validation.validatePayload(payload);
      if (payloadErrors.length) throw new Error(payloadErrors[0]);

      setStatus('正在上传素材…', 'uploading');
      for (const [key] of peopleDef) {
        await uploadFile(assets[key].storagePath, files[key]);
        uploaded.push(assets[key].storagePath);
      }
      await uploadFile(qrPath, qr);
      uploaded.push(qrPath);

      const { error } = await client.from('poster_jobs').insert({ id: jobId, owner_id: user.id, payload });
      if (error) throw error;
      jobCreated = true;
      saveActiveJob(jobId);
      setStatus('任务已提交，等待 Node Renderer 接单…', 'pending');
      await loadHistory();
      startPolling();
    } catch (error) {
      console.error(error);
      if (!jobCreated) {
        await cleanupUploads(uploaded);
        setStatus(`提交失败：${error.message || error}`, 'failed');
        setSubmitBusy(false);
      } else {
        saveActiveJob(jobId);
        setStatus('任务已提交，正在恢复状态跟踪…', 'pending');
        startPolling();
      }
    }
  });

  function setStatus(text, status) {
    jobStatus.textContent = text;
    jobStatus.className = `status-box ${status === 'succeeded' ? 'ok' : ['failed', 'cancelled'].includes(status) ? 'bad' : ''}`;
    progressSteps.textContent = ({
      pending: '① 已提交 → 等待渲染器',
      claimed: '② Renderer 已接单',
      rendering: '③ 正在生成 PNG',
      uploading: '④ 正在上传 PNG',
      succeeded: '⑤ 已完成',
      failed: '生成失败',
      cancelled: '已取消',
    })[status] || '';
  }

  function statusLabel(status) {
    return ({ pending: '排队中', claimed: '已接单', rendering: '生成中', uploading: '上传中', succeeded: '已完成', failed: '失败', cancelled: '已取消' })[status] || status;
  }

  async function restoreActiveJob() {
    let id = readLocalStorage(ACTIVE_JOB_KEY);
    if (!id) {
      const { data } = await client.from('poster_jobs').select('id').in('status', ['pending', 'claimed', 'rendering', 'uploading']).order('created_at', { ascending: false }).limit(1).maybeSingle();
      id = data?.id || null;
    }
    if (!id) return;
    const { data, error } = await client.from('poster_jobs').select('*').eq('id', id).maybeSingle();
    if (error || !data) return removeLocalStorage(ACTIVE_JOB_KEY);
    saveActiveJob(data.id);
    await presentJob(data);
  }

  function startPolling() {
    if (!client || !activeJob) return;
    stopPolling();
    const state = { cancelled: false, generation: pollGeneration, jobId: activeJob, timer: null };
    pollState = state;
    const tick = async () => {
      if (!isCurrentPoll(state)) return;
      try {
        const { data, error } = await client.from('poster_jobs').select('*').eq('id', state.jobId).single();
        if (!error && data && isCurrentPoll(state)) await presentJob(data);
      } catch (error) { log(error.message || error); }
      if (isCurrentPoll(state)) state.timer = setTimeout(tick, 2000);
    };
    void tick();
  }

  function isCurrentPoll(state) {
    return pollState === state && !state.cancelled && state.generation === pollGeneration && state.jobId === activeJob;
  }

  async function presentJob(job) {
    const label = {
      pending: '等待 Node Renderer 接单…',
      claimed: 'Node Renderer 已接单…',
      rendering: '正在生成正式 PNG…',
      uploading: '正在上传 PNG…',
      succeeded: '生成完成',
      failed: `生成失败：${job.error_message || '未知错误'}`,
      cancelled: '任务已取消',
    };
    setStatus(label[job.status] || job.status, job.status);
    if (['pending', 'claimed', 'rendering', 'uploading'].includes(job.status)) {
      setSubmitBusy(true);
      if (!pollState || pollState.jobId !== job.id) startPolling();
      return;
    }
    saveActiveJob(null);
    setSubmitBusy(false);
    if (job.status === 'succeeded') await showResults(job);
    await loadHistory();
  }

  async function signedPng(job) {
    if (!job.result_png_path) throw new Error('任务没有 PNG 结果');
    const result = await client.storage.from(cfg.BUCKET || 'poster-assets').createSignedUrl(job.result_png_path, 1800);
    if (result.error) throw result.error;
    return result.data.signedUrl;
  }

  async function downloadAs(url, filename) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const objectUrl = URL.createObjectURL(await response.blob());
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 10000);
  }
  window.downloadAs = downloadAs;

  async function showResults(job) {
    const url = await signedPng(job);
    const baseName = safeDownloadName(job.payload?.meeting?.outputName || '系列会议海报');
    resultPreview.src = url;
    resultPreview.style.display = 'block';
    downloads.innerHTML = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '下载 PNG';
    button.addEventListener('click', () => downloadAs(url, `${baseName}.png`).catch(error => alert(`下载失败：${error.message}`)));
    downloads.append(button);
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  }

  async function loadHistory() {
    if (!client || !historyList) return;
    historyList.innerHTML = '<div class="history-empty">正在加载…</div>';
    const { data, error } = await client.from('poster_jobs')
      .select('id,status,payload,created_at,finished_at,result_png_path,error_message')
      .order('created_at', { ascending: false }).limit(20);
    if (error) {
      historyList.innerHTML = `<div class="history-empty">加载失败：${escapeHtml(error.message)}</div>`;
      return;
    }
    if (!data?.length) {
      historyList.innerHTML = '<div class="history-empty">暂无历史任务</div>';
      return;
    }
    historyList.innerHTML = '';
    for (const job of data) {
      const item = document.createElement('div');
      item.className = 'history-item';
      item.innerHTML = `<div class="history-top"><div><div class="history-name">${escapeHtml(job.payload?.meeting?.outputName || '系列会议海报')}</div><div class="history-time">${escapeHtml(new Date(job.created_at).toLocaleString())}</div></div><span class="history-status ${escapeHtml(job.status)}">${escapeHtml(statusLabel(job.status))}</span></div><div class="history-actions"></div>`;
      const actions = item.querySelector('.history-actions');
      if (job.status === 'succeeded' || ['pending', 'claimed', 'rendering', 'uploading'].includes(job.status)) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = job.status === 'succeeded' ? '查看 / 下载' : '继续查看状态';
        button.addEventListener('click', () => openHistoryJob(job.id));
        actions.appendChild(button);
      } else if (job.status === 'failed') {
        const text = document.createElement('span');
        text.className = 'tip bad';
        text.textContent = job.error_message || '生成失败';
        actions.appendChild(text);
      }
      historyList.appendChild(item);
    }
  }

  async function openHistoryJob(id) {
    const { data, error } = await client.from('poster_jobs').select('*').eq('id', id).single();
    if (error) return alert(`读取任务失败：${error.message}`);
    saveActiveJob(data.id);
    await presentJob(data);
  }
  window.openHistoryJob = openHistoryJob;

  async function clearLocalData() {
    if (!window.confirm('清除本机草稿、素材和匿名历史身份？云端已生成任务不会删除。')) return;
    clearLocalDataBtn.disabled = true;
    stopPolling();
    try { await client?.auth?.signOut({ scope: 'local' }); } catch (_) {}
    try { await window.posterDraft?.clearAll?.(); } catch (_) {}
    try { localStorage.clear(); } catch (_) {}
    try { sessionStorage.clear(); } catch (_) {}
    window.location.reload();
  }

  document.addEventListener('avatar-image-reset', event => clearAvatar(event.detail?.key));
  document.addEventListener('avatar-crop-applied', event => {
    const state = peopleState[event.detail?.key];
    if (!state) return;
    if (event.detail?.file) state.file = event.detail.file;
    state.baked = true;
  });

  document.getElementById('qrFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    const image = document.getElementById('qrPreview');
    if (!file) return;
    const error = validation?.validateImageFile(file, '二维码');
    if (error) {
      event.target.value = '';
      return alert(error);
    }
    if (qrPreviewUrl) URL.revokeObjectURL(qrPreviewUrl);
    qrPreviewUrl = URL.createObjectURL(file);
    image.src = qrPreviewUrl;
    image.style.display = 'block';
  });

  refreshHistoryBtn?.addEventListener('click', loadHistory);
  clearLocalDataBtn?.addEventListener('click', clearLocalData);
  document.addEventListener('poster-time-controls-state', refreshSubmitAvailability);
  buildPeople();
  buildSchedule();
  refreshSubmitAvailability();
  init().catch(error => {
    console.error(error);
    cloudState.textContent = '连接失败';
    cloudState.className = 'badge bad';
    log(error.message || error);
  });
})();
