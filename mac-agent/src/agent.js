require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs/promises');
const path = require('path');
const os = require('os');

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) throw new Error('请在 .env 配置 SUPABASE_URL，并填写 SUPABASE_SECRET_KEY（推荐）或旧版 SUPABASE_SERVICE_ROLE_KEY');
const BUCKET = process.env.SUPABASE_BUCKET || 'poster-assets';
const WORKSPACE = expandHome(process.env.WORKSPACE_DIR || '~/MeetingPosterAgent');
const POLL_MS = Number(process.env.POLL_MS || 2000);
const AGENT_ID = process.env.AGENT_ID || os.hostname();
const KEEP = String(process.env.KEEP_LOCAL_JOBS || 'true').toLowerCase() === 'true';
const sb = createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
let loopBusy = false;

function expandHome(p) { return p && p.startsWith('~/') ? path.join(os.homedir(), p.slice(2)) : p; }
function now() { return new Date().toISOString(); }
function log(...args){ console.log(new Date().toLocaleTimeString(), ...args); }
async function ensureDirs(){ for(const name of ['inbox','outbox','archive']) await fs.mkdir(path.join(WORKSPACE,name),{recursive:true}); }
async function exists(p){ try{await fs.access(p);return true;}catch{return false;} }
async function writeJson(p,obj){await fs.writeFile(p,JSON.stringify(obj,null,2),'utf8');}
async function readJson(p){return JSON.parse(await fs.readFile(p,'utf8'));}

async function claimOne(){
  const {data,error}=await sb.from('poster_jobs').select('*').eq('status','pending').order('created_at',{ascending:true}).limit(1);
  if(error) throw error; if(!data?.length) return null;
  const job=data[0];
  const {data:claimed,error:claimErr}=await sb.from('poster_jobs')
    .update({status:'claimed',agent_id:AGENT_ID,claimed_at:now()})
    .eq('id',job.id).eq('status','pending').select('*').maybeSingle();
  if(claimErr) throw claimErr; return claimed || null;
}

async function downloadStorage(storagePath, localPath){
  const {data,error}=await sb.storage.from(BUCKET).download(storagePath); if(error) throw error;
  const buf=Buffer.from(await data.arrayBuffer()); await fs.writeFile(localPath,buf);
}

async function stageJob(job){
  const dir=path.join(WORKSPACE,'inbox',job.id); await fs.mkdir(dir,{recursive:true});
  const assets=job.payload.assets || {}; const localAssets={};
  const mapping=[['chair','chairAvatar'],['speaker1','speaker1Avatar'],['speaker2','speaker2Avatar'],['qrCode','qrCode']];
  for(const [srcKey,dstKey] of mapping){
    const a=assets[srcKey]; if(!a?.storagePath) throw new Error(`任务缺少素材 ${srcKey}`);
    const ext=path.extname(a.originalName||a.storagePath)||'.png'; const fileName=`${srcKey}${ext}`;
    await downloadStorage(a.storagePath,path.join(dir,fileName));
    localAssets[dstKey]={fileName,crop:a.crop||{zoom:1,offsetX:0,offsetY:0}};
  }
  const workerJob={id:job.id,ownerId:job.owner_id,meeting:job.payload.meeting,assets:localAssets,createdAt:job.created_at};
  await writeJson(path.join(dir,'job.json'),workerJob);
  await sb.from('poster_jobs').update({status:'rendering',started_at:now()}).eq('id',job.id);
  log('已送入 Photoshop inbox:',job.id);
}

async function scanResults(){
  const outbox=path.join(WORKSPACE,'outbox'); const ids=await fs.readdir(outbox).catch(()=>[]);
  for(const id of ids){
    const dir=path.join(outbox,id); const resultPath=path.join(dir,'result.json'); const uploadedMark=path.join(dir,'.uploaded');
    if(!(await exists(resultPath)) || await exists(uploadedMark)) continue;
    let result; try{result=await readJson(resultPath);}catch(e){log('result.json 读取失败',id,e.message);continue;}
    if(result.status==='failed'){
      await sb.from('poster_jobs').update({status:'failed',error_message:result.error||'Photoshop 生成失败',finished_at:now()}).eq('id',id);
      await fs.writeFile(uploadedMark,'failed','utf8'); log('Photoshop 失败:',id,result.error); continue;
    }
    const {data:job,error}=await sb.from('poster_jobs').select('id,owner_id,status').eq('id',id).single(); if(error){log(error.message);continue;}
    await sb.from('poster_jobs').update({status:'uploading'}).eq('id',id);
    const base=`${job.owner_id}/${id}/output`;
    const psdLocal=path.join(dir,result.psdFileName), pngLocal=path.join(dir,result.pngFileName);
    const psdPath=`${base}/${result.psdFileName}`, pngPath=`${base}/${result.pngFileName}`;
    const [psd,png]=await Promise.all([fs.readFile(psdLocal),fs.readFile(pngLocal)]);
    const up1=await sb.storage.from(BUCKET).upload(psdPath,psd,{contentType:'image/vnd.adobe.photoshop',upsert:true}); if(up1.error) throw up1.error;
    const up2=await sb.storage.from(BUCKET).upload(pngPath,png,{contentType:'image/png',upsert:true}); if(up2.error) throw up2.error;
    await sb.from('poster_jobs').update({status:'succeeded',result_psd_path:psdPath,result_png_path:pngPath,finished_at:now(),error_message:null}).eq('id',id);
    await fs.writeFile(uploadedMark,now(),'utf8'); log('已上传生成结果:',id);
    if(!KEEP){
      await fs.rm(path.join(WORKSPACE,'inbox',id),{recursive:true,force:true});
      await fs.rm(dir,{recursive:true,force:true});
    }
  }
}

async function tick(){
  if(loopBusy) return; loopBusy=true;
  try{
    await scanResults();
    const job=await claimOne(); if(job) await stageJob(job);
  }catch(e){console.error('Agent tick error:',e);}
  finally{loopBusy=false;}
}

(async()=>{
  await ensureDirs();
  log('Meeting Poster Mac Agent 已启动');
  log('Agent ID:',AGENT_ID); log('Workspace:',WORKSPACE);
  await tick(); setInterval(tick,POLL_MS);
})();
