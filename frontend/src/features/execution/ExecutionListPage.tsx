import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Play } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { apiError, resources } from '@/lib/api';
import { fmtDate, STATUS_LABELS } from '@/lib/format';

interface Audit {
  id: string;
  code: string;
  title: string;
  category?: string;
  status: string;
  standard?: { name: string } | null;
  department?: { name: string } | null;
  plant?: { name: string } | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  _count?: Record<string, number>;
}

const EXECUTION_STATUSES = ['APPROVED', 'IN_PROGRESS', 'FINDINGS_RECORDED'];

const PROGRESS_HINT: Record<string, string> = {
  APPROVED: 'Not started',
  IN_PROGRESS: 'In progress',
  FINDINGS_RECORDED: 'Findings recorded',
};

export function ExecutionListPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['executions', search],
    queryFn: () => resources.list<Audit>('/audits', { pageSize: 100, search: search || undefined }),
  });

  const audits = (data?.items ?? []).filter((audit) => EXECUTION_STATUSES.includes(audit.status));

  const startMutation = useMutation({
    mutationFn: (id: string) => resources.create(`/audits/${id}/start`, {}),
    onSuccess: () => {
      toast.success('Audit started');
      queryClient.invalidateQueries({ queryKey: ['executions'] });
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const columns: Column<Audit>[] = [
    { key: 'code', header: 'Code', sortable: true, className: 'w-32 font-medium' },
    { key: 'title', header: 'Title', sortable: true },
    {
      key: 'department',
      header: 'Department',
      value: (row) => row.department?.name ?? '',
      render: (row) => row.department?.name ?? '-',
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-40',
      value: (row) => row.status,
      render: (row) => <Badge variant={statusVariant(row.status)}>{STATUS_LABELS[row.status] ?? row.status}</Badge>,
    },
    {
      key: 'planned',
      header: 'Planned',
      className: 'w-56',
      value: (row) => row.plannedStart ?? '',
      render: (row) => (
        <span className="text-muted-foreground">
          {fmtDate(row.plannedStart)} - {fmtDate(row.plannedEnd)}
        </span>
      ),
    },
    {
      key: 'progress',
      header: 'Progress',
      className: 'w-40',
      value: (row) => PROGRESS_HINT[row.status] ?? '',
      render: (row) => <span className="text-muted-foreground">{PROGRESS_HINT[row.status] ?? '-'}</span>,
    },
    {
      key: '__actions',
      header: '',
      className: 'w-52 text-right',
      render: (row) => (
        <div className="flex justify-end gap-2">
          {row.status === 'APPROVED' && (
            <Button
              size="sm"
              variant="accent"
              disabled={startMutation.isPending}
              onClick={() => startMutation.mutate(row.id)}
            >
              <Play className="h-3.5 w-3.5" /> Start
            </Button>
          )}
          <Button size="sm" variant="outline" asChild>
            <Link to={`/execution/${row.id}`}>Open Execution</Link>
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Audit Execution"
        description="Conduct approved audits, record clause responses and raise findings."
      />
      <DataTable
        columns={columns}
        rows={audits}
        loading={isLoading}
        rowKey={(row) => row.id}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search audits..."
        emptyTitle="No audits awaiting execution"
        emptyDescription="Approved audits will appear here once they are ready to be conducted."
      />
    </div>
  );
}
