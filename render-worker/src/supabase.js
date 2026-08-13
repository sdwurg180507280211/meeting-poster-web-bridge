'use strict';

const { createClient } = require('@supabase/supabase-js');

const MAX_INPUT_BYTES = 15 * 1024 * 1024;
const ASSET_KEYS = Object.freeze(['chair', 'speaker1', 'speaker2', 'qrCode']);

function checked(result, context) {
  if (result?.error) throw new Error(`${context}失败：${result.error.message || result.error}`);
  return result?.data;
}

function createStore({ url, key, bucket = 'poster-assets' }) {
  if (!url || !key) throw new Error('缺少 SUPABASE_URL / SUPABASE_SECRET_KEY');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const storage = client.storage.from(bucket);

  async function claimNext(workerId, leaseSeconds, maxAttempts) {
    const data = checked(await client.rpc('claim_next_poster_job', {
      p_agent_id: workerId,
      p_lease_seconds: leaseSeconds,
      p_max_attempts: maxAttempts,
    }).maybeSingle(), '领取任务');
    return data || null;
  }

  async function patchOwned(job, statuses, patch, context) {
    let query = client.from('poster_jobs').update(patch).eq('id', job.id).eq('agent_id', job.agent_id);
    if (Array.isArray(statuses) && statuses.length) query = query.in('status', statuses);
    const data = checked(await query.select('id,status').maybeSingle(), context);
    if (!data) throw new Error(`${context}失败：任务状态已变化`);
    return data;
  }

  async function startRendering(job, leaseSeconds) {
    return patchOwned(job, ['claimed'], {
      status: 'rendering',
      started_at: new Date().toISOString(),
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
      error_message: null,
    }, '进入渲染状态');
  }

  async function markUploading(job, leaseSeconds) {
    return patchOwned(job, ['rendering'], {
      status: 'uploading',
      lease_expires_at: new Date(Date.now() + leaseSeconds * 1000).toISOString(),
    }, '进入上传状态');
  }

  function expectedPrefix(job) {
    return `${job.owner_id}/${job.id}/input/`;
  }

  async function downloadAsset(job, keyName) {
    const asset = job.payload?.assets?.[keyName];
    if (!asset?.storagePath || typeof asset.storagePath !== 'string') throw new Error(`素材 ${keyName} 路径缺失`);
    if (!asset.storagePath.startsWith(expectedPrefix(job))) throw new Error(`素材 ${keyName} 不属于当前任务`);
    const blob = checked(await storage.download(asset.storagePath), `下载素材 ${keyName}`);
    if (!blob || !Number.isFinite(blob.size) || blob.size <= 0 || blob.size > MAX_INPUT_BYTES) {
      throw new Error(`素材 ${keyName} 大小无效或超过 15 MiB`);
    }
    return Buffer.from(await blob.arrayBuffer());
  }

  async function downloadAssets(job) {
    const result = {};
    for (const keyName of ASSET_KEYS) result[keyName] = await downloadAsset(job, keyName);
    return {
      chairAvatar: result.chair,
      speaker1Avatar: result.speaker1,
      speaker2Avatar: result.speaker2,
      qrCode: result.qrCode,
    };
  }

  async function uploadResult(job, pngBuffer) {
    if (!Buffer.isBuffer(pngBuffer) || !pngBuffer.length) throw new Error('渲染结果为空');
    const path = `${job.owner_id}/${job.id}/output/final.png`;
    checked(await storage.upload(path, pngBuffer, {
      contentType: 'image/png',
      cacheControl: '3600',
      upsert: true,
    }), '上传 PNG');

    await patchOwned(job, ['uploading'], {
      status: 'succeeded',
      result_png_path: path,
      result_psd_path: null,
      finished_at: new Date().toISOString(),
      lease_expires_at: null,
      error_message: null,
    }, '完成任务');
    return path;
  }

  async function fail(job, error) {
    const message = String(error?.message || error || '未知错误').slice(0, 1000);
    try {
      await patchOwned(job, ['claimed', 'rendering', 'uploading'], {
        status: 'failed',
        error_message: message,
        finished_at: new Date().toISOString(),
        lease_expires_at: null,
      }, '标记任务失败');
    } catch (patchError) {
      console.error('无法标记失败任务', job?.id, patchError);
    }
  }

  return Object.freeze({ client, bucket, claimNext, startRendering, markUploading, downloadAssets, uploadResult, fail });
}

module.exports = { createStore };
