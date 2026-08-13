const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'xkuzzmqtboclgvkvdlwd';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    aud: 'authenticated',
    sub: USER_ID,
    role: 'authenticated',
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
        email: '',
        app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
        user_metadata: {},
        identities: [],
        created_at: new Date().toISOString(),
        is_anonymous: true,
      },
    };
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify(session));
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
    if (request.method() === 'OPTIONS') {
      await route.fulfill({ status: 204, headers: cors, body: '' });
      return;
    }
    if (url.pathname === '/rest/v1/poster_service_status') {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
        agent_last_seen_at: new Date().toISOString(),
        worker_last_seen_at: new Date().toISOString(),
        worker_status: 'ready',
      }) });
      return;
    }
    if (url.pathname === '/rest/v1/rpc/poster_preflight') {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({
        schemaVersion: 5,
        renderProtocolVersion: 2,
        renderContractEnforced: true,
        jobControlsAvailable: true,
        serviceStatusReady: true,
        bucketReady: true,
      }) });
      return;
    }
    if (url.pathname === '/rest/v1/poster_jobs') {
      await route.fulfill({ status: 200, headers: cors, body: 'null' });
      return;
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      await route.fulfill({ status: 200, headers: cors, body: JSON.stringify({ user: { id: USER_ID } }) });
      return;
    }
    await route.fulfill({ status: 200, headers: cors, body: '{}' });
  });
}

test.beforeEach(async ({ page }) => {
  await installSupabaseMock(page);
  await page.goto('/');
  await expect(page.locator('#posterCanvas')).toBeVisible();
  await page.waitForFunction(() => Boolean(window.posterCanvasWorkspace));
});

test('app is a canvas-first Photoshop poster editor with no inspector or task panel', async ({ page }) => {
  await expect(page).toHaveTitle('简化版 Photoshop 海报编辑器');
  await expect(page.locator('.brand h1')).toHaveText('简化版 Photoshop 海报编辑器');
  await expect(page.locator('.brand p')).toContainText('海报内直接编辑');

  await expect(page.locator('#inspector')).toHaveCount(0);
  await expect(page.locator('.inspector-tab')).toHaveCount(0);
  await expect(page.locator('.task-control-card')).toHaveCount(0);
  await expect(page.locator('#historyList')).toHaveCount(0);
  await expect(page.locator('.canvas-command-bar')).toBeVisible();
  await expect(page.locator('#submitBtn')).toContainText('生成正式海报');
  await expect(page.locator('#downloadResult')).toBeHidden();
  await expect(page.locator('#cancelActiveJob')).toBeHidden();

  const hiddenDataForm = page.locator('#posterForm');
  await expect(hiddenDataForm).toBeHidden();
  await expect(page.locator('#meetingTime')).toHaveAttribute('type', 'hidden');
  await expect(page.locator('#outputName')).toHaveAttribute('type', 'hidden');
});

test('first-row speaker stays unavailable in the hidden data model', async ({ page }) => {
  const firstSpeaker = page.locator('#s-speaker-0');
  await expect(firstSpeaker).toBeDisabled();
  await expect(firstSpeaker).toHaveClass(/schedule-cell-hidden/);
  await expect(firstSpeaker).toHaveValue('');
  await expect(page.locator('[data-preview-text-id="agenda-0-speaker"]')).toHaveCount(0);
  await expect(page.locator('#s-speaker-1')).toBeEnabled();

  await page.evaluate(() => {
    const el = document.getElementById('s-speaker-0');
    el.disabled = false;
    el.value = '不应保留 教授';
    document.dispatchEvent(new CustomEvent('poster-draft-scalars-restored'));
  });
  await expect(firstSpeaker).toBeDisabled();
  await expect(firstSpeaker).toHaveValue('');
});

test('canvas supports left-button panning without changing poster geometry', async ({ page }) => {
  const viewport = page.locator('.poster-viewport');
  const box = await viewport.boundingBox();
  expect(box).toBeTruthy();
  const before = await page.evaluate(() => ({
    left: document.querySelector('.poster-viewport').scrollLeft,
    top: document.querySelector('.poster-viewport').scrollTop,
    posterWidth: document.getElementById('posterCanvas').offsetWidth,
  }));
  await page.mouse.move(box.x + 24, box.y + 96);
  await page.mouse.down();
  await page.mouse.move(box.x - 70, box.y + 27, { steps: 7 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    left: document.querySelector('.poster-viewport').scrollLeft,
    top: document.querySelector('.poster-viewport').scrollTop,
    posterWidth: document.getElementById('posterCanvas').offsetWidth,
  }));
  expect(Math.abs(after.left - before.left) + Math.abs(after.top - before.top)).toBeGreaterThan(40);
  expect(after.posterWidth).toBe(before.posterWidth);
});

test('system preflight reports canvas editing, render contract and service readiness', async ({ page }) => {
  await expect(page.locator('#renderServiceState')).toContainText('生成服务在线');
  await page.locator('#renderServiceState').click();
  await expect(page.locator('.preflight-overlay')).toBeVisible();
  await expect(page.locator('.preflight-summary')).toContainText('系统自检通过');
  await expect(page.locator('.preflight-list')).toContainText('海报内时间编辑');
  await expect(page.locator('.preflight-list')).toContainText('Render Contract');
  await expect(page.locator('.preflight-list')).toContainText('任务取消');
  await expect(page.locator('.preflight-list')).toContainText('Photoshop Worker');
});
