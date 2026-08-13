(() => {
  'use strict';

  const cfg = window.POSTER_CONFIG || {};
  const supabaseLib = window.supabase;
  const project = window.POSTER_PROJECT;
  const cloudState = document.getElementById('cloudState');
  const jobStatus = document.getElementById('jobStatus');
  const progressSteps = document.getElementById('progressSteps');
  const submitBtn = document.getElementById('submitBtn');
  const downloadResultBtn = document.getElementById('downloadResult');
  const cancelActiveJobBtn = document.getElementById('cancelActiveJob');
  const clearLocalDataBtn = document.getElementById('clearLocalData');
  const form = document.getElementById('posterForm');
  const validation = window.PosterValidation;

  const ACTIVE_JOB_KEY = 'meetingPosterActiveJobV1';
  const AUTO_DOWNLOAD_JOB_KEY = 'meetingPosterAutoDownloadJobV1';
  const AVATAR_OUTPUT_SIZE = validation?.AVATAR_OUTPUT_SIZE || 1024;
  const peopleDef = [['chair','会议主席'], ['speaker1','讲者一'], ['speaker2','讲者二']];
  const peopleState = {};
  let qrPreviewUrl = '';
  let client = null;
  let user = null;
  let activeJob = null;
  let activeJobStatus = null;
  let pollState = null;
  let pollGeneration = 0;
  let submitBusy = false;
  let lastCompletedJob = null;
  let lastDownload = null;

  window.posterTimeControlsState = {
    ready: true,
    failed: false,
    reason: '会议时间与日程时间直接在海报内双击编辑',
  };

  function log(message) {
    console.info(`[poster] ${message}`);
  }

  function uuid() {
    if (!validation) throw new Error('页面校验组件未加载，请刷新后重试');
    return validation.createUuid(window.crypto);
  }

  function val(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function safeDownloadName(name) {
    return (String(name || '系列会议海报').trim() || '系列会议海报').replace(/[\\/:*?"<>|]/g, '_');
  }

  function deriveOutputName() {
    const projectName = project?.name || window.POSTER_RUNTIME?.projectName || '系列会议海报';
    const meetingTime = val('meetingTime');
    const match = meetingTime.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    const date = match
      ? `${match[1]}${String(match[2]).padStart(2, '0')}${String(match[3]).padStart(2, '0')}`
      : '';
    return date ? `${projectName}_${date}` : projectName;
  }

  function readLocalStorage(key) {
    try { return localStorage.getItem(key); }
    catch (error) { log(`无法读取本机状态：${error.message}`); return null; }
  }

  function writeLocalStorage(key, value) {
    try { localStorage.setItem(key, value); }
    catch (error) { log(`无法保存本机状态：${error.message}`); }
  }

  function removeLocalStorage(key) {
    try { localStorage.removeItem(key); }
    catch (error) { log(`无法清除本机状态：${error.message}`); }
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

  function setSubmitBusy(busy) {
    submitBusy = Boolean(busy);
    submitBtn.disabled = submitBusy;
  }

  function setStatus(text, status, detail) {
    activeJobStatus = status || null;
    jobStatus.textContent = text;
    jobStatus.className = status === 'succeeded' ? 'ok' : ['failed', 'cancelled'].includes(status) ? 'bad' : '';
    progressSteps.textContent = detail || ({
      pending: '① 已提交 · 等待 Mac',
      claimed: '② Mac Agent 已接单',
      rendering: '③ Photoshop 正在生成',
      uploading: '④ 正在上传 PNG',
      succeeded: '✓ 已完成并自动下载',
      failed: '生成失败，请检查提示后重试',
      cancelled: '任务已取消',
    }[status] || '双击文字编辑 · 点击头像或二维码上传 · L 调整布局');
    cancelActiveJobBtn.hidden = !(status === 'pending' && activeJob);
  }

  function buildPeople() {
    const root = document.getElementById('people');
    root.innerHTML = '';
    peopleDef.forEach(([key, label]) => {
      peopleState[key] = { file: null, url: '', baked: false };
      const wrap = document.createElement('div');
      wrap.innerHTML = `
        <input id="${key}-file" type="file" accept="image/png,image/jpeg,image/webp">
        <img id="${key}-img" alt="${label}头像">
        <input id="${key}-name" maxlength="40">
        <input id="${key}-title" maxlength="40" value="教授">
        <input id="${key}-hospital" maxlength="120">`;
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
    if (img) img.removeAttribute('src');
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
      row.innerHTML = `<input id="s-time-${i}" maxlength="32"><input id="s-content-${i}" maxlength="200"><input id="s-speaker-${i}" maxlength="80"><input id="s-chair-${i}" maxlength="80">`;
      root.appendChild(row);
    }
  }

  document.getElementById('qrFile').addEventListener('change', event => {
    const file = event.target.files?.[0];
    const img = document.getElementById('qrPreview');
    if (!file) return;
    const fileError = validation?.validateImageFile(file, '二维码');
    if (fileError) {
      event.target.value = '';
      if (qrPreviewUrl) URL.revokeObjectURL(qrPreviewUrl);
      qrPreviewUrl = '';
      img?.removeAttribute('src');
      document.dispatchEvent(new CustomEvent('qr-image-reset'));
      alert(fileError);
      return;
    }
    if (qrPreviewUrl) URL.revokeObjectURL(qrPreviewUrl);
    qrPreviewUrl = URL.createObjectURL(file);
    if (img) img.src = qrPreviewUrl;
  });

  function collectMeeting() {
    const schedule = [];
    for (let i = 0; i < 4; i++) {
      schedule.push({
        time: val(`s-time-${i}`),
        content: val(`s-content-${i}`),
        speaker: val(`s-speaker-${i}`),
        chair: val(`s-chair-${i}`),
      });
    }
    const outputName = deriveOutputName();
    const outputInput = document.getElementById('outputName');
    if (outputInput) outputInput.value = outputName;
    return {
      meetingTime: val('meetingTime'),
      meetingLocation: val('meetingLocation'),
      chair: { name: val('chair-name'), title: val('chair-title'), hospital: val('chair-hospital') },
      speakers: [
        { name: val('speaker1-name'), title: val('speaker1-title'), hospital: val('speaker1-hospital') },
        { name: val('speaker2-name'), title: val('speaker2-title'), hospital: val('speaker2-hospital') },
      ],
      schedule,
      outputName,
    };
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
    try {
      const { error } = await client.storage.from(cfg.BUCKET || 'poster-assets').remove(paths);
      if (error) throw error;
    } catch (error) {
      console.error('清理未关联素材失败', error);
    }
  }

  async function init() {
    if (!supabaseLib?.createClient) throw new Error('云端连接组件加载失败，请刷新页面重试');
    if (!validation) throw new Error('页面校验组件未加载，请刷新后重试');
    if (!project?.buildRenderContract) throw new Error('项目渲染协议组件未加载，请刷新后重试');
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
    await presentJob(data);
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (!client || !user) {
      alert('Supabase 尚未连接');
      return;
    }

    const uploadedPaths = [];
    let jobCreated = false;
    let jobId = null;
    try {
      setSubmitBusy(true);
      downloadResultBtn.hidden = true;
      lastDownload = null;

      const qr = document.getElementById('qrFile').files?.[0];
      const files = {};
      for (const [key, label] of peopleDef) {
        const state = peopleState[key];
        const file = state.file;
        if (!file) throw new Error(`请点击海报中的${label}头像并上传图片`);
        if (!state.baked) throw new Error(`${label}头像必须先应用裁剪`);
        const fileError = validation.validateImageFile(file, `${label}头像`);
        if (fileError) throw new Error(fileError);
        if (file.type !== 'image/png') throw new Error(`${label}应用裁剪后必须为 PNG`);
        files[key] = file;
      }
      if (!qr) throw new Error('请点击海报中的二维码区域并上传图片');
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
      writeLocalStorage(AUTO_DOWNLOAD_JOB_KEY, jobId);
      saveActiveJob(jobId);
      setStatus('任务已提交，等待 Photoshop 接单…', 'pending');
      startPolling();
    } catch (error) {
      console.error(error);
      if (!jobCreated) {
        await cleanupUploads(uploadedPaths);
        setStatus(`提交失败：${error.message || error}`, 'failed');
        setSubmitBusy(false);
        return;
      }
      saveActiveJob(jobId);
      setStatus('任务已提交，正在恢复状态跟踪…', 'pending');
      setSubmitBusy(true);
      startPolling();
    }
  });

  function startPolling() {
    if (!client || !activeJob) return;
    if (pollState && !pollState.cancelled && pollState.jobId === activeJob) return;
    stopPolling();
    const state = { cancelled: false, generation: pollGeneration, jobId: activeJob, timer: null };
    pollState = state;

    const tick = async () => {
      if (!isCurrentPoll(state)) return;
      try { await pollJob(state); }
      catch (error) { console.error(error); }
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
    if (error || !data || data.id !== state.jobId) return;
    await presentJob(data);
  }

  async function presentJob(data) {
    const label = {
      pending: '等待 Photoshop 接单…',
      claimed: 'Mac Agent 已接单，正在准备素材…',
      rendering: 'Photoshop 正在生成正式海报…',
      uploading: 'Photoshop 已完成，正在上传 PNG…',
      succeeded: '海报已生成',
      failed: `生成失败：${data.error_message || '未知错误'}`,
      cancelled: '任务已取消',
    };
    setStatus(label[data.status] || data.status, data.status);

    if (['pending', 'claimed', 'rendering', 'uploading'].includes(data.status)) {
      setSubmitBusy(true);
      if (!pollState || pollState.jobId !== data.id) startPolling();
      return;
    }

    lastCompletedJob = data.status === 'succeeded' ? data : null;
    saveActiveJob(null);
    setSubmitBusy(false);
    if (data.status === 'succeeded') {
      try {
        await showResults(data, { autoDownload: true });
      } catch (error) {
        console.error(error);
        setStatus('海报已生成，但下载链接获取失败', 'succeeded', '点击“再次下载”重新获取 PNG');
        downloadResultBtn.hidden = false;
      }
    }
  }

  async function downloadAs(url, filename) {
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
  }
  window.downloadAs = downloadAs;

  async function showResults(job, { autoDownload = false } = {}) {
    if (!job?.result_png_path) throw new Error('任务没有 PNG 结果');
    const bucket = client.storage.from(cfg.BUCKET || 'poster-assets');
    const png = await bucket.createSignedUrl(job.result_png_path, 1800);
    if (png.error) throw png.error;
    if (!png.data?.signedUrl) throw new Error('未返回 PNG 下载地址');

    const filename = `${safeDownloadName(job.payload?.meeting?.outputName || deriveOutputName())}.png`;
    lastDownload = { url: png.data.signedUrl, filename };
    lastCompletedJob = job;
    downloadResultBtn.hidden = false;

    if (autoDownload && readLocalStorage(AUTO_DOWNLOAD_JOB_KEY) === job.id) {
      removeLocalStorage(AUTO_DOWNLOAD_JOB_KEY);
      await downloadAs(lastDownload.url, lastDownload.filename);
    }
  }

  downloadResultBtn.addEventListener('click', async () => {
    downloadResultBtn.disabled = true;
    try {
      if (!lastDownload && lastCompletedJob) await showResults(lastCompletedJob);
      if (!lastDownload) throw new Error('当前没有可下载的海报');
      await downloadAs(lastDownload.url, lastDownload.filename);
    } catch (error) {
      alert(`下载失败：${error.message || error}`);
    } finally {
      downloadResultBtn.disabled = false;
    }
  });

  cancelActiveJobBtn.addEventListener('click', async () => {
    if (!client || !activeJob || activeJobStatus !== 'pending') return;
    if (!window.confirm('确定取消这个尚未开始处理的任务吗？')) return;
    cancelActiveJobBtn.disabled = true;
    try {
      const { error } = await client.rpc('cancel_poster_job', { p_job_id: activeJob });
      if (error) throw error;
      saveActiveJob(null);
      setSubmitBusy(false);
      setStatus('任务已取消', 'cancelled');
    } catch (error) {
      alert(`取消失败：${error.message || error}`);
    } finally {
      cancelActiveJobBtn.disabled = false;
    }
  });

  async function clearLocalData() {
    const firstConfirmed = window.confirm('这会清除本机保存的文字草稿、头像、二维码和当前匿名会话。是否继续？');
    if (!firstConfirmed) return;
    const finalConfirmed = window.confirm('请再次确认：清除后无法在此浏览器恢复这些本机草稿和素材。');
    if (!finalConfirmed) return;

    clearLocalDataBtn.disabled = true;
    setSubmitBusy(true);
    stopPolling();
    const localErrors = [];

    if (client) {
      try { await client.auth.signOut({ scope: 'local' }); }
      catch (error) { console.error('匿名会话退出失败', error); }
    }

    try {
      if (!window.posterDraft?.clearAll) throw new Error('本地草稿清理组件未加载');
      await window.posterDraft.clearAll();
    } catch (error) {
      localErrors.push(error);
    }

    try { localStorage.clear(); }
    catch (error) { localErrors.push(error); }
    try { sessionStorage.clear(); }
    catch (_) {}

    if (localErrors.length) {
      alert(`部分本机数据未能清除：${localErrors.map(error => error.message || error).join('；')}`);
      clearLocalDataBtn.disabled = false;
      return;
    }
    window.location.reload();
  }

  clearLocalDataBtn?.addEventListener('click', clearLocalData);
  buildPeople();
  buildSchedule();
  setSubmitBusy(false);
  init().catch(error => {
    console.error(error);
    cloudState.textContent = '连接失败';
    cloudState.className = 'badge bad';
    setStatus(`初始化失败：${error.message || error}`, 'failed');
  });
})();
