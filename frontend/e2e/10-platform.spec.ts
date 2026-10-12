import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, apiLogin, gotoNav, uniqueName } from './helpers';

/**
 * The backend rate-limits /api/auth (200 requests / 15 min window), so log in
 * only once per worker and reuse the token across every test in this file.
 */
let cachedToken: string | null = null;

async function authToken(request: APIRequestContext): Promise<string> {
  if (!cachedToken) cachedToken = await apiLogin(request, DEMO.admin.email);
  return cachedToken;
}

/** Seed the cached token and land on the dashboard (like helpers.loginAs). */
async function openApp(page: Page, request: APIRequestContext): Promise<void> {
  const token = await authToken(request);
  await page.addInitScript(
    ([key, value]) => window.localStorage.setItem(key, value as string),
    [TOKEN_KEY, token] as [string, string],
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
}

/** Navigate to Notifications via the sidebar (its label collides with the bell). */
async function gotoNotifications(page: Page): Promise<void> {
  await page.locator('aside').getByRole('link', { name: 'Notifications', exact: true }).click();
  await expect(page).toHaveURL(/\/notifications$/);
}

/**
 * Platform surfaces: Dashboard, Analytics, Reports, Notifications, Documents.
 * Read the matching feature sources for the selectors used below.
 */
test.describe('Platform surfaces', () => {
  test('dashboard renders KPI stat cards with numeric values', async ({ page, request }) => {
    await openApp(page, request);
    await expect(page.getByRole('heading', { name: 'Quality Dashboard' })).toBeVisible();

    // The KPI grid is the first grid container; scope here to avoid matching
    // chart legend labels (e.g. "OFI") further down the page.
    const kpiGrid = page.locator('div.grid').first();
    const numericLabels = ['Total Audits', 'Completed Audits', 'Open NCs', 'Overdue NCs', 'Major NC', 'OFI'];
    for (const label of numericLabels) {
      const labelEl = kpiGrid.getByText(label, { exact: true });
      await expect(labelEl).toBeVisible();
      // StatCard renders the value in the paragraph right after the label.
      await expect(labelEl.locator('xpath=following-sibling::p[1]')).toHaveText(/^\d+$/);
    }

    const effectiveness = kpiGrid.getByText('CAPA Effectiveness', { exact: true });
    await expect(effectiveness).toBeVisible();
    await expect(effectiveness.locator('xpath=following-sibling::p[1]')).toHaveText(/^\d+%$/);

    // Dashboard charts (recharts) render once analytics data resolves.
    await expect(page.getByRole('heading', { name: 'Audits planned vs completed' })).toBeVisible();
    await expect(page.locator('svg.recharts-surface').first()).toBeVisible();
  });

  test('analytics renders sections and recharts charts', async ({ page, request }) => {
    await openApp(page, request);
    await gotoNav(page, 'Analytics');

    await expect(page.getByRole('heading', { name: 'Analytics', exact: true })).toBeVisible();
    for (const title of ['Findings by department', 'Findings by clause', 'CAPA status', 'NC trends']) {
      await expect(page.getByRole('heading', { name: title })).toBeVisible();
    }
    await expect(page.getByRole('heading', { name: 'Department-wise findings' })).toBeVisible();

    // At least one recharts chart container must be present.
    const charts = page.locator('svg.recharts-surface');
    await expect(charts.first()).toBeVisible();
    expect(await charts.count()).toBeGreaterThanOrEqual(1);
  });

  test('reports render controls and generate a downloadable report', async ({ page, request }) => {
    await openApp(page, request);
    await gotoNav(page, 'Reports');

    await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'NC Register' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Department / Clause-wise Findings' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Audit Summary' })).toBeVisible();

    // NC Register is the first report card, so its CSV button is first in DOM order.
    const csvButton = page.getByRole('button', { name: 'CSV' }).first();
    await expect(csvButton).toBeEnabled();

    // Evidence can be a browser download event or the success toast.
    const downloadPromise = page
      .waitForEvent('download', { timeout: 15_000 })
      .catch(() => null);
    const toastSeen = page
      .getByText(/Downloaded nc-register\.csv/)
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);

    await csvButton.click();

    const [download, toast] = await Promise.all([downloadPromise, toastSeen]);
    expect(download ?? toast).toBeTruthy();
    if (download) {
      expect(download.suggestedFilename()).toContain('nc-register');
    }
  });

  test('notifications page renders a list or empty state', async ({ page, request }) => {
    await openApp(page, request);
    await gotoNotifications(page);

    await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible();
    await expect(page.getByText('Alerts for audits, findings, CAPA and approvals.')).toBeVisible();

    // Either the empty-state copy or the populated list container renders.
    const emptyState = page.getByText(/No (unread )?notifications/);
    const list = page.locator('div.bg-card.border').first();
    await expect(emptyState.or(list).first()).toBeVisible();
  });

  test('documents page loads and accepts a small upload', async ({ page, request }) => {
    await openApp(page, request);
    await gotoNav(page, 'Document Library');

    await expect(page.getByRole('heading', { name: 'Document Library' })).toBeVisible();

    const code = uniqueName('E2E-DOC').replace(/\s+/g, '-');
    const name = uniqueName('E2E Document');
    const dir = mkdtempSync(join(tmpdir(), 'qms-e2e-'));
    const tmpFile = join(dir, 'evidence.txt');
    writeFileSync(tmpFile, 'E2E document upload contents\n', 'utf-8');

    await page.getByRole('button', { name: 'Upload document' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    await dialog.getByPlaceholder('SOP-QA-001').fill(code);
    await dialog.getByPlaceholder('Document title').fill(name);
    await dialog.locator('input[type="file"]').setInputFiles(tmpFile);
    await dialog.getByRole('button', { name: 'Upload' }).click();

    await expect(page.getByText('Document uploaded')).toBeVisible();
    await expect(dialog).toBeHidden();
    // New documents are sorted by updatedAt desc, so the row lands on page 1.
    await expect(page.getByRole('cell', { name: code })).toBeVisible();
  });
});
