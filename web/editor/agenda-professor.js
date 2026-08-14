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

  function isEmptyCell(kind, index) {
    return EMPTY_CELLS.some(([emptyKind, emptyIndex]) => emptyKind === kind && emptyIndex === index);
  }

  function baseName(value) {
    return String(value || '').trim().replace(/\s*教授\s*$/u, '').trim();
  }

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

  function eachEditableCell(callback) {
    for (let i = 0; i < 4; i++) {
      for (const kind of ['speaker', 'chair']) {
        if (isEmptyCell(kind, i)) continue;
        const el = document.getElementById(`s-${kind}-${i}`);
        if (el) callback(el, kind, i);
      }
    }
  }

  function syncPreview(el, kind, index) {
    const preview = document.querySelector(`[data-preview-text-id="agenda-${index}-${kind}"]`);
    if (!preview) return;
    const name = baseName(el.value);
    preview.textContent = name ? `${name}${SUFFIX}` : 'xxx 教授';
  }

  function enforceBaseValue(el, kind, index) {
    const next = baseName(el.value);
    if (next !== el.value) {
      el.value = next;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    syncPreview(el, kind, index);
  }

  function normalizeAll() {
    clearEmptyCells();
    eachEditableCell((el, kind, index) => enforceBaseValue(el, kind, index));
  }

  eachEditableCell((el, kind, index) => {
    el.placeholder = kind === 'speaker' ? '讲者姓名（自动加 教授）' : '主席姓名（自动加 教授）';
    el.addEventListener('input', () => enforceBaseValue(el, kind, index));
  });

  normalizeAll();
  document.addEventListener('poster-draft-scalars-restored', normalizeAll);

  // 编辑数据始终只保存姓名；提交瞬间补齐固定后缀，供现有 Render Contract 使用。
  form.addEventListener('submit', () => {
    clearEmptyCells();
    const restore = [];
    eachEditableCell((el, kind, index) => {
      const name = baseName(el.value);
      restore.push([el, name, kind, index]);
      el.value = name ? `${name}${SUFFIX}` : '';
    });
    queueMicrotask(() => {
      for (const [el, name, kind, index] of restore) {
        el.value = name;
        syncPreview(el, kind, index);
      }
    });
  }, true);
})();