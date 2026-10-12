import { useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Check, ChevronRight, ExternalLink, FileQuestion, Plus, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge, statusVariant } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { LoadingBlock } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, apiError, resources } from '@/lib/api';
import { fmtDate, fmtDateTime, STATUS_LABELS, titleCase, toInputDate } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

// --- Types ------------------------------------------------------------------

type CapaStatus =
  | 'PENDING'
  | 'ACKNOWLEDGED'
  | 'IN_PROGRESS'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'VERIFIED'
  | 'CLOSED';

interface CapaUser {
  id: string;
  name: string;
  role?: string;
}

interface CapaWhy {
  id?: string;
  level: number;
  question: string;
  answer: string;
}

interface CapaAction {
  id?: string;
  description: string;
  responsible?: string | null;
  dueDate?: string | null;
  status: string;
}

interface CapaFinding {
  id: string;
  code: string;
  title: string;
  type: string;
  severity: string;
  observation: string;
  requirement?: string | null;
  status: string;
  department?: { id?: string; name: string } | null;
  clause?: { number: string; title: string } | null;
  audit?: { id: string; code: string; title: string } | null;
}

interface CapaAttachment {
  id: string;
  originalName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  createdAt: string;
}

interface Capa {
  id: string;
  status: CapaStatus;
  acknowledgedAt?: string | null;
  acknowledgedBy?: string | null;
  immediateCorrection?: string | null;
  correctionDate?: string | null;
  rootCauseMethod?: 'FIVE_WHY' | 'FISHBONE' | null;
  rootCause?: string | null;
  fishboneJson?: unknown;
  targetDate?: string | null;
  responsibleId?: string | null;
  responsible?: CapaUser | null;
  submittedAt?: string | null;
  acceptedAt?: string | null;
  acceptedBy?: string | null;
  rejectionReason?: string | null;
  verificationMethod?: string | null;
  verificationNotes?: string | null;
  effectivenessResult?: string | null;
  verifiedAt?: string | null;
  verifiedBy?: { name: string } | null;
  closedAt?: string | null;
  createdAt?: string;
  finding: CapaFinding;
  actions: CapaAction[];
  whys: CapaWhy[];
  attachments: CapaAttachment[];
}

interface ResponseBody {
  immediateCorrection?: string | null;
  correctionDate?: string | null;
  rootCauseMethod?: 'FIVE_WHY' | 'FISHBONE';
  rootCause?: string | null;
  fishboneJson?: unknown;
  targetDate?: string | null;
  responsibleId?: string | null;
  whys?: { level: number; question: string; answer: string }[];
  actions?: { description: string; responsible?: string | null; dueDate?: string | null; status?: string }[];
}

interface MutateVars {
  path: string;
  method?: 'post' | 'put' | 'delete';
  body?: unknown;
  success: string;
}

interface VerifyBody {
  verificationMethod?: string | null;
  verificationNotes?: string | null;
  effectivenessResult?: string | null;
  pass: boolean;
}

// --- Constants & helpers ----------------------------------------------------

const STAGES = [
  { key: 'ack', label: 'Acknowledgement' },
  { key: 'correction', label: 'Correction' },
  { key: 'rootcause', label: 'Root Cause' },
  { key: 'action', label: 'Action Plan' },
  { key: 'submit', label: 'Submit' },
  { key: 'review', label: 'Review' },
  { key: 'verify', label: 'Verification' },
  { key: 'close', label: 'Closure' },
] as const;

const FISHBONE_CATEGORIES = ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'] as const;

const ACTION_STATUSES = ['OPEN', 'IN_PROGRESS', 'DONE'] as const;

function currentStageIndex(capa: Capa): number {
  switch (capa.status) {
    case 'CLOSED':
    case 'VERIFIED':
      return 7;
    case 'ACCEPTED':
      return 6;
    case 'SUBMITTED':
      return 5;
    case 'REJECTED':
      return 3;
    case 'ACKNOWLEDGED':
    case 'IN_PROGRESS':
      if (capa.actions.length > 0) return 4;
      if (capa.rootCause || capa.fishboneJson) return 3;
      return 1;
    default:
      return 0;
  }
}

function parseFishbone(value: unknown): Record<string, string> {
  const result: Record<string, string> = {};
  FISHBONE_CATEGORIES.forEach((category) => {
    result[category] = '';
  });
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const source = value as Record<string, unknown>;
    FISHBONE_CATEGORIES.forEach((category) => {
      const entry = source[category];
      if (typeof entry === 'string') result[category] = entry;
    });
  }
  return result;
}

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? titleCase(status);
}

// --- Small presentational pieces -------------------------------------------

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Stepper({ current }: { current: number }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {STAGES.map((stage, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <div key={stage.key} className="flex items-center gap-2">
            <div
              className={cn(
                'flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium',
                done && 'border-emerald-600 bg-emerald-600 text-white',
                active && 'border-primary bg-primary text-primary-foreground',
                !done && !active && 'border-border bg-card text-muted-foreground',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </div>
            <span className={cn('text-xs', active ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
              {stage.label}
            </span>
            {index < STAGES.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          </div>
        );
      })}
    </div>
  );
}

// --- Section components -----------------------------------------------------

interface SectionProps {
  capa: Capa;
  editable: boolean;
  busy: boolean;
  onSave: (body: ResponseBody, success: string) => void;
}

function CorrectionCard({ capa, editable, busy, onSave }: SectionProps) {
  const [text, setText] = useState(capa.immediateCorrection ?? '');
  const [date, setDate] = useState(toInputDate(capa.correctionDate));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Immediate Correction</CardTitle>
        <CardDescription>Containment action taken to address the nonconformity.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {editable ? (
          <>
            <div className="space-y-1.5">
              <Label>Correction description</Label>
              <Textarea
                rows={4}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Describe the immediate containment or correction..."
              />
            </div>
            <div className="space-y-1.5 sm:max-w-xs">
              <Label>Correction date</Label>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </div>
            <Button
              disabled={busy}
              onClick={() =>
                onSave(
                  { immediateCorrection: text.trim(), correctionDate: date || null },
                  'Correction saved',
                )
              }
            >
              Save correction
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <Detail
              label="Correction"
              value={
                capa.immediateCorrection ? (
                  <span className="whitespace-pre-wrap font-normal">{capa.immediateCorrection}</span>
                ) : (
                  '-'
                )
              }
            />
            <Detail label="Date" value={fmtDate(capa.correctionDate)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

interface WhyField {
  level: number;
  question: string;
  answer: string;
}

function RootCauseCard({ capa, editable, busy, onSave }: SectionProps) {
  const [method, setMethod] = useState<'FIVE_WHY' | 'FISHBONE'>(
    capa.rootCauseMethod === 'FISHBONE' ? 'FISHBONE' : 'FIVE_WHY',
  );
  const [fishbone, setFishbone] = useState<Record<string, string>>(() => parseFishbone(capa.fishboneJson));

  const whyForm = useForm<{ rootCause: string; whys: WhyField[] }>({
    defaultValues: {
      rootCause: capa.rootCause ?? '',
      whys:
        capa.whys.length > 0
          ? capa.whys.map((why) => ({ level: why.level, question: why.question, answer: why.answer }))
          : [{ level: 1, question: 'Why did the issue occur?', answer: '' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: whyForm.control, name: 'whys' });

  const fishForm = useForm<{ rootCause: string }>({ defaultValues: { rootCause: capa.rootCause ?? '' } });

  const saveFiveWhy = whyForm.handleSubmit((values) => {
    const answered = values.whys
      .map((why) => ({ question: why.question.trim(), answer: why.answer.trim() }))
      .filter((why) => why.answer.length > 0);
    onSave(
      {
        rootCauseMethod: 'FIVE_WHY',
        rootCause: values.rootCause.trim(),
        whys: answered.map((why, index) => ({
          level: index + 1,
          question: why.question || `Why ${index + 1}?`,
          answer: why.answer,
        })),
      },
      'Root cause saved',
    );
  });

  const saveFishbone = fishForm.handleSubmit((values) => {
    const cleaned: Record<string, string> = {};
    FISHBONE_CATEGORIES.forEach((category) => {
      const entry = fishbone[category]?.trim();
      if (entry) cleaned[category] = entry;
    });
    onSave(
      { rootCauseMethod: 'FISHBONE', rootCause: values.rootCause.trim(), fishboneJson: cleaned },
      'Fishbone analysis saved',
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Root Cause Analysis</CardTitle>
        <CardDescription>Investigate why the nonconformity occurred using 5 Why or Fishbone.</CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs value={method} onValueChange={(value) => setMethod(value as 'FIVE_WHY' | 'FISHBONE')}>
          <TabsList>
            <TabsTrigger value="FIVE_WHY">5 Why</TabsTrigger>
            <TabsTrigger value="FISHBONE">Fishbone</TabsTrigger>
          </TabsList>

          <TabsContent value="FIVE_WHY" className="space-y-4">
            <div className="space-y-3">
              {fields.map((field, index) => (
                <div key={field.id} className="flex items-start gap-3">
                  <span className="mt-2 w-14 shrink-0 text-xs text-muted-foreground">Why {index + 1}</span>
                  <div className="flex-1 space-y-2">
                    <Input
                      placeholder="Question"
                      disabled={!editable}
                      {...whyForm.register(`whys.${index}.question`)}
                    />
                    <Textarea
                      rows={2}
                      placeholder="Answer"
                      disabled={!editable}
                      {...whyForm.register(`whys.${index}.answer`)}
                    />
                  </div>
                  {editable && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={fields.length <= 1}
                      onClick={() => remove(index)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Root cause statement</Label>
              <Textarea
                rows={3}
                placeholder="Summarise the verified root cause..."
                disabled={!editable}
                {...whyForm.register('rootCause')}
              />
            </div>
            {editable && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ level: fields.length + 1, question: `Why ${fields.length + 1}?`, answer: '' })}
                >
                  <Plus className="h-4 w-4" /> Add why
                </Button>
                <Button type="button" disabled={busy} onClick={saveFiveWhy}>
                  Save root cause
                </Button>
              </div>
            )}
          </TabsContent>

          <TabsContent value="FISHBONE" className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {FISHBONE_CATEGORIES.map((category) => (
                <div key={category} className="space-y-1.5">
                  <Label>{category}</Label>
                  <Textarea
                    rows={2}
                    placeholder={`${category} factors`}
                    disabled={!editable}
                    value={fishbone[category] ?? ''}
                    onChange={(event) => setFishbone((prev) => ({ ...prev, [category]: event.target.value }))}
                  />
                </div>
              ))}
            </div>
            <div className="space-y-1.5">
              <Label>Root cause statement</Label>
              <Textarea
                rows={3}
                placeholder="Summarise the verified root cause..."
                disabled={!editable}
                {...fishForm.register('rootCause')}
              />
            </div>
            {editable && (
              <Button type="button" disabled={busy} onClick={saveFishbone}>
                Save fishbone analysis
              </Button>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

interface ActionPlanProps extends SectionProps {
  users: CapaUser[];
}

interface ActionField {
  description: string;
  responsible: string;
  dueDate: string;
  status: string;
}

function ActionPlanCard({ capa, users, editable, busy, onSave }: ActionPlanProps) {
  const form = useForm<{ targetDate: string; responsibleId: string; actions: ActionField[] }>({
    defaultValues: {
      targetDate: toInputDate(capa.targetDate),
      responsibleId: capa.responsibleId ?? '',
      actions:
        capa.actions.length > 0
          ? capa.actions.map((action) => ({
              description: action.description,
              responsible: action.responsible ?? '',
              dueDate: toInputDate(action.dueDate),
              status: action.status,
            }))
          : [{ description: '', responsible: '', dueDate: '', status: 'OPEN' }],
    },
  });
  const { fields, append, remove } = useFieldArray({ control: form.control, name: 'actions' });

  const save = form.handleSubmit((values) => {
    const actions = values.actions
      .map((action) => ({
        description: action.description.trim(),
        responsible: action.responsible.trim() || null,
        dueDate: action.dueDate || null,
        status: action.status,
      }))
      .filter((action) => action.description.length >= 2);
    onSave(
      {
        targetDate: values.targetDate || null,
        responsibleId: values.responsibleId || null,
        actions,
      },
      'Action plan saved',
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Action Plan</CardTitle>
        <CardDescription>Corrective and preventive actions, owners and target dates.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Target date</Label>
            <Input type="date" disabled={!editable} {...form.register('targetDate')} />
          </div>
          <div className="space-y-1.5">
            <Label>Responsible person</Label>
            <Controller
              control={form.control}
              name="responsibleId"
              render={({ field }) => (
                <Select
                  value={field.value || 'NONE'}
                  onValueChange={(value) => field.onChange(value === 'NONE' ? '' : value)}
                  disabled={!editable}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select person" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">Unassigned</SelectItem>
                    {users.map((user) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name}
                        {user.role ? ` (${user.role})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
        </div>

        <Separator />

        <div className="space-y-3">
          {fields.map((field, index) => (
            <div key={field.id} className="space-y-3 rounded-md border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Action {index + 1}
                </span>
                {editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={fields.length <= 1}
                    onClick={() => remove(index)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
              <Textarea
                rows={2}
                placeholder="Action description"
                disabled={!editable}
                {...form.register(`actions.${index}.description`)}
              />
              <div className="grid gap-3 sm:grid-cols-3">
                <Input
                  placeholder="Responsible"
                  disabled={!editable}
                  {...form.register(`actions.${index}.responsible`)}
                />
                <Input type="date" disabled={!editable} {...form.register(`actions.${index}.dueDate`)} />
                <select
                  disabled={!editable}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                  {...form.register(`actions.${index}.status`)}
                >
                  {ACTION_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value)}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
        </div>

        {editable && (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => append({ description: '', responsible: '', dueDate: '', status: 'OPEN' })}
            >
              <Plus className="h-4 w-4" /> Add action
            </Button>
            <Button type="button" disabled={busy} onClick={save}>
              Save action plan
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewCard({
  capa,
  canSubmit,
  busy,
  onSubmit,
}: {
  capa: Capa;
  canSubmit: boolean;
  busy: boolean;
  onSubmit: () => void;
}) {
  const requirementsMet = !!capa.rootCause && capa.actions.length > 0;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Review & Submit</CardTitle>
        <CardDescription>Confirm the response before submitting it for auditor review.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Detail label="Root cause" value={capa.rootCause ?? '-'} />
          <Detail label="Method" value={capa.rootCauseMethod ? statusLabel(capa.rootCauseMethod) : '-'} />
          <Detail label="Target date" value={fmtDate(capa.targetDate)} />
          <Detail label="Responsible" value={capa.responsible?.name ?? '-'} />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Actions</p>
          {capa.actions.length > 0 ? (
            <ul className="space-y-1 text-sm">
              {capa.actions.map((action, index) => (
                <li key={action.id ?? index} className="flex items-center justify-between gap-3">
                  <span>{action.description}</span>
                  <Badge variant={statusVariant(action.status)}>{statusLabel(action.status)}</Badge>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No actions recorded yet.</p>
          )}
        </div>
        {capa.submittedAt && <Detail label="Submitted" value={fmtDateTime(capa.submittedAt)} />}
        {capa.acceptedBy && (
          <Detail label="Accepted by" value={`${capa.acceptedBy} - ${fmtDateTime(capa.acceptedAt)}`} />
        )}
        {capa.rejectionReason && (
          <Detail
            label="Rejection reason"
            value={<span className="font-normal text-destructive">{capa.rejectionReason}</span>}
          />
        )}
        {canSubmit && (
          <div className="space-y-2">
            <Button disabled={busy} onClick={onSubmit}>
              Submit for Review
            </Button>
            {!requirementsMet && (
              <p className="text-xs text-muted-foreground">
                A root cause and at least one action are required before submission.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function DecisionCard({
  capa,
  busy,
  onAccept,
  onReject,
}: {
  capa: Capa;
  busy: boolean;
  onAccept: () => void;
  onReject: (reason: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Auditor Decision</CardTitle>
        <CardDescription>Accept the action plan or reject it with a reason.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {capa.status === 'SUBMITTED' ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="accent" disabled={busy} onClick={onAccept}>
              Accept
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => setOpen(true)}>
              Reject
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <Detail label="Decision" value={statusLabel(capa.status)} />
            {capa.acceptedBy && (
              <Detail label="Accepted by" value={`${capa.acceptedBy} - ${fmtDateTime(capa.acceptedAt)}`} />
            )}
            {capa.rejectionReason && <Detail label="Rejection reason" value={capa.rejectionReason} />}
          </div>
        )}
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject action plan</DialogTitle>
            <DialogDescription>Provide a reason so the auditee can revise the response.</DialogDescription>
          </DialogHeader>
          <Textarea
            rows={4}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Reason for rejection..."
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={busy || reason.trim().length < 3}
              onClick={() => {
                onReject(reason.trim());
                setOpen(false);
                setReason('');
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function VerificationCard({
  capa,
  canVerify,
  canClose,
  busy,
  onVerify,
  onClose,
}: {
  capa: Capa;
  canVerify: boolean;
  canClose: boolean;
  busy: boolean;
  onVerify: (body: VerifyBody, success: string) => void;
  onClose: () => void;
}) {
  const form = useForm<{
    verificationMethod: string;
    verificationNotes: string;
    effectivenessResult: string;
    pass: 'pass' | 'fail';
  }>({
    defaultValues: {
      verificationMethod: capa.verificationMethod ?? '',
      verificationNotes: capa.verificationNotes ?? '',
      effectivenessResult: capa.effectivenessResult ?? '',
      pass: 'pass',
    },
  });

  const submit = form.handleSubmit((values) => {
    onVerify(
      {
        verificationMethod: values.verificationMethod.trim(),
        verificationNotes: values.verificationNotes.trim(),
        effectivenessResult: values.effectivenessResult.trim(),
        pass: values.pass === 'pass',
      },
      values.pass === 'pass' ? 'Effectiveness verified' : 'Verification recorded as failed',
    );
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Effectiveness Verification</CardTitle>
        <CardDescription>Confirm the corrective action eliminated the nonconformity.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {canVerify ? (
          <>
            <div className="space-y-1.5">
              <Label>Verification method</Label>
              <Input placeholder="e.g. Follow-up audit, sampling" {...form.register('verificationMethod')} />
            </div>
            <div className="space-y-1.5">
              <Label>Verification notes</Label>
              <Textarea rows={3} {...form.register('verificationNotes')} />
            </div>
            <div className="space-y-1.5">
              <Label>Effectiveness result</Label>
              <Textarea rows={2} {...form.register('effectivenessResult')} />
            </div>
            <div className="flex gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="pass" {...form.register('pass')} /> Pass
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" value="fail" {...form.register('pass')} /> Fail
              </label>
            </div>
            <Button disabled={busy} onClick={submit}>
              Record verification
            </Button>
          </>
        ) : (
          <div className="space-y-3">
            <Detail label="Method" value={capa.verificationMethod ?? '-'} />
            <Detail label="Notes" value={capa.verificationNotes ?? '-'} />
            <Detail label="Result" value={capa.effectivenessResult ?? '-'} />
            {capa.verifiedBy && (
              <Detail label="Verified by" value={`${capa.verifiedBy.name} - ${fmtDateTime(capa.verifiedAt)}`} />
            )}
            {canClose && (
              <Button disabled={busy} onClick={onClose}>
                Close CAPA
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function AttachmentsCard({
  attachments,
  busy,
  onUpload,
  onDelete,
}: {
  attachments: CapaAttachment[];
  busy: boolean;
  onUpload: (file: File) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Attachments</CardTitle>
        <CardDescription>Evidence and supporting documents for this CAPA.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5 sm:max-w-sm">
          <Label>Add attachment</Label>
          <Input
            type="file"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) onUpload(file);
              event.target.value = '';
            }}
          />
        </div>
        {attachments.length > 0 ? (
          <ul className="divide-y divide-border">
            {attachments.map((attachment) => (
              <li key={attachment.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <a
                    href={attachment.fileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {attachment.originalName}
                  </a>
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(attachment.fileSize)} - {fmtDateTime(attachment.createdAt)}
                  </p>
                </div>
                <Button variant="ghost" size="icon" disabled={busy} onClick={() => onDelete(attachment.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No attachments yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

// --- Page -------------------------------------------------------------------

export function CapaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuth((state) => state.can);

  const { data: capa, isLoading } = useQuery({
    queryKey: ['capa', id],
    queryFn: () => resources.get<Capa>(`/capas/${id}`),
    enabled: !!id,
  });

  const { data: usersData } = useQuery({
    queryKey: ['capa-users'],
    queryFn: () => resources.list<CapaUser>('/people/users', { pageSize: 200 }),
    retry: false,
  });

  const { data: attachments } = useQuery({
    queryKey: ['capa-attachments', id],
    queryFn: () => resources.all<CapaAttachment>('/attachments', { entityType: 'CAPA', entityId: id }),
    enabled: !!id,
  });

  const mutation = useMutation({
    mutationFn: (vars: MutateVars) => {
      if (vars.method === 'put') return api.put(vars.path, vars.body);
      if (vars.method === 'delete') return api.delete(vars.path);
      return api.post(vars.path, vars.body);
    },
    onSuccess: (_data, vars) => {
      toast.success(vars.success);
      queryClient.invalidateQueries({ queryKey: ['capa', id] });
      queryClient.invalidateQueries({ queryKey: ['capa-attachments', id] });
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      form.append('entityType', 'CAPA');
      form.append('entityId', String(id));
      await api.post('/attachments', form);
    },
    onSuccess: () => {
      toast.success('Attachment uploaded');
      queryClient.invalidateQueries({ queryKey: ['capa-attachments', id] });
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const action = (path: string, success: string, body?: unknown, method: MutateVars['method'] = 'post') =>
    mutation.mutate({ path, method, body, success });

  const busy = mutation.isPending || uploadMutation.isPending;

  const canRespond = can('capa.respond');
  const isAuditor = can('capa.review');
  const canCloseRole = can('capa.close');

  if (isLoading || !capa) {
    return (
      <div className="space-y-5">
        <PageHeader title="CAPA" />
        {isLoading ? (
          <LoadingBlock />
        ) : (
          <EmptyState
            icon={FileQuestion}
            title="CAPA not found"
            description="This corrective action may have been removed or you may not have access to it."
          />
        )}
      </div>
    );
  }

  const finding = capa.finding;
  const users = usersData?.items ?? [];
  const editable = canRespond && ['PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REJECTED'].includes(capa.status);
  const canSubmit =
    canRespond && ['PENDING', 'ACKNOWLEDGED', 'IN_PROGRESS', 'REJECTED'].includes(capa.status);
  const canDecide = isAuditor && capa.status === 'SUBMITTED';
  const canVerify = isAuditor && ['ACCEPTED', 'SUBMITTED'].includes(capa.status);
  const canClose = canCloseRole && capa.status === 'VERIFIED';

  const saveResponse = (body: ResponseBody, success: string) =>
    action(`/capas/${id}/response`, success, body, 'put');

  return (
    <div className="space-y-5">
      <PageHeader
        title={`CAPA - ${finding.code}`}
        description={finding.title}
        actions={
          <>
            <Badge variant={statusVariant(capa.status)}>{statusLabel(capa.status)}</Badge>
            <Button variant="outline" size="sm" onClick={() => navigate(`/findings/${finding.id}`)}>
              <ExternalLink className="h-4 w-4" /> Finding
            </Button>
            {finding.audit && (
              <Button variant="outline" size="sm" onClick={() => navigate(`/audits/${finding.audit!.id}`)}>
                <ExternalLink className="h-4 w-4" /> {finding.audit.code}
              </Button>
            )}
          </>
        }
      />

      <Card>
        <CardContent className="py-4">
          <Stepper current={currentStageIndex(capa)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>NC Acknowledgement</CardTitle>
          <CardDescription>The nonconformity raised by the auditor.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Detail label="Finding" value={`${finding.code} - ${finding.title}`} />
          <Detail
            label="Observation"
            value={<span className="whitespace-pre-wrap font-normal">{finding.observation || '-'}</span>}
          />
          {finding.clause && (
            <Detail label="Requirement (Clause)" value={`${finding.clause.number} ${finding.clause.title}`} />
          )}
          {capa.status === 'PENDING' ? (
            canRespond ? (
              <Button disabled={busy} onClick={() => action(`/capas/${id}/acknowledge`, 'CAPA acknowledged')}>
                Acknowledge
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">Awaiting acknowledgement by the responsible department.</p>
            )
          ) : (
            <Detail
              label="Acknowledged"
              value={`${capa.acknowledgedBy ?? '-'} - ${fmtDateTime(capa.acknowledgedAt)}`}
            />
          )}
        </CardContent>
      </Card>

      <CorrectionCard capa={capa} editable={editable} busy={busy} onSave={saveResponse} />
      <RootCauseCard capa={capa} editable={editable} busy={busy} onSave={saveResponse} />
      <ActionPlanCard capa={capa} users={users} editable={editable} busy={busy} onSave={saveResponse} />
      <ReviewCard
        capa={capa}
        canSubmit={canSubmit}
        busy={busy}
        onSubmit={() => action(`/capas/${id}/submit`, 'Submitted for review')}
      />

      {isAuditor && canDecide && (
        <DecisionCard
          capa={capa}
          busy={busy}
          onAccept={() => action(`/capas/${id}/accept`, 'CAPA plan accepted')}
          onReject={(reason) => action(`/capas/${id}/reject`, 'CAPA rejected', { reason })}
        />
      )}

      {['SUBMITTED', 'ACCEPTED', 'VERIFIED', 'CLOSED'].includes(capa.status) && (
        <VerificationCard
          capa={capa}
          canVerify={canVerify}
          canClose={canClose}
          busy={busy}
          onVerify={(body, success) => action(`/capas/${id}/verify`, success, body)}
          onClose={() => action(`/capas/${id}/close`, 'CAPA closed')}
        />
      )}

      <AttachmentsCard
        attachments={attachments ?? []}
        busy={uploadMutation.isPending}
        onUpload={(file) => uploadMutation.mutate(file)}
        onDelete={(attachmentId) =>
          action(`/attachments/${attachmentId}`, 'Attachment removed', undefined, 'delete')
        }
      />
    </div>
  );
}
