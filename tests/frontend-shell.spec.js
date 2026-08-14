const { test, expect } = require('@playwright/test');

test('desktop shell is compact and legacy inspector styles are gone', async ({ page, request }) => {
  const response = await request.get('/styles/styles.css');
  expect(response.ok()).toBeTruthy();
  const css = await response.text();

  for (const legacySelector of ['.inspector{', '.inspector-tabs{', '.editor-section{', '.task-block', '.history-list{', '.open-inspector{']) {
    expect(css).not.toContain(legacySelector);
  }

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.locator('.topbar')).toHaveCSS('height', '58px');
  await expect(page.locator('.canvas-command-bar')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.canvas-command-bar')).toHaveCSS('box-shadow', 'none');
  await expect(page.locator('.poster-viewport')).toHaveCSS('border-radius', '10px');

  const geometry = await page.evaluate(() => {
    const dock = document.querySelector('.text-layout-dock')?.getBoundingClientRect();
    const command = document.querySelector('.canvas-command-bar')?.getBoundingClientRect();
    const viewport = document.querySelector('.poster-viewport')?.getBoundingClientRect();
    return { dock, command, viewport };
  });

  expect(geometry.dock).toBeTruthy();
  expect(geometry.command).toBeTruthy();
  expect(geometry.viewport).toBeTruthy();
  expect(geometry.dock.top).toBeGreaterThanOrEqual(geometry.command.top);
  expect(geometry.dock.bottom).toBeLessThanOrEqual(geometry.command.bottom + 4);
  expect(geometry.viewport.top).toBeGreaterThanOrEqual(geometry.command.bottom - 1);
});