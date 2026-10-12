import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { CheckCircle2, Download, ExternalLink, Pencil, Play, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LoadingBlock } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { api, apiError, resources } from '@/lib/api';
import { fmtDate, STATUS_LABELS, titleCase } from '@/lib/format';
import { useAuth } from '@/store/auth';

interface AuditPersonRef {
  id: string;
  name: string;
  type?: string;
  competencyLevel?: string;
}

interface AuditTeamMember {
  id: string;
  isLead: boolean;
  auditor: AuditPersonRef;
}

interface AuditClauseLink {
  clause: { id: string; number: string; title: string; parentId?: string | null };
}

interface AuditScheduleItem {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  clause?: { id: string; number: string; title: string } | null;
  auditor?: { id: string; name: string } | null;
}

interface AuditDetail {
  id: string;
  code: string;
  title: string;
  category: string;
  status: string;
  scope?: string | null;
  objectives?: string | null;
  criteria?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  actualStart?: string | null;
  actualEnd?: string | null;
  tags?: string[] | null;
  standard?: { id: string; name: string; code?: string; version?: string } | null;
  auditType?: { id: string; name: string; category?: string } | null;
  program?: { id: string; name: string; code?: string; year?: number } | null;
  plant?: { id: string; name: string; code?: string } | null;
  department?: { id: string; name: string; code?: string } | null;
  team?: AuditTeamMember[];
  clauses?: AuditClauseLink[];
  scheduleItems?: AuditScheduleItem[];
  _count?: { findings?: number; responses?: number };
}

interface FindingRow {
  id: string;
  code?: string;
  number?: string;
  title: string;
  description?: string | null;
  status: string;
  findingType?: { id: string; code?: string; name: string } | null;
  severity?: { id: string; code?: string; name: string } | null;
}

const EXECUTION_STATUSES = ['IN_PROGRESS', 'FINDINGS_RECORDED', 'CAPA_IN_PROGRESS', 'VERIFICATION', 'CLOSED'];

export function AuditDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuth((s) => s.can);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectNotes, setRejectNotes] = useState('');

  const { data: audit, isLoading, isError } = useQuery({
    queryKey: ['audit', id],
    queryFn: () => resources.get<AuditDetail>(`/audits/${id}`),
    enabled: !!id,
  });

  const { data: findings, isLoading: findingsLoading } = useQuery({
    queryKey: ['audit-findings', id],
    queryFn: () => resources.all<FindingRow>(`/findings/audit/${id}`),
    enabled: !!id,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['audit', id] });
    queryClient.invalidateQueries({ queryKey: ['audits'] });
  };

  const approveMutation = useMutation({
    mutationFn: () => api.post(`/audits/${id}/approve`, { notes: 'Approved' }),
    onSuccess: () => {
      toast.success('Audit approved');
      refresh();
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const rejectMutation = useMutation({
    mutationFn: () => api.post(`/audits/${id}/reject`, { notes: rejectNotes }),
    onSuccess: () => {
      toast.success('Audit rejected');
      setRejectOpen(false);
      setRejectNotes('');
      refresh();
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const startMutation = useMutation({
    mutationFn: () => api.post(`/audits/${id}/start`),
    onSuccess: () => {
      toast.success('Audit execution started');
      queryClient.invalidateQueries({ queryKey: ['audits'] });
      navigate(`/execution/${id}`);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const downloadSummary = async (format: 'csv' | 'pdf') => {
    try {
      const response = await api.get(`/reports/audit-summary/${id}`, {
        params: { format },
        responseType: 'blob',
      });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `audit-summary-${audit?.code ?? id}.${format}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      toast.error(apiError(error));
    }
  };

  if (isLoading) {
    return <LoadingBlock label="Loading audit..." />;
  }

  if (isError || !audit) {
    return (
      <EmptyState
        title="Audit not found"
        description="The audit could not be loaded, or you do not have access to it."
        action={
          <Button variant="outline" onClick={() => navigate('/audits')}>
            Back to audits
          </Button>
        }
      />
    );
  }

  const canEdit = can('audits.plan') && ['DRAFT', 'PENDING_APPROVAL'].includes(audit.status);
  const isQmr = can('audits.approve');
  const pendingApproval = audit.status === 'PENDING_APPROVAL';

  return (
    <div className="space-y-5">
      <PageHeader
        title={audit.title}
        description={`${audit.code}${audit.standard ? ' - ' + audit.standard.name : ''}`}
        actions={
          <>
            <Badge variant={statusVariant(audit.status)}>{STATUS_LABELS[audit.status] ?? titleCase(audit.status)}</Badge>
            <Badge variant="accent">{titleCase(audit.category)}</Badge>

            {canEdit && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/audits/${audit.id}/edit`}>
                  <Pencil className="h-4 w-4" /> Edit
                </Link>
              </Button>
            )}

            {isQmr && pendingApproval && (
              <>
                <Button size="sm" onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending}>
                  <CheckCircle2 className="h-4 w-4" /> Approve
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => setRejectOpen(true)}
                  disabled={rejectMutation.isPending}
                >
                  <XCircle className="h-4 w-4" /> Reject
                </Button>
              </>
            )}

            {audit.status === 'APPROVED' && (
              <Button size="sm" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>
                <Play className="h-4 w-4" /> Start Execution
              </Button>
            )}

            {EXECUTION_STATUSES.includes(audit.status) && (
              <Button variant="outline" size="sm" asChild>
                <Link to={`/execution/${audit.id}`}>
                  <ExternalLink className="h-4 w-4" /> Open Execution
                </Link>
              </Button>
            )}

            <Button variant="outline" size="sm" onClick={() => downloadSummary('pdf')}>
              <Download className="h-4 w-4" /> PDF
            </Button>
            <Button variant="outline" size="sm" onClick={() => downloadSummary('csv')}>
              <Download className="h-4 w-4" /> CSV
            </Button>
          </>
        }
      />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="clauses">Clauses</TabsTrigger>
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="findings">Findings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview">
          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Planning</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <DetailRow label="Standard" value={audit.standard ? `${audit.standard.name}${audit.standard.version ? ' (' + audit.standard.version + ')' : ''}` : '-'} />
                <DetailRow label="Audit type" value={audit.auditType?.name ?? '-'} />
                <DetailRow label="Programme" value={audit.program ? `${audit.program.name}${audit.program.year ? ' - ' + audit.program.year : ''}` : '-'} />
                <DetailRow label="Plant" value={audit.plant?.name ?? '-'} />
                <DetailRow label="Department" value={audit.department?.name ?? '-'} />
                <DetailRow label="Planned start" value={fmtDate(audit.plannedStart)} />
                <DetailRow label="Planned end" value={fmtDate(audit.plannedEnd)} />
                <DetailRow label="Actual start" value={fmtDate(audit.actualStart)} />
                <DetailRow label="Actual end" value={fmtDate(audit.actualEnd)} />
                {audit.tags && audit.tags.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    {audit.tags.map((tag) => (
                      <Badge key={tag} variant="secondary">
                        {tag}
                      </Badge>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Scope</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <TextBlock label="Scope" value={audit.scope} />
                <TextBlock label="Objectives" value={audit.objectives} />
                <TextBlock label="Criteria" value={audit.criteria} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="team">
          <Card>
            <CardHeader>
              <CardTitle>Audit team</CardTitle>
            </CardHeader>
            <CardContent>
              {!audit.team || audit.team.length === 0 ? (
                <EmptyState title="No auditors assigned" description="Assign a team from the audit planner." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Competency</TableHead>
                      <TableHead>Role</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.team.map((member) => (
                      <TableRow key={member.id}>
                        <TableCell className="font-medium">{member.auditor.name}</TableCell>
                        <TableCell>{member.auditor.type ? titleCase(member.auditor.type) : '-'}</TableCell>
                        <TableCell>{member.auditor.competencyLevel ? titleCase(member.auditor.competencyLevel) : '-'}</TableCell>
                        <TableCell>
                          {member.isLead ? <Badge variant="accent">Lead</Badge> : <Badge variant="secondary">Auditor</Badge>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="clauses">
          <Card>
            <CardHeader>
              <CardTitle>Clauses ({audit.clauses?.length ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {!audit.clauses || audit.clauses.length === 0 ? (
                <EmptyState title="No clauses selected" description="Select checklist clauses from the audit planner." />
              ) : (
                <ul className="divide-y divide-border text-sm">
                  {audit.clauses.map((link) => (
                    <li key={link.clause.id} className="flex items-start gap-3 py-2">
                      <span className="w-20 shrink-0 font-medium text-muted-foreground">{link.clause.number}</span>
                      <span>{link.clause.title}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="schedule">
          <Card>
            <CardHeader>
              <CardTitle>Schedule</CardTitle>
            </CardHeader>
            <CardContent>
              {!audit.scheduleItems || audit.scheduleItems.length === 0 ? (
                <EmptyState title="No schedule items" description="Add audit sessions in the planner." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Time</TableHead>
                      <TableHead>Clause</TableHead>
                      <TableHead>Auditor</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {audit.scheduleItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>{fmtDate(item.date)}</TableCell>
                        <TableCell>
                          {item.startTime} - {item.endTime}
                        </TableCell>
                        <TableCell>{item.clause ? `${item.clause.number} ${item.clause.title}` : '-'}</TableCell>
                        <TableCell>{item.auditor?.name ?? '-'}</TableCell>
                        <TableCell>{item.notes ?? '-'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="findings">
          <Card>
            <CardHeader>
              <CardTitle>Findings ({findings?.length ?? audit._count?.findings ?? 0})</CardTitle>
            </CardHeader>
            <CardContent>
              {findingsLoading ? (
                <LoadingBlock label="Loading findings..." />
              ) : !findings || findings.length === 0 ? (
                <EmptyState title="No findings recorded" description="Findings raised during execution will appear here." />
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Code</TableHead>
                      <TableHead>Title</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Severity</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {findings.map((finding) => (
                      <TableRow key={finding.id}>
                        <TableCell className="font-medium">{finding.code ?? finding.number ?? '-'}</TableCell>
                        <TableCell>{finding.title}</TableCell>
                        <TableCell>{finding.findingType?.code ?? finding.findingType?.name ?? '-'}</TableCell>
                        <TableCell>
                          {finding.severity ? (
                            <Badge variant={statusVariant(finding.severity.code ?? finding.severity.name)}>
                              {finding.severity.name}
                            </Badge>
                          ) : (
                            '-'
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={statusVariant(finding.status)}>
                            {STATUS_LABELS[finding.status] ?? titleCase(finding.status)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button variant="link" size="sm" asChild>
                            <Link to={`/findings/${finding.id}`}>View</Link>
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject audit</DialogTitle>
            <DialogDescription>Provide a reason for rejecting this audit plan.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="reject-notes">Notes</Label>
            <Textarea
              id="reject-notes"
              value={rejectNotes}
              onChange={(event) => setRejectNotes(event.target.value)}
              placeholder="Explain what needs to change..."
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejectOpen(false)} disabled={rejectMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => rejectMutation.mutate()}
              disabled={rejectMutation.isPending || !rejectNotes.trim()}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

function TextBlock({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="space-y-1">
      <p className="text-muted-foreground">{label}</p>
      <p className="whitespace-pre-wrap">{value || '-'}</p>
    </div>
  );
}
