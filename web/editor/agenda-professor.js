(() => {
  const form = document.getElementById('posterForm');
  if (!form) return;

  const SUFFIX = ' 教授';
  const firstRowSpeaker = document.getElementById('s-speaker-0');

  function clearFirstRowSpeaker() {
    if (!firstRowSpeaker) return;
    firstRowSpeaker.value = '';
    firstRowSpeaker.disabled = true;
    firstRowSpeaker.classList.add('schedule-cell-hidden');
    firstRowSpeaker.setAttribute('aria-hidden', 'true');
    firstRowSpeaker.tabIndex = -1;
  }

  function normalize(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    const base = text.replace(/\s*教授\s*$/u, '').trim();
    return base ? `${base}${SUFFIX}` : '';
  }

  function apply(el) {
    if (!el) return;
    const next = normalize(el.value);
    if (next === el.value) return;
    el.value = next;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  clearFirstRowSpeaker();

  for (let i = 0; i < 4; i++) {
    for (const kind of ['speaker', 'chair']) {
      if (i === 0 && kind === 'speaker') continue;
      const el = document.getElementById(`s-${kind}-${i}`);
      if (!el) continue;
      el.placeholder = kind === 'speaker' ? '讲者（自动加 教授）' : '主席（自动加 教授）';
      el.addEventListener('blur', () => apply(el));
      el.addEventListener('change', () => apply(el));
      if (el.value) apply(el);
    }
  }

  document.addEventListener('poster-draft-scalars-restored', clearFirstRowSpeaker);

  // 在 app.js 收集 payload 之前统一补齐，确保即使用户未离开输入框也会带“ 教授”。
  form.addEventListener('submit', () => {
    clearFirstRowSpeaker();
    for (let i = 0; i < 4; i++) {
      if (i > 0) apply(document.getElementById(`s-speaker-${i}`));
      apply(document.getElementById(`s-chair-${i}`));
    }
  }, true);
})();
