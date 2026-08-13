(() => {
  'use strict';

  const taskTab = document.getElementById('taskTab');
  if (!taskTab || taskTab.querySelector('.task-control-card')) return;

  const cfg = window.POSTER_CONFIG || {};
  const card = document.createElement('section');
  card.className = 'task-control-card';
  card.innerHTML = `
    <div class="task-control-head"><h2>任务控制</h2><button type="button" class="task-control-refresh">刷新</button></div>
    <div class="task-control-list"><div class="task-control-empty">正在读取任务…</div></div>
    <div class="task-control-note">排队中的任务可安全取消；Render Worker 已开始处理后不做强制中断。已完成任务可直接查看海报；已完成、失败或取消的任务可使用原素材重新生成。</div>`;

  const history = taskTab.querySelector('.history-card');
  taskTab.insertBefore(card, history || taskTab.querySelector('.debug-details') || null);

  const list = card.querySelector('.task-control-list');
  const refreshButton = card.querySelector('.task-control-refresh');
  const previewUrls = new Map();
  let currentJobs = [];
  let expandedJobId = null;
  let loading = false;
  let actionBusy = false;

  const statusLabels = {
    pending: '排队中',
    claimed: 'Renderer 已接单',
    rendering: '正在生成 PNG',
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
    currentJobs = Array.isArray(jobs) ? jobs : [];
    if (expandedJobId && !currentJobs.some(job => job.id === expandedJobId && job.status === 'succeeded')) {
      expandedJobId = null;
    }
    if (!currentJobs.length) {
      list.innerHTML = '<div class="task-control-empty">暂无任务</div>';
      return;
    }

    list.innerHTML = currentJobs.map(job => {
      const status = String(job.status || 'unknown');
      const name = job.payload?.meeting?.outputName || '系列会议海报';
      const time = job.created_at ? new Date(job.created_at).toLocaleString() : '';
      const canCancel = status === 'pending';
      const canRetry = ['failed', 'succeeded', 'cancelled'].includes(status);
      const isExpanded = status === 'succeeded' && expandedJobId === job.id;
      const previewUrl = previewUrls.get(job.id) || '';

      let actions = '';
      if (status === 'succeeded') {
        actions += `<button type="button" class="view" data-job-action="toggle-preview">${isExpanded ? '收起' : '查看'}</button>`;
      }
      if (canCancel) {
        actions += '<button type="button" class="danger" data-job-action="cancel">取消任务</button>';
      } else if (canRetry) {
        actions += '<button type="button" class="primary" data-job-action="retry">重新生成</button>';
      } else {
        actions += '<button type="button" disabled>处理中不可强制取消</button>';
      }

      const preview = status === 'succeeded'
        ? `<div class="task-control-preview"${isExpanded ? '' : ' hidden'}>${previewUrl
          ? `<img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(name)}预览">`
          : '<div class="task-control-preview-loading">正在加载海报…</div>'}</div>`
        : '';

      return `
        <div class="task-control-item" data-job-id="${escapeHtml(job.id)}" data-job-status="${escapeHtml(status)}">
          <div class="task-control-main">
            <div style="min-width:0"><div class="task-control-name">${escapeHtml(name)}</div><div class="task-control-time">${escapeHtml(time)}</div></div>
            <span class="task-control-status ${escapeHtml(status)}">${escapeHtml(statusLabels[status] || status)}</span>
          </div>
          <div class="task-control-actions">${actions}</div>
          ${preview}
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
        .select('id,status,payload,created_at,error_message,result_png_path')
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

  async function togglePreview(item) {
    const jobId = item.dataset.jobId;
    const job = currentJobs.find(entry => entry.id === jobId);
    if (!job || job.status !== 'succeeded') return;

    if (expandedJobId === jobId) {
      expandedJobId = null;
      render(currentJobs);
      return;
    }

    expandedJobId = jobId;
    render(currentJobs);
    if (previewUrls.has(jobId)) return;

    const sb = client();
    if (!sb) return;
    if (!job.result_png_path) {
      expandedJobId = null;
      render(currentJobs);
      alert('该任务没有可查看的 PNG 结果');
      return;
    }

    try {
      const bucket = sb.storage.from(cfg.BUCKET || 'poster-assets');
      const { data, error } = await bucket.createSignedUrl(job.result_png_path, 1800);
      if (error) throw error;
      if (!data?.signedUrl) throw new Error('未返回海报预览地址');
      previewUrls.set(jobId, data.signedUrl);
      if (expandedJobId === jobId) render(currentJobs);
    } catch (error) {
      if (expandedJobId === jobId) expandedJobId = null;
      render(currentJobs);
      alert(`海报查看失败：${error.message || error}`);
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
    if (!item) return;
    if (button.dataset.jobAction === 'toggle-preview') {
      void togglePreview(item);
      return;
    }
    void runAction(item, button.dataset.jobAction);
  });
  refreshButton.addEventListener('click', () => { void load(); });

  const tabButton = document.querySelector('.inspector-tab[data-tab="task"]');
  tabButton?.addEventListener('click', () => { setTimeout(() => void load(), 0); });

  setInterval(() => { if (taskTab.classList.contains('active')) void load(); }, 5000);
  setTimeout(() => void load(), 250);
})();
