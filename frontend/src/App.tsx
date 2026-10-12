import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/app-layout';
import { ProtectedRoute } from '@/components/layout/protected-route';
import { LoginPage } from '@/features/auth/LoginPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { AuditListPage } from '@/features/planning/AuditListPage';
import { AuditWizardPage } from '@/features/planning/AuditWizardPage';
import { AuditDetailPage } from '@/features/planning/AuditDetailPage';
import { ExecutionListPage } from '@/features/execution/ExecutionListPage';
import { ExecutionPage } from '@/features/execution/ExecutionPage';
import { FindingsListPage } from '@/features/findings/FindingsListPage';
import { FindingDetailPage } from '@/features/findings/FindingDetailPage';
import { CapaListPage } from '@/features/capa/CapaListPage';
import { CapaDetailPage } from '@/features/capa/CapaDetailPage';
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage';
import { ReportsPage } from '@/features/reports/ReportsPage';
import { DocumentsPage } from '@/features/documents/DocumentsPage';
import { NotificationsPage } from '@/features/notifications/NotificationsPage';
import { ProfilePage } from '@/features/profile/ProfilePage';
import {
  CompaniesPage,
  PlantsPage,
  DepartmentsPage,
  ProcessesPage,
  AuditTypesPage,
  StandardsPage,
  ChecklistsPage,
  ClausesPage,
  ProgramsPage,
  AuditorsPage,
  AuditeesPage,
  UsersPage,
  FindingTypesPage,
  SeveritiesPage,
} from '@/features/masters/masters-pages';
import { RolesPage } from '@/features/masters/RolesPage';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<DashboardPage />} />

        <Route path="/audits" element={<ProtectedRoute permissions={['audits.plan', 'audits.approve', 'audits.execute']}><AuditListPage /></ProtectedRoute>} />
        <Route path="/audits/new" element={<ProtectedRoute permissions={['audits.plan']}><AuditWizardPage /></ProtectedRoute>} />
        <Route path="/audits/:id" element={<AuditDetailPage />} />
        <Route path="/audits/:id/edit" element={<ProtectedRoute permissions={['audits.plan']}><AuditWizardPage /></ProtectedRoute>} />

        <Route path="/execution" element={<ProtectedRoute permissions={['audits.execute']}><ExecutionListPage /></ProtectedRoute>} />
        <Route path="/execution/:id" element={<ProtectedRoute permissions={['audits.execute']}><ExecutionPage /></ProtectedRoute>} />

        <Route path="/findings" element={<ProtectedRoute permissions={['findings.manage', 'findings.delete']}><FindingsListPage /></ProtectedRoute>} />
        <Route path="/findings/:id" element={<ProtectedRoute permissions={['findings.manage', 'findings.delete']}><FindingDetailPage /></ProtectedRoute>} />

        <Route path="/capa" element={<ProtectedRoute permissions={['capa.open', 'capa.respond', 'capa.review', 'capa.close']}><CapaListPage /></ProtectedRoute>} />
        <Route path="/capa/:id" element={<ProtectedRoute permissions={['capa.open', 'capa.respond', 'capa.review', 'capa.close']}><CapaDetailPage /></ProtectedRoute>} />

        <Route path="/analytics" element={<ProtectedRoute permissions={['analytics.view']}><AnalyticsPage /></ProtectedRoute>} />
        <Route path="/reports" element={<ProtectedRoute permissions={['reports.view']}><ReportsPage /></ProtectedRoute>} />
        <Route path="/documents" element={<ProtectedRoute permissions={['documents.manage', 'documents.delete']}><DocumentsPage /></ProtectedRoute>} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/profile" element={<ProfilePage />} />

        <Route path="/masters/companies" element={<ProtectedRoute permissions={['masters.org']}><CompaniesPage /></ProtectedRoute>} />
        <Route path="/masters/plants" element={<ProtectedRoute permissions={['masters.org']}><PlantsPage /></ProtectedRoute>} />
        <Route path="/masters/departments" element={<ProtectedRoute permissions={['masters.org']}><DepartmentsPage /></ProtectedRoute>} />
        <Route path="/masters/processes" element={<ProtectedRoute permissions={['masters.org']}><ProcessesPage /></ProtectedRoute>} />
        <Route path="/masters/audit-types" element={<ProtectedRoute permissions={['masters.setup']}><AuditTypesPage /></ProtectedRoute>} />
        <Route path="/masters/standards" element={<ProtectedRoute permissions={['masters.setup']}><StandardsPage /></ProtectedRoute>} />
        <Route path="/masters/checklists" element={<ProtectedRoute permissions={['masters.checklists']}><ChecklistsPage /></ProtectedRoute>} />
        <Route path="/masters/clauses" element={<ProtectedRoute permissions={['masters.checklists']}><ClausesPage /></ProtectedRoute>} />
        <Route path="/masters/programs" element={<ProtectedRoute permissions={['masters.setup']}><ProgramsPage /></ProtectedRoute>} />
        <Route path="/masters/auditors" element={<ProtectedRoute permissions={['masters.auditors']}><AuditorsPage /></ProtectedRoute>} />
        <Route path="/masters/auditees" element={<ProtectedRoute permissions={['masters.auditees']}><AuditeesPage /></ProtectedRoute>} />
        <Route path="/masters/users" element={<ProtectedRoute permissions={['users.view', 'users.manage']}><UsersPage /></ProtectedRoute>} />
        <Route path="/masters/roles" element={<ProtectedRoute permissions={['roles.manage']}><RolesPage /></ProtectedRoute>} />
        <Route path="/masters/finding-types" element={<ProtectedRoute permissions={['masters.classification']}><FindingTypesPage /></ProtectedRoute>} />
        <Route path="/masters/severities" element={<ProtectedRoute permissions={['masters.classification']}><SeveritiesPage /></ProtectedRoute>} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
