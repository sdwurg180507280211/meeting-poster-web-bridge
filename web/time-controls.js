(() => {
  const form = document.getElementById('posterForm');
  const meetingHidden = document.getElementById('meetingTime');
  if (!form || !meetingHidden) return;

  const pad = n => String(n).padStart(2, '0');
  const timeOptions = [];
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 5) timeOptions.push(`${pad(h)}:${pad(m)}`);
  }

  function fillSelect(select, values, placeholder, defaultValue = '') {
    select.innerHTML = '';
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = placeholder;
    select.appendChild(empty);
    values.forEach(value => {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = String(value);
      select.appendChild(option);
    });
    if (defaultValue) select.value = defaultValue;
  }

  function minutes(value) {
    if (!/^\d{2}:\d{2}$/.test(value || '')) return null;
    const [h, m] = value.split(':').map(Number);
    return h * 60 + m;
  }

  function emitInput(el) {
    el?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  const year = document.getElementById('meetingYear');
  const month = document.getElementById('meetingMonth');
  const day = document.getElementById('meetingDay');
  const start = document.getElementById('meetingStart');
  const end = document.getElementById('meetingEnd');

  if (year && month && day && start && end) {
    const nowYear = new Date().getFullYear();
    fillSelect(year, Array.from({ length: 8 }, (_, i) => nowYear - 1 + i), '年份');
    fillSelect(month, Array.from({ length: 12 }, (_, i) => i + 1), '月份');
    fillSelect(day, [], '日期');
    fillSelect(start, timeOptions, '开始', '19:00');
    fillSelect(end, timeOptions, '结束', '20:30');

    function refreshDays() {
      const y = Number(year.value);
      const m = Number(month.value);
      const previous = day.value;
      if (!y || !m) {
        fillSelect(day, [], '日期');
        syncMeeting();
        return;
      }
      const count = new Date(y, m, 0).getDate();
      fillSelect(day, Array.from({ length: count }, (_, i) => i + 1), '日期');
      if (previous && Number(previous) <= count) day.value = previous;
      syncMeeting();
    }

    function syncMeeting() {
      const y = year.value;
      const m = month.value;
      const d = day.value;
      const s = start.value;
      const e = end.value;
      const validTime = s && e && minutes(e) > minutes(s);
      meetingHidden.value = y && m && d && validTime ? `${y}年${Number(m)}月${Number(d)}日 ${s}-${e}` : '';
      emitInput(meetingHidden);
      const wrap = document.getElementById('meetingTimePicker');
      wrap?.classList.toggle('time-invalid', Boolean(s && e && !validTime));
    }

    year.addEventListener('change', refreshDays);
    month.addEventListener('change', refreshDays);
    [day, start, end].forEach(el => el.addEventListener('change', syncMeeting));
    syncMeeting();
  }

  function makeTimeSelect(id, placeholder) {
    const select = document.createElement('select');
    select.id = id;
    select.className = 'compact-select schedule-time-select';
    fillSelect(select, timeOptions, placeholder);
    return select;
  }

  const scheduleStates = [];
  for (let i = 0; i < 4; i++) {
    const hidden = document.getElementById(`s-time-${i}`);
    if (!hidden) continue;
    hidden.type = 'hidden';
    hidden.removeAttribute('placeholder');

    const picker = document.createElement('div');
    picker.className = 'schedule-time-picker';
    const s = makeTimeSelect(`s-start-${i}`, '开始');
    const e = makeTimeSelect(`s-end-${i}`, '结束');
    picker.append(s, e);
    hidden.parentNode.insertBefore(picker, hidden);

    const sync = () => {
      const sm = minutes(s.value);
      const em = minutes(e.value);
      const complete = sm !== null && em !== null;
      const valid = complete && em > sm;
      hidden.value = valid ? `${s.value}-${e.value}` : '';
      emitInput(hidden);
      picker.classList.toggle('time-invalid', complete && !valid);
    };
    s.addEventListener('change', sync);
    e.addEventListener('change', sync);
    scheduleStates.push({ s, e, picker, hidden });
  }

  // 文件选择和裁剪入口统一从海报画布触发；右侧不参与原生 required 校验。
  ['chair-file', 'speaker1-file', 'speaker2-file', 'qrFile'].forEach(id => {
    document.getElementById(id)?.removeAttribute('required');
  });

  form.addEventListener('submit', event => {
    if (year && month && day && start && end) {
      if (!year.value || !month.value || !day.value) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('请选择完整的会议日期。');
        return;
      }
      if (minutes(end.value) <= minutes(start.value)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert('会议结束时间需要晚于开始时间。');
        return;
      }
    }

    for (let i = 0; i < scheduleStates.length; i++) {
      const { s, e } = scheduleStates[i];
      const oneSelected = Boolean(s.value || e.value);
      if (!oneSelected) continue;
      if (!s.value || !e.value || minutes(e.value) <= minutes(s.value)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        alert(`第 ${i + 1} 行日程请选择完整且有效的开始/结束时间。`);
        return;
      }
    }
  }, true);
})();