'use strict';

process.umask(0o077);

const crypto = require('crypto');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const {
  ASSET_DEFINITIONS,
  HARD_MAX_INPUT_BYTES,
  UUID_PATTERN,
  safeResultFileName,
  validateImageBuffer,
  validateImageMetadata,
  validateJob,
} = require('./job-validation');
const { acquireSingleInstance } = require('./single-instance-lock');
const { boundedErrorMessage, checkedResult } = require('./supabase-utils');

const AGENT_ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(AGENT_ROOT, '.env');
require('dotenv').config({ path: ENV_PATH });

function expandHome(value) {
  if (typeof value !== 'string') return value;
  if (value === '~') return os.homedir();
  return value.startsWith('~/') ? path.join(os.homedir(), value.slice(2)) : value;
}

function integerSetting(name, fallback, { min, max }) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function assertSafeWorkspace(value) {
  if (!value || typeof value !== 'string') throw new Error('WORKSPACE_DIR 不能为空');
  const resolved = path.resolve(expandHome(value));
  if (resolved === path.parse(resolved).root || resolved === path.resolve(os.homedir())) {
    throw new Error('WORKSPACE_DIR 不能指向磁盘根目录或用户主目录');
  }
  return resolved;
}

function safeAgentId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 120 || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error('AGENT_ID 格式无效');
  return id;
}

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
if (!URL || !KEY) {
  throw new Error('请在 .env 配置 SUPABASE_URL 和 SUPABASE_SECRET_KEY');
}

const BUCKET = process.env.SUPABASE_BUCKET || 'poster-assets';
const WORKSPACE = assertSafeWorkspace(process.env.WORKSPACE_DIR || '~/MeetingPosterAgent');
const POLL_MS = integerSetting('POLL_MS', 2000, { min: 500, max: 60000 });
const AGENT_ID = safeAgentId(process.env.AGENT_ID || os.hostname());
const KEEP = String(process.env.KEEP_LOCAL_JOBS || 'false').toLowerCase() === 'true';
const MAX_INPUT_BYTES = integerSetting('MAX_INPUT_BYTES', HARD_MAX_INPUT_BYTES, { min: 1024, max: HARD_MAX_INPUT_BYTES });
const MAX_OUTPUT_BYTES = integerSetting('MAX_OUTPUT_BYTES', 1024 * 1024 * 1024, { min: 1024, max: 2 * 1024 * 1024 * 1024 });
const CLAIM_LEASE_SECONDS = integerSetting('CLAIM_LEASE_SECONDS', 900, { min: 60, max: 3600 });
const RENDER_LEASE_SECONDS = integerSetting('RENDER_LEASE_SECONDS', 1800, { min: CLAIM_LEASE_SECONDS, max: 7200 });
const STALE_AFTER_SECONDS = integerSetting('STALE_AFTER_SECONDS', 1800, { min: 300, max: 86400 });
const MAX_JOB_ATTEMPTS = integerSetting('MAX_JOB_ATTEMPTS', 3, { min: 1, max: 10 });
const RECOVERY_INTERVAL_MS = integerSetting('RECOVERY_INTERVAL_MS', 60000, { min: 10000, max: 600000 });
const LEASE_RENEW_INTERVAL_MS = integerSetting('LEASE_RENEW_INTERVAL_MS', 60000, { min: 10000, max: 300000 });
const WORKER_HEARTBEAT_MAX_AGE_MS = integerSetting('WORKER_HEARTBEAT_MAX_AGE_MS', 120000, { min: 10000, max: 600000 });

const SERVICE_DIR = path.join(WORKSPACE, '.service');
const LOCK_FILE = path.join(SERVICE_DIR, 'mac-agent.lock');
const PID_FILE = path.join(SERVICE_DIR, 'mac-agent.pid');
const WORKER_HEARTBEAT_FILE = path.join(WORKSPACE, 'worker-heartbeat.json');
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

let loopBusy = false;
let lastServiceHeartbeatAt = 0;
let lastRecoveryAt = 0;
let lastLeaseRenewalAt = 0;
let pollTimer = null;
let instanceLock = null;
let shuttingDown = false;

function now() { return new Date().toISOString(); }
function log(...args) { console.log(new Date().toLocaleTimeString(), ...args); }
function leaseUntil(seconds) { return new Date(Date.now() + seconds * 1000).toISOString(); }

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
}

async function ensureSecureFilesystem() {
  await ensureDirectory(WORKSPACE);
  for (const name of ['inbox', 'outbox', 'archive', '.service']) {
    await ensureDirectory(path.join(WORKSPACE, name));
  }
  await fs.chmod(ENV_PATH, 0o600).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function writeFileSecure(filePath, value) {
  await fs.writeFile(filePath, value, { mode: 0o600 });
  await fs.chmod(filePath, 0o600);
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  try {
    await writeFileSecure(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    await fs.rename(temporaryPath, filePath);
    await fs.chmod(filePath, 0o600);
  } finally {
    await fs.unlink(temporaryPath).catch((error) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }
}

async function readJsonLimited(filePath, maxBytes = 128 * 1024) {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) throw new Error('JSON 文件大小或类型无效');
  return JSON.parse(await fs.readFile(filePath, 'utf8'));
}

async function readWorkerHeartbeat() {
  try {
    const heartbeat = await readJsonLimited(WORKER_HEARTBEAT_FILE, 16 * 1024);
    const updatedAtMs = Date.parse(heartbeat.updatedAt);
    return {
      workerLastSeenAt: Number.isFinite(updatedAtMs) ? new Date(updatedAtMs).toISOString() : null,
      workerStatus: typeof heartbeat.status === 'string' ? heartbeat.status : 'unknown',
      fresh: Number.isFinite(updatedAtMs) && Date.now() - updatedAtMs <= WORKER_HEARTBEAT_MAX_AGE_MS,
    };
  } catch {
    return { workerLastSeenAt: null, workerStatus: 'offline', fresh: false };
  }
}

async function publishServiceHeartbeat(force = false) {
  const currentTime = Date.now();
  if (!force && currentTime - lastServiceHeartbeatAt < 5000) return;
  lastServiceHeartbeatAt = currentTime;
  const worker = await readWorkerHeartbeat();
  const payload = {
    id: 'primary',
    agent_id: AGENT_ID,
    agent_last_seen_at: now(),
    worker_last_seen_at: worker.workerLastSeenAt,
    worker_status: worker.workerStatus,
    updated_at: now(),
  };
  const result = await sb.from('poster_service_status').upsert(payload, { onConflict: 'id' }).select('id').maybeSingle();
  checkedResult(result, '服务心跳上报', { requireData: true });
}

async function mutateJob(jobId, patch, { statuses, expectedAgent, context = '更新任务' } = {}) {
  let query = sb.from('poster_jobs').update(patch).eq('id', jobId);
  if (Array.isArray(statuses) && statuses.length) query = query.in('status', statuses);
  if (expectedAgent === null) query = query.is('agent_id', null);
  else if (typeof expectedAgent === 'string') query = query.eq('agent_id', expectedAgent);
  const result = await query.select('id,status,agent_id').maybeSingle();
  return checkedResult(result, context, { requireData: true });
}

async function recoverStaleJobs(force = false) {
  const currentTime = Date.now();
  if (!force && currentTime - lastRecoveryAt < RECOVERY_INTERVAL_MS) return;
  lastRecoveryAt = currentTime;

  const result = await sb.rpc('recover_stale_poster_jobs', {
    p_stale_after_seconds: STALE_AFTER_SECONDS,
    p_max_attempts: MAX_JOB_ATTEMPTS,
  }).maybeSingle();
  const summary = checkedResult(result, '恢复过期任务');
  const requeued = Number(summary?.requeued_count || 0);
  const failed = Number(summary?.failed_count || 0);
  if (requeued || failed) log(`过期任务恢复完成：重新排队 ${requeued}，失败 ${failed}`);
}

async function claimOne() {
  const result = await sb.rpc('claim_next_poster_job', {
    p_agent_id: AGENT_ID,
    p_lease_seconds: CLAIM_LEASE_SECONDS,
    p_max_attempts: MAX_JOB_ATTEMPTS,
  }).maybeSingle();
  return checkedResult(result, '原子认领任务') || null;
}

async function renewOwnedLeases() {
  const currentTime = Date.now();
  if (currentTime - lastLeaseRenewalAt < LEASE_RENEW_INTERVAL_MS) return;
  lastLeaseRenewalAt = currentTime;
  const worker = await readWorkerHeartbeat();
  if (!worker.fresh || !['ready', 'busy'].includes(worker.workerStatus)) return;
  const result = await sb.from('poster_jobs')
    .update({ lease_expires_at: leaseUntil(RENDER_LEASE_SECONDS) })
    .eq('agent_id', AGENT_ID)
    .in('status', ['claimed', 'rendering', 'uploading'])
    .select('id');
  checkedResult(result, '续约任务租约');
}

async function downloadStorage(asset, localPath, assetKey) {
  const bucket = sb.storage.from(BUCKET);
  const infoResult = await bucket.info(asset.storagePath);
  const metadata = checkedResult(infoResult, `读取素材 ${assetKey} 元数据`, { requireData: true });
  const checkedMetadata = validateImageMetadata(asset, metadata, MAX_INPUT_BYTES);

  const downloadResult = await bucket.download(asset.storagePath);
  const blob = checkedResult(downloadResult, `下载素材 ${assetKey}`, { requireData: true });
  if (!Number.isSafeInteger(blob.size) || blob.size <= 0 || blob.size > MAX_INPUT_BYTES) {
    throw new Error(`素材 ${assetKey} 下载大小无效或超过 ${MAX_INPUT_BYTES} 字节`);
  }
  const buffer = Buffer.from(await blob.arrayBuffer());
  validateImageBuffer(asset, buffer, blob.type, MAX_INPUT_BYTES);
  if (buffer.length !== checkedMetadata.size) {
    throw new Error(`素材 ${assetKey} 在校验与下载之间发生变化，请重新提交任务`);
  }
  await writeFileSecure(localPath, buffer);
}

function inboxJobDirectory(jobId) {
  if (!UUID_PATTERN.test(jobId)) throw new Error('任务 ID 无效，拒绝访问本地目录');
  return path.join(WORKSPACE, 'inbox', jobId.toLowerCase());
}

async function stageJob(job) {
  const normalized = validateJob(job);
  const directory = inboxJobDirectory(normalized.id);
  await fs.rm(directory, { recursive: true, force: true });
  await ensureDirectory(directory);

  const localAssets = {};
  for (const [assetKey, definition] of Object.entries(ASSET_DEFINITIONS)) {
    const asset = normalized.assets[assetKey];
    const fileName = `${assetKey}.${asset.localExtension}`;
    await downloadStorage(asset, path.join(directory, fileName), assetKey);
    if (definition.crop) {
      localAssets[definition.localKey] = {
        fileName,
        crop: asset.crop,
        cropMode: asset.cropMode,
      };
      if (asset.outputSize != null) {
        localAssets[definition.localKey].outputSize = asset.outputSize;
      }
    } else {
      localAssets[definition.localKey] = { fileName };
    }
  }

  const workerJob = {
    id: normalized.id,
    ownerId: normalized.ownerId,
    meeting: normalized.meeting,
    assets: localAssets,
    createdAt: job.created_at,
  };

  await mutateJob(normalized.id, {
    status: 'rendering',
    started_at: now(),
    error_message: null,
    lease_expires_at: leaseUntil(RENDER_LEASE_SECONDS),
  }, { statuses: ['claimed'], expectedAgent: AGENT_ID, context: '将任务推进到 rendering' });

  await writeJsonAtomic(path.join(directory, 'job.json'), workerJob);
  log('已送入 Photoshop inbox:', normalized.id);
}

async function failStaging(job, error) {
  const jobId = typeof job?.id === 'string' && UUID_PATTERN.test(job.id) ? job.id.toLowerCase() : null;
  if (!jobId) throw error;
  const message = boundedErrorMessage(error, '准备素材失败：');
  await fs.rm(inboxJobDirectory(jobId), { recursive: true, force: true }).catch(() => {});
  await mutateJob(jobId, {
    status: 'failed',
    error_message: message,
    finished_at: now(),
    lease_expires_at: null,
  }, { statuses: ['claimed', 'rendering'], expectedAgent: AGENT_ID, context: '标记素材准备失败' });
  log('任务素材准备失败:', jobId, message);
}

function invalidLocalResult(message, cause) {
  const error = new Error(message, cause ? { cause } : undefined);
  error.code = 'INVALID_LOCAL_RESULT';
  return error;
}

async function quarantineResult(resultPath) {
  const quarantinePath = `${resultPath}.invalid-${Date.now()}`;
  await fs.rename(resultPath, quarantinePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
  });
}

async function readLocalResult(resultPath, jobId) {
  let result;
  try {
    result = await readJsonLimited(resultPath, 128 * 1024);
  } catch (error) {
    throw invalidLocalResult(`result.json 无法读取：${error.message}`, error);
  }
  if (!result || typeof result !== 'object' || !['succeeded', 'failed'].includes(result.status)) {
    throw invalidLocalResult('result.json 状态无效');
  }
  if (result.jobId != null && String(result.jobId).toLowerCase() !== jobId) {
    throw invalidLocalResult('result.json 的 jobId 与目录不一致');
  }
  return result;
}

async function validateOutputFile(directory, fileName, expectedExtension) {
  const safeName = safeResultFileName(fileName, expectedExtension);
  const filePath = path.join(directory, safeName);
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    throw invalidLocalResult(`Photoshop 输出文件不存在：${safeName}`, error);
  }
  if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_OUTPUT_BYTES) {
    throw invalidLocalResult(`Photoshop 输出文件大小或类型无效：${safeName}`);
  }
  return filePath;
}

async function readJobForResult(jobId) {
  const result = await sb.from('poster_jobs')
    .select('id,owner_id,status,agent_id')
    .eq('id', jobId)
    .maybeSingle();
  return checkedResult(result, '读取结果对应任务', { requireData: true });
}

async function markUploaded(uploadedMark, value) {
  await writeJsonAtomic(uploadedMark, { status: value, uploadedAt: now() });
}

async function cleanupProcessedJob(jobId, outboxDirectory) {
  if (KEEP) return;
  await fs.rm(inboxJobDirectory(jobId), { recursive: true, force: true });
  await fs.rm(outboxDirectory, { recursive: true, force: true });
}

async function transitionResultJob(job, patch, context) {
  const expectedAgent = job.agent_id == null ? null : AGENT_ID;
  return mutateJob(job.id, { ...patch, agent_id: AGENT_ID }, {
    statuses: [job.status],
    expectedAgent,
    context,
  });
}

async function processResult(jobId) {
  const directory = path.join(WORKSPACE, 'outbox', jobId);
  const resultPath = path.join(directory, 'result.json');
  const uploadedMark = path.join(directory, '.uploaded');
  if (!(await exists(resultPath)) || await exists(uploadedMark)) return;

  let result;
  try {
    result = await readLocalResult(resultPath, jobId);
  } catch (error) {
    if (error.code === 'INVALID_LOCAL_RESULT') await quarantineResult(resultPath);
    throw error;
  }

  const job = await readJobForResult(jobId);
  if (!UUID_PATTERN.test(job.owner_id)) throw new Error('结果任务 owner_id 无效');

  if (['succeeded', 'failed'].includes(job.status)) {
    await markUploaded(uploadedMark, job.status);
    await cleanupProcessedJob(jobId, directory);
    return;
  }
  if (job.agent_id && job.agent_id !== AGENT_ID) {
    log(`跳过 ${jobId} 的本地结果：任务当前由其他 Agent ${job.agent_id} 持有`);
    return;
  }

  if (result.status === 'failed') {
    const failureMessage = boundedErrorMessage(result.error || 'Photoshop 生成失败');
    await transitionResultJob(job, {
      status: 'failed',
      error_message: failureMessage,
      finished_at: now(),
      lease_expires_at: null,
    }, '写入 Photoshop 失败终态');
    await markUploaded(uploadedMark, 'failed');
    log('Photoshop 失败:', jobId, failureMessage);
    await cleanupProcessedJob(jobId, directory);
    return;
  }

  let psdLocal;
  let pngLocal;
  try {
    psdLocal = await validateOutputFile(directory, result.psdFileName, '.psd');
    pngLocal = await validateOutputFile(directory, result.pngFileName, '.png');
  } catch (error) {
    if (error.code === 'INVALID_LOCAL_RESULT') await quarantineResult(resultPath);
    throw error;
  }

  const uploadingJob = await transitionResultJob(job, {
    status: 'uploading',
    error_message: null,
    lease_expires_at: leaseUntil(RENDER_LEASE_SECONDS),
  }, '将任务推进到 uploading');

  const base = `${job.owner_id.toLowerCase()}/${jobId}/output`;
  const psdPath = `${base}/poster.psd`;
  const pngPath = `${base}/poster.png`;
  const psdBuffer = await fs.readFile(psdLocal);
  const psdUpload = await sb.storage.from(BUCKET).upload(psdPath, psdBuffer, {
    contentType: 'image/vnd.adobe.photoshop',
    upsert: true,
  });
  checkedResult(psdUpload, '上传 PSD 结果', { requireData: true });

  const pngBuffer = await fs.readFile(pngLocal);
  const pngUpload = await sb.storage.from(BUCKET).upload(pngPath, pngBuffer, {
    contentType: 'image/png',
    upsert: true,
  });
  checkedResult(pngUpload, '上传 PNG 结果', { requireData: true });

  await mutateJob(jobId, {
    status: 'succeeded',
    result_psd_path: psdPath,
    result_png_path: pngPath,
    finished_at: now(),
    error_message: null,
    lease_expires_at: null,
  }, { statuses: ['uploading'], expectedAgent: uploadingJob.agent_id, context: '写入任务成功终态' });

  await markUploaded(uploadedMark, 'succeeded');
  log('已上传生成结果:', jobId);
  await cleanupProcessedJob(jobId, directory);
}

async function scanResults() {
  const outbox = path.join(WORKSPACE, 'outbox');
  const entries = await fs.readdir(outbox, { withFileTypes: true }).catch(() => []);
  const jobIds = entries
    .filter((entry) => entry.isDirectory() && UUID_PATTERN.test(entry.name))
    .map((entry) => entry.name.toLowerCase())
    .sort();

  for (const jobId of jobIds) {
    try {
      await processResult(jobId);
    } catch (error) {
      console.error(`结果处理失败 ${jobId}:`, error);
    }
  }
}

async function tick() {
  if (loopBusy || shuttingDown) return;
  loopBusy = true;
  try {
    await publishServiceHeartbeat().catch((error) => log('服务心跳上报失败:', error.message));
    await renewOwnedLeases().catch((error) => log('任务租约续约失败:', error.message));
    await recoverStaleJobs().catch((error) => log('过期任务恢复失败:', error.message));
    await scanResults();

    const job = await claimOne();
    if (job) {
      try {
        await stageJob(job);
      } catch (error) {
        try {
          await failStaging(job, error);
        } catch (markError) {
          throw new AggregateError([error, markError], `任务 ${job.id} 准备失败，且 failed 状态写入失败`);
        }
      }
    }
  } catch (error) {
    console.error('Agent tick error:', error);
  } finally {
    loopBusy = false;
  }
}

async function writePidFile() {
  await writeFileSecure(PID_FILE, `${process.pid}\n`);
}

async function removeOwnPidFile() {
  try {
    const value = (await fs.readFile(PID_FILE, 'utf8')).trim();
    if (value === String(process.pid)) await fs.unlink(PID_FILE);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  if (pollTimer) clearInterval(pollTimer);
  log(`收到 ${signal}，正在安全停止 Mac Agent`);
  await removeOwnPidFile().catch((error) => console.error('清理 PID 文件失败:', error));
  if (instanceLock) await instanceLock.release().catch((error) => console.error('释放单实例锁失败:', error));
  process.exit(0);
}

async function main() {
  await ensureSecureFilesystem();
  instanceLock = await acquireSingleInstance(LOCK_FILE, { workspace: WORKSPACE });
  await writePidFile();
  process.once('SIGINT', () => { void shutdown('SIGINT'); });
  process.once('SIGTERM', () => { void shutdown('SIGTERM'); });

  log('Meeting Poster Mac Agent 已启动');
  log('Agent ID:', AGENT_ID);
  log('Workspace:', WORKSPACE);
  log(`安全限制：单素材最多 ${Math.floor(MAX_INPUT_BYTES / 1024 / 1024)} MiB，仅 PNG/JPEG/WebP`);

  // Startup is fail-closed: the current database contract must be available before polling begins.
  await publishServiceHeartbeat(true);
  await recoverStaleJobs(true);
  await tick();
  pollTimer = setInterval(() => { void tick(); }, POLL_MS);
}

main().catch(async (error) => {
  console.error(error.code === 'AGENT_ALREADY_RUNNING' ? error.message : 'Mac Agent 启动失败:', error);
  await removeOwnPidFile().catch(() => {});
  if (instanceLock) await instanceLock.release().catch(() => {});
  process.exitCode = 1;
});
