(() => {
  const cfg = window.POSTER_CONFIG || {};
  const supabaseLib = window.supabase;
  const cloudState = document.getElementById('cloudState');
  const form = document.getElementById('posterForm');
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY || !supabaseLib || !cloudState || !form) return;

  const wrap = document.createElement('div');
  wrap.style.display = 'flex';
  wrap.style.gap = '8px';
  wrap.style.alignItems = 'center';
  wrap.style.flexWrap = 'wrap';
  cloudState.parentNode.insertBefore(wrap, cloudState);
  wrap.appendChild(cloudState);

  const renderState = document.createElement('span');
  renderState.id = 'renderServiceState';
  renderState.className = 'badge';
  renderState.textContent = '生成服务检测中…';
  wrap.appendChild(renderState);

  // This read-only status client deliberately uses its own auth storage key.
  // app.js owns the persisted anonymous session; sharing the default key across
  // multiple GoTrueClient instances causes Supabase's duplicate-client warning.
  const sb = supabaseLib.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_PUBLISHABLE_KEY, {
    auth: {
      storageKey: 'meeting-poster-service-status-auth',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    }
  });

  let serviceOnline = false;
  let lastReason = '正在检测生成服务';
  let checkInFlight = false;
  let lastSnapshot = null;

  function ageMs(value) {
    if (!value) return Infinity;
    const t = new Date(value).getTime();
    return Number.isFinite(t) ? Date.now() - t : Infinity;
  }

  function emitState() {
    document.dispatchEvent(new CustomEvent('poster-service-state', {
      detail: {
        online: serviceOnline,
        reason: lastReason,
        snapshot: lastSnapshot,
      },
    }));
  }

  function setState(online, text, title) {
    serviceOnline = online;
    lastReason = title || text;
    renderState.textContent = text;
    renderState.className = `badge ${online ? 'ok' : 'bad'}`;
    renderState.title = `${lastReason} · 点击查看系统自检`;
    renderState.setAttribute('role', 'button');
    renderState.tabIndex = 0;
    emitState();
  }

  async function checkService() {
    if (checkInFlight) return;
    checkInFlight = true;
    try {
      const { data, error } = await sb.from('poster_service_status')
        .select('agent_last_seen_at,worker_last_seen_at,worker_status')
        .eq('id', 'primary')
        .maybeSingle();

      if (error || !data) {
        lastSnapshot = null;
        setState(false, '生成服务不可用', error?.message || '未读取到服务状态');
        return;
      }

      lastSnapshot = data;
      const agentFresh = ageMs(data.agent_last_seen_at) < 15000;
      const workerFresh = ageMs(data.worker_last_seen_at) < 180000;
      const workerReady = data.worker_status === 'ready' || data.worker_status === 'busy';

      if (agentFresh && workerFresh && workerReady) {
        const suffix = data.worker_status === 'busy' ? ' · 忙碌' : '';
        setState(true, `生成服务在线${suffix}`, `Mac Agent 在线，Photoshop Worker ${data.worker_status}`);
        return;
      }

      if (!agentFresh) {
        setState(false, '生成服务离线', 'Mac Agent 未在线或心跳已超时');
      } else if (!workerFresh) {
        setState(false, 'Photoshop 离线', 'Mac Agent 在线，但 Photoshop Worker 心跳已超时');
      } else if (data.worker_status === 'template_error') {
        setState(false, 'PSD 母版异常', 'Photoshop Worker 已在线，但 PSD 母版自检未通过');
      } else {
        setState(false, 'Photoshop 未就绪', `Worker 状态：${data.worker_status || 'unknown'}`);
      }
    } catch (err) {
      console.error(err);
      lastSnapshot = null;
      setState(false, '生成服务不可用', err.message || '服务状态检查失败');
    } finally {
      checkInFlight = false;
    }
  }

  form.addEventListener('submit', e => {
    if (serviceOnline) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    alert(`当前无法提交新任务：${lastReason}\n\n请确认 Mac Agent 已启动，并在 Photoshop 中打开“海报 Web Worker”且处于自动接单状态。`);
  }, true);

  window.posterServiceStatus = {
    refresh: checkService,
    getSnapshot: () => ({ online: serviceOnline, reason: lastReason, data: lastSnapshot }),
  };

  checkService();
  setInterval(checkService, 5000);
})();
