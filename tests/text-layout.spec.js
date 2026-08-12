const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'xkuzzmqtboclgvkvdlwd';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated', sub: USER_ID, role: 'authenticated',
    exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

async function installSupabaseMock(page) {
  const accessToken = fakeJwt();
  await page.addInitScript(({ projectRef, userId, token }) => {
    const session = {
      access_token: token,
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: userId,
        aud: 'authenticated',
        role: 'authenticated',
        app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
        user_metadata: {}, identities: [], is_anonymous: true,
        created_at: new Date().toISOString(),
      },
    };
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(session));
    localStorage.removeItem('posterPreviewLayout:chronic-care-2026');
  }, { projectRef: PROJECT_REF, userId: USER_ID, token: accessToken });

  await page.route(`https://${PROJECT_REF}.supabase.co/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const cors = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,apikey,content-type,prefer,x-client-info,accept-profile,content-profile,range',
      'access-control-expose-headers': 'content-range,range',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
    if (url.pathname === '/rest/v1/poster_service_status') {
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
        agent_last_seen_at: new Date().toISOString(), worker_last_seen_at: new Date().toISOString(), worker_status: 'ready',
      }) });
    }
    if (url.pathname === '/rest/v1/poster_jobs') {
      return route.fulfill({ status: 200, headers: { ...cors, 'content-range': '0-0/0' }, body: '[]' });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      return route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ user: { id: USER_ID } }) });
    }
    return route.fulfill({ status: 200, headers: cors, body: '{}' });
  });
}

async function enableLayout(page) {
  await expect(page.locator('.text-layout-mode-btn')).toBeVisible();
  await page.locator('.text-layout-mode-btn').click();
  await expect(page.locator('.text-layout-tools')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout?.isEnabled?.())).toBe(true);
}

async function selectTwo(page) {
  const first = page.locator('[data-preview-text-id="section-chair"]');
  const second = page.locator('[data-preview-text-id="section-speakers"]');
  await first.click();
  await second.click({ modifiers: ['Control'] });
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().sort())).toEqual(['section-chair', 'section-speakers']);
  return { first, second };
}

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.goto('/');
  await page.waitForFunction(() => Boolean(window.posterTextLayout && window.Moveable));
});

test('compact layout mode restores Photoshop-like text selection controls', async ({ page }) => {
  await expect(page.locator('.stage-toolbar')).toBeHidden();
  await expect(page.locator('.text-layout-mode-btn')).toContainText('选择文字');
  await enableLayout(page);
  await expect(page.locator('.text-layout-mode-btn')).toContainText('完成布局');
  await expect(page.locator('[data-align="left"]')).toBeDisabled();

  await selectTwo(page);
  await expect(page.locator('[data-layout-count]')).toContainText('已选 2 项');
  await expect(page.locator('[data-align="left"]')).toBeEnabled();
  await expect(page.locator('[data-align="hdistribute"]')).toBeDisabled();
});

test('arrow keys nudge every selected item by exact design pixels with undo and redo', async ({ page }) => {
  await enableLayout(page);
  await selectTwo(page);

  await page.keyboard.press('ArrowRight');
  let layout = await page.evaluate(() => JSON.parse(localStorage.getItem('posterPreviewLayout:chronic-care-2026') || '{}'));
  expect(layout['section-chair'].x).toBe(269);
  expect(layout['section-speakers'].x).toBe(269);

  await page.keyboard.press('Shift+ArrowDown');
  layout = await page.evaluate(() => JSON.parse(localStorage.getItem('posterPreviewLayout:chronic-care-2026') || '{}'));
  expect(layout['section-chair'].y).toBe(430);
  expect(layout['section-speakers'].y).toBe(772);

  await page.keyboard.press('Control+z');
  layout = await page.evaluate(() => JSON.parse(localStorage.getItem('posterPreviewLayout:chronic-care-2026') || '{}'));
  expect(layout['section-chair'].x).toBe(269);
  expect(layout['section-chair'].y ?? 420).toBe(420);

  await page.keyboard.press('Control+Shift+z');
  layout = await page.evaluate(() => JSON.parse(localStorage.getItem('posterPreviewLayout:chronic-care-2026') || '{}'));
  expect(layout['section-chair'].y).toBe(430);

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(0);
});

test('dragging one member of a multi-selection moves the whole group', async ({ page }) => {
  await enableLayout(page);
  const { first, second } = await selectTwo(page);
  const beforeFirst = await first.boundingBox();
  const beforeSecond = await second.boundingBox();
  expect(beforeFirst).toBeTruthy();
  expect(beforeSecond).toBeTruthy();

  await page.mouse.move(beforeFirst.x + beforeFirst.width / 2, beforeFirst.y + beforeFirst.height / 2);
  await page.mouse.down();
  await page.mouse.move(beforeFirst.x + beforeFirst.width / 2 + 36, beforeFirst.y + beforeFirst.height / 2 + 24, { steps: 8 });
  await page.mouse.up();

  const afterFirst = await first.boundingBox();
  const afterSecond = await second.boundingBox();
  const dx1 = afterFirst.x - beforeFirst.x;
  const dy1 = afterFirst.y - beforeFirst.y;
  const dx2 = afterSecond.x - beforeSecond.x;
  const dy2 = afterSecond.y - beforeSecond.y;

  expect(Math.abs(dx1) + Math.abs(dy1)).toBeGreaterThan(12);
  expect(Math.abs(dx1 - dx2)).toBeLessThan(3);
  expect(Math.abs(dy1 - dy2)).toBeLessThan(3);
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(2);
});
