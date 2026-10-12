import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Download, FileText, Pencil, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoadingBlock } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { api, apiError, resources } from '@/lib/api';
import { fmtDate, fmtDateTime } from '@/lib/format';
import { useAuth } from '@/store/auth';

type FindingType = 'C' | 'NC' | 'OFI' | 'NA';
type FindingSeverity = 'MAJOR' | 'MINOR' | 'OBSERVATION';

interface Attachment {
  id: string;
  originalName: string;
  fileUrl: string;
  fileSize?: number | null;
  mimeType?: string | null;
  createdAt?: string | null;
}

interface Capa {
  id: string;
  status: string;
  actions?: unknown[];
  whys?: unknown[];
}

interface FindingDetail {
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
  capa?: Capa | null;
  attachments?: Attachment[];
}

const schema = z.object({
  type: z.enum(['C', 'NC', 'OFI', 'NA']),
  severity: z.enum(['MAJOR', 'MINOR', 'OBSERVATION']).optional().or(z.literal('')),
  status: z.enum(['OPEN', 'CLOSED']),
  title: z.string().min(1, 'Title is required'),
  requirement: z.string().optional(),
  observation: z.string().min(1, 'Observation is required'),
  objectiveEvidence: z.string().optional(),
  dueDate: z.string().optional(),
});

type FindingForm = z.infer<typeof schema>;

function formatSize(bytes?: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function FindingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuth((state) => state.can);
  const canEdit = can('findings.manage');
  const canDelete = can('findings.delete');

  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: finding, isLoading } = useQuery({
    queryKey: ['finding', id],
    queryFn: () => resources.get<FindingDetail>(`/findings/${id}`),
    enabled: !!id,
  });

  const { data: attachments } = useQuery({
    queryKey: ['attachments', 'FINDING', id],
    queryFn: () => resources.all<Attachment>('/attachments', { entityType: 'FINDING', entityId: id }),
    enabled: !!id,
  });

  const form = useForm<FindingForm>({ resolver: zodResolver(schema) });

  const openEdit = () => {
    if (!finding) return;
    form.reset({
      type: finding.type,
      severity: finding.severity ?? '',
      status: finding.status === 'CLOSED' ? 'CLOSED' : 'OPEN',
      title: finding.title,
      requirement: finding.requirement ?? '',
      observation: finding.observation ?? '',
      objectiveEvidence: finding.objectiveEvidence ?? '',
      dueDate: finding.dueDate ? String(finding.dueDate).slice(0, 10) : '',
    });
    setEditOpen(true);
  };

  const updateMutation = useMutation({
    mutationFn: (values: FindingForm) =>
      resources.update(`/findings/${id}`, {
        type: values.type,
        severity: values.type === 'NC' ? values.severity || undefined : undefined,
        status: values.status,
        title: values.title,
        requirement: values.requirement || undefined,
        observation: values.observation,
        objectiveEvidence: values.objectiveEvidence || undefined,
        dueDate: values.dueDate ? new Date(values.dueDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success('Finding updated');
      queryClient.invalidateQueries({ queryKey: ['finding', id] });
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      setEditOpen(false);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => resources.remove(`/findings/${id}`),
    onSuccess: () => {
      toast.success('Finding deleted');
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      navigate('/findings');
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const createCapaMutation = useMutation({
    mutationFn: () => resources.create<Capa>(`/capas/findings/${id}`, {}),
    onSuccess: (capa) => {
      toast.success('CAPA created');
      queryClient.invalidateQueries({ queryKey: ['finding', id] });
      if (capa?.id) navigate(`/capa/${capa.id}`);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const uploadMutation = useMutation({
    mutationFn: (file: File) => {
      const body = new FormData();
      body.append('file', file);
      body.append('entityType', 'FINDING');
      body.append('entityId', id ?? '');
      return api.post('/attachments', body).then((response) => response.data);
    },
    onSuccess: () => {
      toast.success('Attachment uploaded');
      queryClient.invalidateQueries({ queryKey: ['attachments', 'FINDING', id] });
    },
    onError: (error) => toast.error(apiError(error)),
    onSettled: () => {
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
  });

  const deleteAttachmentMutation = useMutation({
    mutationFn: (attachmentId: string) => resources.remove(`/attachments/${attachmentId}`),
    onSuccess: () => {
      toast.success('Attachment removed');
      queryClient.invalidateQueries({ queryKey: ['attachments', 'FINDING', id] });
    },
    onError: (error) => toast.error(apiError(error)),
  });

  if (isLoading) {
    return <LoadingBlock />;
  }

  if (!finding) {
    return (
      <EmptyState
        title="Finding not found"
        description="This finding may have been removed."
        action={
          <Button variant="outline" onClick={() => navigate('/findings')}>
            <ArrowLeft className="h-4 w-4" /> Back to findings
          </Button>
        }
      />
    );
  }

  const files = attachments ?? finding.attachments ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" onClick={() => navigate('/findings')} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <h1 className="text-xl font-semibold tracking-tight">
              {finding.code} - {finding.title}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 pl-11">
            <Badge variant={statusVariant(finding.type)}>{finding.type}</Badge>
            {finding.severity && <Badge variant={statusVariant(finding.severity)}>{finding.severity}</Badge>}
            <Badge variant={statusVariant(finding.status)}>{finding.status}</Badge>
            {finding.createdAt && (
              <span className="text-xs text-muted-foreground">Raised {fmtDateTime(finding.createdAt)}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit && (
            <Button variant="outline" size="sm" onClick={openEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" /> Delete
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Requirement" value={finding.requirement} />
            <Field label="Observation" value={finding.observation} />
            <Field label="Objective evidence" value={finding.objectiveEvidence} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <MetaRow label="Audit">
              {finding.audit ? (
                <Link to={`/audits/${finding.audit.id}`} className="text-accent hover:underline">
                  {finding.audit.code} - {finding.audit.title}
                </Link>
              ) : (
                <span className="text-muted-foreground">-</span>
              )}
            </MetaRow>
            <MetaRow label="Department">
              <span>{finding.department?.name ?? '-'}</span>
            </MetaRow>
            <MetaRow label="Clause">
              <span>
                {finding.clause ? `${finding.clause.number} - ${finding.clause.title}` : '-'}
              </span>
            </MetaRow>
            <MetaRow label="Raised by">
              <span>{finding.raisedBy?.name ?? '-'}</span>
            </MetaRow>
            <MetaRow label="Due date">
              <span>{fmtDate(finding.dueDate)}</span>
            </MetaRow>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Corrective Action (CAPA)</CardTitle>
        </CardHeader>
        <CardContent>
          {finding.type !== 'NC' ? (
            <p className="text-sm text-muted-foreground">CAPA applies only to nonconformities.</p>
          ) : finding.capa ? (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Badge variant={statusVariant(finding.capa.status)}>{finding.capa.status}</Badge>
                <span className="text-sm text-muted-foreground">
                  {finding.capa.actions?.length ?? 0} action(s), {finding.capa.whys?.length ?? 0} why step(s)
                </span>
              </div>
              <Button size="sm" variant="outline" asChild>
                <Link to={`/capa/${finding.capa.id}`}>Open CAPA</Link>
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">No CAPA has been raised for this nonconformity.</p>
              {canEdit && (
                <Button size="sm" disabled={createCapaMutation.isPending} onClick={() => createCapaMutation.mutate()}>
                  Create CAPA
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle>Attachments</CardTitle>
          {canEdit && (
            <div>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) uploadMutation.mutate(file);
                }}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={uploadMutation.isPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> Upload
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent>
          {files.length === 0 ? (
            <p className="text-sm text-muted-foreground">No attachments yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {files.map((attachment) => (
                <li key={attachment.id} className="flex items-center justify-between gap-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <a
                      href={attachment.fileUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="truncate text-sm text-accent hover:underline"
                    >
                      {attachment.originalName}
                    </a>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatSize(attachment.fileSize)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="icon" variant="ghost" asChild aria-label="Download">
                      <a href={attachment.fileUrl} target="_blank" rel="noreferrer">
                        <Download className="h-4 w-4" />
                      </a>
                    </Button>
                    {canEdit && (
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label="Remove attachment"
                        disabled={deleteAttachmentMutation.isPending}
                        onClick={() => deleteAttachmentMutation.mutate(attachment.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit Finding</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={form.handleSubmit((values) => updateMutation.mutate(values))}
            className="grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.watch('type')} onValueChange={(value) => form.setValue('type', value as FindingType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="C">C - Conformity</SelectItem>
                  <SelectItem value="NC">NC - Nonconformity</SelectItem>
                  <SelectItem value="OFI">OFI - Improvement</SelectItem>
                  <SelectItem value="NA">NA - Not applicable</SelectItem>
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
                  <SelectItem value="MAJOR">Major</SelectItem>
                  <SelectItem value="MINOR">Minor</SelectItem>
                  <SelectItem value="OBSERVATION">Observation</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={form.watch('status')} onValueChange={(value) => form.setValue('status', value as 'OPEN' | 'CLOSED')}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OPEN">Open</SelectItem>
                  <SelectItem value="CLOSED">Closed</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-due">Due date</Label>
              <Input id="edit-due" type="date" {...form.register('dueDate')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input id="edit-title" {...form.register('title')} />
              {form.formState.errors.title && (
                <p className="text-xs text-destructive">{form.formState.errors.title.message}</p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-requirement">Requirement</Label>
              <Textarea id="edit-requirement" {...form.register('requirement')} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-observation">Observation</Label>
              <Textarea id="edit-observation" {...form.register('observation')} />
              {form.formState.errors.observation && (
                <p className="text-xs text-destructive">{form.formState.errors.observation.message}</p>
              )}
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="edit-evidence">Objective evidence</Label>
              <Textarea id="edit-evidence" {...form.register('objectiveEvidence')} />
            </div>
            <DialogFooter className="sm:col-span-2">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={updateMutation.isPending}>
                Save changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete finding?"
        description="This permanently removes the finding. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => deleteMutation.mutateAsync()}
      />
    </div>
  );
}

function Field({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap text-sm">{value || '-'}</p>
    </div>
  );
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
