import { expect, test } from '@playwright/test';
import { DEMO, loginAs, logout, TOKEN_KEY, uiLogin } from './helpers';

test.describe('01 - Authentication, route protection, RBAC and profile', () => {
  test('unauthenticated visit to / redirects to /login', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expect(page.locator('#email')).toBeVisible();
    await expect(page.locator('#password')).toBeVisible();
  });

  test('valid login lands on the dashboard', async ({ page }) => {
    await uiLogin(page, DEMO.admin.email);
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('wrong password shows an error toast and stays on /login', async ({ page }) => {
    await uiLogin(page, DEMO.admin.email, 'wrong-password');
    await expect(page.locator('[data-sonner-toast][data-type="error"]')).toBeVisible();
    await expect(page.getByText('Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });

  test('injected token authenticates the session', async ({ page, request }) => {
    await loginAs(page, request, DEMO.admin.email);
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
    const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
    expect(token).toBeTruthy();
  });

  test('clearing the token and reloading sends the user back to /login', async ({ page }) => {
    // Sign in through the real form: loginAs() installs an init script that would
    // re-seed the token on reload, masking the logout behaviour under test.
    await uiLogin(page, DEMO.admin.email);
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();

    await logout(page);
    await page.reload();

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('RBAC denies an AUDITEE direct access to /masters/users', async ({ page, request }) => {
    await loginAs(page, request, DEMO.auditee.email);
    await page.goto('/masters/users');

    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await expect(page.getByText(`Your role (${DEMO.auditee.role}) cannot view this page.`)).toBeVisible();
  });

  test('an ADMIN can reach /masters/users', async ({ page, request }) => {
    await loginAs(page, request, DEMO.admin.email);
    await page.goto('/masters/users');

    await expect(page.getByRole('heading', { name: 'User', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Access denied' })).toHaveCount(0);
  });

  test('profile page renders the signed-in identity', async ({ page, request }) => {
    await loginAs(page, request, DEMO.admin.email);
    await page.goto('/profile');

    await expect(page.getByRole('heading', { name: 'Profile' })).toBeVisible();
    await expect(page.getByText('admin@acme.example')).toBeVisible();
    await expect(page.getByText('System Administrator').first()).toBeVisible();
  });
});
