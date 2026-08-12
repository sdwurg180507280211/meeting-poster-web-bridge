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
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith('posterAssetLayout:')) localStorage.removeItem(key);
    }
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

async function enableAssets(page) {
  await expect(page.locator('[data-asset-layout-mode]')).toBeVisible();
  await page.locator('[data-asset-layout-mode]').click();
  await expect(page.locator('[data-asset-layout-tools]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout?.isEnabled?.())).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installMock(page);
});

test('each project owns an independent asset layout profile', async ({ page }) => {
  await page.goto('/');
  const snapshot = await page.evaluate(() => ({
    projects: window.POSTER_PROJECT_REGISTRY.projects.map(project => ({ id: project.id, profile: project.assetLayoutProfile })),
    profileIds: Object.keys(window.POSTER_ASSET_LAYOUT_PROFILES.profiles),
    activeProfile: window.POSTER_PROJECT.assetLayoutProfile,
  }));
  expect(snapshot.projects).toEqual([
    { id: 'chronic-care-2026', profile: 'yilu-changan-assets-v1' },
    { id: 'tonghu-jiankang', profile: 'tonghu-jiankang-assets-v1' },
    { id: 'tongxin-hujian', profile: 'tongxin-hujian-assets-v1' },
  ]);
  expect(snapshot.profileIds.sort()).toEqual(['tonghu-jiankang-assets-v1', 'tongxin-hujian-assets-v1', 'yilu-changan-assets-v1']);
  expect(snapshot.activeProfile).toBe('yilu-changan-assets-v1');
});

test('asset mode nudges selected avatar and QR in exact design pixels and updates render source geometry', async ({ page }) => {
  await page.goto('/?project=chronic-care-2026');
  await page.waitForFunction(() => Boolean(window.posterAssetLayout && window.Moveable));
  await enableAssets(page);

  const chair = page.locator('.canvas-asset-slot[data-key="chair"]');
  await chair.click();
  await page.keyboard.press('ArrowRight');

  let state = await page.evaluate(() => ({
    chair: window.POSTER_PROJECT.assetPreview.chair,
    selected: window.posterAssetLayout.getSelectedKeys(),
    storageKey: window.posterAssetLayout.getStorageKey(),
    stored: JSON.parse(localStorage.getItem(window.posterAssetLayout.getStorageKey()) || '{}'),
  }));
  expect(state.selected).toEqual(['chair']);
  expect(state.chair.left).toBe(343);
  expect(state.chair.top).toBe(496);
  expect(state.chair.size).toBe(168);
  expect(state.storageKey).toBe('posterAssetLayout:chronic-care-2026:yilu-changan-assets-v1');
  expect(state.stored.chair.left).toBe(343);

  const qr = page.locator('.canvas-asset-slot[data-key="qr"]');
  await qr.click({ modifiers: ['Control'] });
  await page.keyboard.press('Shift+ArrowDown');
  state = await page.evaluate(() => ({
    chair: window.POSTER_PROJECT.assetPreview.chair,
    qr: window.POSTER_PROJECT.assetPreview.qr,
    selected: window.posterAssetLayout.getSelectedKeys().sort(),
  }));
  expect(state.selected).toEqual(['chair', 'qr']);
  expect(state.chair.top).toBe(506);
  expect(state.qr.top).toBe(1586);
});

test('asset overrides stay project-local and text/asset modes are mutually exclusive', async ({ page }) => {
  await page.goto('/?project=chronic-care-2026');
  await page.waitForFunction(() => Boolean(window.posterAssetLayout && window.posterTextLayout));
  await enableAssets(page);
  await page.locator('.canvas-asset-slot[data-key="speaker1"]').click();
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => window.POSTER_PROJECT.assetPreview.speaker1.left)).toBe(220);

  await page.locator('[data-layout-mode]').click();
  expect(await page.evaluate(() => ({ text: window.posterTextLayout.isEnabled(), assets: window.posterAssetLayout.isEnabled() }))).toEqual({ text: true, assets: false });

  await page.goto('/?project=tonghu-jiankang');
  await page.waitForFunction(() => Boolean(window.posterAssetLayout));
  const tonghu = await page.evaluate(() => ({
    profile: window.POSTER_PROJECT.assetLayoutProfile,
    speakerLeft: window.POSTER_PROJECT.assetPreview.speaker1.left,
    stored: localStorage.getItem(window.posterAssetLayout.getStorageKey()),
  }));
  expect(tonghu.profile).toBe('tonghu-jiankang-assets-v1');
  expect(tonghu.speakerLeft).toBe(221);
  expect(tonghu.stored).toBeNull();
});
