(() => {
  'use strict';

  const taskTab = document.getElementById('taskTab');
  if (!taskTab || taskTab.querySelector('.task-control-card')) return;

  const card = document.createElement('section');
  card.className = 'task-control-card';
  card.innerHTML = `
    <div class="task-control-head"><h2>任务控制</h2><button type="button" class="task-control-refresh">刷新</button></div>
    <div class="task-control-list"><div class="task-control-empty">正在读取任务…</div></div>
    <div class="task-control-note">排队中的任务可安全取消；Photoshop 已开始处理后不做强制中断。已完成、失败或取消的任务可使用原素材重新生成。</div>`;

  const history = taskTab.querySelector('.history-card');
  taskTab.insertBefore(card, history || taskTab.querySelector('.debug-details') || null);

  const list = card.querySelector('.task-control-list');
  const refreshButton = card.querySelector('.task-control-refresh');
  let loading = false;
  let actionBusy = false;

  const statusLabels = {
    pending: '排队中',
    claimed: 'Agent 已接单',
    rendering: 'Photoshop 处理中',
    uploading: '上传结果中',
    succeeded: '已完成',
    failed: '失败',
    cancelled: '已取消',
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  }

  function client() { return window.POSTER_APP_CLIENT || null; }

  function render(jobs) {
    if (!Array.isArray(jobs) || !jobs.length) {
      list.innerHTML = '<div class="task-control-empty">暂无任务</div>';
      return;
    }

    list.innerHTML = jobs.map(job => {
      const status = String(job.status || 'unknown');
      const name = job.payload?.meeting?.outputName || '系列会议海报';
      const time = job.created_at ? new Date(job.created_at).toLocaleString() : '';
      const canCancel = status === 'pending';
      const canRetry = ['failed', 'succeeded', 'cancelled'].includes(status);
      const action = canCancel
        ? '<button type="button" class="danger" data-job-action="cancel">取消任务</button>'
        : canRetry
          ? '<button type="button" class="primary" data-job-action="retry">重新生成</button>'
          : '<button type="button" disabled>处理中不可强制取消</button>';
      return `
        <div class="task-control-item" data-job-id="${escapeHtml(job.id)}" data-job-status="${escapeHtml(status)}">
          <div class="task-control-main">
            <div style="min-width:0"><div class="task-control-name">${escapeHtml(name)}</div><div class="task-control-time">${escapeHtml(time)}</div></div>
            <span class="task-control-status ${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span>
          </div>
          <div class="task-control-actions">${action}</div>
        </div>`;
    }).join('');
  }

  async function load() {
    if (loading || actionBusy) return;
    const sb = client();
    if (!sb) {
      list.innerHTML = '<div class="task-control-empty">等待云端登录完成…</div>';
      return;
    }
    loading = true;
    refreshButton.disabled = true;
    try {
      const { data, error } = await sb.from('poster_jobs')
        .select('id,status,payload,created_at,error_message')
        .order('created_at', { ascending: false })
        .limit(8);
      if (error) throw error;
      render(data || []);
    } catch (error) {
      list.innerHTML = `<div class="task-control-empty">任务读取失败：${escapeHtml(error.message || error)}</div>`;
    } finally {
      loading = false;
      refreshButton.disabled = false;
    }
  }

  async function runAction(item, action) {
    if (actionBusy) return;
    const sb = client();
    if (!sb) return;
    const jobId = item.dataset.jobId;
    const status = item.dataset.jobStatus;
    if (!jobId) return;

    if (action === 'cancel') {
      if (status !== 'pending') return;
      if (!window.confirm('确定取消这个排队中的任务吗？已上传的素材会保留，可之后重新生成。')) return;
    } else if (action === 'retry') {
      if (!['failed', 'succeeded', 'cancelled'].includes(status)) return;
      if (!window.confirm('使用原会议资料和素材重新生成这个任务吗？')) return;
    } else return;

    actionBusy = true;
    card.querySelectorAll('button').forEach(button => { button.disabled = true; });
    try {
      const rpcName = action === 'cancel' ? 'cancel_poster_job' : 'retry_poster_job';
      const { error } = await sb.rpc(rpcName, { p_job_id: jobId });
      if (error) throw error;

      if (action === 'cancel') {
        try { localStorage.removeItem('meetingPosterActiveJobV1'); } catch (_) {}
      } else {
        try { localStorage.setItem('meetingPosterActiveJobV1', jobId); } catch (_) {}
      }
      window.location.reload();
    } catch (error) {
      alert(`${action === 'cancel' ? '取消' : '重新生成'}失败：${error.message || error}`);
      actionBusy = false;
      card.querySelectorAll('button').forEach(button => { button.disabled = false; });
      await load();
    }
  }

  list.addEventListener('click', event => {
    const button = event.target.closest('[data-job-action]');
    if (!button) return;
    const item = button.closest('.task-control-item');
    if (item) void runAction(item, button.dataset.jobAction);
  });
  refreshButton.addEventListener('click', () => { void load(); });

  const tabButton = document.querySelector('.inspector-tab[data-tab="task"]');
  tabButton?.addEventListener('click', () => { setTimeout(() => void load(), 0); });
  document.addEventListener('poster-service-state', () => { if (taskTab.classList.contains('active')) void load(); });

  setInterval(() => { if (taskTab.classList.contains('active')) void load(); }, 5000);
  setTimeout(() => void load(), 250);
})();
