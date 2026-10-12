import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, X } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { apiError, resources } from '@/lib/api';
import { fmtDate } from '@/lib/format';

type FindingType = 'C' | 'NC' | 'OFI' | 'NA';
type FindingSeverity = 'MAJOR' | 'MINOR' | 'OBSERVATION';

interface Finding {
  id: string;
  code: string;
  type: FindingType;
  severity: FindingSeverity | null;
  title: string;
  requirement?: string | null;
  observation?: string | null;
  objectiveEvidence?: string | null;
  status: string;
  dueDate?: string | null;
  createdAt?: string | null;
  clause?: { id: string; number: string; title: string } | null;
  department?: { id: string; name: string } | null;
  audit?: { id: string; code: string; title: string } | null;
  raisedBy?: { name: string } | null;
  capa?: { id: string; status: string } | null;
}

interface Audit {
  id: string;
  code: string;
  title: string;
}

const TYPE_OPTIONS: { value: FindingType; label: string }[] = [
  { value: 'C', label: 'C - Conformity' },
  { value: 'NC', label: 'NC - Nonconformity' },
  { value: 'OFI', label: 'OFI - Improvement' },
  { value: 'NA', label: 'NA - Not applicable' },
];

const SEVERITY_OPTIONS: { value: FindingSeverity; label: string }[] = [
  { value: 'MAJOR', label: 'Major' },
  { value: 'MINOR', label: 'Minor' },
  { value: 'OBSERVATION', label: 'Observation' },
];

const schema = z.object({
  auditId: z.string().min(1, 'Audit is required'),
  type: z.enum(['C', 'NC', 'OFI', 'NA']),
  severity: z.enum(['MAJOR', 'MINOR', 'OBSERVATION']).optional().or(z.literal('')),
  title: z.string().min(1, 'Title is required'),
  requirement: z.string().optional(),
  observation: z.string().min(1, 'Observation is required'),
  objectiveEvidence: z.string().optional(),
  dueDate: z.string().optional(),
});

type FindingForm = z.infer<typeof schema>;

function isOverdue(finding: Finding): boolean {
  if (!finding.dueDate) return false;
  if (finding.status === 'CLOSED') return false;
  return new Date(finding.dueDate).getTime() < Date.now();
}

export function FindingsListPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const auditFilter = searchParams.get('auditId') ?? '';

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [severity, setSeverity] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(false);

  const params = useMemo(
    () => ({
      page,
      pageSize: 20,
      search: search || undefined,
      type: type || undefined,
      severity: severity || undefined,
      status: status || undefined,
      auditId: auditFilter || undefined,
    }),
    [page, search, type, severity, status, auditFilter],
  );

  const { data, isLoading } = useQuery({
    queryKey: ['findings', params],
    queryFn: () => resources.list<Finding>('/findings', params),
  });

  const { data: audits } = useQuery({
    queryKey: ['audits', 'options'],
    queryFn: () => resources.list<Audit>('/audits', { pageSize: 200 }),
  });

  const form = useForm<FindingForm>({
    resolver: zodResolver(schema),
    defaultValues: {
      auditId: auditFilter,
      type: 'NC',
      severity: 'MINOR',
      title: '',
      requirement: '',
      observation: '',
      objectiveEvidence: '',
      dueDate: '',
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: FindingForm) =>
      resources.create('/findings', {
        auditId: values.auditId,
        type: values.type,
        severity: values.type === 'NC' ? values.severity || undefined : undefined,
        title: values.title,
        requirement: values.requirement || undefined,
        observation: values.observation,
        objectiveEvidence: values.objectiveEvidence || undefined,
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success('Finding created');
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      setOpen(false);
      form.reset();
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const openCreate = () => {
    form.reset({
      auditId: auditFilter,
      type: 'NC',
      severity: 'MINOR',
      title: '',
      requirement: '',
      observation: '',
      objectiveEvidence: '',
      dueDate: '',
    });
    setOpen(true);
  };

  const columns: Column<Finding>[] = [
    { key: 'code', header: 'Code', sortable: true, className: 'w-28 font-medium' },
    {
      key: 'type',
      header: 'Type',
      className: 'w-20',
      value: (row) => row.type,
      render: (row) => <Badge variant={statusVariant(row.type)}>{row.type}</Badge>,
    },
    {
      key: 'severity',
      header: 'Severity',
      className: 'w-28',
      value: (row) => row.severity ?? '',
      render: (row) =>
        row.severity ? <Badge variant={statusVariant(row.severity)}>{row.severity}</Badge> : <span className="text-muted-foreground">-</span>,
    },
    { key: 'title', header: 'Title', sortable: true },
    {
      key: 'audit',
      header: 'Audit',
      className: 'w-32',
      value: (row) => row.audit?.code ?? '',
      render: (row) => row.audit?.code ?? '-',
    },
    {
      key: 'department',
      header: 'Department',
      value: (row) => row.department?.name ?? '',
      render: (row) => row.department?.name ?? '-',
    },
    {
      key: 'dueDate',
      header: 'Due date',
      className: 'w-32',
      value: (row) => row.dueDate ?? '',
      render: (row) => (
        <span className={isOverdue(row) ? 'font-medium text-destructive' : 'text-muted-foreground'}>
          {fmtDate(row.dueDate)}
        </span>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      className: 'w-24',
      value: (row) => row.status,
      render: (row) => <Badge variant={statusVariant(row.status)}>{row.status}</Badge>,
    },
    {
      key: 'capa',
      header: 'CAPA',
      className: 'w-28',
      value: (row) => row.capa?.status ?? '',
      render: (row) =>
        row.capa ? <Badge variant={statusVariant(row.capa.status)}>{row.capa.status}</Badge> : <span className="text-muted-foreground">-</span>,
    },
  ];

  const hasFilters = !!(type || severity || status || search || auditFilter);

  return (
    <div className="space-y-5">
      <PageHeader
        title="Findings"
        description="Conformities, nonconformities and opportunities for improvement raised during audits."
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" /> New Finding
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44 space-y-1.5">
          <Label>Type</Label>
          <Select value={type || 'ALL'} onValueChange={(value) => { setType(value === 'ALL' ? '' : value); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All types</SelectItem>
              {TYPE_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-44 space-y-1.5">
          <Label>Severity</Label>
          <Select value={severity || 'ALL'} onValueChange={(value) => { setSeverity(value === 'ALL' ? '' : value); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="All severities" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All severities</SelectItem>
              {SEVERITY_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label>Status</Label>
          <Select value={status || 'ALL'} onValueChange={(value) => { setStatus(value === 'ALL' ? '' : value); setPage(1); }}>
            <SelectTrigger>
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">All statuses</SelectItem>
              <SelectItem value="OPEN">Open</SelectItem>
              <SelectItem value="CLOSED">Closed</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setType('');
              setSeverity('');
              setStatus('');
              setSearch('');
              setPage(1);
            }}
          >
            <X className="h-4 w-4" /> Clear
          </Button>
        )}
      </div>

      <DataTable
        columns={columns}
        rows={data?.items ?? []}
        loading={isLoading}
        rowKey={(row) => row.id}
        search={search}
        onSearchChange={(value) => { setSearch(value); setPage(1); }}
        searchPlaceholder="Search findings..."
        page={data?.page}
        totalPages={data?.totalPages}
        total={data?.total}
        pageSize={data?.pageSize}
        onPageChange={setPage}
        onRowClick={(row) => navigate(`/findings/${row.id}`)}
        emptyTitle="No findings found"
        emptyDescription="Adjust the filters or raise a new finding to get started."
      />

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>New Finding</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((values) => createMutation.mutate(values))}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Audit</Label>
              <Select value={form.watch('auditId')} onValueChange={(value) => form.setValue('auditId', value, { shouldValidate: true })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select an audit..." />
                </SelectTrigger>
                <SelectContent>
                  {(audits?.items ?? []).map((audit) => (
                    <SelectItem key={audit.id} value={audit.id}>
                      {audit.code} - {audit.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.auditId && (
                <p className="text-xs text-destructive">{form.formState.errors.auditId.message}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.watch('type')} onValueChange={(value) => form.setValue('type', value as FindingType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select
                value={form.watch('severity') || ''}
                onValueChange={(value) => form.setValue('severity', value as FindingSeverity)}
                disabled={form.watch('type') !== 'NC'}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-title">Title</Label>
              <Input id="new-title" {...form.register('title')} />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-requirement">Requirement</Label>
              <Textarea id="new-requirement" {...form.register('requirement')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-observation">Observation</Label>
              <Textarea id="new-observation" {...form.register('observation')} />
              {form.formState.errors.observation && (
                <p className="text-xs text-destructive">{form.formState.errors.observation.message}</p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="new-evidence">Objective evidence</Label>
              <Textarea id="new-evidence" {...form.register('objectiveEvidence')} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-due">Due date</Label>
              <Input id="new-due" type="date" {...form.register('dueDate')} />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                Create finding
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
