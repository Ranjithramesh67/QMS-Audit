/**
 * Idempotent, non-destructive migration from the fixed `Role` enum to dynamic,
 * permission-based roles.
 *
 * Safe to run repeatedly. It:
 *   1. creates the `roles` table if missing,
 *   2. upserts the six built-in roles with their permission sets,
 *   3. adds `User.roleId` and backfills it from the legacy `User.role` enum,
 *   4. enforces NOT NULL + FK + index,
 *   5. drops the legacy `role` column and the `Role` enum type.
 *
 * Run order: `prisma generate` first (so the typed client knows about Role),
 * then this script, then `prisma db seed`.
 */
import { PrismaClient } from '@prisma/client';
import { DEFAULT_ROLES } from '../src/lib/permissions.js';

const prisma = new PrismaClient();

async function columnExists(table: string, column: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_name = $1 AND column_name = $2
     ) AS "exists"`,
    table,
    column,
  );
  return rows[0]?.exists === true;
}

async function constraintExists(name: string): Promise<boolean> {
  const rows = await prisma.$queryRawUnsafe<Array<{ exists: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM pg_constraint WHERE conname = $1
     ) AS "exists"`,
    name,
  );
  return rows[0]?.exists === true;
}

async function main() {
  // 1. roles table -----------------------------------------------------------
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "roles" (
      "id" TEXT NOT NULL,
      "code" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "description" TEXT,
      "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
      "isSystem" BOOLEAN NOT NULL DEFAULT false,
      "active" BOOLEAN NOT NULL DEFAULT true,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE UNIQUE INDEX IF NOT EXISTS "roles_code_key" ON "roles"("code")`);

  // 2. built-in roles --------------------------------------------------------
  for (const def of DEFAULT_ROLES) {
    await prisma.role.upsert({
      where: { code: def.code },
      update: { name: def.name, description: def.description, permissions: def.permissions, isSystem: true },
      create: {
        code: def.code,
        name: def.name,
        description: def.description,
        permissions: def.permissions,
        isSystem: true,
      },
    });
  }

  // 3. User.roleId + backfill ------------------------------------------------
  const hadLegacyRole = await columnExists('User', 'role');
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "roleId" TEXT`);

  if (hadLegacyRole) {
    await prisma.$executeRawUnsafe(`
      UPDATE "User" u
      SET "roleId" = r."id"
      FROM "roles" r
      WHERE r."code" = u."role"::text AND u."roleId" IS NULL
    `);
  }

  // Fallback for any user without a role (e.g. first run on a fresh table).
  const fallback = await prisma.role.findUnique({ where: { code: 'AUDITOR' } });
  if (fallback) {
    await prisma.$executeRawUnsafe(
      `UPDATE "User" SET "roleId" = $1 WHERE "roleId" IS NULL`,
      fallback.id,
    );
  }

  // 4. constraints -----------------------------------------------------------
  if (await columnExists('User', 'roleId')) {
    await prisma.$executeRawUnsafe(`ALTER TABLE "User" ALTER COLUMN "roleId" SET NOT NULL`);
  }
  if (!(await constraintExists('User_roleId_fkey'))) {
    await prisma.$executeRawUnsafe(
      `ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey"
         FOREIGN KEY ("roleId") REFERENCES "roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE`,
    );
  }
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS "User_roleId_idx" ON "User"("roleId")`);

  // 5. drop legacy ------------------------------------------------------------
  await prisma.$executeRawUnsafe(`ALTER TABLE "User" DROP COLUMN IF EXISTS "role"`);
  await prisma.$executeRawUnsafe(`DROP TYPE IF EXISTS "Role"`);

  const count = await prisma.role.count();
  console.log(`RBAC migration complete. Roles available: ${count}`);
}

main()
  .catch((err) => {
    console.error('RBAC migration failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
