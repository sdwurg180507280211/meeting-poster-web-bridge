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

test('mobile exposes zoom controls and supports two-finger poster zoom', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/', { waitUntil: 'domcontentloaded' });

  const zoomIn = page.locator('.zoom-controls [data-zoom="in"]');
  const zoomOut = page.locator('.zoom-controls [data-zoom="out"]');
  const readout = page.locator('.zoom-value');
  await expect(zoomIn).toBeVisible();
  await expect(zoomOut).toBeVisible();
  await expect(readout).toBeVisible();

  await zoomIn.click();
  await expect(readout).toHaveText('110%');
  await page.locator('.zoom-controls [data-zoom="fit"]').click();
  await expect(readout).toHaveText('100%');

  const pinchZoom = await page.evaluate(() => {
    const viewport = document.querySelector('.poster-viewport');
    const fire = (type, pointerId, x, y, isPrimary) => viewport.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      isPrimary,
      clientX: x,
      clientY: y,
    }));
    fire('pointerdown', 11, 120, 300, true);
    fire('pointerdown', 12, 220, 300, false);
    fire('pointermove', 11, 90, 300, true);
    fire('pointermove', 12, 250, 300, false);
    const zoom = window.posterZoomControls?.get?.() || 1;
    fire('pointerup', 11, 90, 300, true);
    fire('pointerup', 12, 250, 300, false);
    return zoom;
  });
  expect(pinchZoom).toBeGreaterThan(1);
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
