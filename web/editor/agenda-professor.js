(() => {
  const form = document.getElementById('posterForm');
  if (!form) return;

  const SUFFIX = ' 教授';
  const EMPTY_CELLS = Object.freeze([
    ['speaker', 0],
    ['chair', 1],
    ['chair', 2],
    ['speaker', 3],
  ]);

  function clearEmptyCells() {
    for (const [kind, index] of EMPTY_CELLS) {
      const el = document.getElementById(`s-${kind}-${index}`);
      if (!el) continue;
      el.value = '';
      el.disabled = true;
      el.classList.add('schedule-cell-hidden');
      el.setAttribute('aria-hidden', 'true');
      el.tabIndex = -1;
    }
  }

  function isEmptyCell(kind, index) {
    return EMPTY_CELLS.some(([emptyKind, emptyIndex]) => emptyKind === kind && emptyIndex === index);
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

  for (let i = 0; i < 4; i++) {
    for (const kind of ['speaker', 'chair']) {
      if (isEmptyCell(kind, i)) continue;
      const el = document.getElementById(`s-${kind}-${i}`);
      if (!el) continue;
      el.placeholder = kind === 'speaker' ? '讲者（自动加 教授）' : '主席（自动加 教授）';
      el.addEventListener('blur', () => apply(el));
      el.addEventListener('change', () => apply(el));
      if (el.value) apply(el);
    }
  }

  clearEmptyCells();
  document.addEventListener('poster-draft-scalars-restored', clearEmptyCells);

  // 在 app.js 收集 payload 之前统一补齐，确保即使用户未离开输入框也会带“ 教授”。
  form.addEventListener('submit', () => {
    clearEmptyCells();
    for (let i = 0; i < 4; i++) {
      if (!isEmptyCell('speaker', i)) apply(document.getElementById(`s-speaker-${i}`));
      if (!isEmptyCell('chair', i)) apply(document.getElementById(`s-chair-${i}`));
    }
  }, true);
})();
