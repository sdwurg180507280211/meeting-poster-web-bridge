const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'xkuzzmqtboclgvkvdlwd';
const USER_ID = '11111111-1111-4111-8111-111111111111';
const now = new Date().toISOString();
const jobs = [
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'pending', payload: { meeting: { outputName: '待处理海报' } }, created_at: now, error_message: null },
  { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'rendering', payload: { meeting: { outputName: '生成中的海报' } }, created_at: now, error_message: null },
  { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', status: 'failed', payload: { meeting: { outputName: '失败海报' } }, created_at: now, error_message: 'mock failure' },
  { id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', status: 'succeeded', payload: { meeting: { outputName: '已完成海报' } }, created_at: now, error_message: null },
];

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
      'access-control-allow-headers': 'authorization,apikey,content-type,prefer,x-client-info',
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
      const accept = request.headers().accept || '';
      const isActiveRestore = url.searchParams.get('status')?.startsWith('in.');
      const exactId = url.searchParams.get('id');
      if (accept.includes('application/vnd.pgrst.object') || isActiveRestore || exactId) {
        await route.fulfill({ status: 200, headers: cors, body: 'null' });
      } else {
        await route.fulfill({ status: 200, headers: { ...cors, 'content-range': `0-${jobs.length - 1}/${jobs.length}` }, body: JSON.stringify(jobs) });
      }
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
  await page.waitForFunction(() => Boolean(window.posterInspectorLayout && window.posterCanvasWorkspace));
});

test('left stage is clean and right inspector can be resized', async ({ page }) => {
  await expect(page.locator('.stage-toolbar')).toBeHidden();
  const before = await page.evaluate(() => window.posterInspectorLayout.getWidth());
  const handle = page.locator('.inspector-resize-handle');
  const box = await handle.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x - 130, box.y + box.height / 2, { steps: 6 });
  await page.mouse.up();
  const after = await page.evaluate(() => window.posterInspectorLayout.getWidth());
  expect(after).toBeGreaterThan(before + 80);
  const stored = await page.evaluate(() => Number(localStorage.getItem('meetingPosterInspectorWidthV1')));
  expect(stored).toBeGreaterThan(before + 80);
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
  await page.mouse.move(box.x + 24, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x - 70, box.y - 45, { steps: 7 });
  await page.mouse.up();
  const after = await page.evaluate(() => ({
    left: document.querySelector('.poster-viewport').scrollLeft,
    top: document.querySelector('.poster-viewport').scrollTop,
    posterWidth: document.getElementById('posterCanvas').offsetWidth,
  }));
  expect(Math.abs(after.left - before.left) + Math.abs(after.top - before.top)).toBeGreaterThan(40);
  expect(after.posterWidth).toBe(before.posterWidth);
});

test('system preflight reports render contract and service readiness', async ({ page }) => {
  await page.evaluate(() => {
    window.posterTimeControlsState = { ready: true, failed: false, reason: '时间选择组件已就绪' };
  });
  await expect(page.locator('#renderServiceState')).toContainText('生成服务在线');
  await page.locator('#renderServiceState').click();
  await expect(page.locator('.preflight-overlay')).toBeVisible();
  await expect(page.locator('.preflight-summary')).toContainText('系统自检通过');
  await expect(page.locator('.preflight-list')).toContainText('Render Contract');
  await expect(page.locator('.preflight-list')).toContainText('任务控制');
  await expect(page.locator('.preflight-list')).toContainText('Photoshop Worker');
});

test('task tab exposes safe cancel and retry actions', async ({ page }) => {
  await page.locator('.inspector-tab[data-tab="task"]').click();
  await expect(page.locator('.task-control-item[data-job-status="pending"]')).toBeVisible();
  await expect(page.locator('.task-control-item[data-job-status="pending"] [data-job-action="cancel"]')).toHaveText('取消任务');
  await expect(page.locator('.task-control-item[data-job-status="failed"] [data-job-action="retry"]')).toHaveText('重新生成');
  await expect(page.locator('.task-control-item[data-job-status="succeeded"] [data-job-action="retry"]')).toHaveText('重新生成');
  await expect(page.locator('.task-control-item[data-job-status="rendering"] button')).toBeDisabled();
});
