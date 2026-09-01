const { test, expect } = require('@playwright/test');

test('uses Brave and loads a page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example Domain/);
});
