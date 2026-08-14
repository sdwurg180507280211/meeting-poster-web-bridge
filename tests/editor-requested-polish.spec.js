const { test, expect } = require('@playwright/test');

test('fresh editor provides a useful meeting-time default', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const meetingTime = page.locator('#meetingTime');
  await expect(meetingTime).toHaveValue(/^\d{4}年\d{1,2}月\d{1,2}日 19:00-21:30$/);
  await expect(page.locator('[data-preview-text-id="meeting-time"]')).toContainText('会议时间：');
});

test('agenda professor suffix stays visible in preview but out of the mobile editor', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('[data-preview-text-id="agenda-0-chair"]')).toBeVisible();

  await page.evaluate(() => {
    const input = document.getElementById('s-chair-0');
    input.value = '张三 教授';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  await expect(page.locator('#s-chair-0')).toHaveValue('张三');
  const preview = page.locator('[data-preview-text-id="agenda-0-chair"]');
  await expect(preview).toHaveText('张三 教授');

  await preview.click();
  const editor = page.locator('.mobile-text-popover-input');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveValue('张三');
  await expect(editor).not.toHaveValue(/教授/);

  await editor.fill('李四');
  await page.locator('[data-mobile-text-apply]').click();
  await expect(page.locator('#s-chair-0')).toHaveValue('李四');
  await expect(preview).toHaveText('李四 教授');
});

test('mobile keeps only center control and supports two-finger navigation in layout mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const controls = page.locator('.zoom-controls');
  await expect(controls.locator('.pan-center-btn')).toBeVisible();
  await expect(controls.locator('[data-zoom="in"]')).toBeHidden();
  await expect(controls.locator('[data-zoom="out"]')).toBeHidden();
  await expect(controls.locator('[data-zoom="fit"]')).toBeHidden();
  await expect(controls.locator('.zoom-value')).toBeHidden();

  const layoutButton = page.locator('[data-layout-mode]');
  await expect(layoutButton).toBeEnabled();
  await layoutButton.click();
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool?.isEnabled?.())).toBe(true);

  const navigation = await page.evaluate(async () => {
    const viewport = document.querySelector('.poster-viewport');
    const before = {
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
      zoom: window.posterZoomControls?.get?.() || 1,
    };
    const fire = (type, pointerId, x, y, isPrimary) => viewport.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary,
      clientX: x,
      clientY: y,
    }));

    fire('pointerdown', 21, 110, 300, true);
    fire('pointerdown', 22, 210, 300, false);
    fire('pointermove', 21, 80, 320, true);
    fire('pointermove', 22, 290, 340, false);
    fire('pointerup', 21, 80, 320, true);
    fire('pointerup', 22, 290, 340, false);

    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      before,
      after: {
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        zoom: window.posterZoomControls?.get?.() || 1,
      },
      pinching: viewport.classList.contains('is-pinching'),
    };
  });

  expect(navigation.after.zoom).toBeGreaterThan(navigation.before.zoom);
  expect(
    Math.abs(navigation.after.left - navigation.before.left)
      + Math.abs(navigation.after.top - navigation.before.top),
  ).toBeGreaterThan(1);
  expect(navigation.pinching).toBe(false);
});

test('long press on mobile L button shows shortcuts without toggling layout mode', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const button = page.locator('[data-layout-mode]');
  await expect(button).toBeEnabled();
  const box = await button.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(620);

  await expect(button).toHaveClass(/show-shortcut-help/);
  const help = await button.evaluate(element => ({
    text: element.dataset.toolTip || '',
    display: getComputedStyle(element, '::after').display,
    opacity: getComputedStyle(element, '::after').opacity,
  }));
  expect(help.text).toContain('方向键：移动 1 px');
  expect(help.text).toContain('⌘/Ctrl + Z：撤销');
  expect(help.text).toContain('双指缩放/移动画布');
  expect(help.display).toBe('block');
  expect(help.opacity).toBe('1');

  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool?.isEnabled?.())).toBe(false);

  await page.waitForTimeout(950);
  await button.click();
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool?.isEnabled?.())).toBe(true);
});

test('asset layout selection leaves image boundaries visually unobstructed', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const visual = await page.evaluate(() => {
    const poster = document.getElementById('posterCanvas');
    const slot = document.querySelector('.canvas-asset-slot[data-key="chair"]');
    poster.classList.add('is-asset-layout-mode');
    slot.classList.add('is-layout-selected');
    const style = getComputedStyle(slot);
    const overlay = getComputedStyle(slot, '::after');
    return {
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
      boxShadow: style.boxShadow,
      filter: style.filter,
      overlayDisplay: overlay.display,
      overlayOpacity: overlay.opacity,
    };
  });

  expect(visual.outlineStyle).toBe('none');
  expect(visual.outlineWidth).toBe('0px');
  expect(visual.boxShadow).toBe('none');
  expect(visual.filter).toBe('none');
  expect(visual.overlayDisplay).toBe('none');
  expect(visual.overlayOpacity).toBe('0');
});
