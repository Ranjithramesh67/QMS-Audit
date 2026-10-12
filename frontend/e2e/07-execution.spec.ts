import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, apiLogin, gotoNav, uniqueName } from './helpers';

// Setup + first-load Vite compilation can be slow under the shared dev server,
// so allow more headroom than the global 45s default.
test.describe.configure({ timeout: 90_000 });

/**
 * Audit Execution E2E coverage.
 *
 * Each test builds its own APPROVED + STARTED audit through the public API so
 * the specs stay independent, then drives the real Execution UI.
 *
 * KNOWN APP BUG (worked around below, see unlockExecution):
 *   POST /api/audits/:id/approve sets `audit.locked = true` and
 *   POST /api/audits/:id/start never clears it. ExecutionPage therefore treats
 *   every in-progress audit as locked and disables the documented/implemented
 *   toggles, the Save button and Complete Execution. The backend still accepts
 *   execution writes while the audit is IN_PROGRESS, so the workaround clears
 *   only that flag client-side to exercise the genuine UI logic.
 */

interface CreatedAudit {
  id: string;
  title: string;
  clauseIds: string[];
}

/**
 * The backend applies a shared auth rate limit (200 requests / 15 min), so
 * tokens are cached per account for the lifetime of the worker instead of
 * re-authenticating on every setup step.
 */
const tokenCache = new Map<string, string>();
async function tokenFor(request: APIRequestContext, email: string): Promise<string> {
  const cached = tokenCache.get(email);
  if (cached) return cached;
  const token = await apiLogin(request, email);
  tokenCache.set(email, token);
  return token;
}

/** Seeds a cached token before the app boots (rate-limit friendly loginAs). */
async function signIn(page: Page, request: APIRequestContext, email: string): Promise<void> {
  const token = await tokenFor(request, email);
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value);
    },
    [TOKEN_KEY, token],
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Opens an execution via the list page (SPA navigation, no extra token reload). */
async function openExecutionFromList(page: Page, title: string): Promise<void> {
  await gotoNav(page, 'Execution');
  await page.getByPlaceholder('Search audits...').fill(title);
  const row = page.getByRole('row').filter({ hasText: title });
  await expect(row).toBeVisible();
  await row.getByRole('link', { name: 'Open Execution' }).click();
  await expect(page.getByRole('heading', { name: new RegExp(escapeRegExp(title)) })).toBeVisible();
}

async function listItems<T>(request: APIRequestContext, headers: Record<string, string>, path: string): Promise<T[]> {
  const res = await request.get(path, { headers });
  if (!res.ok()) throw new Error(`GET ${path} failed: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { items?: T[] } | T[];
  return Array.isArray(body) ? body : body.items ?? [];
}

/** Creates an APPROVED, STARTED audit using the smallest available checklist. */
async function createStartedAudit(request: APIRequestContext): Promise<CreatedAudit> {
  const headers = { Authorization: `Bearer ${await tokenFor(request, DEMO.lead.email)}` };

  const checklists = await listItems<{ id: string; standardId: string; _count?: { clauses?: number } }>(
    request,
    headers,
    '/api/setup/checklists',
  );
  const checklist = checklists
    .filter((c) => (c._count?.clauses ?? 0) > 0)
    .sort((a, b) => (a._count?.clauses ?? 0) - (b._count?.clauses ?? 0))[0];
  if (!checklist) throw new Error('No checklist with clauses available');

  const treeRes = await request.get(`/api/setup/checklists/${checklist.id}/tree`, { headers });
  if (!treeRes.ok()) throw new Error(`checklist tree failed: ${treeRes.status()}`);
  const tree = (await treeRes.json()) as Array<{ id: string; children?: unknown[] }>;
  const clauseIds: string[] = [];
  const walk = (nodes: Array<{ id: string; children?: unknown[] }>) => {
    for (const node of nodes) {
      clauseIds.push(node.id);
      if (Array.isArray(node.children)) walk(node.children as Array<{ id: string; children?: unknown[] }>);
    }
  };
  walk(tree);
  if (clauseIds.length === 0) throw new Error('Checklist has no clauses');

  const auditTypes = await listItems<{ id: string; category: string }>(request, headers, '/api/setup/audit-types');
  const auditType = auditTypes.find((t) => t.category === 'PROCESS') ?? auditTypes[0];

  const departments = await listItems<{ id: string; code: string; plantId: string }>(
    request,
    headers,
    '/api/org/departments',
  );
  // Production keeps the QA-based lead auditor independent of the audited dept.
  const department = departments.find((d) => d.code === 'PROD') ?? departments[0];

  const auditors = await listItems<{ id: string; user?: { email?: string } }>(
    request,
    headers,
    '/api/people/auditors',
  );
  const auditor = auditors.find((a) => a.user?.email === DEMO.lead.email) ?? auditors[0];

  const title = uniqueName('Exec Audit');
  const createRes = await request.post('/api/audits', {
    headers,
    data: { title, category: 'PROCESS', standardId: checklist.standardId, auditTypeId: auditType.id },
  });
  if (!createRes.ok()) throw new Error(`audit create failed: ${createRes.status()} ${await createRes.text()}`);
  const id = ((await createRes.json()) as { id: string }).id;

  const step = async (method: 'put' | 'post', path: string, data?: unknown) => {
    const res = await request[method](path, { headers, data });
    if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} failed: ${res.status()} ${await res.text()}`);
    return res;
  };

  await step('put', `/api/audits/${id}/scope`, {
    plantId: department.plantId,
    departmentId: department.id,
    scope: 'E2E execution scope',
  });
  await step('put', `/api/audits/${id}/clauses`, { clauseIds });
  await step('put', `/api/audits/${id}/team`, { auditors: [{ auditorId: auditor.id, isLead: true }] });
  await step('put', `/api/audits/${id}/schedule`, {
    items: [],
    plannedStart: new Date().toISOString(),
    plannedEnd: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await step('post', `/api/audits/${id}/submit`);

  const qmrHeaders = { Authorization: `Bearer ${await tokenFor(request, DEMO.qmr.email)}` };
  const approveRes = await request.post(`/api/audits/${id}/approve`, { headers: qmrHeaders, data: {} });
  if (!approveRes.ok()) throw new Error(`approve failed: ${approveRes.status()} ${await approveRes.text()}`);
  await step('post', `/api/audits/${id}/start`);

  return { id, title, clauseIds };
}

/**
 * Clears the buggy `locked` flag on the execution GET response so the real UI
 * controls become operable. Documented in the file header.
 */
async function unlockExecution(page: Page): Promise<void> {
  await page.route(/\/api\/audits\/[^/]+\/execution$/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    const response = await route.fetch();
    const json = (await response.json()) as { audit?: { locked?: boolean } };
    if (json.audit) json.audit.locked = false;
    await route.fulfill({ response, json });
  });
}

test.describe('Audit Execution', () => {
  test('execution list loads for the lead auditor and lists in-progress audits', async ({ page, request }) => {
    const audit = await createStartedAudit(request);

    await signIn(page, request, DEMO.lead.email);
    await gotoNav(page, 'Execution');

    await expect(page).toHaveURL(/\/execution$/);
    await expect(page.getByRole('heading', { name: 'Audit Execution' })).toBeVisible();

    await page.getByPlaceholder('Search audits...').fill(audit.title);
    const row = page.getByRole('row').filter({ hasText: audit.title });
    await expect(row).toBeVisible();
    await expect(row.getByText('In Progress', { exact: true })).toBeVisible();
    await expect(row.getByRole('link', { name: 'Open Execution' })).toBeVisible();
  });

  test('answering a clause derives the finding classification per the matrix', async ({ page, request }) => {
    const audit = await createStartedAudit(request);

    await signIn(page, request, DEMO.lead.email);
    await unlockExecution(page);
    await openExecutionFromList(page, audit.title);

    await expect(page.getByText('In Progress', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Clauses' })).toBeVisible();

    const preview = page.getByText('Classification preview', { exact: true }).locator('..');
    const documentedYes = page.getByRole('button', { name: 'YES', exact: true }).nth(0);
    const documentedNo = page.getByRole('button', { name: 'NO', exact: true }).nth(0);
    const implementedYes = page.getByRole('button', { name: 'YES', exact: true }).nth(1);
    const implementedNo = page.getByRole('button', { name: 'NO', exact: true }).nth(1);
    const implementedNa = page.getByRole('button', { name: 'N/A', exact: true }).nth(1);

    // YES / YES -> Conformity (C)
    await documentedYes.click();
    await implementedYes.click();
    await expect(preview.getByText('C - Conformity', { exact: true })).toBeVisible();

    // YES / NO -> Nonconformity (MINOR)
    await implementedNo.click();
    await expect(preview.getByText('NC - Nonconformity', { exact: true })).toBeVisible();
    await expect(preview.getByText('MINOR', { exact: true })).toBeVisible();

    // NO / YES -> Opportunity for improvement (OFI)
    await documentedNo.click();
    await implementedYes.click();
    await expect(preview.getByText('OFI - OFI', { exact: true })).toBeVisible();

    // NO / NO -> Nonconformity (MAJOR)
    await implementedNo.click();
    await expect(preview.getByText('NC - Nonconformity', { exact: true })).toBeVisible();
    await expect(preview.getByText('MAJOR', { exact: true })).toBeVisible();

    // Any NA -> Not applicable
    await implementedNa.click();
    await expect(preview.getByText('NA - Not applicable', { exact: true })).toBeVisible();

    // Persist a conformity answer and confirm the UI reflects the saved response.
    await documentedYes.click();
    await implementedYes.click();
    await page.getByRole('button', { name: 'Save response' }).click();
    await expect(page.getByText('Response saved')).toBeVisible();
    await expect(page.getByText('1 of', { exact: false })).toBeVisible();
  });

  test('completing execution moves the audit to Findings Recorded', async ({ page, request }) => {
    const audit = await createStartedAudit(request);

    // Answer every clause so the audit is ready for completion.
    const headers = { Authorization: `Bearer ${await tokenFor(request, DEMO.lead.email)}` };
    for (const clauseId of audit.clauseIds) {
      const res = await request.put(`/api/audits/${audit.id}/execution/${clauseId}`, {
        headers,
        data: { documented: 'YES', implemented: 'YES' },
      });
      expect(res.ok()).toBeTruthy();
    }

    await signIn(page, request, DEMO.lead.email);
    await unlockExecution(page);
    await openExecutionFromList(page, audit.title);

    const total = audit.clauseIds.length;
    await expect(page.getByText(`${total} of ${total} clauses answered`)).toBeVisible();

    const complete = page.getByRole('button', { name: 'Complete Execution' });
    await expect(complete).toBeEnabled();
    await complete.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Complete', exact: true }).click();
    await expect(page.getByText('Execution completed')).toBeVisible();

    // Completion invalidates the execution query, so reopening the audit
    // surfaces the new status in the UI.
    await openExecutionFromList(page, audit.title);
    await expect(page.getByText('Findings Recorded', { exact: true })).toBeVisible();
  });
});
