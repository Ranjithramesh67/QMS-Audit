import { expect, type APIRequestContext, type Page } from '@playwright/test';

/** localStorage key used by the app's token store (see src/lib/api.ts). */
export const TOKEN_KEY = 'qms.token';

/** Demo accounts seeded in backend/prisma/seed.ts. Shared password below. */
export const DEMO = {
  password: 'Password123!',
  admin: { email: 'admin@acme.example', role: 'ADMIN' },
  qmr: { email: 'qmr@acme.example', role: 'QMR' },
  lead: { email: 'lead@acme.example', role: 'LEAD_AUDITOR' },
  auditor: { email: 'auditor@acme.example', role: 'AUDITOR' },
  auditee: { email: 'auditee@acme.example', role: 'AUDITEE' },
  prodhead: { email: 'prodhead@acme.example', role: 'DEPT_HEAD' },
} as const;

/** Unique, timestamped value so parallel/rerun tests never collide. */
export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.floor(Math.random() * 10_000)}`;
}

/** Authenticate against the API and return a JWT. Uses the 5173 proxy. */
export async function apiLogin(request: APIRequestContext, email = DEMO.admin.email): Promise<string> {
  const res = await request.post('/api/auth/login', {
    data: { email, password: DEMO.password },
  });
  if (!res.ok()) throw new Error(`API login failed for ${email}: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { token: string };
  return body.token;
}

/** Auth headers for direct API calls from a request context. */
export async function authHeaders(request: APIRequestContext, email = DEMO.admin.email) {
  return { Authorization: `Bearer ${await apiLogin(request, email)}` };
}

/**
 * Seed the auth token into localStorage before the app boots, then land on
 * the dashboard. Faster and more deterministic than driving the login form.
 */
export async function loginAs(page: Page, request: APIRequestContext, email = DEMO.admin.email): Promise<void> {
  const token = await apiLogin(request, email);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [TOKEN_KEY, token],
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
}

/** Drive the real login form (used by the auth spec). */
export async function uiLogin(page: Page, email: string, password = DEMO.password): Promise<void> {
  await page.goto('/login');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

/** Clear the auth token and reload (simulates an unauthenticated visit). */
export async function logout(page: Page): Promise<void> {
  await page.evaluate((key) => window.localStorage.removeItem(key), TOKEN_KEY);
}

/** Navigate via the sidebar link label. */
export async function gotoNav(page: Page, label: string): Promise<void> {
  await page.getByRole('link', { name: label, exact: true }).click();
}

/** Open a ResourcePage create dialog and return the dialog locator. */
export async function openCreateDialog(page: Page) {
  await page.getByRole('button', { name: 'New' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}
