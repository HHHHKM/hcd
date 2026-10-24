import { test as base, expect, type APIRequestContext, type Page } from '@playwright/test';

export type Theme = 'light' | 'dark';
type MemberState = Awaited<ReturnType<APIRequestContext['storageState']>>;
type Audit = { blockedExternalRequests: string[]; pageErrors: string[]; rateLimitedRequests: string[] };

export const test = base.extend<{ audit: Audit }, { memberState: MemberState }>({
  memberState: [async ({ playwright }, use) => {
    const baseURL = 'http://127.0.0.1:4173';
    const request = await playwright.request.newContext({ baseURL });
    try {
      // One real API login per worker, with the normal application quota intact.
      const response = await request.post('/api/v1/auth/login', {
        headers: { origin: baseURL!, 'x-hcd-request': '1' },
        data: { email: 'd@example.com', password: 'hcd-demo-2026' },
      });
      expect(response.ok(), `visual fixture login: ${response.status()}`).toBe(true);
      await use(await request.storageState());
    } finally {
      await request.dispose();
    }
  }, { scope: 'worker' }],
  audit: [async ({ context, page, baseURL }, use, testInfo) => {
    const audit: Audit = { blockedExternalRequests: [], pageErrors: [], rateLimitedRequests: [] };
    await context.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === baseURL) return route.continue();
      audit.blockedExternalRequests.push(route.request().url());
      return route.abort();
    });
    page.on('pageerror', (error) => audit.pageErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() === 429) audit.rateLimitedRequests.push(response.url());
    });
    await page.clock.setFixedTime(new Date('2026-10-24T12:00:00.000Z'));
    await use(audit);
    await testInfo.attach('local-browser-audit', {
      body: JSON.stringify({
        ...audit,
        blockedExternalRequests: audit.blockedExternalRequests.length,
        externalRequestURLs: audit.blockedExternalRequests,
      }, null, 2),
      contentType: 'application/json',
    });
    expect(audit.blockedExternalRequests, 'no external browser request is attempted').toEqual([]);
    expect(audit.pageErrors, 'no browser runtime errors').toEqual([]);
    expect(audit.rateLimitedRequests, 'screenshots must not capture a quota failure').toEqual([]);
  }, { auto: true }],
});

export { expect };

export async function preparePage(page: Page, width: number, theme: Theme, discussionOpen = width > 980) {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ colorScheme: theme });
  await page.addInitScript(({ selectedTheme, open }) => {
    localStorage.setItem('hcd.theme', selectedTheme);
    localStorage.setItem('hcd.discussion.open', String(open));
    localStorage.setItem('hcd.outline.open', 'false');
  }, { selectedTheme: theme, open: discussionOpen });
}

export async function memberPage(
  page: Page,
  state: MemberState,
  path: string,
  width: number,
  theme: Theme,
  discussionOpen = width > 980,
) {
  await page.context().addCookies(state.cookies);
  await preparePage(page, width, theme, discussionOpen);
  await page.goto(path);
  await expect(page.locator('.left-sidebar')).toBeAttached();
  await expect(page.locator('.global-error')).toHaveCount(0);
}

export async function settle(page: Page) {
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() => page.locator('img').evaluateAll((images) =>
    images.every((image) => image.complete),
  ), { message: 'all local image loads have settled' }).toBe(true);
  await expect(page.locator('.loading-view')).toHaveCount(0);
  await expect(page.locator('.global-error')).toHaveCount(0);
}

export async function capture(page: Page, name: string) {
  await settle(page);
  await expect(page).toHaveScreenshot(`${name}.png`, {
    fullPage: true,
    // Fixed seed dates already stabilize the UI; these date labels also cover
    // future scenarios with server-generated times without masking geometry.
    mask: [page.locator('time, .comment-head small, .submission-author small')],
  });
}
