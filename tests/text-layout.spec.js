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
  let textLayoutRow = null;
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
    if (url.pathname === '/rest/v1/poster_project_text_layouts') {
      if (request.method() === 'GET') {
        const rows = textLayoutRow ? [{ layout: textLayoutRow.layout }] : [];
        return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` }, body: JSON.stringify(rows) });
      }
      if (request.method() === 'POST' || request.method() === 'PATCH') {
        const body = request.postDataJSON();
        textLayoutRow = Array.isArray(body) ? body[0] : body;
        return route.fulfill({ status: 201, headers: cors, body: '{}' });
      }
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

async function setModelValue(page, id, value) {
  await page.evaluate(({ id, value }) => {
    const input = document.getElementById(id);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, { id, value });
}

async function enableLayout(page) {
  await expect(page.locator('.text-layout-mode-btn')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout?.isReady?.())).toBe(true);
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
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.isReady())).toBe(true);
});

test('layout tool is the single text and asset geometry entry', async ({ page }) => {
  const mode = page.locator('.text-layout-mode-btn');
  await expect(mode).toHaveAttribute('aria-label', '布局工具');
  await expect(mode).toHaveAttribute('data-tool-tip', /文字和头像\/二维码均可移动或缩放/);
  await expect(page.locator('.asset-layout-dock')).toBeHidden();

  await enableLayout(page);
  await selectTwo(page);
  await expect(page.locator('[data-layout-count]')).toContainText('已选 2 项');
  await expect(page.locator('[data-layout-save-state]')).toHaveText('已保存');
  await expect(page.locator('[data-layout-action]')).toHaveCount(0);
  await expect(page.locator('[data-align]')).toHaveCount(0);
});

test('double-clicking editable text works by default and syncs the hidden data model', async ({ page }) => {
  await setModelValue(page, 'chair-name', '张三');
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool?.isEnabled?.())).toBe(false);

  const preview = page.locator('[data-preview-text-id="chair-name"]');
  await expect(preview).toHaveText('张三 教授');
  await preview.dblclick();

  await expect(preview).toHaveAttribute('contenteditable', 'true');
  await expect(preview).toBeFocused();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.isInlineEditing())).toBe(true);

  await page.keyboard.press('Control+a');
  await page.keyboard.type('李四');
  await page.keyboard.press('Enter');

  await expect(page.locator('#chair-name')).toHaveValue('李四');
  await expect(preview).toHaveText('李四 教授');
  await expect(preview).not.toHaveAttribute('contenteditable', 'true');
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.isInlineEditing())).toBe(false);
});

test('meeting time displays the full date-time range and can be edited directly on canvas', async ({ page }) => {
  await setModelValue(page, 'meetingTime', '2026年8月12日 19:00-21:30');

  const preview = page.locator('[data-preview-text-id="meeting-time"]');
  await expect(preview).toHaveText('会议时间：2026年8月12日 19:00-21:30');
  await enableLayout(page);
  await preview.dblclick();

  await expect(preview).toHaveAttribute('contenteditable', 'true');
  await expect(preview).toHaveText('2026年8月12日 19:00-21:30');
  await page.keyboard.press('Control+a');
  await page.keyboard.type('2026年8月13日 20:00-22:00');
  await page.keyboard.press('Enter');

  await expect(page.locator('#meetingTime')).toHaveValue('2026年8月13日 20:00-22:00');
  await expect(preview).toHaveText('会议时间：2026年8月13日 20:00-22:00');
});

test('schedule time can be edited directly on canvas', async ({ page }) => {
  await setModelValue(page, 's-time-0', '19:00-19:30');

  const preview = page.locator('[data-preview-text-id="agenda-0-time"]');
  await expect(preview).toHaveText('19:00-19:30');
  await enableLayout(page);
  await preview.dblclick();
  await expect(preview).toHaveAttribute('contenteditable', 'true');

  await page.keyboard.press('Control+a');
  await page.keyboard.type('19:10-19:40');
  await page.keyboard.press('Enter');

  await expect(page.locator('#s-time-0')).toHaveValue('19:10-19:40');
  await expect(preview).toHaveText('19:10-19:40');
});

test('arrow keys nudge every selected item by exact design pixels with keyboard undo and redo', async ({ page }) => {
  await enableLayout(page);
  await selectTwo(page);

  await page.keyboard.press('ArrowRight');
  let layout = await page.evaluate(() => window.posterTextLayout.getLayout());
  expect(layout['section-chair'].x).toBe(269);
  expect(layout['section-speakers'].x).toBe(269);

  await page.keyboard.press('Shift+ArrowDown');
  layout = await page.evaluate(() => window.posterTextLayout.getLayout());
  expect(layout['section-chair'].y).toBe(430);
  expect(layout['section-speakers'].y).toBe(772);

  await page.keyboard.press('Control+z');
  layout = await page.evaluate(() => window.posterTextLayout.getLayout());
  expect(layout['section-chair'].x).toBe(269);
  expect(layout['section-chair'].y).toBe(420);

  await page.keyboard.press('Control+Shift+z');
  layout = await page.evaluate(() => window.posterTextLayout.getLayout());
  expect(layout['section-chair'].y).toBe(430);

  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(0);
});

test('moving text automatically persists the shared project layout and does not use localStorage', async ({ page }) => {
  await enableLayout(page);
  const chair = page.locator('[data-preview-text-id="section-chair"]');
  await chair.click();

  const persisted = page.waitForRequest(request => {
    if (request.method() !== 'POST') return false;
    const url = new URL(request.url());
    if (url.pathname !== '/rest/v1/poster_project_text_layouts') return false;
    const body = request.postDataJSON();
    const row = Array.isArray(body) ? body[0] : body;
    return row?.layout?.['section-chair']?.x === 269;
  });

  await page.keyboard.press('ArrowRight');
  await persisted;
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getPersistenceState().state)).toBe('saved');
  expect(await page.evaluate(() => localStorage.getItem('posterPreviewLayout:chronic-care-2026'))).toBeNull();
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
