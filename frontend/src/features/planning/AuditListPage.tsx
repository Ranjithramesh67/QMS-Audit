import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { resources } from '@/lib/api';
import { fmtDate, STATUS_LABELS, titleCase } from '@/lib/format';
import { useAuth } from '@/store/auth';

const STATUS_ORDER = [
  'DRAFT',
  'PLANNED',
  'PENDING_APPROVAL',
  'APPROVED',
  'IN_PROGRESS',
  'FINDINGS_RECORDED',
  'CAPA_IN_PROGRESS',
  'VERIFICATION',
  'CLOSED',
  'CANCELLED',
];

const CATEGORIES = ['SYSTEM', 'PRODUCT', 'PROCESS'];

interface AuditListRow {
  id: string;
  code: string;
  title: string;
  category: string;
  status: string;
  standard?: { id: string; name: string; code?: string } | null;
  department?: { id: string; name: string; code?: string } | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  _count?: { findings?: number; responses?: number };
}

export function AuditListPage() {
  const navigate = useNavigate();
  const can = useAuth((s) => s.can);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('ALL');
  const [category, setCategory] = useState('ALL');

  const { data, isLoading } = useQuery({
    queryKey: ['audits', page, search, status, category],
    queryFn: () =>
      resources.list<AuditListRow>('/audits', {
        page,
        pageSize: 20,
        search: search || undefined,
        status: status === 'ALL' ? undefined : status,
        category: category === 'ALL' ? undefined : category,
      }),
  });

  const canCreate = can('audits.plan');

  const columns: Column<AuditListRow>[] = [
    { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
    { key: 'title', header: 'Title', sortable: true, value: (r) => r.title },
    {
      key: 'category',
      header: 'Category',
      className: 'w-28',
      value: (r) => r.category,
      render: (r) => <Badge variant="accent">{titleCase(r.category)}</Badge>,
    },
    {
      key: 'standard',
      header: 'Standard',
      value: (r) => r.standard?.name ?? '',
      render: (r) => r.standard?.name ?? '-',
    },
    {
      key: 'department',
      header: 'Department',
      value: (r) => r.department?.name ?? '',
      render: (r) => r.department?.name ?? '-',
    },
    {
      key: 'planned',
      header: 'Planned',
      value: (r) => r.plannedStart ?? '',
      render: (r) =>
        !r.plannedStart && !r.plannedEnd ? '-' : `${fmtDate(r.plannedStart)} - ${fmtDate(r.plannedEnd)}`,
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-40',
      value: (r) => r.status,
      render: (r) => <Badge variant={statusVariant(r.status)}>{STATUS_LABELS[r.status] ?? titleCase(r.status)}</Badge>,
    },
    {
      key: 'findings',
      header: 'Findings',
      className: 'w-24',
      value: (r) => r._count?.findings ?? 0,
      render: (r) => r._count?.findings ?? 0,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Planning"
        description="Plan, approve and track scheduled audits across programmes."
        actions={
          canCreate ? (
            <Button asChild size="sm">
              <Link to="/audits/new">
                <Plus className="h-4 w-4" /> New Audit
              </Link>
            </Button>
          ) : null
        }
      />

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        rowKey={(row) => row.id}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search audits..."
        toolbar={
          <>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_ORDER.map((value) => (
                  <SelectItem key={value} value={value}>
                    {STATUS_LABELS[value] ?? titleCase(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={category}
              onValueChange={(value) => {
                setCategory(value);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Category" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All categories</SelectItem>
                {CATEGORIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {titleCase(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        }
        page={data?.page}
        totalPages={data?.totalPages}
        total={data?.total}
        pageSize={data?.pageSize}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/audits/${row.id}`)}
        emptyTitle="No audits found"
        emptyDescription="Adjust your filters or create a new audit to get started."
      />
    </div>
  );
}
