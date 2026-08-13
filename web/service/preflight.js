(() => {
  'use strict';

  const cfg = window.POSTER_CONFIG || {};
  const runtime = window.POSTER_RUNTIME || {};
  const supabaseLib = window.supabase;
  if (!supabaseLib?.createClient) return;

  const overlay = document.createElement('div');
  overlay.className = 'preflight-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="preflight-panel" role="dialog" aria-modal="true" aria-labelledby="preflightTitle">
      <div class="preflight-head">
        <div><h2 id="preflightTitle">系统自检</h2><p>检查浏览器、Supabase、Mac Agent、Photoshop Worker 与当前渲染协议。</p></div>
        <button type="button" class="preflight-close" aria-label="关闭">×</button>
      </div>
      <div class="preflight-summary"><span class="preflight-summary-dot"></span><span>尚未检查</span></div>
      <div class="preflight-list"></div>
      <div class="preflight-actions"><button type="button" data-action="close">关闭</button><button type="button" class="primary" data-action="refresh">重新检查</button></div>
    </section>`;
  document.body.appendChild(overlay);

  const list = overlay.querySelector('.preflight-list');
  const summary = overlay.querySelector('.preflight-summary');
  const summaryText = summary.querySelector('span:last-child');
  let inFlight = false;

  function ageMs(value) {
    const time = Date.parse(value || '');
    return Number.isFinite(time) ? Date.now() - time : Infinity;
  }

  function statusRow(name, ok, detail, level = null) {
    return {
      name,
      level: level || (ok ? 'ok' : 'bad'),
      detail,
    };
  }

  function render(rows) {
    list.innerHTML = rows.map(row => {
      const icon = row.level === 'ok' ? '✓' : row.level === 'warn' ? '!' : '×';
      return `<div class="preflight-row ${row.level}"><span class="preflight-icon">${icon}</span><span class="preflight-name">${row.name}</span><span class="preflight-detail">${String(row.detail || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}</span></div>`;
    }).join('');
    const blocking = rows.filter(row => row.level === 'bad').length;
    const warnings = rows.filter(row => row.level === 'warn').length;
    summary.className = `preflight-summary ${blocking ? 'bad' : 'ok'}`;
    summaryText.textContent = blocking
      ? `发现 ${blocking} 项阻断问题${warnings ? `，另有 ${warnings} 项提醒` : ''}`
      : warnings ? `系统可接单，但有 ${warnings} 项提醒` : '系统自检通过，可以正常接单';
  }

  async function run() {
    if (inFlight) return;
    inFlight = true;
    summary.className = 'preflight-summary';
    summaryText.textContent = '正在检查…';
    list.innerHTML = '<div class="preflight-row"><span class="preflight-icon">…</span><span class="preflight-name">系统</span><span class="preflight-detail">正在读取运行状态</span></div>';

    const rows = [];
    rows.push(statusRow('Web 编辑器', Boolean(runtime.webVersion), runtime.webVersion ? `v${runtime.webVersion}` : '未读取到 Web 运行版本'));
    rows.push(statusRow('Render Protocol', runtime.renderProtocolVersion === 2, `浏览器协议 v${runtime.renderProtocolVersion ?? '未知'}`));
    rows.push(statusRow('项目画布', Number(runtime.canvas?.width) === 837 && Number(runtime.canvas?.height) === 1880, `${runtime.projectId || '未知项目'} · ${runtime.canvas?.width || '?'} × ${runtime.canvas?.height || '?'}`));
    rows.push(statusRow('时间组件', window.posterTimeControlsState?.ready === true, window.posterTimeControlsState?.reason || '时间选择组件尚未就绪'));

    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_PUBLISHABLE_KEY) {
      rows.push(statusRow('Supabase', false, 'config.js 未配置'));
      render(rows);
      inFlight = false;
      return;
    }

    const client = window.POSTER_APP_CLIENT;
    if (!client) {
      rows.push(statusRow('Supabase 登录', false, '匿名登录尚未完成，请稍候后重新检查'));
      render(rows);
      inFlight = false;
      return;
    }

    try {
      const [preflightResult, serviceResult] = await Promise.all([
        client.rpc('poster_preflight', { p_bucket: cfg.BUCKET || 'poster-assets' }),
        client.from('poster_service_status')
          .select('agent_last_seen_at,worker_last_seen_at,worker_status')
          .eq('id', 'primary')
          .maybeSingle(),
      ]);

      if (preflightResult.error) {
        rows.push(statusRow('数据库能力', false, `poster_preflight 不可用：${preflightResult.error.message || '未知错误'}。请确认已执行 005/006 migration。`));
      } else {
        const db = preflightResult.data || {};
        rows.push(statusRow('数据库 Schema', Number(db.schemaVersion) >= 5, `schema v${db.schemaVersion ?? '未知'}`));
        rows.push(statusRow('Render Contract', db.renderContractEnforced === true && Number(db.renderProtocolVersion) === 2, db.renderContractEnforced ? `数据库强制 protocol v${db.renderProtocolVersion}` : '数据库未启用 render contract v2 trigger'));
        rows.push(statusRow('任务控制', db.jobControlsAvailable === true, db.jobControlsAvailable ? '任务控制 RPC 已安装' : '任务控制 RPC 缺失'));
        rows.push(statusRow('Storage', db.bucketReady === true, db.bucketReady ? `${cfg.BUCKET || 'poster-assets'} 可用` : `${cfg.BUCKET || 'poster-assets'} bucket 不存在`));
      }

      if (serviceResult.error || !serviceResult.data) {
        rows.push(statusRow('Mac Agent', false, serviceResult.error?.message || '未读取到服务心跳'));
        rows.push(statusRow('Photoshop Worker', false, '无法读取 Worker 心跳'));
      } else {
        const service = serviceResult.data;
        const agentFresh = ageMs(service.agent_last_seen_at) < 15000;
        const workerFresh = ageMs(service.worker_last_seen_at) < 180000;
        const workerStatus = service.worker_status || 'unknown';
        const workerReady = workerFresh && ['ready', 'busy'].includes(workerStatus);
        rows.push(statusRow('Mac Agent', agentFresh, agentFresh ? '心跳正常' : '心跳超过 15 秒或未启动'));
        if (workerStatus === 'template_error') {
          rows.push(statusRow('PSD 母版', false, 'Worker 在线，但 PSD 母版结构自检失败；请在 Photoshop Worker 中重新选择正确母版'));
        } else if (workerStatus === 'not_ready') {
          rows.push(statusRow('Photoshop Worker', false, 'Worker 未完成母版 / Workspace 设置'));
        } else if (workerStatus === 'stopped') {
          rows.push(statusRow('Photoshop Worker', false, 'Worker 已停止自动接单'));
        } else {
          rows.push(statusRow('Photoshop Worker', workerReady, workerReady ? `在线 · ${workerStatus === 'busy' ? '正在生成' : '自动接单中'}` : `心跳异常 · ${workerStatus}`));
        }
      }
    } catch (error) {
      rows.push(statusRow('Supabase', false, error.message || String(error)));
    }

    render(rows);
    inFlight = false;
  }

  function open() {
    overlay.hidden = false;
    void run();
  }
  function close() { overlay.hidden = true; }

  overlay.querySelector('.preflight-close').addEventListener('click', close);
  overlay.querySelector('[data-action="close"]').addEventListener('click', close);
  overlay.querySelector('[data-action="refresh"]').addEventListener('click', () => { void run(); });
  overlay.addEventListener('click', event => { if (event.target === overlay) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !overlay.hidden) close(); });

  function wireTrigger() {
    const trigger = document.getElementById('renderServiceState');
    if (!trigger || trigger.dataset.preflightReady === '1') return Boolean(trigger);
    trigger.dataset.preflightReady = '1';
    trigger.addEventListener('click', open);
    trigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
    return true;
  }

  if (!wireTrigger()) {
    const observer = new MutationObserver(() => { if (wireTrigger()) observer.disconnect(); });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.posterPreflight = { open, run };
})();
