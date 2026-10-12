import {
  expect,
  request as playwrightRequest,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { DEMO, TOKEN_KEY, gotoNav, uniqueName } from './helpers';

/**
 * Findings register, NC register and finding detail coverage.
 *
 * Seeding is done through the public API (audit -> scope -> clause -> finding),
 * then the real UI is driven. The auth endpoint is rate limited (200 / 15 min),
 * so a single JWT is fetched for the whole file and re-injected per test.
 */

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Clause {
  id: string;
  number: string;
  title: string;
}

interface ClauseNode extends Clause {
  children?: ClauseNode[];
}

interface FindingRecord {
  id: string;
  code: string;
  title: string;
  observation?: string | null;
  type: string;
  severity?: string | null;
  status: string;
  capa?: { id: string; status: string } | null;
}

interface AuditContext {
  auditId: string;
  auditCode: string;
  auditTitle: string;
  departmentId: string;
  clause: Clause;
}

type Headers = Record<string, string>;

interface Credentials {
  token: string;
  user: unknown;
}

let credentials: Credentials;
const auth = (): Headers => ({ Authorization: `Bearer ${credentials.token}` });

/** Backs off and retries when the shared limiter is briefly saturated. */
async function fetchCredentials(email: string): Promise<Credentials> {
  const ctx = await playwrightRequest.newContext({ baseURL: BASE_URL });
  try {
    for (let attempt = 0; ; attempt++) {
      const res = await ctx.post('/api/auth/login', { data: { email, password: DEMO.password } });
      if (res.ok()) {
        const body = (await res.json()) as { token: string; user: unknown };
        return { token: body.token, user: body.user };
      }
      if (res.status() !== 429 || attempt >= 8) {
        throw new Error(`Login failed for ${email}: ${res.status()} ${await res.text()}`);
      }
      const retryAfter = Number(res.headers()['retry-after'] ?? 0);
      await new Promise((resolve) => setTimeout(resolve, Math.max(retryAfter, 3) * 1000));
    }
  } finally {
    await ctx.dispose();
  }
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  credentials = await fetchCredentials(DEMO.lead.email);
});

async function signIn(page: Page): Promise<void> {
  await page.addInitScript(
    ([key, value]) => {
      window.localStorage.setItem(key, value as string);
    },
    [TOKEN_KEY, credentials.token] as [string, string],
  );
  // Serve the session lookup from the cached user so page loads never touch the
  // rate-limited auth endpoint. The real JWT still authorises every /api call.
  await page.route('**/api/auth/me', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(credentials.user) }),
  );
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
}

async function apiGet<T>(request: APIRequestContext, path: string, params?: Record<string, string | number>): Promise<T> {
  const res = await request.get(path, { headers: auth(), params });
  if (!res.ok()) throw new Error(`GET ${path} failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function apiSend<T>(
  request: APIRequestContext,
  method: 'post' | 'put',
  path: string,
  data: unknown = {},
): Promise<T> {
  const res = await request[method](path, { headers: auth(), data });
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

/** Returns the first leaf clause (a node with no children) in a checklist tree. */
function firstLeaf(nodes: ClauseNode[]): Clause | null {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const leaf = firstLeaf(node.children);
      if (leaf) return leaf;
    } else {
      return node;
    }
  }
  return null;
}

/** Builds a minimal draft audit (with one checklist clause) that findings hang off. */
async function createAuditContext(request: APIRequestContext): Promise<AuditContext> {
  const [standards, auditTypes, plants, departments, checklists] = await Promise.all([
    apiGet<Paginated<{ id: string }>>(request, '/api/setup/standards'),
    apiGet<Paginated<{ id: string; category: string }>>(request, '/api/setup/audit-types'),
    apiGet<Paginated<{ id: string }>>(request, '/api/org/plants'),
    apiGet<Paginated<{ id: string; name: string }>>(request, '/api/org/departments'),
    // A large page size keeps the seeded checklists reachable even after other
    // specs create new (clause-less) checklists that sort ahead of them.
    apiGet<Paginated<{ id: string }>>(request, '/api/setup/checklists', { pageSize: 200 }),
  ]);

  const standard = standards.items[0];
  const auditType = auditTypes.items.find((t) => t.category === 'PROCESS') ?? auditTypes.items[0];
  const plant = plants.items[0];
  const department = departments.items[0];

  // Other specs create checklists with zero clauses, and those can sort first,
  // so scan candidates and use the first checklist that actually has a leaf.
  let clause: Clause | null = null;
  for (const candidate of checklists.items) {
    const tree = await apiGet<ClauseNode[]>(request, `/api/setup/checklists/${candidate.id}/tree`);
    clause = firstLeaf(tree);
    if (clause) break;
  }
  if (!clause) throw new Error('No checklist with a leaf clause is available for the E2E audit');

  const auditTitle = uniqueName('E2E Audit');
  const audit = await apiSend<{ id: string; code: string }>(request, 'post', '/api/audits', {
    title: auditTitle,
    category: 'PROCESS',
    standardId: standard.id,
    auditTypeId: auditType.id,
  });
  await apiSend(request, 'put', `/api/audits/${audit.id}/scope`, {
    plantId: plant.id,
    departmentId: department.id,
    scope: 'E2E scope',
    objectives: 'E2E objectives',
    criteria: 'E2E criteria',
  });
  await apiSend(request, 'put', `/api/audits/${audit.id}/clauses`, { clauseIds: [clause.id] });

  return {
    auditId: audit.id,
    auditCode: audit.code,
    auditTitle,
    departmentId: department.id,
    clause,
  };
}

async function createFinding(
  request: APIRequestContext,
  ctx: AuditContext,
  type: 'NC' | 'OFI' = 'NC',
): Promise<FindingRecord & { observation: string }> {
  const observation = 'E2E observed process deviation.';
  const finding = await apiSend<FindingRecord>(request, 'post', '/api/findings', {
    auditId: ctx.auditId,
    clauseId: ctx.clause.id,
    departmentId: ctx.departmentId,
    type,
    severity: type === 'NC' ? 'MAJOR' : 'OBSERVATION',
    title: uniqueName(type),
    observation,
    dueDate: new Date(Date.now() + 15 * 86400000).toISOString(),
  });
  return { ...finding, observation };
}

/** Selects an option from the Nth Radix select on the page. */
async function selectOption(page: Page, comboboxIndex: number, optionName: string): Promise<void> {
  await page.getByRole('combobox').nth(comboboxIndex).click();
  await page.getByRole('option', { name: optionName, exact: true }).click();
}

test.describe('Findings register and detail', () => {
  test('list loads and search plus type/status filters work', async ({ page, request }) => {
    const ctx = await createAuditContext(request);
    const finding = await createFinding(request, ctx, 'NC');

    await signIn(page);
    await gotoNav(page, 'Findings');
    await expect(page).toHaveURL(/\/findings$/);
    await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();

    const search = page.getByPlaceholder('Search findings...');
    await search.fill(finding.title);
    await expect(page.getByText(finding.code, { exact: true })).toBeVisible();
    await expect(page.getByText(finding.title, { exact: true })).toBeVisible();

    // Type filter: moving away from NC hides the seeded nonconformity.
    await selectOption(page, 0, 'C - Conformity');
    await expect(page.getByText(finding.title, { exact: true })).toHaveCount(0);
    await selectOption(page, 0, 'All types');
    await expect(page.getByText(finding.title, { exact: true })).toBeVisible();

    // Status filter: the finding is OPEN, so filtering to Closed hides it.
    await selectOption(page, 2, 'Closed');
    await expect(page.getByText(finding.title, { exact: true })).toHaveCount(0);
    await selectOption(page, 2, 'Open');
    await expect(page.getByText(finding.title, { exact: true })).toBeVisible();
  });

  test('creates a finding through the UI and lists it', async ({ page, request }) => {
    const ctx = await createAuditContext(request);
    const title = uniqueName('UI NC');

    await signIn(page);
    // The audit-id query param pre-fills the create dialog's audit field.
    await page.goto(`/findings?auditId=${ctx.auditId}`);
    await expect(page.getByRole('heading', { name: 'Findings' })).toBeVisible();

    await page.getByRole('button', { name: 'New Finding' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading', { name: 'New Finding' })).toBeVisible();

    await dialog.getByLabel('Title', { exact: true }).fill(title);
    await dialog.getByLabel('Observation', { exact: true }).fill('Recorded from the UI by the E2E suite.');
    await dialog.getByRole('button', { name: 'Create finding' }).click();

    await expect(page.getByText('Finding created')).toBeVisible();
    await expect(dialog).toBeHidden();

    await page.getByPlaceholder('Search findings...').fill(title);
    await expect(page.getByText(title, { exact: true })).toBeVisible();
  });

  test('detail renders fields and the auto-created CAPA for a nonconformity', async ({ page, request }) => {
    const ctx = await createAuditContext(request);
    const finding = await createFinding(request, ctx, 'NC');

    // Backend must auto-create the CAPA workflow for an NC.
    const detail = await apiGet<FindingRecord>(request, `/api/findings/${finding.id}`);
    expect(detail.capa?.id).toBeTruthy();

    await signIn(page);
    await page.goto(`/findings/${finding.id}`);

    await expect(page.getByRole('heading', { name: `${finding.code} - ${finding.title}` })).toBeVisible();
    await expect(page.getByText('NC', { exact: true })).toBeVisible();
    await expect(page.getByText('MAJOR', { exact: true })).toBeVisible();
    await expect(page.getByText(finding.observation, { exact: true })).toBeVisible();
    await expect(page.getByText(`${ctx.clause.number} - ${ctx.clause.title}`, { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: `${ctx.auditCode} - ${ctx.auditTitle}`, exact: true })).toBeVisible();

    await expect(page.getByRole('heading', { name: 'Corrective Action (CAPA)' })).toBeVisible();
    await expect(page.getByText(detail.capa!.status, { exact: true })).toBeVisible();
    const openCapa = page.getByRole('link', { name: 'Open CAPA' });
    await expect(openCapa).toBeVisible();
    await expect(openCapa).toHaveAttribute('href', `/capa/${detail.capa!.id}`);
  });

  test('detail status badge tracks backend state through the CAPA workflow', async ({ page, request }) => {
    const ctx = await createAuditContext(request);
    const finding = await createFinding(request, ctx, 'NC');

    const opened = await apiGet<FindingRecord>(request, `/api/findings/${finding.id}`);
    expect(opened.status).toBe('OPEN');
    expect(opened.capa?.id).toBeTruthy();

    await signIn(page);
    await page.goto(`/findings/${finding.id}`);
    await expect(page.getByText(opened.status, { exact: true })).toBeVisible();

    // Drive the CAPA lifecycle; a passing verification closes the finding.
    const capaId = opened.capa!.id;
    await apiSend(request, 'post', `/api/capas/${capaId}/acknowledge`);
    await apiSend(request, 'put', `/api/capas/${capaId}/response`, {
      rootCause: 'E2E root cause established through analysis.',
      actions: [{ description: 'Implement the corrective action' }],
    });
    await apiSend(request, 'post', `/api/capas/${capaId}/submit`);
    await apiSend(request, 'post', `/api/capas/${capaId}/accept`);
    await apiSend(request, 'post', `/api/capas/${capaId}/verify`, {
      pass: true,
      verificationMethod: 'E2E verification',
    });

    const closed = await apiGet<FindingRecord>(request, `/api/findings/${finding.id}`);
    expect(closed.status).toBe('CLOSED');

    await page.reload();
    await expect(page.getByText('CLOSED', { exact: true })).toBeVisible();
    await expect(page.getByText('OPEN', { exact: true })).toHaveCount(0);
  });

  test('NC register exposes nonconformities via API and reports page', async ({ page, request }) => {
    const ctx = await createAuditContext(request);
    const finding = await createFinding(request, ctx, 'NC');

    const register = await apiGet<FindingRecord[]>(request, '/api/findings/nc-register');
    const entry = register.find((row) => row.id === finding.id);
    expect(entry?.code).toBe(finding.code);
    expect(entry?.type).toBe('NC');

    await signIn(page);
    await gotoNav(page, 'Reports');
    await expect(page.getByRole('heading', { name: 'Reports' })).toBeVisible();
    await expect(page.getByText('NC Register')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'CSV' }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('nc-register.csv');
  });
});
