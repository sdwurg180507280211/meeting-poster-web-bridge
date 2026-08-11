(() => {
  const poster = document.getElementById('posterCanvas');
  const workspace = document.getElementById('editorWorkspace');
  const inspector = document.getElementById('inspector');
  if (!poster || !workspace || !inspector) return;

  // 与当前 PSD 母版一致的头像/二维码几何坐标（837 × 1880）。
  const avatarSpec = {
    chair: { left:342, top:496, size:168, name:'主席' },
    speaker1: { left:221, top:836, size:168, name:'讲者一' },
    speaker2: { left:457, top:836, size:168, name:'讲者二' },
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
    slot.innerHTML=`<img alt="${spec.name}头像">`;
    poster.appendChild(slot);
    const img=slot.querySelector('img');
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
      img.src=url; img.style.display='block';
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
    chair:{name:[340,682,172,24],hospital:[329,717,194,18]},
    speaker1:{name:[218,1018,174,24],hospital:[209,1056,192,18]},
    speaker2:{name:[454,1017,174,24],hospital:[445,1055,192,18]},
  };

  function formatPersonName(value){
    const text=String(value||'').trim().replace(/\s*教授\s*$/u,'').trim();
    return `${text||'姓名'} 教授`;
  }

  Object.entries(personTextSpec).forEach(([key,sp])=>{
    [['name','姓名'],['hospital','XXXXXXXXXXXX医院']].forEach(([field,label])=>{
      const [l,t,w,h]=sp[field]; const el=document.createElement('div');
      el.className=`canvas-person-text canvas-${key}-${field}`;
      el.style.left=pct(l,W);el.style.top=pct(t,H);el.style.width=pct(w,W);el.style.minHeight=pct(h,H);
      poster.appendChild(el);
      const input=document.getElementById(`${key}-${field}`);
      const sync=()=>{
        el.textContent=field==='name'
          ? formatPersonName(input?.value)
          : (input?.value.trim()||label);
      };
      input?.addEventListener('input',sync);
      sync();
      el.addEventListener('click',()=>{openSection('people');input?.focus();});
    });
  });

  const meetingTime=document.getElementById('meetingTime');
  const canvasTime=document.getElementById('canvasMeetingTime');
  const syncTime=()=>{
    const raw=meetingTime?.value.trim()||'';
    const dateText=raw.split(/\s+/)[0]||'';
    canvasTime.textContent=`会议时间：${dateText}`;
  };
  meetingTime?.addEventListener('input',syncTime); syncTime();
  canvasTime?.addEventListener('click',()=>{
    openSection('meeting');
    window.posterTimeControls?.openMeeting?.();
  });

  const agenda=document.getElementById('canvasAgenda');
  const agendaPlaceholders=[
    ['00:00-00:00','开场致辞','xxx 教授','xxx 教授'],
    ['00:00-00:00','xxxxx','xxx 教授',''],
    ['00:00-00:00','xxxxx','xxx 教授',''],
    ['00:00-00:00','会议总结','','xxx 教授'],
  ];
  // 参考海报正文的真实文字坐标，不再用 Grid 均分底图表格。
  const agendaRowsTop=[1310,1375,1439,1503];
  const agendaCells=[
    { left:91, width:122, align:'left' },
    { left:262, width:190, align:'left' },
    { left:491, width:132, align:'left' },
    { left:638, width:128, align:'left' },
  ];
  function syncAgenda(){
    agenda.innerHTML='';
    for(let i=0;i<4;i++){
      const row=document.createElement('div');
      row.className='canvas-agenda-row';
      row.style.top=pct(agendaRowsTop[i],H);
      const vals=['time','content','speaker','chair'].map((k,j)=>{
        const value=document.getElementById(`s-${k}-${i}`)?.value.trim()||'';
        return value || agendaPlaceholders[i][j];
      });
      vals.forEach((v,j)=>{
        const s=document.createElement('span');
        s.textContent=v;
        s.style.left=pct(agendaCells[j].left,W);
        s.style.width=pct(agendaCells[j].width,W);
        s.style.textAlign=agendaCells[j].align;
        row.appendChild(s);
      });
      row.addEventListener('click',()=>{
        openSection('schedule');
        window.posterTimeControls?.openSchedule?.(i);
      });
      agenda.appendChild(row);
    }
  }
  for(let i=0;i<4;i++) ['time','content','speaker','chair'].forEach(k=>document.getElementById(`s-${k}-${i}`)?.addEventListener('input',syncAgenda));
  syncAgenda();

  const qrSlot=document.createElement('div');
  qrSlot.className='canvas-qr-slot';
  qrSlot.style.left=pct(QR.left,W);qrSlot.style.top=pct(QR.top,H);qrSlot.style.width=pct(QR.size,W);qrSlot.style.height=pct(QR.size,H);
  qrSlot.innerHTML='<img alt="二维码">';
  poster.appendChild(qrSlot);
  const qrImg=qrSlot.querySelector('img');
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
