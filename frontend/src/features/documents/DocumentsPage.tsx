import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileUp, History, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { LoadingBlock } from '@/components/ui/spinner';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/common/data-table';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { api, apiError, resources } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { cn } from '@/lib/utils';

type DocType = 'SOP' | 'WORK_INSTRUCTION' | 'EVIDENCE' | 'STANDARD' | 'RECORD' | 'OTHER';
type DocStatus = 'DRAFT' | 'UNDER_REVIEW' | 'APPROVED' | 'OBSOLETE';

interface DocumentVersion {
  id: string;
  version: string;
  fileUrl?: string | null;
  fileSize?: number | null;
  note?: string | null;
  createdAt: string;
}

interface DocumentRecord {
  id: string;
  code: string;
  name: string;
  type: DocType;
  status: DocStatus;
  currentVersion?: string | null;
  description?: string | null;
  fileUrl?: string | null;
  fileSize?: number | null;
  mimeType?: string | null;
  updatedAt: string;
  createdAt: string;
  uploadedBy?: { id: string; name: string } | null;
  _count?: { versions: number };
  versions?: DocumentVersion[];
}

const TYPE_OPTIONS: { value: DocType; label: string }[] = [
  { value: 'SOP', label: 'SOP' },
  { value: 'WORK_INSTRUCTION', label: 'Work Instruction' },
  { value: 'EVIDENCE', label: 'Evidence' },
  { value: 'STANDARD', label: 'Standard' },
  { value: 'RECORD', label: 'Record' },
  { value: 'OTHER', label: 'Other' },
];

const STATUS_OPTIONS: { value: DocStatus; label: string }[] = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'UNDER_REVIEW', label: 'Under Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'OBSOLETE', label: 'Obsolete' },
];

const TYPE_LABELS = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label])) as Record<DocType, string>;

const STATUS_VARIANT: Record<DocStatus, 'secondary' | 'warning' | 'success' | 'outline'> = {
  DRAFT: 'secondary',
  UNDER_REVIEW: 'warning',
  APPROVED: 'success',
  OBSOLETE: 'outline',
};

interface UploadForm {
  code: string;
  name: string;
  type: DocType;
  status: DocStatus;
  description: string;
  currentVersion: string;
  file: File | null;
}

interface VersionForm {
  version: string;
  note: string;
  file: File | null;
}

const EMPTY_UPLOAD: UploadForm = {
  code: '',
  name: '',
  type: 'SOP',
  status: 'DRAFT',
  description: '',
  currentVersion: '',
  file: null,
};

function formatFileSize(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function DocumentsPage() {
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [upload, setUpload] = useState<UploadForm>(EMPTY_UPLOAD);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [versionTarget, setVersionTarget] = useState<DocumentRecord | null>(null);
  const [versionForm, setVersionForm] = useState<VersionForm>({ version: '', note: '', file: null });
  const [deleteTarget, setDeleteTarget] = useState<DocumentRecord | null>(null);

  const listQuery = useQuery({
    queryKey: ['documents', { page, search, type: typeFilter, status: statusFilter }],
    queryFn: () =>
      resources.list<DocumentRecord>('/documents', {
        page,
        pageSize: 20,
        search: search || undefined,
        type: typeFilter === 'ALL' ? undefined : typeFilter,
        status: statusFilter === 'ALL' ? undefined : statusFilter,
      }),
  });

  const detailQuery = useQuery({
    queryKey: ['documents', 'detail', detailId],
    queryFn: () => resources.get<DocumentRecord>(`/documents/${detailId}`),
    enabled: !!detailId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['documents'] });

  const uploadMutation = useMutation({
    mutationFn: (values: UploadForm) => {
      const form = new FormData();
      form.append('code', values.code.trim());
      form.append('name', values.name.trim());
      form.append('type', values.type);
      form.append('status', values.status);
      if (values.description.trim()) form.append('description', values.description.trim());
      if (values.currentVersion.trim()) form.append('currentVersion', values.currentVersion.trim());
      if (values.file) form.append('file', values.file);
      return api.post<DocumentRecord>('/documents', form).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success('Document uploaded');
      invalidate();
      setUploadOpen(false);
      setUpload(EMPTY_UPLOAD);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const versionMutation = useMutation({
    mutationFn: (payload: { id: string; values: VersionForm }) => {
      const form = new FormData();
      form.append('version', payload.values.version.trim());
      if (payload.values.note.trim()) form.append('note', payload.values.note.trim());
      if (payload.values.file) form.append('file', payload.values.file);
      return api.post<DocumentVersion>(`/documents/${payload.id}/versions`, form).then((r) => r.data);
    },
    onSuccess: () => {
      toast.success('New version uploaded');
      invalidate();
      setVersionTarget(null);
      setVersionForm({ version: '', note: '', file: null });
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (record: DocumentRecord) => resources.remove(`/documents/${record.id}`),
    onSuccess: () => {
      toast.success('Document marked obsolete');
      invalidate();
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const openUpload = () => {
    setUpload(EMPTY_UPLOAD);
    setUploadOpen(true);
  };

  const openVersion = (record: DocumentRecord) => {
    setVersionForm({ version: record.currentVersion ?? '', note: '', file: null });
    setVersionTarget(record);
  };

  const submitUpload = () => {
    if (!upload.code.trim() || !upload.name.trim()) {
      toast.error('Code and name are required');
      return;
    }
    uploadMutation.mutate(upload);
  };

  const submitVersion = () => {
    if (!versionTarget) return;
    if (!versionForm.version.trim()) {
      toast.error('Version is required');
      return;
    }
    versionMutation.mutate({ id: versionTarget.id, values: versionForm });
  };

  const detail = detailQuery.data;

  const columns: Column<DocumentRecord>[] = [
    { key: 'code', header: 'Code', sortable: true, className: 'w-32 font-medium' },
    { key: 'name', header: 'Name', sortable: true },
    {
      key: 'type',
      header: 'Type',
      value: (r) => TYPE_LABELS[r.type] ?? r.type,
      render: (r) => <Badge variant="accent">{TYPE_LABELS[r.type] ?? r.type}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      value: (r) => r.status,
      render: (r) => <Badge variant={STATUS_VARIANT[r.status] ?? 'secondary'}>{r.status.replace('_', ' ')}</Badge>,
    },
    { key: 'currentVersion', header: 'Version', render: (r) => r.currentVersion ?? '-' },
    { key: 'updatedAt', header: 'Updated', sortable: true, value: (r) => r.updatedAt, render: (r) => fmtDate(r.updatedAt) },
    {
      key: '_count',
      header: 'Versions',
      className: 'w-24 text-center',
      render: (r) => <span className="text-sm text-muted-foreground">{r._count?.versions ?? 0}</span>,
    },
    {
      key: '__actions',
      header: '',
      className: 'w-32 text-right',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            variant="ghost"
            size="icon"
            aria-label="New version"
            title="New version"
            onClick={(e) => {
              e.stopPropagation();
              openVersion(r);
            }}
          >
            <History className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete"
            title="Delete"
            onClick={(e) => {
              e.stopPropagation();
              setDeleteTarget(r);
            }}
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Document Library"
        description="Controlled SOPs, work instructions, standards and evidence."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => listQuery.refetch()}>
              <RefreshCw className={cn('h-4 w-4', listQuery.isFetching && 'animate-spin')} /> Refresh
            </Button>
            <Button size="sm" onClick={openUpload}>
              <Plus className="h-4 w-4" /> Upload document
            </Button>
          </>
        }
      />

      <DataTable
        columns={columns}
        rows={listQuery.data?.items ?? []}
        loading={listQuery.isLoading}
        rowKey={(r) => r.id}
        search={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(1);
        }}
        searchPlaceholder="Search documents..."
        toolbar={
          <div className="flex items-center gap-2">
            <Select
              value={typeFilter}
              onValueChange={(v) => {
                setTypeFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-44">
                <SelectValue placeholder="All types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All types</SelectItem>
                {TYPE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={statusFilter}
              onValueChange={(v) => {
                setStatusFilter(v);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
        page={listQuery.data?.page}
        totalPages={listQuery.data?.totalPages}
        total={listQuery.data?.total}
        pageSize={listQuery.data?.pageSize}
        onPageChange={setPage}
        onRowClick={(r) => setDetailId(r.id)}
        emptyTitle="No documents found"
        emptyDescription="Upload your first document to build the library."
      />

      {/* Upload dialog */}
      <Dialog
        open={uploadOpen}
        onOpenChange={(v) => {
          setUploadOpen(v);
          if (!v) setUpload(EMPTY_UPLOAD);
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
            <DialogDescription>Add a controlled document to the library.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Code">
              <Input
                value={upload.code}
                onChange={(e) => setUpload((u) => ({ ...u, code: e.target.value }))}
                placeholder="SOP-QA-001"
              />
            </Field>
            <Field label="Current version">
              <Input
                value={upload.currentVersion}
                onChange={(e) => setUpload((u) => ({ ...u, currentVersion: e.target.value }))}
                placeholder="1.0"
              />
            </Field>
            <Field label="Name" className="sm:col-span-2">
              <Input
                value={upload.name}
                onChange={(e) => setUpload((u) => ({ ...u, name: e.target.value }))}
                placeholder="Document title"
              />
            </Field>
            <Field label="Type">
              <Select value={upload.type} onValueChange={(v) => setUpload((u) => ({ ...u, type: v as DocType }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={upload.status} onValueChange={(v) => setUpload((u) => ({ ...u, status: v as DocStatus }))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Description" className="sm:col-span-2">
              <Textarea
                value={upload.description}
                onChange={(e) => setUpload((u) => ({ ...u, description: e.target.value }))}
                placeholder="Optional summary"
              />
            </Field>
            <Field label="File" className="sm:col-span-2">
              <Input type="file" onChange={(e) => setUpload((u) => ({ ...u, file: e.target.files?.[0] ?? null }))} />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUploadOpen(false)} disabled={uploadMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submitUpload} disabled={uploadMutation.isPending}>
              <FileUp className="h-4 w-4" /> {uploadMutation.isPending ? 'Uploading...' : 'Upload'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New version dialog */}
      <Dialog
        open={!!versionTarget}
        onOpenChange={(v) => {
          if (!v) {
            setVersionTarget(null);
            setVersionForm({ version: '', note: '', file: null });
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>New version</DialogTitle>
            <DialogDescription>
              {versionTarget ? `${versionTarget.code} - ${versionTarget.name}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <Field label="Version">
              <Input
                value={versionForm.version}
                onChange={(e) => setVersionForm((v) => ({ ...v, version: e.target.value }))}
                placeholder="2.0"
              />
            </Field>
            <Field label="Note">
              <Textarea
                value={versionForm.note}
                onChange={(e) => setVersionForm((v) => ({ ...v, note: e.target.value }))}
                placeholder="Change summary (optional)"
              />
            </Field>
            <Field label="File">
              <Input
                type="file"
                onChange={(e) => setVersionForm((v) => ({ ...v, file: e.target.files?.[0] ?? null }))}
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setVersionTarget(null)} disabled={versionMutation.isPending}>
              Cancel
            </Button>
            <Button onClick={submitVersion} disabled={versionMutation.isPending}>
              <FileUp className="h-4 w-4" /> {versionMutation.isPending ? 'Saving...' : 'Upload version'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details dialog */}
      <Dialog open={!!detailId} onOpenChange={(v) => !v && setDetailId(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {detail ? `${detail.code} - ${detail.name}` : 'Document details'}
            </DialogTitle>
            {detail && <DialogDescription>{detail.description || 'No description provided.'}</DialogDescription>}
          </DialogHeader>

          {detailQuery.isLoading ? (
            <LoadingBlock />
          ) : detail ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Type</p>
                  <Badge variant="accent">{TYPE_LABELS[detail.type] ?? detail.type}</Badge>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Status</p>
                  <Badge variant={STATUS_VARIANT[detail.status] ?? 'secondary'}>
                    {detail.status.replace('_', ' ')}
                  </Badge>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Current version</p>
                  <p className="font-medium">{detail.currentVersion ?? '-'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Uploaded by</p>
                  <p className="font-medium">{detail.uploadedBy?.name ?? '-'}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">Updated</p>
                  <p className="font-medium">{fmtDateTime(detail.updatedAt)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase text-muted-foreground">File size</p>
                  <p className="font-medium">{formatFileSize(detail.fileSize)}</p>
                </div>
              </div>

              {detail.fileUrl && (
                <a
                  href={detail.fileUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 text-sm font-medium text-accent hover:underline"
                >
                  <FileUp className="h-4 w-4" /> Download current file
                </a>
              )}

              <Separator />

              <div className="space-y-2">
                <h4 className="text-sm font-semibold">Version history</h4>
                {detail.versions && detail.versions.length > 0 ? (
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {detail.versions.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-medium">v{v.version}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {fmtDate(v.createdAt)}
                            {v.note ? ` - ${v.note}` : ''}
                          </p>
                        </div>
                        {v.fileUrl && (
                          <a
                            href={v.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0 text-accent hover:underline"
                          >
                            Download
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">No versions recorded.</p>
                )}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Document not found.</p>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(v) => !v && setDeleteTarget(null)}
        title="Mark document obsolete?"
        description="The document will be marked obsolete; it is not permanently removed."
        confirmLabel="Mark obsolete"
        destructive
        onConfirm={async () => {
          if (deleteTarget) await deleteMutation.mutateAsync(deleteTarget);
        }}
      />
    </div>
  );
}
