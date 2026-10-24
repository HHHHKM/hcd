import { test, expect, memberPage, preparePage, capture } from './helpers';

for (const theme of ['light', 'dark'] as const) {
  test(`home 1440 ${theme}`, async ({ page, memberState }) => {
    await memberPage(page, memberState, '/', 1440, theme);
    await expect(page.locator('.doc-card')).toHaveCount(2);
    await capture(page, `home-1440-${theme}`);
  });

  for (const width of [1680, 1440, 1280, 805, 390]) {
    test(`reading ${width} ${theme}`, async ({ page, memberState }) => {
      await memberPage(page, memberState, '/d/d_aaaaaaab', width, theme, true);
      await expect(page.locator('.document-page [data-hcd-node-id="n_aaaaaaab"]').first()).toBeAttached();
      await expect(page.locator('.right-rail.open')).toBeVisible();
      await expect(page.locator('#comment-cm_demo000000')).toBeAttached();
      if (width >= 1280) {
        const contentWidth = await page.locator('.module-content').first().evaluate((node) =>
          node.getBoundingClientRect().width,
        );
        expect(contentWidth, 'body width with discussion open').toBeGreaterThanOrEqual(680);
      }
      await capture(page, `reading-${width}-${theme}`);
    });
  }

  test(`edit 1440 ${theme}`, async ({ page, memberState }) => {
    await memberPage(page, memberState, '/d/d_aaaaaaab', 1440, theme);
    await page.getByRole('button', { name: '编辑文档', exact: true }).click();
    await expect(page.locator('.document-editor-fields .editable-block').first()).toBeVisible();
    await expect(page.locator('.edit-dock')).toBeVisible();
    await capture(page, `edit-1440-${theme}`);
  });

  test(`review 1440 ${theme}`, async ({ page, memberState }) => {
    await memberPage(page, memberState, '/d/d_aaaaaaab/review', 1440, theme);
    await expect(page.locator('.review-modal')).toBeVisible();
    await expect(page.locator('.submission-list .submission-row')).toHaveCount(4);
    await capture(page, `review-1440-${theme}`);
  });

  test(`history 1440 ${theme}`, async ({ page, memberState }) => {
    await memberPage(page, memberState, '/d/d_aaaaaaab/history', 1440, theme);
    await expect(page.locator('.version-comparison-result[aria-busy="false"]')).toBeVisible();
    await expect(page.locator('.version-read-error')).toHaveCount(0);
    await capture(page, `history-1440-${theme}`);
  });

  test(`settings 1440 ${theme}`, async ({ page, memberState }) => {
    await memberPage(page, memberState, '/settings', 1440, theme);
    await expect(page.locator('.password-settings')).toBeVisible();
    await capture(page, `settings-1440-${theme}`);
  });

  for (const width of [1440, 390]) {
    test(`guest ${width} ${theme}`, async ({ page }) => {
      await preparePage(page, width, theme);
      await page.goto('/s/visual_viewer_v1');
      await expect(page.locator('.shared-page h1')).toHaveText('Q4 增长方案');
      await expect(page.locator('.shared-module').first()).toBeVisible();
      await expect(page.locator('.shared-discussions article')).toHaveCount(1);
      await capture(page, `guest-${width}-${theme}`);
    });
  }

  test(`login 1440 ${theme}`, async ({ page }) => {
    await preparePage(page, 1440, theme);
    await page.goto('/login');
    await expect(page.locator('.auth-card input[type="email"]')).toBeVisible();
    await capture(page, `login-1440-${theme}`);
  });

  for (const width of [1440, 360]) {
    test(`more menu ${width} ${theme}`, async ({ page, memberState }) => {
      await memberPage(page, memberState, '/d/d_aaaaaaab', width, theme);
      await page.getByRole('button', { name: '更多文档操作', exact: true }).click();
      await expect(page.getByRole('menu')).toBeVisible();
      await capture(page, `more-${width}-${theme}`);
    });
  }
}
