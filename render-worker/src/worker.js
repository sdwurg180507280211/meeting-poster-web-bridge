'use strict';

const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '..', '.env') });

const { loadTemplate } = require('./template');
const { renderPoster } = require('./renderer');
const { createStore } = require('./supabase');

function integerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  const value = raw == null || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${name} 必须是 ${min} 到 ${max} 之间的整数`);
  }
  return value;
}

function cleanWorkerId(value) {
  const id = String(value || '').trim();
  if (!id || id.length > 128 || /[\u0000-\u001f\u007f]/u.test(id)) throw new Error('WORKER_ID 非法');
  return id;
}

const POLL_MS = integerEnv('POLL_MS', 2000, 500, 60000);
const LEASE_SECONDS = integerEnv('LEASE_SECONDS', 300, 60, 3600);
const MAX_ATTEMPTS = integerEnv('MAX_ATTEMPTS', 3, 1, 20);
const WORKER_ID = cleanWorkerId(process.env.WORKER_ID || `node-renderer:${os.hostname()}`);
const store = createStore({
  url: process.env.SUPABASE_URL,
  key: process.env.SUPABASE_SECRET_KEY,
  bucket: process.env.SUPABASE_BUCKET || 'poster-assets',
});

let running = true;
let busy = false;
const templateCache = new Map();

function log(...args) {
  console.log(new Date().toLocaleString(), ...args);
}

async function templateFor(projectId) {
  if (!templateCache.has(projectId)) templateCache.set(projectId, loadTemplate(projectId));
  return templateCache.get(projectId);
}

async function processJob(job) {
  const projectId = job.payload?.project?.id;
  if (!projectId) throw new Error('任务缺少 payload.project.id');
  await store.startRendering(job, LEASE_SECONDS);
  log('开始渲染', job.id, projectId);

  const [template, assets] = await Promise.all([
    templateFor(projectId),
    store.downloadAssets(job),
  ]);

  const png = await renderPoster({ template, payload: job.payload, assets });
  await store.markUploading(job, LEASE_SECONDS);
  const resultPath = await store.uploadResult(job, png);
  log('渲染完成', job.id, resultPath);
}

async function tick() {
  if (!running || busy) return;
  busy = true;
  let job = null;
  try {
    job = await store.claimNext(WORKER_ID, LEASE_SECONDS, MAX_ATTEMPTS);
    if (!job) return;
    await processJob(job);
  } catch (error) {
    console.error(new Date().toLocaleString(), '渲染失败', job?.id || '-', error);
    if (job) await store.fail(job, error);
  } finally {
    busy = false;
  }
}

async function main() {
  log('Node PNG Renderer 已启动', WORKER_ID);
  while (running) {
    await tick();
    if (!running) break;
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
}

function stop(signal) {
  if (!running) return;
  running = false;
  log(`收到 ${signal}，等待当前任务结束后退出`);
}

process.on('SIGINT', () => stop('SIGINT'));
process.on('SIGTERM', () => stop('SIGTERM'));

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
