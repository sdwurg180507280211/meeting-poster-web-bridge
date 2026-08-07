const engine = require('./src/ps-engine');
const SPEC = require('./src/constants');
const { storage } = require('uxp');
const fs = storage.localFileSystem;
const PREF='meetingPosterWebWorkerPrefsV1';
const $=s=>document.querySelector(s);
const state={template:null,workspace:null,running:false,busy:false,timer:null};
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
async function writeHeartbeat(status){
  if(!state.workspace)return;
  try{await writeJson(state.workspace,'worker-heartbeat.json',{status,updatedAt:new Date().toISOString()});}
  catch(e){log(`心跳写入失败：${e.message}`);}
}

async function processFolder(jobFolder,outbox){
  const resultExistingFolder=await findChild(outbox,jobFolder.name); if(resultExistingFolder && await findChild(resultExistingFolder,'result.json')) return false;
  const jobFile=await findChild(jobFolder,'job.json'); if(!jobFile)return false;
  const job=await readJson(jobFile); const out=await ensureFolder(outbox,job.id||jobFolder.name);
  try{
    await writeHeartbeat('busy');
    log(`开始任务 ${job.id}`); setState(`正在生成：${job.id}`);
    const a=job.assets||{};
    const assets={
      chairAvatar:{entry:await fileByName(jobFolder,a.chairAvatar.fileName),crop:a.chairAvatar.crop||{}},
      speaker1Avatar:{entry:await fileByName(jobFolder,a.speaker1Avatar.fileName),crop:a.speaker1Avatar.crop||{}},
      speaker2Avatar:{entry:await fileByName(jobFolder,a.speaker2Avatar.fileName),crop:a.speaker2Avatar.crop||{}},
      qrCode:await fileByName(jobFolder,a.qrCode.fileName)
    };
    const result=await engine.generatePoster({templateEntry:state.template,outputFolderEntry:out,meeting:job.meeting,assets,spec:SPEC,onProgress:m=>log(`→ ${m}`)});
    await writeJson(out,'result.json',{status:'succeeded',jobId:job.id,baseName:result.baseName,psdFileName:`${result.baseName}.psd`,pngFileName:`${result.baseName}.png`,finishedAt:new Date().toISOString()});
    await writeHeartbeat('ready');
    log(`✓ 完成 ${job.id}`); setState('空闲，等待下一任务','ok'); return true;
  }catch(e){
    console.error(e); await writeJson(out,'result.json',{status:'failed',jobId:job.id,error:e.message||String(e),finishedAt:new Date().toISOString()}); await writeHeartbeat('ready'); log(`✗ ${job.id}: ${e.message}`); setState(`失败：${e.message}`,'bad'); return true;
  }
}

async function scanOnce(){
  if(state.busy)return;
  if(!state.template||!state.workspace){setState('请先选择母版和 Workspace','bad');await writeHeartbeat('not_ready');return;}
  state.busy=true;
  try{
    await writeHeartbeat(state.running?'ready':'stopped');
    const inbox=await ensureFolder(state.workspace,'inbox'); const outbox=await ensureFolder(state.workspace,'outbox'); const entries=await inbox.getEntries();
    const folders=entries.filter(e=>e.isFolder).sort((a,b)=>a.name.localeCompare(b.name)); let handled=false;
    for(const folder of folders){if(await processFolder(folder,outbox)){handled=true;break;}}
    if(!handled)setState(state.running?'自动接单中 · 当前无任务':'已就绪','ok');
  }catch(e){console.error(e);log(`扫描失败：${e.message}`);setState(`扫描失败：${e.message}`,'bad');await writeHeartbeat('error');}
  finally{state.busy=false;}
}
function start(){if(state.timer)clearInterval(state.timer);state.running=true;$('#toggle').textContent='停止自动接单';state.timer=setInterval(scanOnce,2000);writeHeartbeat('ready');scanOnce();}
function stop(){state.running=false;if(state.timer){clearInterval(state.timer);state.timer=null;}$('#toggle').textContent='启动自动接单';setState('自动接单已停止');writeHeartbeat('stopped');}

$('#pickTemplate').addEventListener('click',async()=>{const e=await fs.getFileForOpening({types:['psd'],allowMultiple:false});if(e){state.template=e;refreshPaths();await savePrefs();await writeHeartbeat(state.running?'ready':'stopped');log(`母版：${display(e)}`);}});
$('#pickWorkspace').addEventListener('click',async()=>{const e=await fs.getFolder();if(e){state.workspace=e;refreshPaths();await ensureFolder(e,'inbox');await ensureFolder(e,'outbox');await savePrefs();await writeHeartbeat(state.template&&state.running?'ready':'not_ready');log(`Workspace：${display(e)}`);}});
$('#toggle').addEventListener('click',()=>state.running?stop():start());
$('#scan').addEventListener('click',scanOnce);
loadPrefs().then(()=>{if(state.template&&state.workspace){log('已恢复设置，自动开始接单。');start();}else setState('请完成一次性设置');});
