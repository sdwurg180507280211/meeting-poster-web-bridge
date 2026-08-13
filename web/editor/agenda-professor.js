(() => {
  const form = document.getElementById('posterForm');
  if (!form) return;

  const SUFFIX = ' 教授';

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

  for (let i = 0; i < 4; i++) {
    for (const kind of ['speaker', 'chair']) {
      const el = document.getElementById(`s-${kind}-${i}`);
      if (!el) continue;
      el.placeholder = kind === 'speaker' ? '讲者（自动加 教授）' : '主席（自动加 教授）';
      el.addEventListener('blur', () => apply(el));
      el.addEventListener('change', () => apply(el));
      if (el.value) apply(el);
    }
  }

  // 在 app.js 收集 payload 之前统一补齐，确保即使用户未离开输入框也会带“ 教授”。
  form.addEventListener('submit', () => {
    for (let i = 0; i < 4; i++) {
      apply(document.getElementById(`s-speaker-${i}`));
      apply(document.getElementById(`s-chair-${i}`));
    }
  }, true);
})();
