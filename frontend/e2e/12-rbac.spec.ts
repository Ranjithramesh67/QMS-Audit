import { expect, test, type APIRequestContext } from '@playwright/test';
import { DEMO, gotoNav, loginAs, TOKEN_KEY } from './helpers';

/**
 * End-to-end coverage for the dynamic RBAC feature: custom roles with a
 * permission set (or full access), assigning a role to a user, and verifying
 * that the effective access enforced by the API matches the role definition.
 */

interface RoleDto {
  id: string;
  code: string;
  name: string;
  permissions: string[];
  isSystem: boolean;
  _count?: { users: number };
}

let seq = 0;
const stamp = () => `${Date.now()}-${seq++}`;

async function login(request: APIRequestContext, email: string, password = DEMO.password) {
  const res = await request.post('/api/auth/login', { data: { email, password } });
  expect(res.ok(), `login ${email} -> ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return (await res.json()) as { token: string; user: { role: string; permissions: string[] } };
}

const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function createRole(request: APIRequestContext, token: string, body: Record<string, unknown>): Promise<RoleDto> {
  const res = await request.post('/api/roles', { headers: auth(token), data: body });
  expect(res.ok(), `create role -> ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return (await res.json()) as RoleDto;
}

async function createUser(
  request: APIRequestContext,
  token: string,
  email: string,
  roleId: string,
): Promise<string> {
  const res = await request.post('/api/people/users', {
    headers: auth(token),
    data: { email, password: DEMO.password, name: `RBAC ${email}`, roleId },
  });
  expect(res.ok(), `create user -> ${res.status()} ${await res.text().catch(() => '')}`).toBeTruthy();
  return ((await res.json()) as { id: string }).id;
}

async function roleIdByCode(request: APIRequestContext, token: string, code: string): Promise<string> {
  const res = await request.get('/api/roles', { headers: auth(token) });
  const roles = (await res.json()) as RoleDto[];
  const match = roles.find((r) => r.code === code);
  if (!match) throw new Error(`role ${code} not found`);
  return match.id;
}

/** Reassign the user so the temporary role can be deleted, then drop the role. */
async function cleanup(request: APIRequestContext, token: string, userId: string, roleId: string) {
  const auditorId = await roleIdByCode(request, token, 'AUDITOR');
  await request.put(`/api/people/users/${userId}`, { headers: auth(token), data: { roleId: auditorId } });
  await request.delete(`/api/roles/${roleId}`, { headers: auth(token) });
}

test.describe('12 - Dynamic RBAC', () => {
  test('a custom role grants exactly its permissions', async ({ request }) => {
    const admin = await login(request, DEMO.admin.email);
    const code = `E2E_LIMITED_${stamp()}`.replace(/-/g, '_').toUpperCase();
    const role = await createRole(request, admin.token, {
      code,
      name: 'E2E Limited',
      description: 'Created by the RBAC e2e suite',
      permissions: ['masters.auditors', 'audits.execute'],
    });
    const email = `rbac-limited-${stamp()}@acme.example`;
    const userId = await createUser(request, admin.token, email, role.id);

    const user = await login(request, email);
    // Effective permissions are carried on the session.
    expect(user.user.role).toBe(code);
    expect(user.user.permissions.sort()).toEqual(['audits.execute', 'masters.auditors']);

    // Allowed by the role.
    expect((await request.get('/api/people/auditors', { headers: auth(user.token) })).status()).toBe(200);
    // Not granted: listing users, managing roles, planning audits.
    expect((await request.get('/api/people/users', { headers: auth(user.token) })).status()).toBe(403);
    expect(
      (await request.post('/api/roles', { headers: auth(user.token), data: { code: 'NOPE_X', name: 'x' } })).status(),
    ).toBe(403);
    expect(
      (await request.post('/api/audits', { headers: auth(user.token), data: { title: 'nope' } })).status(),
    ).toBe(403);

    await cleanup(request, admin.token, userId, role.id);
  });

  test('a full-access role reaches every permission-gated endpoint', async ({ request }) => {
    const admin = await login(request, DEMO.admin.email);
    const code = `E2E_FULL_${stamp()}`.replace(/-/g, '_').toUpperCase();
    const role = await createRole(request, admin.token, {
      code,
      name: 'E2E Full',
      permissions: ['*'],
    });
    const email = `rbac-full-${stamp()}@acme.example`;
    const userId = await createUser(request, admin.token, email, role.id);

    const user = await login(request, email);
    expect(user.user.permissions).toContain('*');

    expect((await request.get('/api/people/users', { headers: auth(user.token) })).status()).toBe(200);
    expect((await request.get('/api/roles', { headers: auth(user.token) })).status()).toBe(200);
    const created = await request.post('/api/roles', {
      headers: auth(user.token),
      data: { code: `E2E_CHILD_${stamp()}`.replace(/-/g, '_').toUpperCase(), name: 'E2E Child', permissions: ['masters.org'] },
    });
    expect(created.status()).toBe(201);
    await request.delete(`/api/roles/${((await created.json()) as RoleDto).id}`, { headers: auth(user.token) });

    await cleanup(request, admin.token, userId, role.id);
  });

  test('ADMIN manages roles from the Roles & Permissions page', async ({ page, request }) => {
    const name = `E2E UI Role ${stamp()}`;
    const code = `E2E_UI_${stamp()}`.replace(/-/g, '_').toUpperCase();
    const admin = await login(request, DEMO.admin.email);
    try {
      await loginAs(page, request, DEMO.admin.email);
      await gotoNav(page, 'Roles & Permissions');

      await expect(page).toHaveURL(/\/masters\/roles$/);
      await expect(page.getByRole('heading', { level: 1, name: 'Roles & Permissions' })).toBeVisible();
      // Built-in roles are listed and marked as such.
      await expect(page.getByRole('heading', { level: 2, name: 'Administrator' })).toBeVisible();
      await expect(page.getByText('Built-in').first()).toBeVisible();

      // Create a role granting a single permission.
      await page.getByRole('button', { name: 'New role' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      await dialog.locator('#role-code').fill(code);
      await dialog.locator('#role-name').fill(name);
      await dialog.getByRole('checkbox', { name: 'Plan audits' }).check();
      await dialog.getByRole('button', { name: 'Create role' }).click();

      await expect(page.getByText('Role created')).toBeVisible({ timeout: 20_000 });
      await expect(dialog).toBeHidden({ timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 2, name })).toBeVisible();

      // Delete it again (non-system roles are removable when unassigned).
      await page.getByRole('button', { name: `Delete ${name}` }).click();
      const confirm = page.getByRole('dialog');
      await expect(confirm).toBeVisible();
      await confirm.getByRole('button', { name: 'Delete' }).click();
      await expect(page.getByText('Role deleted')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole('heading', { level: 2, name })).toHaveCount(0);
    } finally {
      // Guarantee cleanup even if an assertion above failed.
      const res = await request.get('/api/roles', { headers: auth(admin.token) });
      const leftover = ((await res.json()) as RoleDto[]).find((r) => r.code === code);
      if (leftover) await request.delete(`/api/roles/${leftover.id}`, { headers: auth(admin.token) });
    }
  });

  test('a user assigned a custom role sees only the matching navigation', async ({ page, request }) => {
    const admin = await login(request, DEMO.admin.email);
    const code = `E2E_NAV_${stamp()}`.replace(/-/g, '_').toUpperCase();
    const role = await createRole(request, admin.token, {
      code,
      name: 'E2E Nav',
      permissions: ['masters.auditors'],
    });
    const email = `rbac-nav-${stamp()}@acme.example`;
    const userId = await createUser(request, admin.token, email, role.id);

    // Authenticate through the real form so /auth/me supplies the custom role.
    await page.goto('/login');
    await page.locator('#email').fill(email);
    await page.locator('#password').fill(DEMO.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();

    await expect(page.getByRole('link', { name: 'Auditors', exact: true })).toBeVisible();
    // No permission for these areas.
    await expect(page.getByRole('link', { name: 'Audit Planning', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Users', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Roles & Permissions', exact: true })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Analytics', exact: true })).toHaveCount(0);

    await cleanup(request, admin.token, userId, role.id);
  });
});
