import { expect, request as apiRequest, test, type Locator, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, apiLogin, gotoNav, openCreateDialog, uniqueName } from './helpers';

/**
 * Organisation masters (Companies, Plants, Departments, Processes).
 *
 * Every page is rendered by the generic ResourcePage component, so the flow is
 * identical: create -> row appears -> search filters -> edit -> delete.
 * Deletes are soft (the backend flips `active` to false), so the row stays in
 * the list; we assert the success toast rather than row removal.
 *
 * KNOWN APP BUG (reported, not fixed here):
 * useOptions() in src/features/masters/use-options.ts - and the parent-process
 * option loader in masters-pages.tsx - fetch CRUD list endpoints via
 * resources.all(), which returns the raw paginated `{ items, total, ... }`
 * envelope. The components then call `.map()` on that object and crash the
 * whole route with "(data ?? []).map is not a function".
 * `normaliseOptionLookups()` below unwraps the envelope for those option
 * lookups only (requests without a `page` query param). The ResourcePage CRUD
 * flow itself still runs against the real backend unchanged.
 *
 * Auth note: the backend rate limits `/api/auth/*` (200 requests / 15 min) and
 * the app calls `/api/auth/me` on every full page boot. To stay inside that
 * budget we authenticate once per worker and then navigate client-side.
 */

let qmrToken = '';

/** Short unique code, comfortably within the backend's 32 char limit. */
function shortCode(prefix: string): string {
  return `${prefix}${Date.now().toString(36).toUpperCase()}${Math.floor(Math.random() * 100)}`;
}

function rowWith(page: Page, text: string): Locator {
  return page.getByRole('row').filter({ hasText: text });
}

/**
 * ResourcePage wires its inputs through react-hook-form's register, which sets
 * `name` but not `id`, so address fields by name attribute rather than id.
 */
function fieldInput(dialog: Locator, name: string): Locator {
  return dialog.locator(`input[name="${name}"]`);
}

/** Open the first <select> in the dialog and pick its first option. */
async function pickFirstSelect(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('combobox').first().click();
  const option = page.getByRole('option').first();
  await expect(option).toBeVisible();
  await option.click();
}

/** Work around the useOptions paginated-envelope bug for option lookups only. */
async function normaliseOptionLookups(page: Page): Promise<void> {
  const optionEndpoints = ['companies', 'plants', 'departments', 'processes'];
  for (const endpoint of optionEndpoints) {
    await page.route(`**/api/org/${endpoint}*`, async (route) => {
      const url = new URL(route.request().url());
      // Paginated ResourcePage list requests must pass through untouched.
      if (url.searchParams.has('page')) return route.continue();
      try {
        const response = await route.fetch();
        const body = (await response.json()) as { items?: unknown[] } | unknown[];
        const items = Array.isArray(body) ? body : (body.items ?? []);
        await route.fulfill({ json: items });
      } catch {
        // The page navigated away while this option lookup was in flight, so
        // the response was disposed. The stale request can simply be dropped.
        await route.abort().catch(() => {});
      }
    });
  }
}

interface MasterConfig {
  navLabel: string;
  route: string;
  /** Record/page title as used by ResourcePage (toasts and PageHeader). */
  header: string;
  fillCreate: (page: Page, dialog: Locator, name: string, code: string) => Promise<void>;
}

const MASTERS: MasterConfig[] = [
  {
    navLabel: 'Plants',
    route: '/masters/plants',
    header: 'Plant',
    fillCreate: async (page, dialog, name, code) => {
      await pickFirstSelect(page, dialog);
      await fieldInput(dialog, 'code').fill(code);
      await fieldInput(dialog, 'name').fill(name);
    },
  },
  {
    navLabel: 'Departments',
    route: '/masters/departments',
    header: 'Department',
    fillCreate: async (page, dialog, name, code) => {
      await pickFirstSelect(page, dialog);
      await fieldInput(dialog, 'code').fill(code);
      await fieldInput(dialog, 'name').fill(name);
    },
  },
  {
    navLabel: 'Processes',
    route: '/masters/processes',
    header: 'Process',
    fillCreate: async (page, dialog, name, code) => {
      await pickFirstSelect(page, dialog);
      await fieldInput(dialog, 'code').fill(code);
      await fieldInput(dialog, 'name').fill(name);
    },
  },
  {
    navLabel: 'Companies',
    route: '/masters/companies',
    header: 'Company',
    fillCreate: async (_page, dialog, name, code) => {
      await fieldInput(dialog, 'code').fill(code);
      await fieldInput(dialog, 'name').fill(name);
    },
  },
];

/**
 * Inject the shared token, then load the app at '/' and wait until it has
 * booted. Retries handle the case where a boot-time /auth/me call is briefly
 * rate limited and the app redirects to /login.
 */
async function boot(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [TOKEN_KEY, qmrToken] as [string, string],
  );
  await expect(async () => {
    await page.goto('/');
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible({ timeout: 15_000 });
  }).toPass({ timeout: 60_000, intervals: [0, 2_000, 4_000, 8_000] });
}

/** Boot, then reach the target page through the sidebar (client-side, no /me). */
async function openMaster(page: Page, cfg: MasterConfig): Promise<void> {
  await boot(page);
  await expect(async () => {
    await gotoNav(page, cfg.navLabel);
    await expect(page).toHaveURL(new RegExp(`${cfg.route}$`));
    await expect(page.getByRole('heading', { name: cfg.header, exact: true })).toBeVisible();
  }).toPass({ timeout: 30_000, intervals: [0, 2_000, 4_000] });
}

async function runCrudFlow(page: Page, cfg: MasterConfig): Promise<void> {
  const name = uniqueName(cfg.header);
  const renamed = `${name} edited`;
  const code = shortCode(cfg.header.slice(0, 2).toUpperCase());

  await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });

  // Create -----------------------------------------------------------------
  const createDialog = await openCreateDialog(page);
  await cfg.fillCreate(page, createDialog, name, code);
  await createDialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByText(`${cfg.header} created`)).toBeVisible();
  await expect(createDialog).toBeHidden();
  await expect(rowWith(page, name)).toBeVisible();

  // Search filters down to the created row ---------------------------------
  const search = page.getByPlaceholder('Search...');
  await search.fill(name);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(rowWith(page, name)).toBeVisible();

  // Edit -------------------------------------------------------------------
  await search.fill('');
  await rowWith(page, name).getByRole('button', { name: 'Edit' }).click();
  const editDialog = page.getByRole('dialog');
  await expect(editDialog.getByText(`Edit ${cfg.header}`)).toBeVisible();
  await fieldInput(editDialog, 'name').fill(renamed);
  await editDialog.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(`${cfg.header} updated`)).toBeVisible();
  await expect(editDialog).toBeHidden();

  await search.fill(renamed);
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(rowWith(page, renamed)).toBeVisible();

  // Delete (soft) ----------------------------------------------------------
  await rowWith(page, renamed).getByRole('button', { name: 'Delete' }).click();
  const confirm = page.getByRole('dialog');
  await expect(confirm.getByText(`Delete ${cfg.header}?`)).toBeVisible();
  await confirm.getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText(`${cfg.header} deleted`)).toBeVisible();
}

test.describe('Organisation masters', () => {
  test.describe.configure({ timeout: 90_000 });

  test.beforeAll(async () => {
    // Wait for the shared auth rate-limit window; other suites run concurrently.
    test.setTimeout(660_000);
    const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
    const ctx = await apiRequest.newContext({ baseURL });
    for (let attempt = 0; attempt < 300 && !qmrToken; attempt++) {
      try {
        qmrToken = await apiLogin(ctx, DEMO.qmr.email);
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
    }
    await ctx.dispose();
    if (!qmrToken) throw new Error('Could not authenticate: /api/auth rate limit window stayed exhausted');
  });

  test.beforeEach(async ({ page }) => {
    await normaliseOptionLookups(page);
  });

  for (const cfg of MASTERS) {
    test(`${cfg.header}: create, search, edit and delete`, async ({ page }) => {
      await openMaster(page, cfg);
      await runCrudFlow(page, cfg);
    });
  }

  test('sidebar navigation opens each organisation master page', async ({ page }) => {
    await boot(page);
    const nav = [
      { label: 'Companies', route: '/masters/companies', header: 'Company' },
      { label: 'Plants', route: '/masters/plants', header: 'Plant' },
      { label: 'Departments', route: '/masters/departments', header: 'Department' },
      { label: 'Processes', route: '/masters/processes', header: 'Process' },
    ];
    for (const { label, route, header } of nav) {
      await expect(async () => {
        await gotoNav(page, label);
        await expect(page).toHaveURL(new RegExp(`${route}$`));
        await expect(page.getByRole('heading', { name: header, exact: true })).toBeVisible();
      }).toPass({ timeout: 20_000, intervals: [0, 2_000] });
    }
  });

  test('table search filters rows by a unique created name', async ({ page }) => {
    const cfg = MASTERS[0];
    await openMaster(page, cfg);
    await expect(page.locator('tbody tr').first()).toBeVisible({ timeout: 20_000 });

    const name = uniqueName('SearchPlant');
    const dialog = await openCreateDialog(page);
    await pickFirstSelect(page, dialog);
    await fieldInput(dialog, 'code').fill(shortCode('SP'));
    await fieldInput(dialog, 'name').fill(name);
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page.getByText('Plant created')).toBeVisible();

    const search = page.getByPlaceholder('Search...');
    await search.fill(name);
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await expect(rowWith(page, name)).toBeVisible();
    await expect(page.getByText('Chennai Plant')).toBeHidden();

    // Clean up the record created above (soft delete).
    await rowWith(page, name).getByRole('button', { name: 'Delete' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
    await expect(page.getByText('Plant deleted')).toBeVisible();
  });
});
