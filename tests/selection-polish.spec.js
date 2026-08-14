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
    window.posterTextLayout && window.posterAssetLayout && window.posterLayoutTool && window.posterSelectionPolish && window.Moveable
  ));
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.isReady())).toBe(true);
}

async function enableLayout(page) {
  await page.locator('[data-layout-mode]').click();
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool.isEnabled())).toBe(true);
}

test.beforeEach(async ({ page }) => {
  await installMock(page);
  await ready(page);
});

test('clicking anywhere outside the poster clears text selection but keeps layout tool active', async ({ page }) => {
  await enableLayout(page);
  await page.locator('[data-preview-text-id="section-chair"]').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(1);

  await page.locator('.brand').click();
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds().length)).toBe(0);
  expect(await page.evaluate(() => window.posterTextLayout.isEnabled())).toBe(true);
  await expect(page.locator('.moveable-control-box')).toHaveCount(0);
});

test('clicking the canvas command bar clears asset selection but keeps layout tool active', async ({ page }) => {
  await enableLayout(page);
  const chair = page.locator('.canvas-asset-slot[data-key="chair"]');
  const speaker = page.locator('.canvas-asset-slot[data-key="speaker1"]');
  await chair.click();
  await speaker.click({ modifiers: ['Control'] });
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys().sort())).toEqual(['chair', 'speaker1']);

  const commandBar = page.locator('.canvas-command-bar');
  const layoutDock = page.locator('.text-layout-dock');
  const [commandBox, dockBox] = await Promise.all([commandBar.boundingBox(), layoutDock.boundingBox()]);
  expect(commandBox).toBeTruthy();
  expect(dockBox).toBeTruthy();
  await page.mouse.click(dockBox.x + dockBox.width + 12, commandBox.y + 6);

  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys().length)).toBe(0);
  expect(await page.evaluate(() => window.posterAssetLayout.isEnabled())).toBe(true);
});

test('turning off the unified layout tool clears the active asset selection', async ({ page }) => {
  await enableLayout(page);
  await page.locator('.canvas-asset-slot[data-key="qr"]').click();
  await expect.poll(() => page.evaluate(() => window.posterAssetLayout.getSelectedKeys())).toEqual(['qr']);

  await page.locator('[data-layout-mode]').click();
  await expect.poll(() => page.evaluate(() => ({
    layout: window.posterLayoutTool.isEnabled(),
    asset: window.posterAssetLayout.isEnabled(),
    selected: window.posterAssetLayout.getSelectedKeys(),
  }))).toEqual({ layout: false, asset: false, selected: [] });
});

test('clearing a group removes the transform box and the next object click starts a clean selection', async ({ page }) => {
  await enableLayout(page);
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

test('one layout tool switches context by the selected object and clears stale selection', async ({ page }) => {
  await enableLayout(page);
  await page.locator('[data-preview-text-id="section-chair"]').click();
  await expect.poll(() => page.evaluate(() => ({
    text: window.posterTextLayout.isEnabled(),
    asset: window.posterAssetLayout.isEnabled(),
    textCount: window.posterTextLayout.getSelectedIds().length,
  }))).toEqual({ text: true, asset: false, textCount: 1 });

  await page.locator('.canvas-asset-slot[data-key="qr"]').click();
  await expect.poll(() => page.evaluate(() => ({
    context: window.posterLayoutTool.getContext(),
    text: window.posterTextLayout.isEnabled(),
    asset: window.posterAssetLayout.isEnabled(),
    textCount: window.posterTextLayout.getSelectedIds().length,
    assetKeys: window.posterAssetLayout.getSelectedKeys(),
  }))).toEqual({ context: 'asset', text: false, asset: true, textCount: 0, assetKeys: ['qr'] });

  await page.locator('[data-preview-text-id="section-chair"]').click();
  await expect.poll(() => page.evaluate(() => ({
    context: window.posterLayoutTool.getContext(),
    text: window.posterTextLayout.isEnabled(),
    asset: window.posterAssetLayout.isEnabled(),
    assetCount: window.posterAssetLayout.getSelectedKeys().length,
    textIds: window.posterTextLayout.getSelectedIds(),
  }))).toEqual({ context: 'text', text: true, asset: false, assetCount: 0, textIds: ['section-chair'] });
});