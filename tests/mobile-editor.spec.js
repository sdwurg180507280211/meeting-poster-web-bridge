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

async function installMock(page) {
  const token = fakeJwt();
  let textLayoutRow = null;
  await page.addInitScript(({ projectRef, userId, accessToken }) => {
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify({
      access_token: accessToken,
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: {
        id: userId, aud: 'authenticated', role: 'authenticated',
        app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
        user_metadata: {}, identities: [], is_anonymous: true,
        created_at: new Date().toISOString(),
      },
    }));
  }, { projectRef: PROJECT_REF, userId: USER_ID, accessToken: token });

  await page.route(`https://${PROJECT_REF}.supabase.co/**`, async route => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'authorization,apikey,content-type,prefer,x-client-info,accept-profile,content-profile,range',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (url.pathname === '/rest/v1/poster_service_status') {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({
        agent_last_seen_at: new Date().toISOString(),
        worker_last_seen_at: new Date().toISOString(),
        worker_status: 'ready',
      }) });
    }
    if (url.pathname === '/rest/v1/rpc/poster_preflight') {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({
        schemaVersion: 5,
        renderProtocolVersion: 2,
        renderContractEnforced: true,
        jobControlsAvailable: true,
        serviceStatusReady: true,
        bucketReady: true,
      }) });
    }
    if (url.pathname === '/rest/v1/poster_project_text_layouts') {
      if (request.method() === 'GET') {
        const rows = textLayoutRow ? [{ layout: textLayoutRow.layout }] : [];
        return route.fulfill({ status: 200, headers: { ...headers, 'content-range': `0-${Math.max(0, rows.length - 1)}/${rows.length}` }, body: JSON.stringify(rows) });
      }
      if (request.method() === 'POST' || request.method() === 'PATCH') {
        const body = request.postDataJSON();
        textLayoutRow = Array.isArray(body) ? body[0] : body;
        return route.fulfill({ status: 201, headers, body: '{}' });
      }
    }
    if (url.pathname === '/rest/v1/poster_jobs') {
      return route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, body: 'null' });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ user: { id: USER_ID } }) });
    }
    return route.fulfill({ status: 200, headers, body: '{}' });
  });
}

async function ready(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await installMock(page);
  await page.goto('/');
  await expect(page.locator('#posterCanvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(
    window.posterTextLayout?.isReady?.() && window.posterLayoutTool && window.posterCanvasWorkspace
  ));
}

test.beforeEach(async ({ page }) => {
  await ready(page);
});

test('mobile shell uses fit-width canvas and a fixed bottom command bar', async ({ page }) => {
  const metrics = await page.evaluate(() => ({
    topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
    posterWidth: document.getElementById('posterCanvas').getBoundingClientRect().width,
    commandPosition: getComputedStyle(document.querySelector('.canvas-command-bar')).position,
    dockPosition: getComputedStyle(document.querySelector('.text-layout-dock')).position,
  }));

  expect(metrics.topbarHeight).toBeLessThanOrEqual(54);
  expect(metrics.posterWidth).toBeGreaterThan(350);
  expect(metrics.posterWidth).toBeLessThanOrEqual(370);
  expect(metrics.commandPosition).toBe('fixed');
  expect(metrics.dockPosition).toBe('fixed');
  await expect(page.locator('#projectSelect')).toBeVisible();
  await expect(page.locator('#renderServiceState')).toBeVisible();
  await expect(page.locator('#clearLocalData')).toBeHidden();
  await expect(page.locator('#submitBtn')).toBeVisible();
});

test('single tap edits text through the mobile bottom sheet and writes the shared data model', async ({ page }) => {
  await page.evaluate(() => {
    const input = document.getElementById('chair-name');
    input.value = '张三';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });

  const preview = page.locator('[data-preview-text-id="chair-name"]');
  await preview.click();
  const sheet = page.locator('.mobile-text-sheet');
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.mobile-text-sheet-input')).toHaveValue('张三');
  await sheet.locator('.mobile-text-sheet-input').fill('李四');
  await sheet.locator('[data-mobile-text-apply]').click();

  await expect(sheet).toBeHidden();
  await expect(page.locator('#chair-name')).toHaveValue('李四');
  await expect(preview).toContainText('李四 教授');
});

test('layout mode keeps tap for selection instead of opening the mobile text sheet', async ({ page }) => {
  await page.locator('[data-layout-mode]').click();
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool.isEnabled())).toBe(true);
  await page.locator('[data-preview-text-id="chair-name"]').click();
  await expect(page.locator('.mobile-text-sheet')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds())).toEqual(['chair-name']);
});

test('crop dialogs become full-screen workspaces on mobile', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('avatarCropModal').hidden = false;
  });
  const box = await page.locator('#avatarCropModal .crop-dialog').boundingBox();
  expect(box).toBeTruthy();
  expect(Math.abs(box.width - 390)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 844)).toBeLessThanOrEqual(2);
  await expect(page.locator('#avatarCropModal .crop-stage')).toBeVisible();
});
