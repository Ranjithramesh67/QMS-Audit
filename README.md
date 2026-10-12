# QMS Audit Platform

An end-to-end Quality Management System (QMS) audit application that drives a full
7-stage audit lifecycle: **Masters -> Planning -> Execution -> Findings -> CAPA ->
Verification -> Closure**. Built for ISO 9001, IATF 16949 and VDA 6.3 style audits
across System, Product and Process categories.

## Tech Stack

**Frontend**
- React 18 + Vite + TypeScript
- Tailwind CSS with a Shadcn-style component kit
- Zustand (auth + UI state), TanStack React Query (server state)
- react-hook-form + Zod for forms and validation

**Backend**
- Node.js + Express + TypeScript
- Prisma ORM against PostgreSQL
- JWT authentication with dynamic, permission-based access control (RBAC)
- Multer file uploads, PDFKit / CSV exports, Nodemailer notifications

## Architecture

The app is a frontend/backend separated monorepo. Only one port is exposed for
preview: the Vite dev server (5173) proxies `/api` and `/uploads` to the backend
on port 3001, avoiding CORS and mimicking a single-entry production deployment.

```
frontend (5173, exposed)
   |
   |  /api/*   -> proxy -> backend (3001) -> Prisma -> PostgreSQL
   |  /uploads/* -> proxy -> backend static uploads
```

## Repository Layout

```
.
├── backend/
│   ├── prisma/
│   │   ├── schema.prisma        # Full data model (source of truth)
│   │   └── seed.ts              # Seed data + demo logins
│   └── src/
│       ├── app.ts, index.ts     # Express app + bootstrap
│       ├── config/              # env + configuration
│       ├── lib/                 # prisma client, http helpers, CRUD factory
│       ├── middleware/          # auth, rbac, error, upload, audit log
│       ├── routes/              # REST routers for every resource
│       └── services/            # finding matrix, notifications
├── frontend/
│   ├── vite.config.ts           # /api + /uploads proxy, allowedHosts
│   └── src/
│       ├── components/          # UI kit + layout + common components
│       ├── features/            # feature pages (planning, execution, ...)
│       ├── lib/                 # api client, formatters, utils
│       └── store/               # Zustand stores
├── scripts/
│   └── e2e-smoke.mjs            # End-to-end lifecycle smoke test
├── start.sh                     # Starts backend + frontend together
└── package.json                 # Root orchestration scripts
```

## Prerequisites

- Node.js 18+
- PostgreSQL 15+ running locally

Create the database and role (one-time):

```bash
sudo -u postgres psql -c "CREATE ROLE qms WITH LOGIN PASSWORD 'qms_password';"
sudo -u postgres psql -c "CREATE DATABASE qms_audit OWNER qms;"
```

## Setup

Install dependencies for both packages:

```bash
npm run install:all
```

Configure the backend environment. Copy the example file and adjust values:

```bash
cp backend/.env.example backend/.env
```

The key variable is `DATABASE_URL`, for example:

```
DATABASE_URL="postgresql://qms:qms_password@localhost:5432/qms_audit?schema=public"
PORT=3001
JWT_SECRET="replace-with-a-long-random-secret"
```

Generate the Prisma client, push the schema and seed demo data:

```bash
npm run db:generate
npm --prefix backend run db:push
npm run db:seed
```

Upgrading an existing database created before dynamic roles? Run the idempotent
RBAC migration instead of `db:push`; it creates the `roles` table, seeds the six
built-in roles and backfills `User.roleId` from the legacy `Role` enum without
losing data:

```bash
npm run db:generate
npm --prefix backend run db:migrate-rbac
npm run db:seed
```

## Running

Start both services with the provided script (the frontend port is the exposed one):

```bash
bash start.sh
```

Or run them separately during development:

```bash
npm run dev:backend    # http://localhost:3001
npm run dev:frontend   # http://localhost:5173
```

Build for production (type-checks both packages):

```bash
npm run build
```

## Demo Logins

All demo accounts use the password `Password123!`:

| Role           | Email                 |
| -------------- | --------------------- |
| Admin          | admin@acme.example    |
| QMR            | qmr@acme.example      |
| Lead Auditor   | lead@acme.example     |
| Auditor        | auditor@acme.example  |
| Auditee        | auditee@acme.example  |
| Department Head| prodhead@acme.example |

## Roles and Permissions

Roles are **dynamic** and permission-based. A role is a named set of permission
keys (for example `audits.plan`, `capa.close`, `users.manage`) or the wildcard
`*`, which grants **Full access** to everything. Administrators manage roles and
assign one role per user from **Masters -> Roles & Permissions** and **Masters ->
Users**.

Authorization checks live on the API: every protected route requires a
permission, and the JWT is resolved against the user's current role on each
request, so editing a role takes effect immediately. If the current user holds
`*` they pass every check.

Six built-in (system) roles ship with the seed and reproduce the original fixed
behaviour. They can be edited but not deleted:

| Role            | Summary                                                        |
| --------------- | -------------------------------------------------------------- |
| Administrator   | Full access (`*`).                                              |
| QMR             | Planning, approvals, CAPA closure, reporting, user read.        |
| Lead Auditor    | Planning, execution, findings, CAPA review/closure.             |
| Auditor         | Execution, findings, CAPA responses/review.                     |
| Auditee         | Responds to findings and CAPA.                                  |
| Department Head | Organisation masters, analytics/reports, CAPA responses.        |

Permissions are grouped in the role editor: Organisation, Audit Setup, People &
Access, Classification, Audit Lifecycle, Findings & CAPA, Insights, Documents
and System. Toggle **Full access** to grant `*`, or pick individual permissions
(each group has a select-all checkbox). The API refuses to strip `*` from the
last role that holds it, so an administrator cannot lock everyone out.

## Core Domain Rules

**Finding matrix.** During execution each checklist clause is answered with
`documented` and `implemented` (YES/NO/NA) plus an optional comment. The derived
finding type follows industry convention:

| Documented | Implemented | Derived   |
| ---------- | ----------- | --------- |
| YES        | YES         | C         |
| YES        | NO          | NC MINOR  |
| NO         | YES         | OFI       |
| NO         | NO          | NC MAJOR  |
| any        | NA          | NA        |

**CAPA lifecycle.** Creating an NC finding automatically opens a CAPA record.
The CAPA moves through `ACKNOWLEDGED -> SUBMITTED -> ACCEPTED -> VERIFIED ->
CLOSED`, and closing a CAPA recomputes the parent audit status. Audits are
automatically closed once all linked findings are closed.

**Approval lock.** Submitting an audit moves it to `PENDING_APPROVAL`; QMR
approval locks the plan (`locked = true`) before execution can start.

## Verification

The repository ships two complementary end-to-end test suites.

### API smoke test

`scripts/e2e-smoke.mjs` exercises the whole lifecycle through the API
(authentication, planning, approval, execution, findings, CAPA, verification,
closure, analytics and reporting):

```bash
node scripts/e2e-smoke.mjs
```

Expected output ends with a summary such as:

```
Result: 25 passed, 0 failed
```

### Browser E2E tests (Playwright)

`frontend/e2e/` contains a browser-driven Playwright suite covering every
feature area: authentication and RBAC, all master-data CRUD pages, the planning
wizard, execution and the finding matrix, findings, the CAPA lifecycle, and the
dashboard/analytics/reports/notifications/documents surfaces. A regression spec
also locks in fixes for the paginated-options, execution-lock and finding-status
defects. `12-rbac.spec.ts` covers dynamic roles end to end: creating a role with
a permission set, assigning it to a user, verifying the API returns 200/403
according to the role, and managing roles from the UI.

Prerequisites (one time):

```bash
cd frontend
npx playwright install chromium
npx playwright install-deps chromium
```

Both servers must be running (see Running above), then run the suite:

```bash
npm --prefix frontend run test:e2e
```

Useful variants:

```bash
# A single spec
npm --prefix frontend run test:e2e -- e2e/06-planning.spec.ts

# Headed / interactive UI mode
npm --prefix frontend run test:e2e:headed
npm --prefix frontend run test:e2e:ui
```

The configuration lives in `frontend/playwright.config.ts` and shared helpers
(login, API seeding, nav) in `frontend/e2e/helpers.ts`.

## API Overview

All routes are mounted under `/api`:

| Mount            | Purpose                                        |
| ---------------- | ---------------------------------------------- |
| `/auth`          | Login, current user, profile                   |
| `/org`           | Plants, departments, organizational masters    |
| `/setup`         | Standards, audit types, checklists, clauses    |
| `/people`        | Users, auditors, competency tracking           |
| `/roles`         | Dynamic roles, permissions catalog, assignment |
| `/classification`| Risk/criticality classification masters        |
| `/audits`        | Planning wizard, approval, execution lifecycle |
| `/findings`      | Findings and NC register entries               |
| `/capas`         | Corrective/preventive actions                  |
| `/analytics`     | Dashboards and KPIs                            |
| `/reports`       | NC register and compliance reports (PDF/CSV)   |
| `/notifications` | In-app notifications                           |
