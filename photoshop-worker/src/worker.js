const engine = require('./src/render-contract');
const SPEC = require('./src/constants');
const { PROJECTS, PROJECT_BY_ID } = require('./src/projects');
const { app, core } = require('photoshop');
const { storage } = require('uxp');
const fs = storage.localFileSystem;
const PREF='meetingPosterWebWorkerPrefsV1';
const WORKER_VERSION='1.2.0';
const HEARTBEAT_INTERVAL_MS=5000;
const UUID_PATTERN=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const $=s=>document.querySelector(s);
const state={templates:{},workspace:null,running:false,busy:false,timer:null};
for(const project of PROJECTS){state.templates[project.id]={entry:null,ready:false,error:''};}
function log(m){$('#log').textContent+=`${new Date().toLocaleTimeString()} ${m}\n`;$('#log').scrollTop=$('#log').scrollHeight;}
function setState(m,cls=''){$('#state').textContent=m;$('#state').className=cls;}
function display(e){return e?(e.nativePath||e.name||''):'';}
function templateState(projectId){return state.templates[projectId]||null;}
function readyProjectCount(){return PROJECTS.filter(project=>templateState(project.id)?.ready).length;}
function configuredProjectCount(){return PROJECTS.filter(project=>Boolean(templateState(project.id)?.entry)).length;}
function projectHeartbeat(){
  const result={};
  for(const project of PROJECTS){
    const template=templateState(project.id);
    result[project.id]={
      name:project.name,
      ready:Boolean(template?.ready),
      error:template?.error||null,
      templateVersion:SPEC.TEMPLATE_VERSION||'unknown'
    };
  }
  return result;
}
function refreshTemplatePaths(){
  for(const project of PROJECTS){
    const el=$(`#templatePath-${project.id}`);
    if(!el)continue;
    const template=templateState(project.id);
    el.textContent=display(template?.entry)||'未选择';
    el.className=`path ${template?.ready?'ok':template?.error?'bad':''}`;
  }
  $('#workspacePath').textContent=display(state.workspace)||'未选择';
}
async function savePrefs(){
  const p={templates:{},workspace:null};
  for(const project of PROJECTS){
    const entry=templateState(project.id)?.entry;
    if(entry)p.templates[project.id]=await fs.createPersistentToken(entry);
  }
  if(state.workspace)p.workspace=await fs.createPersistentToken(state.workspace);
  localStorage.setItem(PREF,JSON.stringify(p));
}
async function restore(token){if(!token)return null;try{return await fs.getEntryForPersistentToken(token);}catch{return null;}}
async function loadPrefs(){
  try{
    const p=JSON.parse(localStorage.getItem(PREF)||'{}');
    if(p.templates&&typeof p.templates==='object'){
      for(const project of PROJECTS){templateState(project.id).entry=await restore(p.templates[project.id]);}
    }else if(p.template){
      // v1 单母版设置自动迁移为现有“医路长安”项目，避免升级后要求重新选择旧 PSD。
      templateState('chronic-care-2026').entry=await restore(p.template);
    }
    state.workspace=await restore(p.workspace);
    refreshTemplatePaths();
  }catch(e){log(`设置恢复失败：${e.message}`)}
}
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
  if(!state.workspace)return 'not_ready';
  if(!readyProjectCount())return 'template_error';
  return state.running?(state.busy?'busy':'ready'):'stopped';
}
async function writeHeartbeat(status=heartbeatStatus()){
  if(!state.workspace)return;
  try{
    const readyCount=readyProjectCount();
    await writeJson(state.workspace,'worker-heartbeat.json',{
      status,
      updatedAt:new Date().toISOString(),
      workerVersion:WORKER_VERSION,
      templateVersion:SPEC.TEMPLATE_VERSION||'unknown',
      templateReady:readyCount>0,
      templateError:readyCount?null:'没有已通过自检的项目 PSD 母版',
      expectedCanvas:{width:SPEC.EXPECTED_WIDTH,height:SPEC.EXPECTED_HEIGHT},
      projects:projectHeartbeat()
    });
  }catch(e){log(`心跳写入失败：${e.message}`);}
}
function refreshOverallState(){
  const ready=readyProjectCount();
  const configured=configuredProjectCount();
  if(!state.workspace){setState('请先选择 Agent Workspace','bad');return;}
  if(!ready){setState(`PSD 母版未就绪 · 已选择 ${configured}/${PROJECTS.length}`,'bad');return;}
  if(state.running)setState(`自动接单中 · PSD 就绪 ${ready}/${PROJECTS.length}`,'ok');
  else setState(`已就绪 ${ready}/${PROJECTS.length} · 自动接单已停止`,ready===PROJECTS.length?'ok':'');
}
async function validateSelectedTemplate(projectId){
  const project=PROJECT_BY_ID[projectId];
  const template=templateState(projectId);
  if(!project||!template)throw new Error(`未知项目：${projectId}`);
  template.ready=false;
  template.error='';
  if(!template.entry){
    template.error='未选择 PSD 母版';
    refreshTemplatePaths();
    refreshOverallState();
    if(!readyProjectCount())await writeHeartbeat('template_error');else await writeHeartbeat();
    return false;
  }
  setState(`正在校验 ${project.name} PSD 母版…`);
  try{
    const repair=await core.executeAsModal(async()=>{
      let doc=null;
      try{
        doc=await app.open(template.entry);
        app.activeDocument=doc;
        const result=engine.repairLegacyTextLayerNames(doc,SPEC);
        engine.validateTemplate(doc,SPEC);
        return result;
      }finally{
        if(doc){try{doc.closeWithoutSaving();}catch(_){}}
      }
    },{commandName:`校验 ${project.name} PSD 母版`});
    template.ready=true;
    if(repair?.renamed?.length)log(`[${project.name}] 母版自检通过；兼容修复旧文字层命名 ${repair.renamed.length} 个（仅内存校验，不修改母版）`);
    else log(`[${project.name}] ✓ PSD 母版自检通过：${SPEC.TEMPLATE_VERSION||'template'} · ${SPEC.EXPECTED_WIDTH}×${SPEC.EXPECTED_HEIGHT}`);
    refreshTemplatePaths();
    refreshOverallState();
    await writeHeartbeat();
    return true;
  }catch(e){
    template.error=e.message||String(e);
    log(`[${project.name}] ✗ PSD 母版自检失败：${template.error}`);
    refreshTemplatePaths();
    refreshOverallState();
    if(!readyProjectCount())await writeHeartbeat('template_error');else await writeHeartbeat();
    return false;
  }
}
async function validateConfiguredTemplates(){
  for(const project of PROJECTS){
    if(templateState(project.id)?.entry)await validateSelectedTemplate(project.id);
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
    if(zoom!==1||offsetX!==0||offsetY!==0)throw new Error(`${label}的 baked 裁剪参数必须为 zoom=1、offsetX=0、offsetY=0`);
    asset.outputSize=1024;
  }else if(asset.outputSize!=null){
    throw new Error(`${label}的 raw 模式不应包含 outputSize`);
  }
  asset.cropMode=cropMode;
  return asset;
}
function validateWorkerJob(job,folderName){
  if(!job||typeof job!=='object'||Array.isArray(job))throw new Error('job.json 根对象无效');
  if(typeof job.id!=='string'||!UUID_PATTERN.test(job.id)||job.id.toLowerCase()!==folderName.toLowerCase())throw new Error('job.json 的任务 ID 与目录不一致');
  if(!job.meeting||typeof job.meeting!=='object'||Array.isArray(job.meeting))throw new Error('job.json 缺少会议信息');
  if(!job.assets||typeof job.assets!=='object'||Array.isArray(job.assets))throw new Error('job.json 缺少素材信息');
  const projectId=job.meeting?.__renderContract?.project?.id;
  if(typeof projectId!=='string'||!PROJECT_BY_ID[projectId])throw new Error(`任务项目未注册：${projectId||'未知'}`);
  job.projectId=projectId;
  for(const [key,label] of [['chairAvatar','主席头像'],['speaker1Avatar','讲者一头像'],['speaker2Avatar','讲者二头像'],['qrCode','二维码']]){
    const asset=job.assets[key];
    if(!asset||typeof asset!=='object'||Array.isArray(asset))throw new Error(`job.json 缺少${label}`);
    safeTaskFileName(asset.fileName,label);
    if(key==='qrCode'){
      if(asset.cropMode!=null||asset.outputSize!=null)throw new Error('二维码不支持头像裁剪模式');
    }else normalizeWorkerAvatarAsset(asset,label);
  }
  return job;
}
function startBusyHeartbeat(){
  let pending=Promise.resolve();
  const pulse=()=>{pending=pending.then(()=>writeHeartbeat('busy')).catch(e=>log(`忙碌心跳写入失败：${e.message}`));return pending;};
  pulse();
  const timer=setInterval(pulse,HEARTBEAT_INTERVAL_MS);
  return {pulse,async stop(){clearInterval(timer);await pending;}};
}
async function processFolder(jobFolder,outbox){
  let job=null;
  let out=null;
  let busyHeartbeat=null;
  let lastProgress='读取任务';
  try{
    const resultExistingFolder=await findChild(outbox,jobFolder.name);
    if(resultExistingFolder&&await findChild(resultExistingFolder,'result.json'))return false;
    const jobFile=await findChild(jobFolder,'job.json');
    if(!jobFile)return false;
    out=await ensureFolder(outbox,jobFolder.name);
    busyHeartbeat=startBusyHeartbeat();
    job=validateWorkerJob(await readJson(jobFile),jobFolder.name);
    const project=PROJECT_BY_ID[job.projectId];
    const template=templateState(job.projectId);
    if(!template?.entry||!template.ready)throw new Error(`项目“${project.name}”的本地 PSD 母版未配置或未通过自检`);
    lastProgress='准备任务';
    log(`开始任务 ${job.id} · ${project.name}`);setState(`正在生成：${project.name} · ${job.id}`);
    const a=job.assets||{};
    const assets={
      chairAvatar:{entry:await fileByName(jobFolder,a.chairAvatar.fileName),crop:a.chairAvatar.crop||{},cropMode:a.chairAvatar.cropMode,outputSize:a.chairAvatar.outputSize},
      speaker1Avatar:{entry:await fileByName(jobFolder,a.speaker1Avatar.fileName),crop:a.speaker1Avatar.crop||{},cropMode:a.speaker1Avatar.cropMode,outputSize:a.speaker1Avatar.outputSize},
      speaker2Avatar:{entry:await fileByName(jobFolder,a.speaker2Avatar.fileName),crop:a.speaker2Avatar.crop||{},cropMode:a.speaker2Avatar.cropMode,outputSize:a.speaker2Avatar.outputSize},
      qrCode:await fileByName(jobFolder,a.qrCode.fileName)
    };
    const runGenerate=()=>engine.generatePoster({
      templateEntry:template.entry,
      outputFolderEntry:out,
      meeting:job.meeting,
      assets,
      spec:SPEC,
      onProgress:m=>{lastProgress=m;log(`→ ${m}`);busyHeartbeat.pulse();}
    });
    let result;
    try{result=await runGenerate();}
    catch(firstError){
      if(!isTransientDocumentIdError(firstError))throw firstError;
      log(`⚠ 检测到 Photoshop 文档引用失效：${firstError.message}`);
      log('→ 等待 800ms 后自动重试一次');
      lastProgress='自动恢复：等待后重新打开 PSD 母版';
      await sleep(800);
      result=await runGenerate();
    }
    await writeJson(out,'result.json',{status:'succeeded',jobId:job.id,projectId:job.projectId,baseName:result.baseName,psdFileName:`${result.baseName}.psd`,pngFileName:`${result.baseName}.png`,finishedAt:new Date().toISOString()});
    log(`✓ 完成 ${job.id} · ${project.name}`);refreshOverallState();return true;
  }catch(e){
    const detail=`阶段：${lastProgress}；${e.message||String(e)}`;
    console.error(e);
    const jobId=job&&job.id?job.id:jobFolder.name;
    try{
      if(!out)out=await ensureFolder(outbox,jobFolder.name);
      await writeJson(out,'result.json',{status:'failed',jobId,projectId:job?.projectId||null,error:detail,stage:lastProgress,finishedAt:new Date().toISOString()});
    }catch(writeError){console.error(writeError);log(`失败结果写入失败：${writeError.message}`);}
    log(`✗ ${jobId}: ${detail}`);setState(`失败：${detail}`,'bad');return true;
  }finally{
    if(busyHeartbeat)await busyHeartbeat.stop();
    await writeHeartbeat();
  }
}
async function scanOnce(){
  if(state.busy)return;
  if(!state.workspace){setState('请先选择 Workspace','bad');return;}
  if(!readyProjectCount()){setState('请至少配置一份通过自检的项目 PSD 母版','bad');await writeHeartbeat('template_error');return;}
  state.busy=true;
  try{
    await writeHeartbeat(state.running?'ready':'stopped');
    const inbox=await ensureFolder(state.workspace,'inbox');const outbox=await ensureFolder(state.workspace,'outbox');const entries=await inbox.getEntries();
    const folders=entries.filter(e=>e.isFolder).sort((a,b)=>a.name.localeCompare(b.name));let handled=false;
    for(const folder of folders){
      try{if(await processFolder(folder,outbox)){handled=true;break;}}
      catch(e){console.error(e);log(`任务目录 ${folder.name} 处理异常：${e.message}`);}
    }
    if(!handled)refreshOverallState();
  }catch(e){console.error(e);log(`扫描失败：${e.message}`);setState(`扫描失败：${e.message}`,'bad');await writeHeartbeat('error');}
  finally{state.busy=false;}
}
function start(){
  if(!state.workspace){setState('请先选择 Workspace','bad');return;}
  if(!readyProjectCount()){setState('请至少配置一份通过自检的项目 PSD 母版','bad');writeHeartbeat('template_error');return;}
  if(state.timer)clearInterval(state.timer);
  state.running=true;
  $('#toggle').textContent='停止自动接单';
  state.timer=setInterval(scanOnce,2000);
  writeHeartbeat('ready');
  refreshOverallState();
  scanOnce();
}
function stop(){state.running=false;if(state.timer){clearInterval(state.timer);state.timer=null;}$('#toggle').textContent='启动自动接单';refreshOverallState();writeHeartbeat('stopped');}
function installTemplateRows(){
  const root=$('#templateProjects');
  if(!root)return;
  root.innerHTML='';
  for(const project of PROJECTS){
    const row=document.createElement('div');
    row.className='template-project';
    row.innerHTML=`<div class="template-project-head"><strong>${project.name}</strong><span>${SPEC.TEMPLATE_VERSION||'template'}</span></div><button type="button" data-template-project="${project.id}">选择 ${project.name} PSD</button><div id="templatePath-${project.id}" class="path">未选择</div>`;
    root.appendChild(row);
  }
  root.querySelectorAll('[data-template-project]').forEach(button=>button.addEventListener('click',async()=>{
    const projectId=button.dataset.templateProject;
    const project=PROJECT_BY_ID[projectId];
    const entry=await fs.getFileForOpening({types:['psd'],allowMultiple:false});
    if(!entry)return;
    const resume=state.running;
    if(resume)stop();
    const template=templateState(projectId);
    template.entry=entry;template.ready=false;template.error='';
    refreshTemplatePaths();
    await savePrefs();
    log(`[${project.name}] 母版：${display(entry)}`);
    await validateSelectedTemplate(projectId);
    if(resume&&state.workspace&&readyProjectCount())start();
  }));
}
$('#pickWorkspace').addEventListener('click',async()=>{
  const entry=await fs.getFolder();
  if(entry){state.workspace=entry;refreshTemplatePaths();await ensureFolder(entry,'inbox');await ensureFolder(entry,'outbox');await savePrefs();await writeHeartbeat();log(`Workspace：${display(entry)}`);refreshOverallState();}
});
$('#toggle').addEventListener('click',()=>state.running?stop():start());
$('#scan').addEventListener('click',scanOnce);
installTemplateRows();
loadPrefs().then(async()=>{
  await validateConfiguredTemplates();
  refreshTemplatePaths();
  if(state.workspace&&readyProjectCount()){
    log(`已恢复设置，${readyProjectCount()}/${PROJECTS.length} 个项目 PSD 通过自检，自动开始接单。`);
    start();
  }else{
    refreshOverallState();
    await writeHeartbeat(state.workspace?'template_error':'not_ready');
  }
});
