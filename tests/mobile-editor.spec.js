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

test('mobile shell uses fit-width canvas and one visual bottom command surface', async ({ page }) => {
  const metrics = await page.evaluate(() => {
    const command = document.querySelector('.canvas-command-bar').getBoundingClientRect();
    const layoutButton = document.querySelector('[data-layout-mode]').getBoundingClientRect();
    return {
      topbarHeight: document.querySelector('.topbar').getBoundingClientRect().height,
      posterWidth: document.getElementById('posterCanvas').getBoundingClientRect().width,
      commandPosition: getComputedStyle(document.querySelector('.canvas-command-bar')).position,
      dockPosition: getComputedStyle(document.querySelector('.text-layout-dock')).position,
      layoutInsideCommandY: layoutButton.top >= command.top && layoutButton.bottom <= command.bottom + 1,
      viewportBackground: getComputedStyle(document.querySelector('.poster-viewport')).backgroundColor,
    };
  });

  expect(metrics.topbarHeight).toBeLessThanOrEqual(54);
  expect(metrics.posterWidth).toBeGreaterThan(350);
  expect(metrics.posterWidth).toBeLessThanOrEqual(370);
  expect(metrics.commandPosition).toBe('fixed');
  expect(metrics.dockPosition).toBe('fixed');
  expect(metrics.layoutInsideCommandY).toBe(true);
  expect(metrics.viewportBackground).toBe('rgb(223, 227, 232)');
  await expect(page.locator('#projectSelect')).toBeVisible();
  await expect(page.locator('#renderServiceState')).toBeVisible();
  await expect(page.locator('#clearLocalData')).toBeHidden();
  await expect(page.locator('#submitBtn')).toBeVisible();
});

test('idle job status stays out of the way until work starts', async ({ page }) => {
  const state = page.locator('.canvas-job-state');
  await expect(state).toHaveClass(/is-idle/);
  await expect(state).toBeHidden();

  await page.evaluate(() => {
    const status = document.getElementById('jobStatus');
    status.textContent = 'Photoshop 正在生成正式海报…';
  });
  await expect(state).not.toHaveClass(/is-idle/);
  await expect(state).toBeVisible();
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

test('mobile text editor follows the visual viewport above the soft keyboard', async ({ page }) => {
  await page.locator('[data-preview-text-id="chair-name"]').click();
  const sheet = page.locator('.mobile-text-sheet');
  await expect(sheet).toBeVisible();
  await page.setViewportSize({ width: 390, height: 560 });

  await expect.poll(() => page.evaluate(() => {
    window.posterMobileKeyboard?.sync?.();
    const host = document.querySelector('.mobile-text-sheet');
    const viewport = window.visualViewport;
    if (!host || !viewport) return false;
    const rect = host.getBoundingClientRect();
    const visibleBottom = viewport.offsetTop + viewport.height;
    return Math.abs(rect.bottom - visibleBottom) <= 1
      && Math.abs(rect.height - viewport.height) <= 1
      && host.style.bottom === 'auto';
  })).toBe(true);

  await expect(sheet.locator('.mobile-text-sheet-input')).toBeFocused();
});

test('mobile project profiles start from their own calibrated text and asset positions', async ({ page }) => {
  const layouts = await page.evaluate(() => {
    const text = window.POSTER_TEXT_LAYOUT_PROFILES.profiles;
    const assets = window.POSTER_ASSET_LAYOUT_PROFILES.profiles;
    const byId = items => Object.fromEntries(items.map(item => [item.id, item]));
    return {
      text: {
        yilu: byId(text['yilu-changan-text-v1'].items)['section-speakers'].y,
        tonghu: byId(text['tonghu-jiankang-text-v1'].items)['section-speakers'].y,
        tongxin: byId(text['tongxin-hujian-text-v1'].items)['section-speakers'].y,
      },
      assets: {
        yilu: assets['yilu-changan-assets-v1'].layout.speaker1,
        tonghu: assets['tonghu-jiankang-assets-v1'].layout.speaker1,
        tongxin: assets['tongxin-hujian-assets-v1'].layout.speaker1,
      },
    };
  });

  expect(layouts.text).toEqual({ yilu: 772, tonghu: 782, tongxin: 773 });
  expect(layouts.assets).toEqual({
    yilu: expect.objectContaining({ left: 221, top: 836 }),
    tonghu: expect.objectContaining({ left: 214, top: 848 }),
    tongxin: expect.objectContaining({ left: 217, top: 836 }),
  });
});

test('layout mode keeps tap for selection instead of opening the mobile text sheet', async ({ page }) => {
  await page.locator('[data-layout-mode]').click();
  await expect.poll(() => page.evaluate(() => window.posterLayoutTool.isEnabled())).toBe(true);
  await page.locator('[data-preview-text-id="chair-name"]').click();
  await expect(page.locator('.mobile-text-sheet')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.posterTextLayout.getSelectedIds())).toEqual(['chair-name']);
});

test('crop dialogs are full-screen and use touch-first helper copy on mobile', async ({ page }) => {
  await page.evaluate(() => {
    document.getElementById('avatarCropModal').hidden = false;
  });
  const box = await page.locator('#avatarCropModal .crop-dialog').boundingBox();
  expect(box).toBeTruthy();
  expect(Math.abs(box.width - 390)).toBeLessThanOrEqual(1);
  expect(Math.abs(box.height - 844)).toBeLessThanOrEqual(2);
  await expect(page.locator('#avatarCropModal .crop-stage')).toBeVisible();
  const helper = await page.locator('#avatarCropModal .crop-dialog-head p').evaluate(el => getComputedStyle(el, '::after').content);
  expect(helper).toContain('拖动调整位置');
  await expect(page.locator('#avatarCropModal .crop-dialog-actions')).toBeVisible();
});
