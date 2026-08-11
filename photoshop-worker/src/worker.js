const engine = require('./src/render-contract');
const SPEC = require('./src/constants');
const { app, core } = require('photoshop');
const { storage } = require('uxp');
const fs = storage.localFileSystem;
const PREF='meetingPosterWebWorkerPrefsV1';
const WORKER_VERSION='1.1.0';
const HEARTBEAT_INTERVAL_MS=5000;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const $=s=>document.querySelector(s);
const state={template:null,workspace:null,running:false,busy:false,timer:null,templateReady:false,templateError:''};
function log(m){$('#log').textContent+=`${new Date().toLocaleTimeString()} ${m}\n`;$('#log').scrollTop=$('#log').scrollHeight;}
function setState(m,cls=''){$('#state').textContent=m;$('#state').className=cls;}
function display(e){return e?(e.nativePath||e.name||''):'';}
async function savePrefs(){const p={template:null,workspace:null};if(state.template)p.template=await fs.createPersistentToken(state.template);if(state.workspace)p.workspace=await fs.createPersistentToken(state.workspace);localStorage.setItem(PREF,JSON.stringify(p));}
async function restore(token){if(!token)return null;try{return await fs.getEntryForPersistentToken(token);}catch{return null;}}
async function loadPrefs(){try{const p=JSON.parse(localStorage.getItem(PREF)||'{}');state.template=await restore(p.template);state.workspace=await restore(p.workspace);refreshPaths();}catch(e){log(`设置恢复失败：${e.message}`)}}
function refreshPaths(){$('#templatePath').textContent=display(state.template)||'未选择';$('#workspacePath').textContent=display(state.workspace)||'未选择';}
async function findChild(folder,name){const entries=await folder.getEntries();return entries.find(e=>e.name===name)||null;}
async function ensureFolder(folder,name){let e=await findChild(folder,name);if(e)return e;return folder.createFolder(name);}
async function readJson(file){return JSON.parse(await file.read({format:storage.formats.utf8}));}
async function writeJson(folder,name,obj){let f=await findChild(folder,name);if(!f)f=await folder.createFile(name,{overwrite:true});await f.write(JSON.stringify(obj,null,2),{format:storage.formats.utf8});}
async function fileByName(folder,name){const f=await findChild(folder,name);if(!f)throw new Error(`任务素材不存在：${name}`);return f;}
function sleep(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
function isTransientDocumentIdError(error){
  const text=String(error&&error.message?error.message:error||'');
  return /(?:document|文档).*id.*undefined|id of undefined/i.test(text);
}
function heartbeatStatus(){
  if(!state.template||!state.workspace)return 'not_ready';
  if(!state.templateReady)return 'template_error';
  return state.running?(state.busy?'busy':'ready'):'stopped';
}
async function writeHeartbeat(status=heartbeatStatus()){
  if(!state.workspace)return;
  try{
    await writeJson(state.workspace,'worker-heartbeat.json',{
      status,
      updatedAt:new Date().toISOString(),
      workerVersion:WORKER_VERSION,
      templateVersion:SPEC.TEMPLATE_VERSION||'unknown',
      templateReady:state.templateReady,
      templateError:state.templateError||null,
      expectedCanvas:{width:SPEC.EXPECTED_WIDTH,height:SPEC.EXPECTED_HEIGHT}
    });
  }catch(e){log(`心跳写入失败：${e.message}`);}
}

async function validateSelectedTemplate(){
  state.templateReady=false;
  state.templateError='';
  if(!state.template){await writeHeartbeat('not_ready');return false;}
  setState('正在校验 PSD 母版…');
  try{
    const repair=await core.executeAsModal(async()=>{
      let doc=null;
      try{
        doc=await app.open(state.template);
        app.activeDocument=doc;
        const result=engine.repairLegacyTextLayerNames(doc,SPEC);
        engine.validateTemplate(doc,SPEC);
        return result;
      }finally{
        if(doc){try{doc.closeWithoutSaving();}catch(_){}}
      }
    },{commandName:'校验会议海报 PSD 母版'});
    state.templateReady=true;
    if(repair?.renamed?.length)log(`母版自检通过；兼容修复旧文字层命名 ${repair.renamed.length} 个（仅内存校验，不修改母版）`);
    else log(`✓ PSD 母版自检通过：${SPEC.TEMPLATE_VERSION||'template'} · ${SPEC.EXPECTED_WIDTH}×${SPEC.EXPECTED_HEIGHT}`);
    setState(state.running?'自动接单中 · 当前无任务':'PSD 母版已通过自检','ok');
    await writeHeartbeat(state.running?'ready':'stopped');
    return true;
  }catch(e){
    state.templateError=e.message||String(e);
    log(`✗ PSD 母版自检失败：${state.templateError}`);
    setState(`PSD 母版异常：${state.templateError}`,'bad');
    await writeHeartbeat('template_error');
    return false;
  }
}

function safeTaskFileName(value,label){
  if(typeof value!=='string'||!value||value.length>255||value.includes('/')||value.includes('\\')||/[\u0000-\u001f\u007f]/.test(value)){
    throw new Error(`${label}文件名无效`);
  }
  if(!/\.(?:png|jpe?g|webp)$/i.test(value))throw new Error(`${label}文件类型无效`);
  return value;
}

function normalizeWorkerAvatarAsset(asset,label){
  const cropMode=asset.cropMode==null?'raw':asset.cropMode;
  if(cropMode!=='raw'&&cropMode!=='baked')throw new Error(`${label}的 cropMode 只允许 raw 或 baked`);

  const crop=asset.crop==null?{}:asset.crop;
  if(!crop||typeof crop!=='object'||Array.isArray(crop))throw new Error(`${label}的裁剪参数无效`);
  const zoom=crop.zoom==null?1:Number(crop.zoom);
  const offsetX=crop.offsetX==null?0:Number(crop.offsetX);
  const offsetY=crop.offsetY==null?0:Number(crop.offsetY);
  if(!Number.isFinite(zoom)||zoom<0.2||zoom>3.5||!Number.isFinite(offsetX)||Math.abs(offsetX)>100||!Number.isFinite(offsetY)||Math.abs(offsetY)>100){
    throw new Error(`${label}的裁剪参数超出允许范围`);
  }
  asset.crop={zoom,offsetX,offsetY};

  if(cropMode==='baked'){
    if(asset.outputSize!==1024)throw new Error(`${label}的 baked outputSize 必须为 1024`);
    if(!/\.png$/i.test(asset.fileName))throw new Error(`${label}的 baked 成品必须是 PNG`);
    if(zoom!==1||offsetX!==0||offsetY!==0){
      throw new Error(`${label}的 baked 裁剪参数必须为 zoom=1、offsetX=0、offsetY=0`);
    }
    asset.outputSize=1024;
  }else if(asset.outputSize!=null){
    throw new Error(`${label}的 raw 模式不应包含 outputSize`);
  }
  asset.cropMode=cropMode;
  return asset;
}

function validateWorkerJob(job,folderName){
  if(!job||typeof job!=='object'||Array.isArray(job))throw new Error('job.json 根对象无效');
  if(typeof job.id!=='string'||!UUID_PATTERN.test(job.id)||job.id.toLowerCase()!==folderName.toLowerCase()){
    throw new Error('job.json 的任务 ID 与目录不一致');
  }
  if(!job.meeting||typeof job.meeting!=='object'||Array.isArray(job.meeting))throw new Error('job.json 缺少会议信息');
  if(!job.assets||typeof job.assets!=='object'||Array.isArray(job.assets))throw new Error('job.json 缺少素材信息');
  for(const [key,label] of [['chairAvatar','主席头像'],['speaker1Avatar','讲者一头像'],['speaker2Avatar','讲者二头像'],['qrCode','二维码']]){
    const asset=job.assets[key];
    if(!asset||typeof asset!=='object'||Array.isArray(asset))throw new Error(`job.json 缺少${label}`);
    safeTaskFileName(asset.fileName,label);
    if(key==='qrCode'){
      if(asset.cropMode!=null||asset.outputSize!=null)throw new Error('二维码不支持头像裁剪模式');
    }else{
      normalizeWorkerAvatarAsset(asset,label);
    }
  }
  return job;
}

function startBusyHeartbeat(){
  let pending=Promise.resolve();
  const pulse=()=>{
    pending=pending.then(()=>writeHeartbeat('busy')).catch(e=>log(`忙碌心跳写入失败：${e.message}`));
    return pending;
  };
  pulse();
  const timer=setInterval(pulse,HEARTBEAT_INTERVAL_MS);
  return {
    pulse,
    async stop(){clearInterval(timer);await pending;}
  };
}

async function processFolder(jobFolder,outbox){
  let job=null;
  let out=null;
  let busyHeartbeat=null;
  let lastProgress='读取任务';
  try{
    const resultExistingFolder=await findChild(outbox,jobFolder.name);
    if(resultExistingFolder && await findChild(resultExistingFolder,'result.json')) return false;
    const jobFile=await findChild(jobFolder,'job.json');
    if(!jobFile)return false;

    out=await ensureFolder(outbox,jobFolder.name);
    busyHeartbeat=startBusyHeartbeat();
    job=validateWorkerJob(await readJson(jobFile),jobFolder.name);
    lastProgress='准备任务';
    log(`开始任务 ${job.id}`); setState(`正在生成：${job.id}`);
    const a=job.assets||{};
    const assets={
      chairAvatar:{entry:await fileByName(jobFolder,a.chairAvatar.fileName),crop:a.chairAvatar.crop||{},cropMode:a.chairAvatar.cropMode,outputSize:a.chairAvatar.outputSize},
      speaker1Avatar:{entry:await fileByName(jobFolder,a.speaker1Avatar.fileName),crop:a.speaker1Avatar.crop||{},cropMode:a.speaker1Avatar.cropMode,outputSize:a.speaker1Avatar.outputSize},
      speaker2Avatar:{entry:await fileByName(jobFolder,a.speaker2Avatar.fileName),crop:a.speaker2Avatar.crop||{},cropMode:a.speaker2Avatar.cropMode,outputSize:a.speaker2Avatar.outputSize},
      qrCode:await fileByName(jobFolder,a.qrCode.fileName)
    };
    const runGenerate=()=>engine.generatePoster({
      templateEntry:state.template,
      outputFolderEntry:out,
      meeting:job.meeting,
      assets,
      spec:SPEC,
      onProgress:m=>{lastProgress=m;log(`→ ${m}`);busyHeartbeat.pulse();}
    });

    let result;
    try{
      result=await runGenerate();
    }catch(firstError){
      if(!isTransientDocumentIdError(firstError))throw firstError;
      log(`⚠ 检测到 Photoshop 文档引用失效：${firstError.message}`);
      log('→ 等待 800ms 后自动重试一次');
      lastProgress='自动恢复：等待后重新打开 PSD 母版';
      await sleep(800);
      result=await runGenerate();
    }

    await writeJson(out,'result.json',{status:'succeeded',jobId:job.id,baseName:result.baseName,psdFileName:`${result.baseName}.psd`,pngFileName:`${result.baseName}.png`,finishedAt:new Date().toISOString()});
    log(`✓ 完成 ${job.id}`); setState('空闲，等待下一任务','ok'); return true;
  }catch(e){
    const detail=`阶段：${lastProgress}；${e.message||String(e)}`;
    console.error(e);
    const jobId=job&&job.id?job.id:jobFolder.name;
    try{
      if(!out)out=await ensureFolder(outbox,jobFolder.name);
      await writeJson(out,'result.json',{status:'failed',jobId,error:detail,stage:lastProgress,finishedAt:new Date().toISOString()});
    }catch(writeError){
      console.error(writeError);
      log(`失败结果写入失败：${writeError.message}`);
    }
    log(`✗ ${jobId}: ${detail}`); setState(`失败：${detail}`,'bad'); return true;
  }finally{
    if(busyHeartbeat)await busyHeartbeat.stop();
    await writeHeartbeat();
  }
}

async function scanOnce(){
  if(state.busy)return;
  if(!state.template||!state.workspace){setState('请先选择母版和 Workspace','bad');await writeHeartbeat('not_ready');return;}
  if(!state.templateReady){setState(`PSD 母版异常：${state.templateError||'请重新选择并完成自检'}`,'bad');await writeHeartbeat('template_error');return;}
  state.busy=true;
  try{
    await writeHeartbeat(state.running?'ready':'stopped');
    const inbox=await ensureFolder(state.workspace,'inbox'); const outbox=await ensureFolder(state.workspace,'outbox'); const entries=await inbox.getEntries();
    const folders=entries.filter(e=>e.isFolder).sort((a,b)=>a.name.localeCompare(b.name)); let handled=false;
    for(const folder of folders){
      try{if(await processFolder(folder,outbox)){handled=true;break;}}
      catch(e){console.error(e);log(`任务目录 ${folder.name} 处理异常：${e.message}`);}
    }
    if(!handled)setState(state.running?'自动接单中 · 当前无任务':'已就绪','ok');
  }catch(e){console.error(e);log(`扫描失败：${e.message}`);setState(`扫描失败：${e.message}`,'bad');await writeHeartbeat('error');}
  finally{state.busy=false;}
}
function start(){
  if(!state.template||!state.workspace){setState('请先选择母版和 Workspace','bad');writeHeartbeat('not_ready');return;}
  if(!state.templateReady){setState(`PSD 母版异常：${state.templateError||'请重新选择母版'}`,'bad');writeHeartbeat('template_error');return;}
  if(state.timer)clearInterval(state.timer);
  state.running=true;
  $('#toggle').textContent='停止自动接单';
  state.timer=setInterval(scanOnce,2000);
  writeHeartbeat('ready');
  scanOnce();
}
function stop(){state.running=false;if(state.timer){clearInterval(state.timer);state.timer=null;}$('#toggle').textContent='启动自动接单';setState('自动接单已停止');writeHeartbeat('stopped');}

$('#pickTemplate').addEventListener('click',async()=>{
  const e=await fs.getFileForOpening({types:['psd'],allowMultiple:false});
  if(!e)return;
  const resume=state.running;
  if(resume)stop();
  state.template=e;
  refreshPaths();
  await savePrefs();
  log(`母版：${display(e)}`);
  const valid=await validateSelectedTemplate();
  if(valid&&resume&&state.workspace)start();
});
$('#pickWorkspace').addEventListener('click',async()=>{const e=await fs.getFolder();if(e){state.workspace=e;refreshPaths();await ensureFolder(e,'inbox');await ensureFolder(e,'outbox');await savePrefs();await writeHeartbeat();log(`Workspace：${display(e)}`);}});
$('#toggle').addEventListener('click',()=>state.running?stop():start());
$('#scan').addEventListener('click',scanOnce);
loadPrefs().then(async()=>{
  if(state.template&&state.workspace){
    const valid=await validateSelectedTemplate();
    if(valid){log('已恢复设置并通过母版自检，自动开始接单。');start();}
  }else{
    setState('请完成一次性设置');
    await writeHeartbeat('not_ready');
  }
});
