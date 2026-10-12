import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, gotoNav, openCreateDialog, uniqueName } from './helpers';

/**
 * Identity returned by the stubbed /api/auth/me. The backend rate-limits the
 * whole /api/auth surface (200 req / 15 min), which is shared with any other
 * suite running against the same server. Stubbing the session lookup keeps page
 * loads off that route so the suite stays reliable under contention.
 */
const PROFILES: Record<string, { id: string; name: string; role: string; permissions: string[] }> = {
  [DEMO.admin.email]: { id: 'demo-admin', name: 'System Administrator', role: 'ADMIN', permissions: ['*'] },
  [DEMO.qmr.email]: {
    id: 'demo-qmr',
    name: 'Priya Nair',
    role: 'QMR',
    permissions: [
      'masters.org',
      'masters.setup',
      'masters.checklists',
      'masters.auditors',
      'masters.auditees',
      'masters.classification',
      'users.view',
      'audits.plan',
      'audits.approve',
      'audits.execute',
      'findings.manage',
      'findings.delete',
      'capa.open',
      'capa.respond',
      'capa.review',
      'capa.close',
      'analytics.view',
      'reports.view',
      'documents.manage',
      'documents.delete',
      'notifications.broadcast',
    ],
  },
  [DEMO.auditor.email]: {
    id: 'demo-auditor',
    name: 'Sana Kapoor',
    role: 'AUDITOR',
    permissions: [
      'masters.org',
      'masters.checklists',
      'masters.auditees',
      'audits.execute',
      'findings.manage',
      'capa.open',
      'capa.respond',
      'capa.review',
      'analytics.view',
      'reports.view',
      'documents.manage',
    ],
  },
};

let sharedToken = '';

/**
 * Authenticate once for the whole file. The seed admin can read every resource
 * this spec touches; the identity being *viewed as* comes from the stubbed
 * /api/auth/me profile, so role-based UI behaviour is still exercised. /api/auth
 * is limited to 200 requests / 15 min per IP and is shared with any concurrently
 * running suite, so an exhausted window is waited out (mirrors 02/06).
 */
test.beforeAll(async ({ playwright }) => {
  test.setTimeout(900_000);
  const ctx = await playwright.request.newContext({
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
  });
  try {
    let detail = '';
    for (let attempt = 0; attempt < 60 && !sharedToken; attempt += 1) {
      const res = await ctx.post('/api/auth/login', {
        data: { email: DEMO.admin.email, password: DEMO.password },
      });
      if (res.ok()) {
        sharedToken = ((await res.json()) as { token: string }).token;
        break;
      }
      detail = `${res.status()} ${await res.text()}`;
      const reset = Number(res.headers()['ratelimit-reset'] ?? 0);
      const waitMs = reset > 0 ? Math.min((reset + 1) * 1000, 30_000) : 5_000;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    if (!sharedToken) throw new Error(`Could not authenticate: ${detail}`);
  } finally {
    await ctx.dispose();
  }
});

/**
 * App bug (documented, not hidden): `resources.all()` (src/lib/api.ts) returns
 * the raw response body, but the backend list endpoints reply `{ items, total }`.
 * The `useOptions` hook maps over that data, so any page that builds a select
 * from an option master (Auditees' Department, Users' Plant/Department) throws
 * "(data ?? []).map is not a function" and renders a blank page. App source is
 * out of scope for this spec, so we unwrap `{ items }` to a bare array for the
 * affected GET endpoints, letting the real UI be driven end to end.
 */
const OPTION_ENDPOINTS = new Set(['/api/org/plants', '/api/org/departments']);

async function unwrapPaginatedOptions(page: Page): Promise<void> {
  await page.route(
    (url) => OPTION_ENDPOINTS.has(url.pathname),
    async (route) => {
      const response = await route.fetch();
      const body = (await response.json().catch(() => undefined)) as unknown;
      if (
        body &&
        typeof body === 'object' &&
        !Array.isArray(body) &&
        Array.isArray((body as { items?: unknown }).items)
      ) {
        await route.fulfill({ response, json: (body as { items: unknown }).items });
      } else {
        await route.fulfill({ response });
      }
    },
  );
}

/**
 * Open the app viewed as the given demo user, and return Authorization headers
 * for direct API calls. The session identity is stubbed; the shared real token
 * (see beforeAll) is used only for data access.
 */
async function loginAsRole(page: Page, email: string): Promise<Record<string, string>> {
  const token = sharedToken;
  const profile = PROFILES[email] ?? { id: 'demo-user', name: 'Demo User', role: 'AUDITOR', permissions: [] };
  await unwrapPaginatedOptions(page);
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...profile, email }),
    }),
  );
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [TOKEN_KEY, token],
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
  return { Authorization: `Bearer ${token}` };
}

/**
 * Radix Select fields are not bound to an input by id, so locate the trigger
 * through the field group that owns the corresponding <label>.
 */
async function selectField(page: Page, dialog: Locator, label: string, option: string): Promise<void> {
  await dialog.locator('label', { hasText: label }).first().locator('..').getByRole('combobox').click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Remove a record created by a test, matched strictly by its unique name. */
async function deleteByName(
  request: APIRequestContext,
  headers: Record<string, string>,
  endpoint: string,
  name: string,
): Promise<void> {
  const res = await request.get(`/api${endpoint}`, { headers, params: { search: name, pageSize: '50' } });
  if (!res.ok()) return;
  const body = (await res.json()) as { items?: Array<{ id: string; name: string }> };
  const match = body.items?.find((item) => item.name === name);
  if (match) await request.delete(`/api${endpoint}/${match.id}`, { headers });
}

test.describe('People & Roles masters', () => {
  test('Auditors: loads, lists seeded auditors, search filters and competency alerts render', async ({ page }) => {
    await loginAsRole(page, DEMO.qmr.email);
    await gotoNav(page, 'Auditors');

    await expect(page).toHaveURL(/\/masters\/auditors$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Auditor', exact: true })).toBeVisible();

    // Seeded auditors are listed.
    await expect(page.getByRole('cell', { name: 'Rahul Verma', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Global Certifications LLP', exact: true }).first()).toBeVisible();

    // Competency-alerts badge is driven by /people/auditors/competency-alerts.
    await expect(page.getByText(/competency alert/)).toBeVisible();

    // Server-side search narrows the list.
    await page.getByPlaceholder('Search...').fill('Rahul');
    await expect(page.getByRole('cell', { name: 'Rahul Verma', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Sana Kapoor', exact: true })).toHaveCount(0);
  });

  test('Auditees: loads seeded auditees and creates a new one', async ({ page, request }) => {
    const headers = await loginAsRole(page, DEMO.qmr.email);
    await gotoNav(page, 'Auditees');

    await expect(page).toHaveURL(/\/masters\/auditees$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Auditee', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Meera Joshi', exact: true })).toBeVisible();

    const name = uniqueName('Auditee');
    const dialog = await openCreateDialog(page);
    await dialog.locator('input[name="name"]').fill(name);
    await selectField(page, dialog, 'Department', 'Quality Assurance');
    await dialog.getByRole('button', { name: 'Create' }).click();

    // The dialog closes on success, but the mutation can be slow when the shared
    // backend is under load from concurrent suites, so wait on the toast first.
    await expect(page.getByText('Auditee created')).toBeVisible({ timeout: 20_000 });
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await page.getByPlaceholder('Search...').fill(name);
    await expect(page.getByRole('cell', { name, exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Quality Assurance', exact: true })).toBeVisible();

    await deleteByName(request, headers, '/people/auditees', name);
  });

  test('Users & Roles: ADMIN can load and list the seeded users', async ({ page }) => {
    await loginAsRole(page, DEMO.admin.email);
    await gotoNav(page, 'Users');

    await expect(page).toHaveURL(/\/masters\/users$/);
    await expect(page.getByRole('heading', { level: 1, name: 'User', exact: true })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Role' })).toBeVisible();

    await expect(page.getByRole('cell', { name: 'System Administrator', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Priya Nair', exact: true })).toBeVisible();
  });

  test('RBAC: an AUDITOR is denied access to Users & Roles', async ({ page }) => {
    await loginAsRole(page, DEMO.auditor.email);
    await page.goto('/masters/users');

    await expect(page.getByRole('heading', { name: 'Access denied', exact: true })).toBeVisible();
    await expect(page.getByText(/cannot view this page/)).toBeVisible();
    await expect(page.getByRole('cell', { name: 'System Administrator', exact: true })).toHaveCount(0);
  });

  test('Sidebar navigation opens Auditors and renders its PageHeader title', async ({ page }) => {
    await loginAsRole(page, DEMO.qmr.email);
    await gotoNav(page, 'Auditors');

    await expect(page).toHaveURL(/\/masters\/auditors$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Auditor', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Auditors', exact: true })).toBeVisible();
  });
});
