(() => {
  const poster = document.getElementById('posterCanvas');
  const workspace = document.getElementById('editorWorkspace');
  const inspector = document.getElementById('inspector');
  if (!poster || !workspace || !inspector) return;

  const avatarSpec = {
    chair: { left:342, top:496, size:168, name:'主席' },
    speaker1: { left:221, top:836, size:165, name:'讲者一' },
    speaker2: { left:457, top:836, size:164, name:'讲者二' },
  };
  const QR = { left:338, top:1576, size:148 };
  const W=837, H=1880;

  function pct(v,total){return `${(v/total)*100}%`;}
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
    slot.innerHTML=`<img alt="${spec.name}头像"><span>${spec.name}<br>点击裁剪</span>`;
    poster.appendChild(slot);
    const img=slot.querySelector('img');
    const hint=slot.querySelector('span');
    const file=document.getElementById(`${key}-file`);
    const zoom=document.getElementById(`${key}-zoom`);
    const sx=document.getElementById(`${key}-x`);
    const sy=document.getElementById(`${key}-y`);

    function syncPreview(){
      if(!img.naturalWidth)return;
      const box=slot.getBoundingClientRect().width || 1;
      const z=(Number(zoom?.value||100))/100;
      const x=Number(sx?.value||0), y=Number(sy?.value||0);
      const cover=Math.max(box/img.naturalWidth,box/img.naturalHeight);
      const w=img.naturalWidth*cover*z, h=img.naturalHeight*cover*z;
      img.style.inset='auto';
      img.style.width=`${w}px`;
      img.style.height=`${h}px`;
      img.style.left=`${(box-w)/2+(x/100)*box}px`;
      img.style.top=`${(box-h)/2+(y/100)*box}px`;
      img.style.transform='none';
      img.style.objectFit='initial';
    }

    file?.addEventListener('change',()=>{
      const f=file.files?.[0]; if(!f)return;
      const url=URL.createObjectURL(f);
      img.onload=()=>{syncPreview();URL.revokeObjectURL(url);};
      img.src=url; img.style.display='block'; hint.style.display='none';
    });
    [zoom,sx,sy].forEach(el=>el?.addEventListener('input',syncPreview));

    function openAvatarEditor(){
      openSection('people');
      if(window.posterAvatarCrop?.open) window.posterAvatarCrop.open(key);
      else if(!file?.files?.length) file?.click();
    }
    slot.addEventListener('click',openAvatarEditor);
    slot.addEventListener('dblclick',openAvatarEditor);
    document.addEventListener('avatar-crop-applied',e=>{if(e.detail?.key===key)syncPreview();});
    window.addEventListener('resize',syncPreview);
  }

  Object.entries(avatarSpec).forEach(([k,s])=>createAvatarSlot(k,s));

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
  canvasTime?.addEventListener('click',()=>{
    openSection('meeting');
    document.getElementById('meetingYear')?.focus();
  });

  const agenda=document.getElementById('canvasAgenda');
  function syncAgenda(){
    agenda.innerHTML='';
    for(let i=0;i<4;i++){
      const row=document.createElement('div'); row.className='canvas-agenda-row';
      const vals=['time','content','speaker','chair'].map(k=>document.getElementById(`s-${k}-${i}`)?.value.trim()||'');
      vals.forEach((v,j)=>{const s=document.createElement('span');s.textContent=v||['时间','内容','讲者','主席'][j];row.appendChild(s);});
      row.addEventListener('click',()=>{
        openSection('schedule');
        document.getElementById(`s-start-${i}`)?.focus();
      });
      agenda.appendChild(row);
    }
  }
  for(let i=0;i<4;i++) ['time','content','speaker','chair'].forEach(k=>document.getElementById(`s-${k}-${i}`)?.addEventListener('input',syncAgenda));
  syncAgenda();

  const qrSlot=document.createElement('div');
  qrSlot.className='canvas-qr-slot';
  qrSlot.style.left=pct(QR.left,W);qrSlot.style.top=pct(QR.top,H);qrSlot.style.width=pct(QR.size,W);qrSlot.style.height=pct(QR.size,H);
  qrSlot.innerHTML='<img alt="二维码"><span>二维码<br>点击裁剪</span>';
  poster.appendChild(qrSlot);
  const qrImg=qrSlot.querySelector('img');
  const qrHint=qrSlot.querySelector('span');
  const qrInput=document.getElementById('qrFile');

  function openQrEditor(){
    openSection('qr');
    if (window.posterQrCrop?.open) window.posterQrCrop.open();
    else if (!qrInput?.files?.length) qrInput?.click();
  }
  qrSlot.addEventListener('click',openQrEditor);
  qrSlot.addEventListener('dblclick',openQrEditor);

  document.addEventListener('qr-crop-applied',e=>{
    const url=e.detail?.previewUrl;
    if(!url)return;
    qrImg.src=url;
    qrImg.style.display='block';
    qrImg.style.width='100%';
    qrImg.style.height='100%';
    qrImg.style.objectFit='cover';
    qrImg.style.transform='none';
    qrHint.style.display='none';
  });

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
  document.getElementById('jobStatus')?.addEventListener('click',()=>showTab('task'));
})();