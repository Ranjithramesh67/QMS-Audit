import { expect, test } from '@playwright/test';
import { DEMO, loginAs, uiLogin } from './helpers';

test.describe('E2E harness sanity', () => {
  test('app boots and API proxy is reachable', async ({ page, request }) => {
    const health = await request.get('/api/health');
    expect(health.ok()).toBeTruthy();
  });

  test('login form signs in', async ({ page }) => {
    await uiLogin(page, DEMO.admin.email);
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 20_000 });
  });

  test('token injection authenticates', async ({ page, request }) => {
    await loginAs(page, request, DEMO.qmr.email);
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible();
  });
});
