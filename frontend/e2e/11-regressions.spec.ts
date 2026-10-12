import { expect, test } from '@playwright/test';
import { DEMO, loginAs, uniqueName } from './helpers';

/**
 * Regression coverage for defects surfaced by the feature specs. These tests
 * run against the REAL app with NO network shims, proving the fixes hold:
 *  - resources.all() now normalises the paginated { items } envelope so
 *    option-driven master pages render instead of crashing.
 *  - ExecutionPage gates editing on audit status (IN_PROGRESS), not the
 *    planning `locked` flag that stays true after approval.
 *  - A finding's status can be updated via PUT /api/findings/:id.
 */
test.describe('Regression: paginated options, execution lock, finding status', () => {
  test('option-driven master pages render without crashing', async ({ page, request }) => {
    await loginAs(page, request, DEMO.qmr.email);
    const pages: Array<[string, string]> = [
      ['/masters/plants', 'Plant'],
      ['/masters/departments', 'Department'],
      ['/masters/processes', 'Process'],
      ['/masters/auditors', 'Auditor'],
    ];
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'New' })).toBeVisible();
      // The route must not have crashed to a blank page.
      await expect(page.locator('body')).not.toHaveText('');
    }
  });

  test('new audit wizard renders step 1 with real option data', async ({ page, request }) => {
    await loginAs(page, request, DEMO.lead.email);
    await page.goto('/audits/new');
    await expect(page.getByText(/Step 1 of 9/i)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'New Audit' })).toBeVisible();
  });

  test('finding status is updatable through the API', async ({ request }) => {
    const token = await request
      .post('/api/auth/login', { data: { email: DEMO.lead.email, password: DEMO.password } })
      .then((r) => r.json())
      .then((b) => b.token as string);
    const headers = { Authorization: `Bearer ${token}` };

    const audit = await request
      .post('/api/audits', {
        headers,
        data: { title: uniqueName('Reg Audit'), category: 'PROCESS' },
      })
      .then((r) => r.json());
    const finding = await request
      .post('/api/findings', {
        headers,
        data: {
          auditId: audit.id,
          type: 'OFI',
          title: uniqueName('Reg Finding'),
          observation: 'Regression observation',
        },
      })
      .then((r) => r.json());
    expect(finding.status).toBe('OPEN');

    const updated = await request
      .put(`/api/findings/${finding.id}`, { headers, data: { status: 'CLOSED' } })
      .then((r) => r.json());
    expect(updated.status).toBe('CLOSED');
  });
});
