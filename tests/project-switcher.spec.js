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

test('keeps current project id for 医路长安 and exposes three projects', async ({ page }) => {
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

test('同护健康 loads its web base and project-specific layouts', async ({ page }) => {
  await page.goto('/?project=tonghu-jiankang');
  await expect(page.locator('#projectSelect')).toHaveValue('tonghu-jiankang');
  const snapshot = await page.evaluate(() => ({
    id: window.POSTER_PROJECT.id,
    textLayoutProfile: window.POSTER_PROJECT.textLayoutProfile,
    assetLayoutProfile: window.POSTER_PROJECT.assetLayoutProfile,
    baseImage: document.getElementById('posterCanvas').style.getPropertyValue('--poster-base-image'),
    layout: window.POSTER_PROJECT.assetPreview,
  }));
  expect(snapshot.id).toBe('tonghu-jiankang');
  expect(snapshot.textLayoutProfile).toBe('tonghu-jiankang-text-v1');
  expect(snapshot.assetLayoutProfile).toBe('tonghu-jiankang-assets-v1');
  expect(snapshot.baseImage).toContain('./assets/tonghu-jiankang-base.jpg');
  expect(snapshot.layout.chair).toMatchObject({ left: 330, top: 496, size: 168 });
  expect(snapshot.layout.qr).toMatchObject({ left: 342, top: 1574, size: 148 });
});

test('同心护健 loads its own base and shared canvas size', async ({ page }) => {
  await page.goto('/?project=tongxin-hujian');
  await expect(page.locator('#projectSelect')).toHaveValue('tongxin-hujian');
  const project = await page.evaluate(() => ({
    id: window.POSTER_PROJECT.id,
    name: window.POSTER_PROJECT.name,
    canvas: window.POSTER_PROJECT.canvas,
    baseImage: document.getElementById('posterCanvas').style.getPropertyValue('--poster-base-image'),
  }));
  expect(project.id).toBe('tongxin-hujian');
  expect(project.name).toBe('同心护健');
  expect(project.canvas).toEqual({ width: 837, height: 1880 });
  expect(project.baseImage).toContain('./assets/tongxin-hujian-base.jpg');
});
