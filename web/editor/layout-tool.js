(() => {
  'use strict';

  const poster = document.getElementById('posterCanvas');
  const button = document.querySelector('[data-layout-mode]');
  const dock = button?.closest('.text-layout-dock');
  const textLayout = window.posterTextLayout;
  const assetLayout = window.posterAssetLayout;
  if (!poster || !button || !dock || !textLayout || !assetLayout) return;

  const MOVEABLE_SELECTOR = '.moveable-control-box,.moveable-control,.moveable-line,.moveable-area';
  const LONG_PRESS_MS = 560;
  const LONG_PRESS_MOVE_TOLERANCE = 8;
  const SHORTCUT_HELP = [
    '布局工具',
    '文字和头像/二维码均可移动或缩放；双击文字可直接修改内容。',
    '',
    '布局快捷键',
    '方向键：移动 1 px',
    'Shift + 方向键：移动 10 px',
    '⌘/Ctrl + Z：撤销',
    'Shift + ⌘/Ctrl + Z：重做',
    'Esc：取消选择',
    '手机：单指拖元素 · 双指缩放/移动画布',
  ].join('\n');

  let active = false;
  let context = 'text';
  let longPress = null;
  let longPressTimer = null;
  let helpHideTimer = null;
  let suppressClickUntil = 0;

  button.dataset.toolTip = SHORTCUT_HELP;
  button.setAttribute('aria-expanded', 'false');

  function sync() {
    dock.classList.toggle('is-active', active);
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  function activate(kind) {
    context = kind === 'asset' ? 'asset' : 'text';
    if (!active) return;
    if (context === 'asset') {
      textLayout.setEnabled(false);
      assetLayout.setEnabled(true);
    } else {
      assetLayout.setEnabled(false);
      textLayout.setEnabled(true);
    }
    sync();
  }

  function setEnabled(enabled) {
    active = Boolean(enabled);
    if (!active) {
      textLayout.setEnabled(false);
      assetLayout.setEnabled(false);
      sync();
      return;
    }
    activate('text');
  }

  function clearLongPressTimer() {
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = null;
    longPress = null;
  }

  function hideShortcutHelp() {
    if (helpHideTimer) clearTimeout(helpHideTimer);
    helpHideTimer = null;
    button.classList.remove('show-shortcut-help');
    button.setAttribute('aria-expanded', 'false');
  }

  function showShortcutHelp() {
    suppressClickUntil = Date.now() + 900;
    button.classList.add('show-shortcut-help');
    button.setAttribute('aria-expanded', 'true');
    if (helpHideTimer) clearTimeout(helpHideTimer);
    helpHideTimer = setTimeout(hideShortcutHelp, 4500);
  }

  button.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    clearLongPressTimer();
    longPress = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
    longPressTimer = setTimeout(() => {
      longPressTimer = null;
      longPress = null;
      showShortcutHelp();
    }, LONG_PRESS_MS);
  }, true);

  button.addEventListener('pointermove', event => {
    if (!longPress || event.pointerId !== longPress.pointerId) return;
    if (Math.hypot(event.clientX - longPress.x, event.clientY - longPress.y) > LONG_PRESS_MOVE_TOLERANCE) {
      clearLongPressTimer();
    }
  }, true);

  button.addEventListener('pointerup', clearLongPressTimer, true);
  button.addEventListener('pointercancel', clearLongPressTimer, true);
  button.addEventListener('contextmenu', event => event.preventDefault());

  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (Date.now() < suppressClickUntil) return;
    hideShortcutHelp();
    setEnabled(!active);
  }, true);

  poster.addEventListener('pointerdown', event => {
    if (!active || event.button !== 0) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target || target.closest(MOVEABLE_SELECTOR)) return;
    if (target.closest('.canvas-asset-slot')) activate('asset');
    else if (target.closest('.poster-preview-text') || target === poster) activate('text');
  }, true);

  document.addEventListener('pointerdown', event => {
    if (!button.classList.contains('show-shortcut-help')) return;
    if (event.target instanceof Node && button.contains(event.target)) return;
    hideShortcutHelp();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') hideShortcutHelp();
  });

  sync();
  window.posterLayoutTool = Object.freeze({
    setEnabled,
    isEnabled: () => active,
    getContext: () => context,
    showShortcutHelp,
    hideShortcutHelp,
  });
})();
