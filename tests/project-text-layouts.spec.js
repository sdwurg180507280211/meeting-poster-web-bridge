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
  const textLayouts = new Map();
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
      'access-control-expose-headers': 'content-range,range',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'content-type': 'application/json',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers, body: '' });
    if (url.pathname === '/rest/v1/poster_service_status') return route.fulfill({ status: 200, headers, body: JSON.stringify({ agent_last_seen_at: new Date().toISOString(), worker_last_seen_at: new Date().toISOString(), worker_status: 'ready' }) });
    if (url.pathname === '/rest/v1/poster_project_text_layouts') {
      if (request.method() === 'GET') {
        const projectId = String(url.searchParams.get('project_id') || '').replace(/^eq\./, '');
        const profileId = String(url.searchParams.get('profile_id') || '').replace(/^eq\./, '');
        const row = textLayouts.get(`${projectId}:${profileId}`);
        return route.fulfill({
          status: 200,
          headers: { ...headers, 'content-range': row ? '0-0/1' : '0-0/0' },
          body: JSON.stringify(row ? [{ layout: row.layout }] : []),
        });
      }
      if (request.method() === 'POST' || request.method() === 'PATCH') {
        const body = request.postDataJSON();
        const row = Array.isArray(body) ? body[0] : body;
        textLayouts.set(`${row.project_id}:${row.profile_id}`, row);
        return route.fulfill({ status: 201, headers, body: '{}' });
      }
    }
    if (url.pathname === '/rest/v1/poster_jobs') return route.fulfill({ status: 200, headers, body: url.searchParams.get('id') ? 'null' : '[]' });
    if (url.pathname.startsWith('/auth/v1/')) return route.fulfill({ status: 200, headers, body: JSON.stringify({ user: { id: USER_ID } }) });
    return route.fulfill({ status: 200, headers, body: '{}' });
  });
}

async function waitForTextLayout(page) {
  await page.waitForFunction(() => Boolean(window.posterTextLayout));
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.isReady())).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installMock(page);
});

test('each project owns a distinct text layout profile', async ({ page }) => {
  await page.goto('/');
  const snapshot = await page.evaluate(() => {
    const projects = window.POSTER_PROJECT_REGISTRY.projects.map(project => ({
      id: project.id,
      textLayoutProfile: project.textLayoutProfile,
    }));
    const store = window.POSTER_TEXT_LAYOUT_PROFILES.profiles;
    return {
      projects,
      profileIds: Object.keys(store),
      arraysAreDistinct:
        store['yilu-changan-text-v1'].items !== store['tonghu-jiankang-text-v1'].items &&
        store['yilu-changan-text-v1'].items !== store['tongxin-hujian-text-v1'].items &&
        store['tonghu-jiankang-text-v1'].items !== store['tongxin-hujian-text-v1'].items,
    };
  });

  expect(snapshot.projects).toEqual([
    { id: 'chronic-care-2026', textLayoutProfile: 'yilu-changan-text-v1' },
    { id: 'tonghu-jiankang', textLayoutProfile: 'tonghu-jiankang-text-v1' },
    { id: 'tongxin-hujian', textLayoutProfile: 'tongxin-hujian-text-v1' },
  ]);
  expect(snapshot.profileIds.sort()).toEqual([
    'tonghu-jiankang-text-v1',
    'tongxin-hujian-text-v1',
    'yilu-changan-text-v1',
  ]);
  expect(snapshot.arraysAreDistinct).toBe(true);
});

test('active project loads and saves its own shared cloud text calibration', async ({ page }) => {
  await page.goto('/?project=chronic-care-2026');
  await expect(page.locator('#posterCanvas')).toBeVisible();
  await waitForTextLayout(page);
  expect(await page.evaluate(() => window.POSTER_PROJECT.textLayoutProfile)).toBe('yilu-changan-text-v1');

  await page.locator('[data-layout-mode]').click();
  await page.locator('[data-preview-text-id="section-chair"]').click();
  const yiluSave = page.waitForRequest(request => {
    if (request.method() !== 'POST') return false;
    const url = new URL(request.url());
    if (url.pathname !== '/rest/v1/poster_project_text_layouts') return false;
    const body = request.postDataJSON();
    const row = Array.isArray(body) ? body[0] : body;
    return row?.project_id === 'chronic-care-2026'
      && row?.profile_id === 'yilu-changan-text-v1'
      && row?.layout?.['section-chair']?.x === 269;
  });
  await page.keyboard.press('ArrowRight');
  await yiluSave;
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getPersistenceState().state)).toBe('saved');
  expect(await page.evaluate(() => localStorage.getItem('posterPreviewLayout:chronic-care-2026'))).toBeNull();

  await page.goto('/?project=tonghu-jiankang');
  await expect(page.locator('#posterCanvas')).toBeVisible();
  await waitForTextLayout(page);
  const tonghu = await page.evaluate(() => ({
    profile: window.POSTER_PROJECT.textLayoutProfile,
    chairX: window.posterTextLayout.getLayout()['section-chair']?.x,
  }));
  expect(tonghu.profile).toBe('tonghu-jiankang-text-v1');
  expect(tonghu.chairX).toBe(268);

  await page.goto('/?project=chronic-care-2026');
  await waitForTextLayout(page);
  expect(await page.evaluate(() => window.posterTextLayout.getLayout()['section-chair']?.x)).toBe(269);

  await page.goto('/?project=tongxin-hujian');
  await expect(page.locator('#posterCanvas')).toBeVisible();
  await waitForTextLayout(page);
  expect(await page.evaluate(() => window.POSTER_PROJECT.textLayoutProfile)).toBe('tongxin-hujian-text-v1');
  expect(await page.evaluate(() => window.posterTextLayout.getLayout()['section-chair']?.x)).toBe(268);
});
