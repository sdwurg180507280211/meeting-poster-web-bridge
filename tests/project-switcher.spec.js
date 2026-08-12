const { test, expect } = require('@playwright/test');

const PROJECT_REF = 'xkuzzmqtboclgvkvdlwd';
const USER_ID = '11111111-1111-4111-8111-111111111111';

function fakeJwt() {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ aud: 'authenticated', sub: USER_ID, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

async function installMock(page) {
  const token = fakeJwt();
  await page.addInitScript(({ projectRef, userId, accessToken }) => {
    localStorage.setItem(`sb-${projectRef}-auth-token`, JSON.stringify({
      access_token: accessToken,
      refresh_token: 'mock-refresh-token',
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      token_type: 'bearer',
      user: { id: userId, aud: 'authenticated', role: 'authenticated', app_metadata: { provider: 'anonymous', providers: ['anonymous'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), is_anonymous: true },
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
    if (url.pathname === '/rest/v1/poster_service_status') return route.fulfill({ status: 200, headers, body: JSON.stringify({ agent_last_seen_at: new Date().toISOString(), worker_last_seen_at: new Date().toISOString(), worker_status: 'ready' }) });
    if (url.pathname === '/rest/v1/poster_jobs') return route.fulfill({ status: 200, headers, body: url.searchParams.get('id') ? 'null' : '[]' });
    if (url.pathname.startsWith('/auth/v1/')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ user: { id: USER_ID } }) });
    return route.fulfill({ status: 200, headers, body: '{}' });
  });
}

test.beforeEach(async ({ page }) => { await installMock(page); });

test('keeps existing project id for 医路长安 and exposes three projects', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#projectSelect')).toHaveValue('chronic-care-2026');
  const snapshot = await page.evaluate(() => ({
    id: window.POSTER_PROJECT.id,
    name: window.POSTER_PROJECT.name,
    projects: window.POSTER_PROJECT_REGISTRY.projects.map(project => project.name),
  }));
  expect(snapshot.id).toBe('chronic-care-2026');
  expect(snapshot.name).toBe('医路长安');
  expect(snapshot.projects).toEqual(['医路长安', '同护健康', '同心护健']);
});

test('同护健康 uses its imported web base and keeps the shared render contract', async ({ page }) => {
  await page.goto('/?project=tonghu-jiankang');
  await expect(page.locator('#projectSelect')).toHaveValue('tonghu-jiankang');
  await expect(page.locator('#posterCanvas')).not.toHaveClass(/is-project-placeholder/);
  await expect(page.locator('#projectPreviewState')).toContainText('网页底板已载入');
  await expect(page.locator('#projectPreviewState')).toContainText('正式输出使用本地 PSD');
  const snapshot = await page.evaluate(() => ({
    id: window.POSTER_PROJECT.id,
    profile: window.POSTER_PROJECT.contentProfile,
    templateProfile: window.POSTER_PROJECT.templateProfile,
    preview: window.POSTER_PROJECT.preview,
    layout: window.POSTER_PROJECT.assetPreview,
    blocked: document.getElementById('submitBtn').dataset.projectBlocked || '',
  }));
  expect(snapshot.id).toBe('tonghu-jiankang');
  expect(snapshot.profile).toBe('meeting-series-common-v1');
  expect(snapshot.templateProfile).toBe('meeting-poster-v10');
  expect(snapshot.preview).toMatchObject({ type: 'asset', src: './assets/tonghu-jiankang-base.jpg' });
  expect(snapshot.layout.chair).toMatchObject({ left: 342, top: 496, size: 168 });
  expect(snapshot.layout.qr).toMatchObject({ left: 338, top: 1576, size: 148 });
  expect(snapshot.blocked).toBe('');
});

test('同心护健 uses its imported web base with the same shared structure', async ({ page }) => {
  await page.goto('/?project=tongxin-hujian');
  await expect(page.locator('#projectSelect')).toHaveValue('tongxin-hujian');
  await expect(page.locator('#posterCanvas')).not.toHaveClass(/is-project-placeholder/);
  await expect(page.locator('#projectPreviewState')).toContainText('网页底板已载入');
  const project = await page.evaluate(() => ({
    id: window.POSTER_PROJECT.id,
    name: window.POSTER_PROJECT.name,
    canvas: window.POSTER_PROJECT.canvas,
    preview: window.POSTER_PROJECT.preview,
  }));
  expect(project).toEqual({
    id: 'tongxin-hujian',
    name: '同心护健',
    canvas: { width: 837, height: 1880 },
    preview: { type: 'asset', src: './assets/tongxin-hujian-base.jpg', theme: 'tongxin' },
  });
});
