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
    if (url.pathname === '/rest/v1/poster_jobs') {
      return route.fulfill({ status: 200, headers: { ...headers, 'content-range': '0-0/0' }, body: '[]' });
    }
    if (url.pathname.startsWith('/auth/v1/')) {
      return route.fulfill({ status: 200, headers, body: JSON.stringify({ user: { id: USER_ID } }) });
    }
    return route.fulfill({ status: 200, headers, body: '{}' });
  });
}

async function ready(page) {
  await page.goto('/');
  await page.waitForFunction(() => Boolean(
    window.posterTextLayout && window.posterAssetLayout && window.posterSelectionPolish && window.Moveable
  ));
}

async function enableText(page) {
  await page.locator('.text-layout-mode-btn').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.isEnabled())).toBe(true);
}

async function enableAsset(page) {
  await page.locator('.asset-layout-mode-btn').click();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.isEnabled())).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installMock(page);
  await ready(page);
});

test('clicking anywhere outside the poster clears text selection but keeps V mode active', async ({ page }) => {
  await enableText(page);
  await page.locator('[data-preview-text-id="section-chair"]').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(1);

  await page.locator('.brand').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(0);
  expect(await page.evaluate(() => window.posterTextLayout.isEnabled())).toBe(true);
  await expect(page.locator('.moveable-control-box')).toHaveCount(0);
});

test('clicking the inspector outside the poster clears asset selection but keeps A mode active', async ({ page }) => {
  await enableAsset(page);
  const chair = page.locator('.canvas-asset-slot[data-key="chair"]');
  const speaker = page.locator('.canvas-asset-slot[data-key="speaker1"]');
  await chair.click();
  await speaker.click({ modifiers: ['Control'] });
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys().sort())).toEqual(['chair', 'speaker1']);

  await page.locator('#outputName').click();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys().length)).toBe(0);
  expect(await page.evaluate(() => window.posterAssetLayout.isEnabled())).toBe(true);
});

test('even clicking the floating tool status outside poster clears the active selection', async ({ page }) => {
  await enableAsset(page);
  await page.locator('.canvas-asset-slot[data-key="qr"]').click();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys())).toEqual(['qr']);

  await page.locator('[data-asset-layout-count]').click();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys())).toEqual([]);
  expect(await page.evaluate(() => window.posterAssetLayout.isEnabled())).toBe(true);
});

test('clearing a group removes the transform box and the next object click starts a clean selection', async ({ page }) => {
  await enableText(page);
  const chair = page.locator('[data-preview-text-id="section-chair"]');
  const speakers = page.locator('[data-preview-text-id="section-speakers"]');
  await chair.click();
  await speakers.click({ modifiers: ['Control'] });
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().sort())).toEqual(['section-chair', 'section-speakers']);

  await page.locator('.brand').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds())).toEqual([]);
  await expect(page.locator('.moveable-control-box')).toHaveCount(0);

  await chair.click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds())).toEqual(['section-chair']);
});

test('switching V and A modes clears stale selection and keeps only one mode active', async ({ page }) => {
  await enableText(page);
  await page.locator('[data-preview-text-id="section-chair"]').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(1);

  await page.locator('.asset-layout-mode-btn').click();
  await expect.poll(() => page.evaluate(() => ({
    text: window.posterTextLayout.isEnabled(),
    asset: window.posterAssetLayout.isEnabled(),
    textCount: window.posterTextLayout.getSelectedIds().length,
  }))).toEqual({ text: false, asset: true, textCount: 0 });

  await page.locator('.canvas-asset-slot[data-key="qr"]').click();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys())).toEqual(['qr']);

  await page.locator('.text-layout-mode-btn').click();
  await expect.poll(() => page.evaluate(() => ({
    text: window.posterTextLayout.isEnabled(),
    asset: window.posterAssetLayout.isEnabled(),
    assetCount: window.posterAssetLayout.getSelectedKeys().length,
  }))).toEqual({ text: true, asset: false, assetCount: 0 });
});
