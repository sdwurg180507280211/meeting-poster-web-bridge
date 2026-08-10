(() => {
  const poster = document.getElementById('posterCanvas');
  const workspace = document.getElementById('editorWorkspace');
  const inspector = document.getElementById('inspector');
  if (!poster || !workspace || !inspector) return;

  const avatarSpec = {
    chair: { left:347, top:504, size:150, name:'主席' },
    speaker1: { left:223, top:844, size:150, name:'讲者一' },
    speaker2: { left:463, top:844, size:150, name:'讲者二' },
  };
  const QR = { left:338, top:1576, size:148 };
  const W=837, H=1880;
  const qrState={source:null,url:'',zoom:1,offsetX:0,offsetY:0,loaded:false};

  function pct(v,total){return `${(v/total)*100}%`;}
  function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
  function dispatchInput(el){el.dispatchEvent(new Event('input',{bubbles:true}));}
  function openSection(name){
    document.querySelectorAll('.editor-section').forEach(d=>{ if(d.dataset.section===name) d.open=true; });
    showTab('edit');
    expandInspector();
  }

  function createAvatarSlot(key,spec){
    const slot=document.createElement('div');
    slot.className='canvas-avatar-slot';
    slot.dataset.key=key;
    slot.style.left=pct(spec.left,W); slot.style.top=pct(spec.top,H);
    slot.style.width=pct(spec.size,W); slot.style.height=pct(spec.size,H);
    slot.innerHTML=`<img alt="${spec.name}头像"><span>${spec.name}<br>点击上传</span>`;
    poster.appendChild(slot);
    const img=slot.querySelector('img');
    const hint=slot.querySelector('span');
    const file=document.getElementById(`${key}-file`);
    const zoom=document.getElementById(`${key}-zoom`);
    const sx=document.getElementById(`${key}-x`);
    const sy=document.getElementById(`${key}-y`);

    function syncPreview(){
      const z=(Number(zoom?.value||100))/100;
      const x=Number(sx?.value||0), y=Number(sy?.value||0);
      img.style.transform=`translate(${x}%,${y}%) scale(${z})`;
    }
    file?.addEventListener('change',()=>{
      const f=file.files?.[0]; if(!f)return;
      img.src=URL.createObjectURL(f); img.style.display='block'; hint.style.display='none';
      syncPreview();
    });
    [zoom,sx,sy].forEach(el=>el?.addEventListener('input',syncPreview));

    slot.addEventListener('dblclick',()=>file?.click());
    slot.addEventListener('click',()=>{
      openSection('people');
      const input=document.getElementById(`${key}-name`); input?.focus({preventScroll:true});
      if(!file?.files?.length) file?.click();
    });
    bindDragZoom(slot,()=>({zoom,sx,sy}),syncPreview);
  }

  function bindDragZoom(target,getControls,onChange){
    let dragging=false,px=0,py=0,startX=0,startY=0;
    target.addEventListener('pointerdown',e=>{
      if(e.button!==0)return;
      const {sx,sy}=getControls(); if(!sx||!sy)return;
      dragging=true; target.setPointerCapture(e.pointerId);
      px=e.clientX; py=e.clientY; startX=Number(sx.value||0); startY=Number(sy.value||0);
      target.classList.add('dragging'); e.preventDefault();
    });
    target.addEventListener('pointermove',e=>{
      if(!dragging)return;
      const {sx,sy}=getControls(); const r=target.getBoundingClientRect();
      sx.value=String(clamp(startX+(e.clientX-px)/r.width*100,-100,100));
      sy.value=String(clamp(startY+(e.clientY-py)/r.height*100,-100,100));
      dispatchInput(sx); dispatchInput(sy); onChange?.();
    });
    const end=e=>{if(!dragging)return;dragging=false;target.classList.remove('dragging');try{target.releasePointerCapture(e.pointerId)}catch{}};
    target.addEventListener('pointerup',end); target.addEventListener('pointercancel',end);
    target.addEventListener('wheel',e=>{
      const {zoom}=getControls(); if(!zoom)return;
      e.preventDefault();
      const next=clamp(Number(zoom.value||100)+(e.deltaY<0?5:-5),100,250);
      zoom.value=String(next); dispatchInput(zoom); onChange?.();
    },{passive:false});
  }

  Object.entries(avatarSpec).forEach(([k,s])=>createAvatarSlot(k,s));

  // 人物姓名/医院直接出现在海报位置。
  const personTextSpec={
    chair:{name:[362,682,114,24],hospital:[341,717,155,18]},
    speaker1:{name:[247,1018,109,24],hospital:[223,1044,155,18]},
    speaker2:{name:[494,1017,109,24],hospital:[470,1044,155,18]},
  };
  Object.entries(personTextSpec).forEach(([key,sp])=>{
    [['name','姓名'],['hospital','医院']].forEach(([field,label])=>{
      const [l,t,w,h]=sp[field]; const el=document.createElement('div');
      el.className=`canvas-person-text canvas-${key}-${field}`;
      el.style.left=pct(l,W);el.style.top=pct(t,H);el.style.width=pct(w,W);el.style.minHeight=pct(h,H);
      el.textContent=label; poster.appendChild(el);
      const input=document.getElementById(`${key}-${field}`);
      const sync=()=>{el.textContent=input?.value.trim()||label;}; input?.addEventListener('input',sync); sync();
      el.addEventListener('click',()=>{openSection('people');input?.focus();});
    });
  });

  const meetingTime=document.getElementById('meetingTime');
  const canvasTime=document.getElementById('canvasMeetingTime');
  const syncTime=()=>{canvasTime.textContent=`会议时间：${meetingTime?.value.trim()||''}`;};
  meetingTime?.addEventListener('input',syncTime); syncTime();
  canvasTime?.addEventListener('click',()=>{openSection('meeting');meetingTime?.focus();});

  const agenda=document.getElementById('canvasAgenda');
  function syncAgenda(){
    agenda.innerHTML='';
    for(let i=0;i<4;i++){
      const row=document.createElement('div'); row.className='canvas-agenda-row';
      const vals=['time','content','speaker','chair'].map(k=>document.getElementById(`s-${k}-${i}`)?.value.trim()||'');
      vals.forEach((v,j)=>{const s=document.createElement('span');s.textContent=v||['时间','内容','讲者','主席'][j];row.appendChild(s);});
      row.addEventListener('click',()=>{openSection('schedule');document.getElementById(`s-time-${i}`)?.focus();});
      agenda.appendChild(row);
    }
  }
  for(let i=0;i<4;i++) ['time','content','speaker','chair'].forEach(k=>document.getElementById(`s-${k}-${i}`)?.addEventListener('input',syncAgenda));
  syncAgenda();

  // 二维码：画布上直接拖动 + 滚轮缩放，提交前真正裁成方形 PNG。
  const qrSlot=document.createElement('div'); qrSlot.className='canvas-qr-slot';
  qrSlot.style.left=pct(QR.left,W);qrSlot.style.top=pct(QR.top,H);qrSlot.style.width=pct(QR.size,W);qrSlot.style.height=pct(QR.size,H);
  qrSlot.innerHTML='<img alt="二维码"><span>二维码<br>点击上传</span>';
  poster.appendChild(qrSlot);
  const qrImg=qrSlot.querySelector('img'),qrHint=qrSlot.querySelector('span'),qrInput=document.getElementById('qrFile'),readout=document.getElementById('qrCropReadout');
  function renderQr(){qrImg.style.transform=`translate(${qrState.offsetX}%,${qrState.offsetY}%) scale(${qrState.zoom})`;if(readout)readout.textContent=`缩放 ${Math.round(qrState.zoom*100)}% · X ${Math.round(qrState.offsetX)} · Y ${Math.round(qrState.offsetY)}`;}
  qrInput?.addEventListener('change',()=>{
    const f=qrInput.files?.[0];if(!f)return;
    qrState.source=f; if(qrState.url)URL.revokeObjectURL(qrState.url);qrState.url=URL.createObjectURL(f);
    const im=new Image(); im.onload=()=>{qrState.loaded=true;qrImg.src=qrState.url;qrImg.style.display='block';qrHint.style.display='none';renderQr();};im.src=qrState.url;
  });
  qrSlot.addEventListener('click',()=>{openSection('qr');if(!qrState.source)qrInput?.click();}); qrSlot.addEventListener('dblclick',()=>qrInput?.click());
  let qdrag=false,qx=0,qy=0,qsx=0,qsy=0;
  qrSlot.addEventListener('pointerdown',e=>{if(e.button!==0||!qrState.source)return;qdrag=true;qx=e.clientX;qy=e.clientY;qsx=qrState.offsetX;qsy=qrState.offsetY;qrSlot.setPointerCapture(e.pointerId);qrSlot.classList.add('dragging');e.preventDefault();});
  qrSlot.addEventListener('pointermove',e=>{if(!qdrag)return;const r=qrSlot.getBoundingClientRect();qrState.offsetX=clamp(qsx+(e.clientX-qx)/r.width*100,-100,100);qrState.offsetY=clamp(qsy+(e.clientY-qy)/r.height*100,-100,100);renderQr();});
  qrSlot.addEventListener('pointerup',e=>{qdrag=false;qrSlot.classList.remove('dragging');try{qrSlot.releasePointerCapture(e.pointerId)}catch{}});
  qrSlot.addEventListener('wheel',e=>{if(!qrState.source)return;e.preventDefault();qrState.zoom=clamp(qrState.zoom+(e.deltaY<0?.05:-.05),1,3);renderQr();},{passive:false});
  document.getElementById('resetQrCrop')?.addEventListener('click',()=>{qrState.zoom=1;qrState.offsetX=0;qrState.offsetY=0;renderQr();});

  function makeCroppedQrFile(){
    if(!qrState.source||!qrState.loaded||!qrImg.naturalWidth)return null;
    const size=1024,w=qrImg.naturalWidth,h=qrImg.naturalHeight;
    const base=Math.max(size/w,size/h),scale=base*qrState.zoom;
    const dw=w*scale,dh=h*scale;
    const dx=(size-dw)/2+(qrState.offsetX/100)*size,dy=(size-dh)/2+(qrState.offsetY/100)*size;
    const c=document.createElement('canvas');c.width=size;c.height=size;const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,size,size);ctx.drawImage(qrImg,dx,dy,dw,dh);
    const data=c.toDataURL('image/png');const b64=data.split(',')[1];const bin=atob(b64);const bytes=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)bytes[i]=bin.charCodeAt(i);
    return new File([bytes],'qr-cropped.png',{type:'image/png'});
  }
  document.getElementById('posterForm')?.addEventListener('submit',()=>{
    const cropped=makeCroppedQrFile();if(!cropped||!qrInput)return;
    try{const dt=new DataTransfer();dt.items.add(cropped);qrInput.files=dt.files;}catch(err){console.warn('无法替换裁剪后的二维码文件',err);}
  },true);

  // Inspector：可完全收起；Tab 切换。
  function collapseInspector(){workspace.classList.add('inspector-collapsed');}
  function expandInspector(){workspace.classList.remove('inspector-collapsed');}
  document.getElementById('collapseInspector')?.addEventListener('click',collapseInspector);
  document.getElementById('toggleInspector')?.addEventListener('click',()=>workspace.classList.toggle('inspector-collapsed'));
  document.getElementById('openInspector')?.addEventListener('click',expandInspector);
  function showTab(name){
    document.querySelectorAll('.inspector-tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));
    document.getElementById('editTab')?.classList.toggle('active',name==='edit');
    document.getElementById('taskTab')?.classList.toggle('active',name==='task');
  }
  document.querySelectorAll('.inspector-tab').forEach(b=>b.addEventListener('click',()=>showTab(b.dataset.tab)));
  window.__posterShowTaskTab=()=>{showTab('task');expandInspector();};

  // 任务成功时用户通常想看结果，点击状态区也可切换到任务 Tab。
  document.getElementById('jobStatus')?.addEventListener('click',()=>showTab('task'));
})();
