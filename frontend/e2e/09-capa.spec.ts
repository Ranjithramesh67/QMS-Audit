import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { DEMO, TOKEN_KEY, loginAs, uniqueName } from './helpers';

/**
 * CAPA lifecycle coverage: list/search/filter, plus the full acknowledgement ->
 * root cause + action plan -> submit -> accept -> verify -> close workflow.
 *
 * The seeds below create a real audit with a MAJOR NC finding, which the
 * backend automatically links to a PENDING CAPA.
 */

interface Seed {
  findingId: string;
  findingCode: string;
  findingTitle: string;
  capaId: string;
}

interface ClauseNode {
  id: string;
  children?: ClauseNode[];
}

type Headers = Record<string, string>;

/**
 * The auth endpoint is rate limited, so log in once for the whole file and then
 * re-inject the JWT into each test's fresh browser context.
 */
let sharedToken: string | null = null;

async function authenticate(page: Page, request: APIRequestContext): Promise<Headers> {
  if (!sharedToken) {
    await loginAs(page, request, DEMO.lead.email);
    const token = await page.evaluate((key) => window.localStorage.getItem(key), TOKEN_KEY);
    if (!token) throw new Error('No auth token found in localStorage after loginAs()');
    sharedToken = token;
  } else {
    await page.addInitScript(
      ([key, value]) => window.localStorage.setItem(key, value),
      [TOKEN_KEY, sharedToken],
    );
  }
  return { Authorization: `Bearer ${sharedToken}` };
}

async function getJson<T>(request: APIRequestContext, path: string, headers: Headers): Promise<T> {
  const res = await request.get(path, { headers });
  if (!res.ok()) throw new Error(`GET ${path} failed: ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function sendJson<T>(
  request: APIRequestContext,
  method: 'post' | 'put',
  path: string,
  headers: Headers,
  body?: unknown,
): Promise<T> {
  const res = await request[method](path, { headers, data: body });
  if (!res.ok()) throw new Error(`${method.toUpperCase()} ${path} failed: ${res.status()} ${await res.text()}`);
  return (await res.text()) ? ((await res.json()) as T) : (undefined as T);
}

function firstLeafId(nodes: ClauseNode[]): string {
  for (const node of nodes) {
    if (node.children && node.children.length > 0) {
      const child = firstLeafId(node.children);
      if (child) return child;
    } else {
      return node.id;
    }
  }
  throw new Error('Checklist tree contained no leaf clauses');
}

/** True when the tree contains at least one leaf clause (a node with no children). */
function hasLeaf(nodes: ClauseNode[]): boolean {
  return nodes.some((node) => (node.children && node.children.length > 0 ? hasLeaf(node.children) : true));
}

/**
 * Other specs (e.g. 03-setup-masters) create NEW checklists that have ZERO
 * clauses, so a checklist matched by standard is not guaranteed to be usable.
 * Try the checklist matching the audit's standard first, then every other
 * checklist, and return the first one whose tree actually contains a leaf.
 */
async function findChecklistWithLeaf(
  request: APIRequestContext,
  headers: Headers,
  standardId: string,
  checklists: Array<{ id: string; standardId: string }>,
): Promise<{ id: string; clauseId: string }> {
  const ordered = [
    ...checklists.filter((c) => c.standardId === standardId),
    ...checklists.filter((c) => c.standardId !== standardId),
  ];
  for (const candidate of ordered) {
    const tree = await getJson<ClauseNode[]>(request, `/api/setup/checklists/${candidate.id}/tree`, headers);
    if (hasLeaf(tree)) return { id: candidate.id, clauseId: firstLeafId(tree) };
  }
  throw new Error('No checklist with leaf clauses available to seed a finding');
}

/** Create an audit + MAJOR NC finding, returning the auto-created CAPA id. */
async function seedCapa(request: APIRequestContext, headers: Headers): Promise<Seed> {
  const standards = await getJson<{ items: Array<{ id: string; code: string }> }>(
    request,
    '/api/setup/standards',
    headers,
  );
  const standard = standards.items.find((s) => s.code === 'ISO9001') ?? standards.items[0];

  // Fetch a generous page: other specs append checklists, and the seeded ones
  // (the only ones with clauses) must not fall off page 1.
  const checklists = await getJson<{ items: Array<{ id: string; standardId: string }> }>(
    request,
    '/api/setup/checklists?pageSize=200',
    headers,
  );
  const checklist = await findChecklistWithLeaf(request, headers, standard.id, checklists.items);

  const auditTypes = await getJson<{ items: Array<{ id: string; category: string }> }>(
    request,
    '/api/setup/audit-types',
    headers,
  );
  const auditType = auditTypes.items.find((t) => t.category === 'PROCESS') ?? auditTypes.items[0];

  const plants = await getJson<{ items: Array<{ id: string }> }>(request, '/api/org/plants', headers);
  const departments = await getJson<{ items: Array<{ id: string }> }>(request, '/api/org/departments', headers);
  const plant = plants.items[0];
  const department = departments.items[0];

  const audit = await sendJson<{ id: string }>(request, 'post', '/api/audits', headers, {
    title: uniqueName('E2E CAPA Audit'),
    category: 'PROCESS',
    standardId: standard.id,
    auditTypeId: auditType.id,
  });

  await sendJson(request, 'put', `/api/audits/${audit.id}/scope`, headers, {
    plantId: plant.id,
    departmentId: department.id,
  });

  await sendJson(request, 'put', `/api/audits/${audit.id}/clauses`, headers, {
    clauseIds: [checklist.clauseId],
  });

  const findingTitle = uniqueName('NC');
  const finding = await sendJson<{ id: string; code: string }>(request, 'post', '/api/findings', headers, {
    auditId: audit.id,
    clauseId: checklist.clauseId,
    departmentId: department.id,
    type: 'NC',
    severity: 'MAJOR',
    title: findingTitle,
    observation: 'E2E observation describing the nonconformity.',
    dueDate: '2026-12-31',
  });

  const detail = await getJson<{ capa: { id: string } }>(request, `/api/findings/${finding.id}`, headers);
  return { findingId: finding.id, findingCode: finding.code, findingTitle, capaId: detail.capa.id };
}

/** Drive a freshly seeded CAPA up to SUBMITTED so the UI starts at review. */
async function advanceCapaToSubmitted(request: APIRequestContext, seed: Seed, headers: Headers): Promise<void> {
  await sendJson(request, 'post', `/api/capas/${seed.capaId}/acknowledge`, headers);
  await sendJson(request, 'put', `/api/capas/${seed.capaId}/response`, headers, {
    immediateCorrection: 'Containment performed immediately.',
    rootCauseMethod: 'FIVE_WHY',
    rootCause: 'Process control was missing at the affected step.',
    targetDate: '2026-12-31',
    whys: [{ level: 1, question: 'Why did the deviation occur?', answer: 'A process control was missing.' }],
    actions: [{ description: 'Introduce a verification step in the control plan.', responsible: 'QA', status: 'OPEN' }],
  });
  await sendJson(request, 'post', `/api/capas/${seed.capaId}/submit`, headers);
}

/** Status badge lives in the page header actions next to the CAPA title. */
function statusBadge(page: Page, label: string) {
  return page.locator('h1').locator('xpath=../..').getByText(label, { exact: true });
}

test.describe('CAPA lifecycle', () => {
  test('CAPA list loads, searches, filters and opens a CAPA', async ({ page, request }) => {
    const headers = await authenticate(page, request);
    const seed = await seedCapa(request, headers);
    await page.goto('/capa');
    await expect(page.getByRole('heading', { name: 'Corrective & Preventive Actions (CAPA)' })).toBeVisible();

    const search = page.getByPlaceholder('Search by finding code or title...');
    await search.fill(seed.findingTitle);
    await expect(page.getByText(seed.findingTitle)).toBeVisible();

    await search.fill('no-such-capa-zzz-999');
    await expect(page.getByText('No CAPAs found')).toBeVisible();

    // Server-side status filter: the new CAPA is PENDING, so it disappears under Closed.
    await search.fill('');
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Pending' }).click();
    await expect(page.getByText(seed.findingTitle)).toBeVisible();

    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'Closed' }).click();
    await expect(page.getByText(seed.findingTitle)).toHaveCount(0);

    // Back to all statuses, search again and open the row.
    await page.getByRole('combobox').click();
    await page.getByRole('option', { name: 'All statuses' }).click();
    await search.fill(seed.findingTitle);
    await page.getByRole('cell', { name: seed.findingTitle }).click();

    await expect(page).toHaveURL(new RegExp(`/capa/${seed.capaId}$`));
    await expect(page.getByRole('heading', { name: `CAPA - ${seed.findingCode}` })).toBeVisible();
  });

  test('CAPA detail drives acknowledge to close through the UI', async ({ page, request }) => {
    const headers = await authenticate(page, request);
    const seed = await seedCapa(request, headers);
    await page.goto(`/capa/${seed.capaId}`);

    await expect(page.getByRole('heading', { name: `CAPA - ${seed.findingCode}` })).toBeVisible();
    await expect(statusBadge(page, 'Pending')).toBeVisible();

    // Step 1: acknowledge the nonconformity.
    await page.getByRole('button', { name: 'Acknowledge' }).click();
    await expect(statusBadge(page, 'Acknowledged')).toBeVisible();

    const waitForResponseSave = () =>
      page.waitForResponse(
        (res) =>
          res.url().includes(`/api/capas/${seed.capaId}/response`) && res.request().method() === 'PUT',
      );

    // Step 2: immediate correction.
    await page
      .getByPlaceholder('Describe the immediate containment or correction...')
      .fill('Contained the nonconformity immediately.');
    const correction = waitForResponseSave();
    await page.getByRole('button', { name: 'Save correction' }).click();
    expect((await correction).ok()).toBeTruthy();

    // Step 3: root cause via 5 Why.
    await page.getByPlaceholder('Answer').first().fill('The affected process lacked a control.');
    await page
      .getByPlaceholder('Summarise the verified root cause...')
      .fill('Missing process control allowed the deviation to reach the customer.');
    const rootCause = waitForResponseSave();
    await page.getByRole('button', { name: 'Save root cause' }).click();
    expect((await rootCause).ok()).toBeTruthy();
    await expect(page.getByText('Missing process control allowed the deviation to reach the customer.').first()).toBeVisible();

    // Step 4: action plan.
    await page.getByPlaceholder('Action description').fill('Add a verification step to the control plan.');
    const actionPlan = waitForResponseSave();
    await page.getByRole('button', { name: 'Save action plan' }).click();
    expect((await actionPlan).ok()).toBeTruthy();

    // Step 5: submit for auditor review.
    await page.getByRole('button', { name: 'Submit for Review' }).click();
    await expect(statusBadge(page, 'Submitted')).toBeVisible();

    // Step 6: accept the action plan.
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(statusBadge(page, 'Accepted')).toBeVisible();

    // Step 7: effectiveness verification (pass).
    await page.getByPlaceholder('e.g. Follow-up audit, sampling').fill('Follow-up audit sampling');
    await page
      .getByText('Verification notes')
      .locator('..')
      .locator('textarea')
      .fill('Sampled 10 units; all compliant.');
    await page
      .getByText('Effectiveness result')
      .locator('..')
      .locator('textarea')
      .fill('Effective, no recurrence observed.');
    await page.getByRole('button', { name: 'Record verification' }).click();
    await expect(statusBadge(page, 'Verified')).toBeVisible();

    // Step 8: formal closure.
    await page.getByRole('button', { name: 'Close CAPA' }).click();
    await expect(statusBadge(page, 'Closed')).toBeVisible();
  });

  test('CAPA review can reject a submitted action plan with a reason', async ({ page, request }) => {
    const headers = await authenticate(page, request);
    const seed = await seedCapa(request, headers);
    await advanceCapaToSubmitted(request, seed, headers);
    await page.goto(`/capa/${seed.capaId}`);

    await expect(statusBadge(page, 'Submitted')).toBeVisible();

    await page.getByRole('button', { name: 'Reject' }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByPlaceholder('Reason for rejection...').fill('Action plan lacks measurable effectiveness criteria.');
    await dialog.getByRole('button', { name: 'Reject' }).click();

    await expect(statusBadge(page, 'Rejected')).toBeVisible();
  });
});
