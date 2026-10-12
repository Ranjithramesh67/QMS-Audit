import {
  LayoutDashboard,
  ClipboardList,
  CalendarCheck,
  AlertTriangle,
  Wrench,
  BarChart3,
  FileText,
  Building2,
  Factory,
  Network,
  Workflow,
  Tags,
  BookOpen,
  ListChecks,
  CalendarRange,
  UserCog,
  Users,
  ShieldAlert,
  FileStack,
  Bell,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  /** Visible when the user holds at least one of these permission keys. */
  permissions?: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const navSections: NavSection[] = [
  {
    title: 'Overview',
    items: [
      { label: 'Dashboard', to: '/', icon: LayoutDashboard },
      { label: 'Notifications', to: '/notifications', icon: Bell },
    ],
  },
  {
    title: 'Audit Lifecycle',
    items: [
      { label: 'Audit Planning', to: '/audits', icon: ClipboardList, permissions: ['audits.plan', 'audits.approve', 'audits.execute'] },
      { label: 'Execution', to: '/execution', icon: CalendarCheck, permissions: ['audits.execute'] },
      { label: 'Findings', to: '/findings', icon: AlertTriangle, permissions: ['findings.manage', 'findings.delete'] },
      { label: 'CAPA', to: '/capa', icon: Wrench, permissions: ['capa.open', 'capa.respond', 'capa.review', 'capa.close'] },
      { label: 'Analytics', to: '/analytics', icon: BarChart3, permissions: ['analytics.view'] },
      { label: 'Reports', to: '/reports', icon: FileText, permissions: ['reports.view'] },
    ],
  },
  {
    title: 'Organisation',
    items: [
      { label: 'Companies', to: '/masters/companies', icon: Building2, permissions: ['masters.org'] },
      { label: 'Plants', to: '/masters/plants', icon: Factory, permissions: ['masters.org'] },
      { label: 'Departments', to: '/masters/departments', icon: Network, permissions: ['masters.org'] },
      { label: 'Processes', to: '/masters/processes', icon: Workflow, permissions: ['masters.org'] },
    ],
  },
  {
    title: 'Audit Setup',
    items: [
      { label: 'Audit Types', to: '/masters/audit-types', icon: Tags, permissions: ['masters.setup'] },
      { label: 'Standards', to: '/masters/standards', icon: BookOpen, permissions: ['masters.setup'] },
      { label: 'Checklists', to: '/masters/checklists', icon: ListChecks, permissions: ['masters.checklists'] },
      { label: 'Clauses', to: '/masters/clauses', icon: ListChecks, permissions: ['masters.checklists'] },
      { label: 'Audit Programmes', to: '/masters/programs', icon: CalendarRange, permissions: ['masters.setup'] },
    ],
  },
  {
    title: 'People',
    items: [
      { label: 'Auditors', to: '/masters/auditors', icon: UserCog, permissions: ['masters.auditors'] },
      { label: 'Auditees', to: '/masters/auditees', icon: Users, permissions: ['masters.auditees'] },
      { label: 'Users', to: '/masters/users', icon: ShieldAlert, permissions: ['users.view', 'users.manage'] },
      { label: 'Roles & Permissions', to: '/masters/roles', icon: ShieldAlert, permissions: ['roles.manage'] },
    ],
  },
  {
    title: 'Classification',
    items: [
      { label: 'Finding Types', to: '/masters/finding-types', icon: AlertTriangle, permissions: ['masters.classification'] },
      { label: 'Severities', to: '/masters/severities', icon: ShieldAlert, permissions: ['masters.classification'] },
    ],
  },
  {
    title: 'Documents',
    items: [{ label: 'Document Library', to: '/documents', icon: FileStack, permissions: ['documents.manage', 'documents.delete'] }],
  },
];
