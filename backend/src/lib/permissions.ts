/**
 * Central permission catalog for the QMS Audit Platform.
 *
 * A role is a named, editable collection of these permission keys. The special
 * wildcard `*` grants every permission (equivalent to the legacy ADMIN role and
 * used by the "Full access" toggle in the role editor).
 *
 * The default permission sets below reproduce the behaviour of the six original
 * fixed roles exactly, so existing users keep the same access after migrating
 * from the old `Role` enum to editable roles.
 */

export const WILDCARD = '*';

export interface PermissionDef {
  key: string;
  label: string;
  group: string;
  description: string;
}

export const PERMISSIONS: PermissionDef[] = [
  // Organisation
  { key: 'masters.org', label: 'Organisation masters', group: 'Organisation', description: 'Create and edit companies, plants, departments and processes.' },
  // Audit setup
  { key: 'masters.setup', label: 'Audit programme setup', group: 'Audit Setup', description: 'Manage audit types, standards and audit programmes.' },
  { key: 'masters.checklists', label: 'Checklists & clauses', group: 'Audit Setup', description: 'Manage checklists and their clauses.' },
  // People & access
  { key: 'masters.auditors', label: 'Auditor register', group: 'People & Access', description: 'Manage the auditor register and competency records.' },
  { key: 'masters.auditees', label: 'Auditee register', group: 'People & Access', description: 'Manage auditee records.' },
  { key: 'users.view', label: 'View users', group: 'People & Access', description: 'View the user directory.' },
  { key: 'users.manage', label: 'Manage users', group: 'People & Access', description: 'Create, edit, deactivate users and assign their role.' },
  { key: 'roles.manage', label: 'Manage roles', group: 'People & Access', description: 'Create, edit and delete roles and their permissions.' },
  // Classification
  { key: 'masters.classification', label: 'Classification masters', group: 'Classification', description: 'Manage finding types and severity definitions.' },
  // Audit lifecycle
  { key: 'audits.plan', label: 'Plan audits', group: 'Audit Lifecycle', description: 'Create and edit audits, scope, clauses, team, schedule and submit for approval.' },
  { key: 'audits.approve', label: 'Approve audits', group: 'Audit Lifecycle', description: 'Approve or reject submitted audits.' },
  { key: 'audits.execute', label: 'Execute audits', group: 'Audit Lifecycle', description: 'Start audits and record clause answers.' },
  // Findings & CAPA
  { key: 'findings.manage', label: 'Record findings', group: 'Findings & CAPA', description: 'Raise and edit findings.' },
  { key: 'findings.delete', label: 'Delete findings', group: 'Findings & CAPA', description: 'Delete findings.' },
  { key: 'capa.open', label: 'Open CAPA', group: 'Findings & CAPA', description: 'Open corrective/preventive actions from findings.' },
  { key: 'capa.respond', label: 'Respond to CAPA', group: 'Findings & CAPA', description: 'Acknowledge, respond to and submit CAPA actions.' },
  { key: 'capa.review', label: 'Review CAPA', group: 'Findings & CAPA', description: 'Accept, reject and verify CAPA responses.' },
  { key: 'capa.close', label: 'Close CAPA', group: 'Findings & CAPA', description: 'Close verified CAPA.' },
  // Insights
  { key: 'analytics.view', label: 'View analytics', group: 'Insights', description: 'View analytics dashboards.' },
  { key: 'reports.view', label: 'View reports', group: 'Insights', description: 'View and export reports.' },
  // Documents
  { key: 'documents.manage', label: 'Manage documents', group: 'Documents', description: 'Upload, edit and version documents.' },
  { key: 'documents.delete', label: 'Delete documents', group: 'Documents', description: 'Delete documents.' },
  // System
  { key: 'notifications.broadcast', label: 'Scan deadlines', group: 'System', description: 'Trigger deadline scans and system broadcasts.' },
];

const PERMISSION_SET = new Set(PERMISSIONS.map((p) => p.key));

/** True when `key` is a known permission (or the wildcard). */
export function isKnownPermission(key: string): boolean {
  return key === WILDCARD || PERMISSION_SET.has(key);
}

/** True when the held permissions satisfy at least one required permission. */
export function hasPermission(held: string[] | undefined | null, required: string[]): boolean {
  if (!held || held.length === 0) return false;
  if (held.includes(WILDCARD)) return true;
  if (required.length === 0) return true;
  return required.some((key) => held.includes(key));
}

/** True when the held permissions include the full-access wildcard. */
export function isFullAccess(held: string[] | undefined | null): boolean {
  return !!held && held.includes(WILDCARD);
}

/**
 * Seed definitions for the original fixed roles. `code` is stable and used by
 * the login payload for display; `isSystem` roles cannot be deleted.
 */
export interface DefaultRoleDef {
  code: string;
  name: string;
  description: string;
  permissions: string[];
}

export const DEFAULT_ROLES: DefaultRoleDef[] = [
  {
    code: 'ADMIN',
    name: 'Administrator',
    description: 'Full access to every part of the platform.',
    permissions: [WILDCARD],
  },
  {
    code: 'QMR',
    name: 'Quality Management Representative',
    description: 'Owns the audit programme: planning, approvals, CAPA closure and reporting.',
    permissions: [
      'masters.org',
      'masters.setup',
      'masters.checklists',
      'masters.auditors',
      'masters.auditees',
      'masters.classification',
      'users.view',
      'audits.plan',
      'audits.approve',
      'audits.execute',
      'findings.manage',
      'findings.delete',
      'capa.open',
      'capa.respond',
      'capa.review',
      'capa.close',
      'analytics.view',
      'reports.view',
      'documents.manage',
      'documents.delete',
      'notifications.broadcast',
    ],
  },
  {
    code: 'LEAD_AUDITOR',
    name: 'Lead Auditor',
    description: 'Plans and runs audits, manages findings and reviews CAPA.',
    permissions: [
      'masters.org',
      'masters.setup',
      'masters.checklists',
      'masters.auditors',
      'masters.auditees',
      'users.view',
      'audits.plan',
      'audits.execute',
      'findings.manage',
      'findings.delete',
      'capa.open',
      'capa.respond',
      'capa.review',
      'capa.close',
      'analytics.view',
      'reports.view',
      'documents.manage',
    ],
  },
  {
    code: 'AUDITOR',
    name: 'Auditor',
    description: 'Executes audits and records findings and CAPA responses.',
    permissions: [
      'masters.org',
      'masters.checklists',
      'masters.auditees',
      'audits.execute',
      'findings.manage',
      'capa.open',
      'capa.respond',
      'capa.review',
      'analytics.view',
      'reports.view',
      'documents.manage',
    ],
  },
  {
    code: 'AUDITEE',
    name: 'Auditee',
    description: 'Responds to findings and CAPA raised against their area.',
    permissions: ['capa.open', 'capa.respond'],
  },
  {
    code: 'DEPT_HEAD',
    name: 'Department Head',
    description: 'Views audits and analytics for their department and responds to CAPA.',
    permissions: ['masters.org', 'capa.open', 'capa.respond', 'analytics.view', 'reports.view'],
  },
];
