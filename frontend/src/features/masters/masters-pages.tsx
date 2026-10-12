import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { ResourcePage, type FieldConfig } from '@/components/common/resource-page';
import { Badge } from '@/components/ui/badge';
import { useOptions } from './use-options';
import { fmtDate } from '@/lib/format';
import { resources } from '@/lib/api';

const CATEGORY_OPTIONS = [
  { value: 'SYSTEM', label: 'System' },
  { value: 'PRODUCT', label: 'Product' },
  { value: 'PROCESS', label: 'Process' },
];

const booleanActive: FieldConfig = { name: 'active', label: 'Active', type: 'checkbox' };

// --- Organisation -----------------------------------------------------------

export function CompaniesPage() {
  const fields: FieldConfig[] = [
    { name: 'code', label: 'Code', required: true, placeholder: 'ACME' },
    { name: 'name', label: 'Company name', required: true, fullWidth: true },
    { name: 'city', label: 'City' },
    { name: 'country', label: 'Country' },
    { name: 'phone', label: 'Phone' },
    { name: 'email', label: 'Email' },
    { name: 'website', label: 'Website' },
    { name: 'address', label: 'Address', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Company"
      description="Legal entities that own one or more plants."
      endpoint="/org/companies"
      queryKey="companies"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
        { key: 'name', header: 'Name', sortable: true },
        { key: 'city', header: 'City', sortable: true },
        { key: 'country', header: 'Country' },
        { key: '_count', header: 'Plants', render: (r) => r._count?.plants ?? 0, className: 'w-20' },
        { key: 'active', header: 'Status', render: (r) => <Badge variant={r.active ? 'success' : 'secondary'}>{r.active ? 'Active' : 'Inactive'}</Badge> },
      ]}
    />
  );
}

export function PlantsPage() {
  const { options } = useOptions('/org/companies', 'name', 'companies');
  const fields: FieldConfig[] = [
    { name: 'companyId', label: 'Company', type: 'select', options, required: true },
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Plant name', required: true, fullWidth: true },
    { name: 'city', label: 'City' },
    { name: 'country', label: 'Country' },
    { name: 'address', label: 'Address', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Plant"
      description="Manufacturing or service locations."
      endpoint="/org/plants"
      queryKey="plants"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
        { key: 'name', header: 'Name', sortable: true },
        { key: 'company', header: 'Company', render: (r) => r.company?.name ?? '-', value: (r) => r.company?.name ?? '' },
        { key: 'city', header: 'City' },
        { key: '_count', header: 'Departments', render: (r) => r._count?.departments ?? 0, className: 'w-28' },
      ]}
    />
  );
}

export function DepartmentsPage() {
  const { options } = useOptions('/org/plants', 'name', 'plants');
  const fields: FieldConfig[] = [
    { name: 'plantId', label: 'Plant', type: 'select', options, required: true },
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Department name', required: true, fullWidth: true },
    { name: 'headName', label: 'Department head' },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Department"
      description="Functional departments within a plant."
      endpoint="/org/departments"
      queryKey="departments"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
        { key: 'name', header: 'Name', sortable: true },
        { key: 'plant', header: 'Plant', render: (r) => r.plant?.name ?? '-', value: (r) => r.plant?.name ?? '' },
        { key: 'headName', header: 'Head' },
        { key: '_count', header: 'Processes', render: (r) => r._count?.processes ?? 0, className: 'w-24' },
      ]}
    />
  );
}

export function ProcessesPage() {
  const { options: departments } = useOptions('/org/departments', 'name', 'departments');
  const { data: processes } = useQuery({
    queryKey: ['processes', 'options'],
    queryFn: () => resources.all<Record<string, unknown>>('/org/processes', { pageSize: 200 }),
  });
  const parentOptions = useMemo(
    () => (processes ?? []).map((p) => ({ value: String(p.id), label: `${p.code} ${p.name}` })),
    [processes],
  );
  const fields: FieldConfig[] = [
    { name: 'departmentId', label: 'Department', type: 'select', options: departments, required: true },
    { name: 'parentId', label: 'Parent process', type: 'select', options: [{ value: '', label: 'None (top level)' }, ...parentOptions] },
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Process name', required: true },
    { name: 'owner', label: 'Process owner' },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Process"
      description="Nested process structure per department."
      endpoint="/org/processes"
      queryKey="processes"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
        { key: 'name', header: 'Process', sortable: true },
        { key: 'department', header: 'Department', render: (r) => r.department?.name ?? '-', value: (r) => r.department?.name ?? '' },
        { key: 'owner', header: 'Owner' },
      ]}
    />
  );
}

// --- Audit setup ------------------------------------------------------------

export function AuditTypesPage() {
  const fields: FieldConfig[] = [
    { name: 'code', label: 'Code', required: true, placeholder: 'SYS' },
    { name: 'name', label: 'Name', required: true },
    { name: 'category', label: 'Category', type: 'select', options: CATEGORY_OPTIONS, required: true },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Audit Type"
      description="System, Product or Process audit definitions."
      endpoint="/setup/audit-types"
      queryKey="audit-types"
      createDefaults={{ active: true, category: 'SYSTEM' }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-24 font-medium' },
        { key: 'name', header: 'Name', sortable: true },
        { key: 'category', header: 'Category', render: (r) => <Badge variant="accent">{r.category}</Badge> },
        { key: 'description', header: 'Description' },
      ]}
    />
  );
}

export function StandardsPage() {
  const fields: FieldConfig[] = [
    { name: 'code', label: 'Code', required: true, placeholder: 'ISO9001' },
    { name: 'name', label: 'Standard name', required: true },
    { name: 'version', label: 'Version', placeholder: '2015' },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Standard"
      description="Reference standards such as ISO 9001, IATF 16949, VDA 6.3."
      endpoint="/setup/standards"
      queryKey="standards"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-32 font-medium' },
        { key: 'name', header: 'Standard', sortable: true },
        { key: 'version', header: 'Version', className: 'w-24' },
        { key: '_count', header: 'Checklists', render: (r) => r._count?.checklists ?? 0, className: 'w-28' },
      ]}
    />
  );
}

export function ChecklistsPage() {
  const { options: standards } = useOptions('/setup/standards', 'name', 'standards');
  const fields: FieldConfig[] = [
    { name: 'standardId', label: 'Standard', type: 'select', options: standards, required: true },
    { name: 'code', label: 'Code', required: true },
    { name: 'name', label: 'Checklist name', required: true, fullWidth: true },
    { name: 'version', label: 'Version' },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Checklist"
      description="Clause structures used during audit execution."
      endpoint="/setup/checklists"
      queryKey="checklists"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-32 font-medium' },
        { key: 'name', header: 'Checklist', sortable: true },
        { key: 'standard', header: 'Standard', render: (r) => r.standard?.name ?? '-', value: (r) => r.standard?.name ?? '' },
        { key: '_count', header: 'Clauses', render: (r) => r._count?.clauses ?? 0, className: 'w-24' },
      ]}
    />
  );
}

export function ProgramsPage() {
  const { options: standards } = useOptions('/setup/standards', 'name', 'standards');
  const fields: FieldConfig[] = [
    { name: 'code', label: 'Code', required: true, placeholder: 'AP-2026' },
    { name: 'name', label: 'Programme name', required: true, fullWidth: true },
    { name: 'year', label: 'Year', type: 'number', required: true },
    { name: 'standardId', label: 'Standard', type: 'select', options: standards },
    { name: 'status', label: 'Status', type: 'select', options: [
      { value: 'DRAFT', label: 'Draft' },
      { value: 'ACTIVE', label: 'Active' },
      { value: 'COMPLETED', label: 'Completed' },
      { value: 'ARCHIVED', label: 'Archived' },
    ] },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
  ];
  return (
    <ResourcePage<any>
      title="Audit Programme"
      description="Annual or multi-audit programmes."
      endpoint="/setup/programs"
      queryKey="programs"
      createDefaults={{ status: 'DRAFT', year: new Date().getFullYear() }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
        { key: 'name', header: 'Programme', sortable: true },
        { key: 'year', header: 'Year', className: 'w-20' },
        { key: 'status', header: 'Status', render: (r) => <Badge variant="info">{r.status}</Badge> },
        { key: '_count', header: 'Audits', render: (r) => r._count?.audits ?? 0, className: 'w-20' },
      ]}
    />
  );
}

export function ClausesPage() {
  const { options: checklists } = useOptions('/setup/checklists', 'name', 'checklists');
  const { data: clauses } = useQuery({
    queryKey: ['clauses', 'options'],
    queryFn: () => resources.all<Record<string, unknown>>('/setup/clauses', { pageSize: 500 }),
  });
  const parentOptions = useMemo(
    () => (clauses ?? []).map((c) => ({ value: String(c.id), label: `${c.number} ${c.title}` })),
    [clauses],
  );
  const fields: FieldConfig[] = [
    { name: 'checklistId', label: 'Checklist', type: 'select', options: checklists, required: true },
    { name: 'parentId', label: 'Parent clause', type: 'select', options: [{ value: '', label: 'None (top level)' }, ...parentOptions] },
    { name: 'number', label: 'Clause number', required: true, placeholder: '8.5.1' },
    { name: 'title', label: 'Title', required: true },
    { name: 'sortOrder', label: 'Sort order', type: 'number' },
    { name: 'requirement', label: 'Requirement text', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Clause"
      description="Clauses and sub-clauses within a checklist."
      endpoint="/setup/clauses"
      queryKey="clauses"
      createDefaults={{ active: true, sortOrder: 0 }}
      fields={fields}
      columns={[
        { key: 'checklist', header: 'Checklist', render: (r) => r.checklist?.name ?? '-', value: (r) => r.checklist?.name ?? '' },
        { key: 'number', header: 'Clause', sortable: true, className: 'w-28 font-medium' },
        { key: 'title', header: 'Title', sortable: true },
        { key: 'sortOrder', header: 'Order', className: 'w-20' },
      ]}
    />
  );
}

// --- People -----------------------------------------------------------------

export function AuditorsPage() {
  const { data: alerts } = useQuery({
    queryKey: ['auditor-alerts'],
    queryFn: () => resources.all<Record<string, unknown>>('/people/auditors/competency-alerts'),
  });

  const fields: FieldConfig[] = [
    { name: 'name', label: 'Auditor name', required: true },
    { name: 'type', label: 'Type', type: 'select', options: [{ value: 'INTERNAL', label: 'Internal' }, { value: 'EXTERNAL', label: 'External' }], required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'organisation', label: 'Organisation' },
    { name: 'competencyLevel', label: 'Competency level', type: 'select', options: [
      { value: 'TRAINEE', label: 'Trainee' },
      { value: 'QUALIFIED', label: 'Qualified' },
      { value: 'SENIOR', label: 'Senior' },
      { value: 'LEAD', label: 'Lead' },
    ], required: true },
    { name: 'competencyExpiry', label: 'Competency expiry', type: 'date' },
    { name: 'qualifications', label: 'Qualifications (comma separated)', type: 'tags', fullWidth: true },
    { name: 'certifications', label: 'Certifications (comma separated)', type: 'tags', fullWidth: true },
    { name: 'competentForCategories', label: 'Competent for', type: 'checkboxes', options: CATEGORY_OPTIONS, fullWidth: true },
    booleanActive,
  ];

  return (
    <ResourcePage<any>
      title="Auditor"
      description="Internal and external auditors with competency tracking."
      endpoint="/people/auditors"
      queryKey="auditors"
      createDefaults={{ active: true, type: 'INTERNAL', competencyLevel: 'QUALIFIED', competentForCategories: [] }}
      fields={fields}
      extraToolbar={
        alerts && alerts.length > 0 ? (
          <Badge variant="warning" className="gap-1">
            <AlertTriangle className="h-3 w-3" /> {alerts.length} competency alert(s)
          </Badge>
        ) : null
      }
      columns={[
        { key: 'name', header: 'Name', sortable: true, className: 'font-medium' },
        { key: 'type', header: 'Type', render: (r) => <Badge variant={r.type === 'INTERNAL' ? 'info' : 'outline'}>{r.type}</Badge> },
        { key: 'competencyLevel', header: 'Level' },
        { key: 'organisation', header: 'Organisation' },
        {
          key: 'competencyExpiry',
          header: 'Expiry',
          value: (r) => r.competencyExpiry ?? '',
          render: (r) => {
            if (!r.competencyExpiry) return '-';
            const expired = new Date(r.competencyExpiry) < new Date();
            return <span className={expired ? 'text-destructive' : ''}>{fmtDate(r.competencyExpiry)}</span>;
          },
        },
      ]}
    />
  );
}

export function AuditeesPage() {
  const { options: departments } = useOptions('/org/departments', 'name', 'departments');
  const fields: FieldConfig[] = [
    { name: 'name', label: 'Auditee name', required: true },
    { name: 'email', label: 'Email', type: 'email' },
    { name: 'phone', label: 'Phone' },
    { name: 'designation', label: 'Designation' },
    { name: 'departmentId', label: 'Department', type: 'select', options: departments },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Auditee"
      description="Personnel who respond to findings."
      endpoint="/people/auditees"
      queryKey="auditees"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'name', header: 'Name', sortable: true, className: 'font-medium' },
        { key: 'designation', header: 'Designation' },
        { key: 'department', header: 'Department', render: (r) => r.department?.name ?? '-', value: (r) => r.department?.name ?? '' },
        { key: 'email', header: 'Email' },
      ]}
    />
  );
}

export function UsersPage() {
  const { options: plants } = useOptions('/org/plants', 'name', 'plants');
  const { options: departments } = useOptions('/org/departments', 'name', 'departments');
  const { options: roles } = useOptions('/roles', 'name', 'roles');
  const fields: FieldConfig[] = [
    { name: 'name', label: 'Full name', required: true },
    { name: 'email', label: 'Email', type: 'email', required: true },
    { name: 'password', label: 'Password (blank to keep)', placeholder: 'Min 8 characters' },
    { name: 'roleId', label: 'Role', type: 'select', options: roles, required: true },
    { name: 'designation', label: 'Designation' },
    { name: 'plantId', label: 'Plant', type: 'select', options: plants },
    { name: 'departmentId', label: 'Department', type: 'select', options: departments },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="User"
      description="Application users and their assigned role."
      endpoint="/people/users"
      queryKey="users"
      createDefaults={{ active: true }}
      fields={fields}
      columns={[
        { key: 'name', header: 'Name', sortable: true, className: 'font-medium' },
        { key: 'email', header: 'Email', sortable: true },
        { key: 'role', header: 'Role', render: (r) => <Badge variant="accent">{r.roleName ?? r.role}</Badge> },
        { key: 'department', header: 'Department', render: (r) => r.department?.name ?? '-' },
        { key: 'active', header: 'Status', render: (r) => <Badge variant={r.active ? 'success' : 'secondary'}>{r.active ? 'Active' : 'Disabled'}</Badge> },
      ]}
    />
  );
}

// --- Classification ---------------------------------------------------------

export function FindingTypesPage() {
  const fields: FieldConfig[] = [
    { name: 'code', label: 'Code', required: true, placeholder: 'NC' },
    { name: 'name', label: 'Name', required: true },
    { name: 'requiresCapa', label: 'Requires CAPA', type: 'checkbox' },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Finding Type"
      description="C (Conformity), NC (Nonconformity), OFI, NA."
      endpoint="/classification/finding-types"
      queryKey="finding-types"
      createDefaults={{ active: true, requiresCapa: false }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-24 font-medium' },
        { key: 'name', header: 'Name', sortable: true },
        { key: 'requiresCapa', header: 'CAPA', render: (r) => (r.requiresCapa ? <Badge variant="warning">Required</Badge> : <Badge variant="secondary">No</Badge>) },
        { key: 'description', header: 'Description' },
      ]}
    />
  );
}

export function SeveritiesPage() {
  const fields: FieldConfig[] = [
    { name: 'code', label: 'Code', required: true, placeholder: 'MAJOR' },
    { name: 'name', label: 'Name', required: true },
    { name: 'weight', label: 'Weight', type: 'number' },
    { name: 'color', label: 'Color', placeholder: '#dc2626' },
    { name: 'description', label: 'Description', type: 'textarea', fullWidth: true },
    booleanActive,
  ];
  return (
    <ResourcePage<any>
      title="Severity"
      description="Major, Minor and Observation severity levels."
      endpoint="/classification/severities"
      queryKey="severities"
      createDefaults={{ active: true, weight: 1 }}
      fields={fields}
      columns={[
        { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
        { key: 'name', header: 'Name', sortable: true },
        { key: 'weight', header: 'Weight', className: 'w-20' },
        { key: 'color', header: 'Color', render: (r) => (r.color ? <span className="inline-block h-4 w-4 rounded" style={{ background: r.color }} /> : '-') },
        { key: 'description', header: 'Description' },
      ]}
    />
  );
}
