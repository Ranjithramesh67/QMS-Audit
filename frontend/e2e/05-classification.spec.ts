import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, gotoNav, uniqueName } from './helpers';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

/** Short, collision-resistant code (kept within the backend's max length). */
const shortCode = (prefix: string) => `${prefix}${Date.now().toString(36).toUpperCase()}`;

/** Rows rendered in the data table body. */
const tableRows = (page: Page) => page.locator('tbody tr');

const searchBox = (page: Page) => page.getByPlaceholder('Search...');

/**
 * Fetch a JWT once per role. The backend protects /api/auth with a global
 * 200 req / 15 min rate limit, so sharing tokens across tests keeps this spec
 * well under it. If another client has saturated the limiter, wait out the
 * advertised reset window and retry (bounded) instead of failing the suite.
 */
async function fetchToken(email: string): Promise<string> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    const deadline = Date.now() + 13 * 60 * 1000;
    for (;;) {
      const res = await ctx.post('/api/auth/login', { data: { email, password: DEMO.password } });
      if (res.ok()) return ((await res.json()) as { token: string }).token;
      if (res.status() !== 429 || Date.now() > deadline) {
        throw new Error(`Login failed for ${email}: ${res.status()} ${await res.text()}`);
      }
      const retryAfter = Number(res.headers()['retry-after'] ?? '15');
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 5_000), 60_000)));
    }
  } finally {
    await ctx.dispose();
  }
}

let cachedTokens: Promise<{ qmr: string; auditor: string }> | undefined;

/** Resolve both role tokens once per worker, reusing them across tests. */
function getTokens(): Promise<{ qmr: string; auditor: string }> {
  cachedTokens ??= (async () => {
    const qmr = await fetchToken(DEMO.qmr.email);
    const auditor = await fetchToken(DEMO.auditor.email);
    return { qmr, auditor };
  })().catch((error) => {
    cachedTokens = undefined;
    throw error;
  });
  return cachedTokens;
}

/** Seed a pre-fetched token into localStorage before the app boots. */
async function signIn(page: Page, token: string): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value as string);
    },
    [TOKEN_KEY, token] as [string, string],
  );
  // The app hydrates the user via /api/auth/me, which shares the backend's
  // /api/auth rate limit. Transparently retry transient 429s (real response
  // is preserved) so hydration is not derailed by other clients' usage.
  await page.route('**/api/auth/me', async (route) => {
    const deadline = Date.now() + 10 * 60 * 1000;
    for (;;) {
      const response = await route.fetch();
      if (response.status() !== 429 || Date.now() > deadline) {
        await route.fulfill({ response });
        return;
      }
      const retryAfter = Number(response.headers()['retry-after'] ?? '15');
      await new Promise((resolve) => setTimeout(resolve, Math.min(Math.max(retryAfter * 1000, 3_000), 30_000)));
    }
  });
}

async function createRecord(page: Page, code: string, name: string) {
  await page.getByRole('button', { name: 'New' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('[name="code"]').fill(code);
  await dialog.locator('[name="name"]').fill(name);
  await dialog.getByRole('button', { name: 'Create' }).click();
}

async function deleteRecord(page: Page, name: string) {
  const row = tableRows(page).filter({ hasText: name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Delete' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Delete' }).click();
}

// The dev server can be slow under load; allow generous, non-flaky timeouts.
// Tracing is disabled to avoid races on the shared .artifacts directory.
test.use({ navigationTimeout: 90_000, actionTimeout: 30_000, trace: 'off' });

test.describe('Classification masters', () => {
  // The first token fetch may need to wait out a saturated auth rate limit.
  test.describe.configure({ timeout: 14 * 60 * 1000 });

  test('Finding Types: seeded rows load and search filters', async ({ page }) => {
    const { qmr } = await getTokens();
    await signIn(page, qmr);
    await page.goto('/masters/finding-types');
    await expect(page.getByRole('heading', { name: 'Finding Type', exact: true })).toBeVisible();

    await expect(tableRows(page).filter({ hasText: 'Nonconformity' })).toBeVisible();
    await expect(tableRows(page).filter({ hasText: 'Opportunity for Improvement' })).toBeVisible();

    await searchBox(page).fill('Opportunity for Improvement');
    await expect(tableRows(page).filter({ hasText: 'Opportunity for Improvement' })).toBeVisible();
    await expect(tableRows(page).filter({ hasText: 'Nonconformity' })).toHaveCount(0);

    await searchBox(page).fill('');
    await expect(tableRows(page).filter({ hasText: 'Nonconformity' })).toBeVisible();
  });

  test('Finding Types: create and delete a unique record', async ({ page }) => {
    const { qmr } = await getTokens();
    await signIn(page, qmr);
    await page.goto('/masters/finding-types');
    await expect(page.getByRole('heading', { name: 'Finding Type', exact: true })).toBeVisible();

    const name = uniqueName('FindingType');
    await createRecord(page, shortCode('FT'), name);
    await expect(page.getByText('Finding Type created')).toBeVisible();

    await searchBox(page).fill(name);
    await expect(tableRows(page).filter({ hasText: name })).toBeVisible();

    await deleteRecord(page, name);
    await expect(page.getByText('Finding Type deleted')).toBeVisible();
  });

  test('Severities: seeded rows load and search filters', async ({ page }) => {
    const { qmr } = await getTokens();
    await signIn(page, qmr);
    await page.goto('/masters/severities');
    await expect(page.getByRole('heading', { name: 'Severity', exact: true })).toBeVisible();

    await expect(tableRows(page).filter({ hasText: 'Major' })).toBeVisible();
    await expect(tableRows(page).filter({ hasText: 'Observation' })).toBeVisible();

    await searchBox(page).fill('Observation');
    await expect(tableRows(page).filter({ hasText: 'Observation' })).toBeVisible();
    await expect(tableRows(page).filter({ hasText: 'Minor' })).toHaveCount(0);

    await searchBox(page).fill('');
    await expect(tableRows(page).filter({ hasText: 'Minor' })).toBeVisible();
  });

  test('Severities: create and delete a unique record', async ({ page }) => {
    const { qmr } = await getTokens();
    await signIn(page, qmr);
    await page.goto('/masters/severities');
    await expect(page.getByRole('heading', { name: 'Severity', exact: true })).toBeVisible();

    const name = uniqueName('Severity');
    await createRecord(page, shortCode('SEV'), name);
    await expect(page.getByText('Severity created')).toBeVisible();

    await searchBox(page).fill(name);
    await expect(tableRows(page).filter({ hasText: name })).toBeVisible();

    await deleteRecord(page, name);
    await expect(page.getByText('Severity deleted')).toBeVisible();
  });

  test('Sidebar navigation exposes Classification pages with PageHeader titles', async ({ page }) => {
    const { qmr } = await getTokens();
    await signIn(page, qmr);
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Finding Types', exact: true })).toBeVisible();

    await gotoNav(page, 'Finding Types');
    await expect(page).toHaveURL(/\/masters\/finding-types/);
    await expect(page.getByRole('heading', { name: 'Finding Type', exact: true })).toBeVisible();

    await gotoNav(page, 'Severities');
    await expect(page).toHaveURL(/\/masters\/severities/);
    await expect(page.getByRole('heading', { name: 'Severity', exact: true })).toBeVisible();
  });

  test('RBAC: AUDITOR is denied access to Finding Types', async ({ page }) => {
    const { auditor } = await getTokens();
    await signIn(page, auditor);
    await page.goto('/masters/finding-types');

    await expect(page.getByRole('heading', { name: 'Access denied' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0);
  });
});
