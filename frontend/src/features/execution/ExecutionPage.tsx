import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CheckCircle2, Circle, Plus, Save } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { ConfirmDialog } from '@/components/common/confirm-dialog';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
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
import { apiError, resources } from '@/lib/api';
import { STATUS_LABELS } from '@/lib/format';
import { cn } from '@/lib/utils';

type Answer = 'YES' | 'NO' | 'NA';
type FindingType = 'C' | 'NC' | 'OFI' | 'NA';
type FindingSeverity = 'MAJOR' | 'MINOR' | 'OBSERVATION';

interface Derived {
  applicable: boolean;
  type: FindingType;
  severity: FindingSeverity | null;
}

interface MatrixRow {
  documented: Answer;
  implemented: Answer;
  result: FindingType;
  severity: FindingSeverity | null;
}

interface ClauseRef {
  id: string;
  number: string;
  title: string;
  description?: string | null;
  requirement?: string | null;
  parentId?: string | null;
  sortOrder?: number | null;
  checklistId?: string | null;
}

interface ExecutionResponse {
  id: string;
  documented: Answer;
  implemented: Answer;
  applicable: boolean;
  comments?: string | null;
  evidence?: string | null;
  answeredAt?: string | null;
}

interface ExecutionClause {
  clause: ClauseRef;
  response: ExecutionResponse | null;
  answered: boolean;
  derived: Derived | null;
}

interface ExecutionData {
  audit: {
    id: string;
    code: string;
    title: string;
    status: string;
    standard?: { name: string } | null;
    department?: { name: string } | null;
    locked?: boolean;
  };
  clauses: ExecutionClause[];
  progress: { total: number; answered: number };
}

function deriveLocal(documented: Answer, implemented: Answer): Derived {
  if (documented === 'NA' || implemented === 'NA') return { applicable: false, type: 'NA', severity: null };
  if (documented === 'YES' && implemented === 'YES') return { applicable: true, type: 'C', severity: null };
  if (documented === 'YES' && implemented === 'NO') return { applicable: true, type: 'NC', severity: 'MINOR' };
  if (documented === 'NO' && implemented === 'YES') return { applicable: true, type: 'OFI', severity: null };
  return { applicable: true, type: 'NC', severity: 'MAJOR' };
}

function derive(documented: Answer, implemented: Answer, matrix: MatrixRow[]): Derived {
  if (documented === 'NA' || implemented === 'NA') return { applicable: false, type: 'NA', severity: null };
  const row = matrix.find((item) => item.documented === documented && item.implemented === implemented);
  if (row) return { applicable: row.result !== 'NA', type: row.result, severity: row.severity ?? null };
  return deriveLocal(documented, implemented);
}

const TYPE_LABEL: Record<FindingType, string> = { C: 'Conformity', NC: 'Nonconformity', OFI: 'OFI', NA: 'Not applicable' };

function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
      <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function Segmented({
  value,
  onChange,
  disabled,
}: {
  value: Answer | '';
  onChange: (value: Answer) => void;
  disabled?: boolean;
}) {
  const options: Answer[] = ['YES', 'NO', 'NA'];
  return (
    <div className="inline-flex rounded-md border border-input p-0.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          disabled={disabled}
          onClick={() => onChange(option)}
          className={cn(
            'min-w-[64px] rounded px-3 py-1.5 text-sm font-medium transition-colors',
            value === option ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-secondary',
            disabled && 'cursor-not-allowed opacity-50',
          )}
        >
          {option === 'NA' ? 'N/A' : option}
        </button>
      ))}
    </div>
  );
}

export function ExecutionPage() {
  const { id: auditId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [documented, setDocumented] = useState<Answer | ''>('');
  const [implemented, setImplemented] = useState<Answer | ''>('');
  const [comments, setComments] = useState('');
  const [evidence, setEvidence] = useState('');
  const [completeOpen, setCompleteOpen] = useState(false);
  const [findingOpen, setFindingOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['execution', auditId],
    queryFn: () => resources.get<ExecutionData>(`/audits/${auditId}/execution`),
    enabled: !!auditId,
  });

  const { data: matrixData } = useQuery({
    queryKey: ['matrix'],
    queryFn: () => resources.all<MatrixRow>('/matrix'),
    staleTime: Infinity,
  });
  const matrix = Array.isArray(matrixData) ? matrixData : [];

  const clauses = useMemo(() => data?.clauses ?? [], [data]);

  const ordered = useMemo(() => {
    const depthOf = (clause: ClauseRef): number => {
      let depth = 0;
      let parent = clause.parentId ?? null;
      while (parent) {
        const found = clauses.find((item) => item.clause.id === parent);
        if (!found) break;
        depth += 1;
        parent = found.clause.parentId ?? null;
      }
      return depth;
    };
    return [...clauses]
      .sort(
        (a, b) =>
          (a.clause.sortOrder ?? 0) - (b.clause.sortOrder ?? 0) ||
          a.clause.number.localeCompare(b.clause.number),
      )
      .map((item) => ({ item, depth: depthOf(item.clause) }));
  }, [clauses]);

  const selected = clauses.find((item) => item.clause.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId && clauses.length > 0) {
      const firstUnanswered = clauses.find((item) => !item.answered);
      setSelectedId((firstUnanswered ?? clauses[0]).clause.id);
    }
  }, [clauses, selectedId]);

  useEffect(() => {
    const response = clauses.find((item) => item.clause.id === selectedId)?.response;
    setDocumented(response?.documented ?? '');
    setImplemented(response?.implemented ?? '');
    setComments(response?.comments ?? '');
    setEvidence(response?.evidence ?? '');
    // Reset the answer form only when the selected clause changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  const preview = useMemo<Derived | null>(() => {
    if (!documented || !implemented) return null;
    return derive(documented, implemented, matrix);
  }, [documented, implemented, matrix]);

  // Execution is editable only while the audit is actually in progress.
  // The planning `locked` flag stays true after approval, so it must not be
  // used here (it would disable the execution form for every started audit).
  const locked = !!data && data.audit.status !== 'IN_PROGRESS';
  const canSave = !!selectedId && !!documented && !!implemented && !locked;

  const saveMutation = useMutation({
    mutationFn: () =>
      resources.update<{ response: ExecutionResponse; derived: Derived }>(
        `/audits/${auditId}/execution/${selectedId}`,
        { documented, implemented, comments: comments || undefined, evidence: evidence || undefined },
      ),
    onSuccess: () => {
      toast.success('Response saved');
      queryClient.invalidateQueries({ queryKey: ['execution', auditId] });
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const completeMutation = useMutation({
    mutationFn: () => resources.create(`/audits/${auditId}/execution/complete`, {}),
    onSuccess: () => {
      toast.success('Execution completed');
      queryClient.invalidateQueries({ queryKey: ['execution', auditId] });
      queryClient.invalidateQueries({ queryKey: ['executions'] });
      navigate(`/findings?auditId=${auditId}`);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  // Create finding form state
  const [fType, setFType] = useState<FindingType>('NC');
  const [fSeverity, setFSeverity] = useState<FindingSeverity>('MINOR');
  const [fTitle, setFTitle] = useState('');
  const [fRequirement, setFRequirement] = useState('');
  const [fObservation, setFObservation] = useState('');
  const [fEvidence, setFEvidence] = useState('');
  const [fDueDate, setFDueDate] = useState('');

  const openFinding = () => {
    if (!selected) return;
    const derived = preview ?? selected.derived;
    setFType(derived?.type ?? 'NC');
    setFSeverity(derived?.severity ?? 'MINOR');
    setFTitle(`${selected.clause.number} ${selected.clause.title}`.trim());
    setFRequirement(selected.clause.requirement ?? '');
    setFObservation(comments || selected.response?.comments || '');
    setFEvidence(evidence || selected.response?.evidence || '');
    setFDueDate('');
    setFindingOpen(true);
  };

  const createFindingMutation = useMutation({
    mutationFn: () =>
      resources.create('/findings', {
        auditId,
        clauseId: selectedId,
        type: fType,
        severity: fType === 'NC' ? fSeverity : undefined,
        title: fTitle,
        requirement: fRequirement || undefined,
        observation: fObservation,
        objectiveEvidence: fEvidence || undefined,
        dueDate: fDueDate ? new Date(fDueDate).toISOString() : undefined,
      }),
    onSuccess: () => {
      toast.success('Finding created');
      queryClient.invalidateQueries({ queryKey: ['findings'] });
      setFindingOpen(false);
    },
    onError: (error) => toast.error(apiError(error)),
  });

  if (isLoading) {
    return <LoadingBlock />;
  }

  if (!data) {
    return (
      <EmptyState
        title="Execution not available"
        description="This audit could not be loaded for execution."
        action={
          <Button variant="outline" onClick={() => navigate('/execution')}>
            <ArrowLeft className="h-4 w-4" /> Back to execution list
          </Button>
        }
      />
    );
  }

  const { audit, progress } = data;
  const allAnswered = progress.total > 0 && progress.answered === progress.total;

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${audit.code} - ${audit.title}`}
        description={[audit.standard?.name, audit.department?.name].filter(Boolean).join(' | ') || undefined}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('/execution')}>
              <ArrowLeft className="h-4 w-4" /> Back
            </Button>
            <Button variant="accent" size="sm" disabled={!allAnswered || locked} onClick={() => setCompleteOpen(true)}>
              <CheckCircle2 className="h-4 w-4" /> Complete Execution
            </Button>
          </div>
        }
      />

      <Card>
        <CardContent className="space-y-3 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Badge variant={statusVariant(audit.status)}>{STATUS_LABELS[audit.status] ?? audit.status}</Badge>
              {locked && <Badge variant="secondary">Locked</Badge>}
            </div>
            <span className="text-sm text-muted-foreground">
              {progress.answered} of {progress.total} clauses answered
            </span>
          </div>
          <ProgressBar value={progress.answered} max={progress.total} />
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        <Card className="lg:sticky lg:top-4 lg:h-[calc(100vh-10rem)]">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Clauses</CardTitle>
          </CardHeader>
          <CardContent className="overflow-auto scrollbar-thin p-2 pt-0">
            {ordered.length === 0 ? (
              <EmptyState title="No clauses" description="This checklist has no clauses." />
            ) : (
              <div className="space-y-1">
                {ordered.map(({ item, depth }) => (
                  <button
                    key={item.clause.id}
                    type="button"
                    onClick={() => setSelectedId(item.clause.id)}
                    style={{ paddingLeft: `${8 + depth * 16}px` }}
                    className={cn(
                      'w-full rounded-md py-2 pr-2 text-left transition-colors',
                      selectedId === item.clause.id ? 'bg-secondary' : 'hover:bg-secondary/60',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{item.clause.number}</span>
                      {item.answered ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                      ) : (
                        <Circle className="h-4 w-4 shrink-0 text-muted-foreground" />
                      )}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{item.clause.title}</div>
                    {item.derived && (
                      <div className="mt-1">
                        <Badge variant={statusVariant(item.derived.type)}>
                          {item.derived.type}
                          {item.derived.severity ? ` ${item.derived.severity}` : ''}
                        </Badge>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          {!selected ? (
            <CardContent className="p-5">
              <EmptyState title="Select a clause" description="Choose a clause from the list to record its response." />
            </CardContent>
          ) : (
            <>
              <CardHeader className="flex-row items-start justify-between gap-3">
                <div className="space-y-1">
                  <CardTitle>
                    {selected.clause.number} - {selected.clause.title}
                  </CardTitle>
                  {selected.clause.requirement && (
                    <p className="text-sm text-muted-foreground">{selected.clause.requirement}</p>
                  )}
                </div>
                <Button size="sm" variant="outline" onClick={openFinding}>
                  <Plus className="h-4 w-4" /> Create Finding
                </Button>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Is it documented?</Label>
                    <div>
                      <Segmented value={documented} onChange={setDocumented} disabled={locked} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Is it implemented?</Label>
                    <div>
                      <Segmented value={implemented} onChange={setImplemented} disabled={locked} />
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border bg-secondary/40 p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Classification preview
                  </p>
                  {preview ? (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant(preview.type)}>
                        {preview.type} - {TYPE_LABEL[preview.type]}
                      </Badge>
                      {preview.severity && <Badge variant={statusVariant(preview.severity)}>{preview.severity}</Badge>}
                      <span className="text-xs text-muted-foreground">
                        Documented {documented} / Implemented {implemented}
                      </span>
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Answer both mandatory fields to preview the derived classification.
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exec-comments">Comments</Label>
                  <Textarea
                    id="exec-comments"
                    value={comments}
                    onChange={(event) => setComments(event.target.value)}
                    placeholder="Observations, notes and context..."
                    disabled={locked}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="exec-evidence">Objective evidence</Label>
                  <Textarea
                    id="exec-evidence"
                    value={evidence}
                    onChange={(event) => setEvidence(event.target.value)}
                    placeholder="Records, documents or samples examined..."
                    disabled={locked}
                  />
                </div>

                <div className="flex justify-end">
                  <Button disabled={!canSave || saveMutation.isPending} onClick={() => saveMutation.mutate()}>
                    <Save className="h-4 w-4" /> Save response
                  </Button>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>

      <Dialog open={findingOpen} onOpenChange={setFindingOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create Finding</DialogTitle>
            <DialogDescription>
              {selected ? `${selected.clause.number} - ${selected.clause.title}` : 'Link a finding to this clause.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={fType} onValueChange={(value) => setFType(value as FindingType)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="C">C - Conformity</SelectItem>
                  <SelectItem value="NC">NC - Nonconformity</SelectItem>
                  <SelectItem value="OFI">OFI - Opportunity for improvement</SelectItem>
                  <SelectItem value="NA">NA - Not applicable</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Severity</Label>
              <Select
                value={fSeverity}
                onValueChange={(value) => setFSeverity(value as FindingSeverity)}
                disabled={fType !== 'NC'}
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
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="finding-title">Title</Label>
              <Input id="finding-title" value={fTitle} onChange={(event) => setFTitle(event.target.value)} />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="finding-requirement">Requirement</Label>
              <Textarea
                id="finding-requirement"
                value={fRequirement}
                onChange={(event) => setFRequirement(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="finding-observation">Observation</Label>
              <Textarea
                id="finding-observation"
                value={fObservation}
                onChange={(event) => setFObservation(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="finding-evidence">Objective evidence</Label>
              <Textarea
                id="finding-evidence"
                value={fEvidence}
                onChange={(event) => setFEvidence(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="finding-due">Due date</Label>
              <Input
                id="finding-due"
                type="date"
                value={fDueDate}
                onChange={(event) => setFDueDate(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFindingOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={!fTitle || !fObservation || createFindingMutation.isPending}
              onClick={() => createFindingMutation.mutate()}
            >
              Create finding
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={completeOpen}
        onOpenChange={setCompleteOpen}
        title="Complete execution?"
        description="All clauses are answered. Completing will lock responses and move the audit to findings recording."
        confirmLabel="Complete"
        onConfirm={async () => {
          await completeMutation.mutateAsync();
        }}
      />
    </div>
  );
}
