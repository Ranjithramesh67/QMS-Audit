import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { resources } from '@/lib/api';
import { fmtDate, STATUS_LABELS, titleCase } from '@/lib/format';

const PAGE_SIZE = 10;

const CAPA_STATUSES = [
  'PENDING',
  'ACKNOWLEDGED',
  'IN_PROGRESS',
  'SUBMITTED',
  'ACCEPTED',
  'REJECTED',
  'VERIFIED',
  'CLOSED',
] as const;

interface CapaListRow {
  id: string;
  status: string;
  targetDate?: string | null;
  effectivenessResult?: string | null;
  finding: {
    id: string;
    code: string;
    title: string;
    severity?: string | null;
    department?: { name: string } | null;
  };
}

function shorten(value: string | null | undefined, max = 48) {
  if (!value) return '-';
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

export function CapaListPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('ALL');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading } = useQuery({
    queryKey: ['capas', status, page],
    queryFn: () =>
      resources.list<CapaListRow>('/capas', {
        status: status === 'ALL' ? undefined : status,
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const rows = useMemo(() => {
    const items = data?.items ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return items;
    return items.filter((row) => {
      const haystack = [row.finding?.code, row.finding?.title, row.finding?.department?.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [data?.items, search]);

  const columns: Column<CapaListRow>[] = [
    {
      key: 'code',
      header: 'Finding',
      sortable: true,
      className: 'w-32 font-medium',
      value: (row) => row.finding?.code ?? '',
      render: (row) => row.finding?.code ?? '-',
    },
    {
      key: 'title',
      header: 'Title',
      sortable: true,
      value: (row) => row.finding?.title ?? '',
      render: (row) => row.finding?.title ?? '-',
    },
    {
      key: 'severity',
      header: 'Severity',
      className: 'w-32',
      value: (row) => row.finding?.severity ?? '',
      render: (row) =>
        row.finding?.severity ? (
          <Badge variant={statusVariant(row.finding.severity)}>{titleCase(row.finding.severity)}</Badge>
        ) : (
          '-'
        ),
    },
    {
      key: 'department',
      header: 'Department',
      value: (row) => row.finding?.department?.name ?? '',
      render: (row) => row.finding?.department?.name ?? '-',
    },
    {
      key: 'status',
      header: 'CAPA Status',
      className: 'w-40',
      value: (row) => row.status,
      render: (row) => (
        <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status] ?? titleCase(row.status)}</Badge>
      ),
    },
    {
      key: 'targetDate',
      header: 'Target Date',
      className: 'w-32',
      value: (row) => row.targetDate ?? '',
      render: (row) => {
        const overdue =
          !!row.targetDate &&
          new Date(row.targetDate) < new Date() &&
          !['VERIFIED', 'CLOSED'].includes(row.status);
        return <span className={overdue ? 'font-medium text-destructive' : ''}>{fmtDate(row.targetDate)}</span>;
      },
    },
    {
      key: 'effectiveness',
      header: 'Effectiveness',
      value: (row) => row.effectivenessResult ?? '',
      render: (row) => <span className="text-muted-foreground">{shorten(row.effectivenessResult)}</span>,
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Corrective & Preventive Actions (CAPA)"
        description="Track nonconformity corrections, root cause analysis, action plans and verification."
      />

      <DataTable
        columns={columns}
        rows={rows}
        loading={isLoading}
        rowKey={(row) => row.id}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        searchPlaceholder="Search by finding code or title..."
        toolbar={
          <Select
            value={status}
            onValueChange={(value) => {
              setStatus(value);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              {CAPA_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {STATUS_LABELS[value] ?? titleCase(value)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
        page={data?.page}
        totalPages={data?.totalPages}
        total={data?.total}
        pageSize={data?.pageSize}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/capa/${row.id}`)}
        emptyTitle="No CAPAs found"
        emptyDescription="Adjust the filters or record findings against an audit to start a CAPA."
      />
    </div>
  );
}
