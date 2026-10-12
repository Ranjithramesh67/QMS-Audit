import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, ArrowLeft, ArrowRight, Check, ChevronRight, Plus, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { LoadingBlock } from '@/components/ui/spinner';
import { api, apiError, resources } from '@/lib/api';
import { fmtDate, STATUS_LABELS, titleCase, toInputDate } from '@/lib/format';
import { cn } from '@/lib/utils';

const STEPS = [
  'Basic Info',
  'Plant',
  'Category',
  'Scope',
  'Checklist',
  'Review Clauses',
  'Auditors',
  'Schedule',
  'Submit',
];

const CATEGORIES = ['SYSTEM', 'PRODUCT', 'PROCESS'];

interface StandardRef {
  id: string;
  name: string;
  code?: string;
  version?: string;
}

interface NamedRef {
  id: string;
  name: string;
  code?: string;
}

interface ProgramRef {
  id: string;
  name: string;
  code?: string;
  year?: number;
}

interface AuditTypeRef {
  id: string;
  name: string;
  category?: string;
}

interface DepartmentRef {
  id: string;
  name: string;
  code?: string;
  plantId?: string;
}

interface AuditorRef {
  id: string;
  name: string;
  type?: string;
  competencyLevel?: string;
  competencyExpiry?: string | null;
  competentForCategories?: string[];
  user?: { id: string } | null;
}

interface CompetencyAlert {
  auditorId?: string;
  auditor?: { id: string; name: string };
  id?: string;
  name?: string;
  message?: string;
  competencyExpiry?: string;
}

interface ChecklistRef {
  id: string;
  name: string;
  code?: string;
}

interface ClauseNode {
  id: string;
  number: string;
  title: string;
  requirement?: string;
  parentId?: string | null;
  children?: ClauseNode[];
}

interface AuditTeamMember {
  id: string;
  isLead: boolean;
  auditor: { id: string; name: string; type?: string; competencyLevel?: string };
}

interface AuditClauseLink {
  clause: { id: string; number: string; title: string; parentId?: string | null };
}

interface AuditScheduleItem {
  id?: string;
  date: string;
  startTime: string;
  endTime: string;
  notes?: string | null;
  clause?: { id: string; number: string; title: string } | null;
  auditor?: { id: string; name: string } | null;
}

interface AuditFull {
  id: string;
  code: string;
  title: string;
  category: string;
  status: string;
  checklistId?: string | null;
  scope?: string | null;
  objectives?: string | null;
  criteria?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  standard?: StandardRef | null;
  auditType?: AuditTypeRef | null;
  program?: ProgramRef | null;
  plant?: NamedRef | null;
  department?: DepartmentRef | null;
  team?: AuditTeamMember[];
  clauses?: AuditClauseLink[];
  scheduleItems?: AuditScheduleItem[];
}

interface SelectedAuditor {
  auditorId: string;
  isLead: boolean;
}

interface ScheduleRow {
  key: string;
  clauseId: string;
  auditorId: string;
  date: string;
  startTime: string;
  endTime: string;
  notes: string;
}

function makeKey() {
  return Math.random().toString(36).slice(2);
}

function collectIds(node: ClauseNode): string[] {
  return [node.id, ...(node.children ?? []).flatMap(collectIds)];
}

function flattenTree(nodes: ClauseNode[]): ClauseNode[] {
  return nodes.flatMap((node) => [node, ...flattenTree(node.children ?? [])]);
}

function describeAlert(alert: CompetencyAlert): string {
  const name = alert.auditor?.name ?? alert.name ?? alert.auditorId ?? 'Auditor';
  if (alert.message) return `${name}: ${alert.message}`;
  if (alert.competencyExpiry) return `${name}: competency expires ${fmtDate(alert.competencyExpiry)}`;
  return `${name}: competency needs review`;
}

function useAll<T>(path: string, key: string) {
  return useQuery({
    queryKey: [key, 'options'],
    queryFn: () => resources.all<T>(path),
  });
}

export function AuditWizardPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [auditId, setAuditId] = useState<string | undefined>(id);
  const prefilledFor = useRef<string | null>(null);

  // Step 1 - basic info
  const [title, setTitle] = useState('');
  const [standardId, setStandardId] = useState('');
  const [auditTypeId, setAuditTypeId] = useState('');
  const [programId, setProgramId] = useState('');
  const [category, setCategory] = useState('SYSTEM');

  // Step 2 - plant
  const [plantId, setPlantId] = useState('');

  // Step 4 - scope
  const [departmentId, setDepartmentId] = useState('');
  const [scopeText, setScopeText] = useState('');
  const [objectives, setObjectives] = useState('');
  const [criteria, setCriteria] = useState('');

  // Step 5 - clauses
  const [checklistId, setChecklistId] = useState('');
  const [selectedClauseIds, setSelectedClauseIds] = useState<string[]>([]);

  // Step 7 - team
  const [selectedAuditors, setSelectedAuditors] = useState<SelectedAuditor[]>([]);

  // Step 8 - schedule
  const [scheduleItems, setScheduleItems] = useState<ScheduleRow[]>([]);
  const [plannedStart, setPlannedStart] = useState('');
  const [plannedEnd, setPlannedEnd] = useState('');

  const { data: audit, isLoading: auditLoading } = useQuery({
    queryKey: ['audit', id],
    queryFn: () => resources.get<AuditFull>(`/audits/${id}`),
    enabled: !!id,
  });

  const standardsQuery = useAll<StandardRef>('/setup/standards', 'standards');
  const programsQuery = useAll<ProgramRef>('/setup/programs', 'programs');
  const auditTypesQuery = useAll<AuditTypeRef>('/setup/audit-types', 'audit-types');
  const plantsQuery = useAll<NamedRef>('/org/plants', 'plants');
  const departmentsQuery = useAll<DepartmentRef>('/org/departments', 'departments');
  const auditorsQuery = useAll<AuditorRef>('/people/auditors', 'auditors');
  const alertsQuery = useAll<CompetencyAlert>('/people/auditors/competency-alerts', 'auditor-alerts');
  const checklistsQuery = useAll<ChecklistRef>('/setup/checklists', 'checklists');

  const { data: tree, isLoading: treeLoading } = useQuery({
    queryKey: ['checklist-tree', checklistId],
    queryFn: () => resources.get<ClauseNode[]>(`/setup/checklists/${checklistId}/tree`),
    enabled: !!checklistId,
  });

  useEffect(() => {
    if (id) {
      setAuditId(id);
      prefilledFor.current = null;
    }
  }, [id]);

  useEffect(() => {
    if (!audit || prefilledFor.current === audit.id) return;
    prefilledFor.current = audit.id;
    setTitle(audit.title ?? '');
    setStandardId(audit.standard?.id ?? '');
    setAuditTypeId(audit.auditType?.id ?? '');
    setProgramId(audit.program?.id ?? '');
    setCategory(audit.category ?? 'SYSTEM');
    setPlantId(audit.plant?.id ?? '');
    setDepartmentId(audit.department?.id ?? '');
    setScopeText(audit.scope ?? '');
    setObjectives(audit.objectives ?? '');
    setCriteria(audit.criteria ?? '');
    setChecklistId(audit.checklistId ?? '');
    setSelectedClauseIds((audit.clauses ?? []).map((link) => link.clause.id));
    setSelectedAuditors((audit.team ?? []).map((member) => ({ auditorId: member.auditor.id, isLead: member.isLead })));
    setScheduleItems(
      (audit.scheduleItems ?? []).map((item) => ({
        key: item.id ?? makeKey(),
        clauseId: item.clause?.id ?? '',
        auditorId: item.auditor?.id ?? '',
        date: item.date ? toInputDate(item.date) : '',
        startTime: item.startTime ?? '',
        endTime: item.endTime ?? '',
        notes: item.notes ?? '',
      })),
    );
    setPlannedStart(audit.plannedStart ? toInputDate(audit.plannedStart) : '');
    setPlannedEnd(audit.plannedEnd ? toInputDate(audit.plannedEnd) : '');
  }, [audit]);

  const clauseIndex = useMemo(() => {
    const map = new Map<string, ClauseNode>();
    for (const node of flattenTree(tree ?? [])) map.set(node.id, node);
    for (const link of audit?.clauses ?? []) {
      if (!map.has(link.clause.id)) {
        map.set(link.clause.id, {
          id: link.clause.id,
          number: link.clause.number,
          title: link.clause.title,
          parentId: link.clause.parentId ?? null,
        });
      }
    }
    return map;
  }, [tree, audit]);

  const selectedGroups = useMemo(() => {
    const groups = new Map<string, { top: ClauseNode; items: ClauseNode[] }>();
    for (const clauseId of selectedClauseIds) {
      const node = clauseIndex.get(clauseId);
      if (!node) continue;
      let top = node;
      while (top.parentId && clauseIndex.has(top.parentId)) {
        top = clauseIndex.get(top.parentId)!;
      }
      const entry = groups.get(top.id) ?? { top, items: [] };
      entry.items.push(node);
      groups.set(top.id, entry);
    }
    return Array.from(groups.values()).sort((a, b) => a.top.number.localeCompare(b.top.number));
  }, [selectedClauseIds, clauseIndex]);

  const clauseOptions = useMemo(
    () =>
      selectedClauseIds
        .map((clauseId) => clauseIndex.get(clauseId))
        .filter((node): node is ClauseNode => !!node)
        .sort((a, b) => a.number.localeCompare(b.number)),
    [selectedClauseIds, clauseIndex],
  );

  const auditorById = useMemo(() => {
    const map = new Map<string, AuditorRef>();
    for (const auditor of auditorsQuery.data ?? []) map.set(auditor.id, auditor);
    return map;
  }, [auditorsQuery.data]);

  const departmentOptions = useMemo(
    () => (departmentsQuery.data ?? []).filter((dept) => !plantId || dept.plantId === plantId),
    [departmentsQuery.data, plantId],
  );

  const auditType = (auditTypesQuery.data ?? []).find((type) => type.id === auditTypeId);
  const readOnly = !!audit && ['PENDING_APPROVAL', 'APPROVED'].includes(audit.status);

  const toggleClauses = (ids: string[], add: boolean) => {
    setSelectedClauseIds((prev) => {
      const set = new Set(prev);
      for (const clauseId of ids) {
        if (add) set.add(clauseId);
        else set.delete(clauseId);
      }
      return Array.from(set);
    });
  };

  const toggleAuditor = (auditorId: string) => {
    setSelectedAuditors((prev) => {
      if (prev.some((entry) => entry.auditorId === auditorId)) {
        return prev.filter((entry) => entry.auditorId !== auditorId);
      }
      return [...prev, { auditorId, isLead: prev.length === 0 }];
    });
  };

  const setLead = (auditorId: string) => {
    setSelectedAuditors((prev) => prev.map((entry) => ({ ...entry, isLead: entry.auditorId === auditorId })));
  };

  const addScheduleRow = () => {
    setScheduleItems((prev) => [
      ...prev,
      {
        key: makeKey(),
        clauseId: '',
        auditorId: '',
        date: plannedStart || '',
        startTime: '09:00',
        endTime: '10:00',
        notes: '',
      },
    ]);
  };

  const updateScheduleRow = (key: string, patch: Partial<ScheduleRow>) => {
    setScheduleItems((prev) => prev.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  };

  const removeScheduleRow = (key: string) => {
    setScheduleItems((prev) => prev.filter((row) => row.key !== key));
  };

  const basicPayload = () => ({
    title,
    programId: programId || null,
    standardId: standardId || null,
    auditTypeId: auditTypeId || null,
    category,
  });

  const persist = async (index: number) => {
    if (index === 0) {
      if (!auditId) {
        const created = await resources.create<{ id: string }>('/audits', {
          title,
          category,
          programId: programId || undefined,
          standardId: standardId || undefined,
          auditTypeId: auditTypeId || undefined,
        });
        setAuditId(created.id);
        queryClient.invalidateQueries({ queryKey: ['audits'] });
        return;
      }
      await resources.update(`/audits/${auditId}/basic`, basicPayload());
      queryClient.invalidateQueries({ queryKey: ['audit', auditId] });
      return;
    }

    if (!auditId) throw new Error('Create the audit draft before continuing.');

    switch (index) {
      case 1:
        await resources.update(`/audits/${auditId}/scope`, { plantId: plantId || null });
        break;
      case 2:
        await resources.update(`/audits/${auditId}/basic`, basicPayload());
        await resources.update(`/audits/${auditId}/scope`, {
          plantId: plantId || null,
          departmentId: departmentId || null,
        });
        break;
      case 3:
        await resources.update(`/audits/${auditId}/scope`, {
          plantId: plantId || null,
          departmentId: departmentId || null,
          scope: scopeText || null,
          objectives: objectives || null,
          criteria: criteria || null,
        });
        break;
      case 4:
        await resources.update(`/audits/${auditId}/clauses`, { clauseIds: selectedClauseIds });
        break;
      case 5:
        break;
      case 6:
        if (selectedAuditors.length > 0 && !selectedAuditors.some((entry) => entry.isLead)) {
          throw new Error('Mark exactly one auditor as lead.');
        }
        await resources.update(`/audits/${auditId}/team`, {
          auditors: selectedAuditors.map((entry) => ({ auditorId: entry.auditorId, isLead: entry.isLead })),
        });
        break;
      case 7: {
        const invalid = scheduleItems.find((row) => !row.date || !row.startTime || !row.endTime);
        if (invalid) throw new Error('Every schedule row needs a date, start time and end time.');
        await resources.update(`/audits/${auditId}/schedule`, {
          items: scheduleItems.map((row) => ({
            clauseId: row.clauseId || undefined,
            auditorId: row.auditorId || undefined,
            date: new Date(row.date).toISOString(),
            startTime: row.startTime,
            endTime: row.endTime,
            notes: row.notes || undefined,
          })),
          plannedStart: plannedStart ? new Date(plannedStart).toISOString() : null,
          plannedEnd: plannedEnd ? new Date(plannedEnd).toISOString() : null,
        });
        break;
      }
      default:
        break;
    }

    queryClient.invalidateQueries({ queryKey: ['audit', auditId] });
    queryClient.invalidateQueries({ queryKey: ['audits'] });
  };

  const next = async () => {
    if (saving) return;
    if (step === 0) {
      if (!title.trim()) {
        toast.error('Title is required.');
        return;
      }
      if (!standardId) {
        toast.error('Select a standard.');
        return;
      }
      if (!auditTypeId) {
        toast.error('Select an audit type.');
        return;
      }
    }
    if (step === 1 && !plantId) {
      toast.error('Select a plant.');
      return;
    }
    setSaving(true);
    try {
      await persist(step);
      setStep((current) => Math.min(current + 1, STEPS.length - 1));
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  const back = () => setStep((current) => Math.max(0, current - 1));

  const submit = async () => {
    if (!auditId) {
      toast.error('Create the audit draft before submitting.');
      return;
    }
    setSaving(true);
    try {
      await api.post(`/audits/${auditId}/submit`);
      toast.success('Submitted for QMR approval.');
      queryClient.invalidateQueries({ queryKey: ['audits'] });
      queryClient.invalidateQueries({ queryKey: ['audit', auditId] });
      navigate(`/audits/${auditId}`);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setSaving(false);
    }
  };

  if (id && auditLoading) {
    return <LoadingBlock label="Loading audit..." />;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title={id ? 'Edit Audit' : 'New Audit'}
        description={
          audit
            ? `${audit.code} - ${audit.title} (${STATUS_LABELS[audit.status] ?? titleCase(audit.status)})`
            : 'Complete the steps below to plan and submit an audit.'
        }
      />

      <Stepper step={step} onSelect={setStep} />

      {step === 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Basic information</CardTitle>
            <CardDescription>Identify the audit, its standard and its type.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Title</Label>
              <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Q1 internal audit..." />
            </div>
            <div className="space-y-1.5">
              <Label>Standard</Label>
              <Select value={standardId} onValueChange={setStandardId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select standard" />
                </SelectTrigger>
                <SelectContent>
                  {(standardsQuery.data ?? []).map((standard) => (
                    <SelectItem key={standard.id} value={standard.id}>
                      {standard.code ? `${standard.code} - ${standard.name}` : standard.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Audit type</Label>
              <Select value={auditTypeId} onValueChange={setAuditTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select audit type" />
                </SelectTrigger>
                <SelectContent>
                  {(auditTypesQuery.data ?? []).map((type) => (
                    <SelectItem key={type.id} value={type.id}>
                      {type.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Programme</Label>
              <Select value={programId} onValueChange={setProgramId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select programme (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {(programsQuery.data ?? []).map((program) => (
                    <SelectItem key={program.id} value={program.id}>
                      {program.year ? `${program.name} (${program.year})` : program.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Plant</CardTitle>
            <CardDescription>Select the plant where the audit will take place.</CardDescription>
          </CardHeader>
          <CardContent className="max-w-md space-y-1.5">
            <Label>Plant</Label>
            <Select value={plantId} onValueChange={setPlantId}>
              <SelectTrigger>
                <SelectValue placeholder="Select plant" />
              </SelectTrigger>
              <SelectContent>
                {(plantsQuery.data ?? []).map((plant) => (
                  <SelectItem key={plant.id} value={plant.id}>
                    {plant.code ? `${plant.code} - ${plant.name}` : plant.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Category and type</CardTitle>
            <CardDescription>Confirm the audit category and review the selected type.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.map((value) => (
                  <Button
                    key={value}
                    type="button"
                    variant={category === value ? 'accent' : 'outline'}
                    size="sm"
                    onClick={() => setCategory(value)}
                  >
                    {titleCase(value)}
                  </Button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Audit type</Label>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium">{auditType?.name ?? '-'}</span>
                {auditType?.category && <Badge variant="accent">{titleCase(auditType.category)}</Badge>}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Scope</CardTitle>
            <CardDescription>Describe the scope, objectives and audit criteria.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5 sm:max-w-md">
              <Label>Department</Label>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select department (optional)" />
                </SelectTrigger>
                <SelectContent>
                  {departmentOptions.map((dept) => (
                    <SelectItem key={dept.id} value={dept.id}>
                      {dept.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Scope</Label>
              <Textarea value={scopeText} onChange={(event) => setScopeText(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Objectives</Label>
              <Textarea value={objectives} onChange={(event) => setObjectives(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Criteria</Label>
              <Textarea value={criteria} onChange={(event) => setCriteria(event.target.value)} />
            </div>
          </CardContent>
        </Card>
      )}

      {step === 4 && (
        <Card>
          <CardHeader>
            <CardTitle>Checklist selection</CardTitle>
            <CardDescription>Pick a checklist and select the clauses to audit.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:max-w-2xl sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Checklist</Label>
                <Select value={checklistId} onValueChange={setChecklistId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select checklist" />
                  </SelectTrigger>
                  <SelectContent>
                    {(checklistsQuery.data ?? []).map((checklist) => (
                      <SelectItem key={checklist.id} value={checklist.id}>
                        {checklist.code ? `${checklist.code} - ${checklist.name}` : checklist.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select department (optional)" />
                  </SelectTrigger>
                  <SelectContent>
                    {departmentOptions.map((dept) => (
                      <SelectItem key={dept.id} value={dept.id}>
                        {dept.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="rounded-lg border border-border p-4">
              {!checklistId ? (
                <p className="text-sm text-muted-foreground">Select a checklist to load its clauses.</p>
              ) : treeLoading ? (
                <LoadingBlock label="Loading clauses..." />
              ) : !tree || tree.length === 0 ? (
                <p className="text-sm text-muted-foreground">This checklist has no clauses.</p>
              ) : (
                <ClauseTree nodes={tree} selected={selectedClauseIds} onToggle={toggleClauses} />
              )}
            </div>
            <p className="text-sm text-muted-foreground">{selectedClauseIds.length} clause(s) selected</p>
          </CardContent>
        </Card>
      )}

      {step === 5 && (
        <Card>
          <CardHeader>
            <CardTitle>Clause review</CardTitle>
            <CardDescription>{selectedClauseIds.length} clause(s) selected, grouped by top clause.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {selectedGroups.length === 0 ? (
              <p className="text-sm text-muted-foreground">No clauses selected yet.</p>
            ) : (
              selectedGroups.map((group) => (
                <div key={group.top.id} className="space-y-1">
                  <p className="text-sm font-medium">
                    {group.top.number} {group.top.title}
                  </p>
                  <ul className="space-y-1 border-l border-border pl-4 text-sm text-muted-foreground">
                    {group.items.map((item) => (
                      <li key={item.id}>
                        <span className="font-medium text-foreground">{item.number}</span> {item.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}

      {step === 6 && (
        <Card>
          <CardHeader>
            <CardTitle>Auditor assignment</CardTitle>
            <CardDescription>Select the audit team and mark one auditor as lead.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {(alertsQuery.data ?? []).length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
                <div className="mb-1 flex items-center gap-2 font-medium">
                  <AlertTriangle className="h-4 w-4" /> Competency alerts
                </div>
                <ul className="list-disc space-y-1 pl-5">
                  {(alertsQuery.data ?? []).map((alert, index) => (
                    <li key={index}>{describeAlert(alert)}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="divide-y divide-border rounded-lg border border-border">
              {(auditorsQuery.data ?? []).length === 0 ? (
                <p className="p-4 text-sm text-muted-foreground">No auditors available.</p>
              ) : (
                (auditorsQuery.data ?? []).map((auditor) => {
                  const selected = selectedAuditors.find((entry) => entry.auditorId === auditor.id);
                  return (
                    <div key={auditor.id} className="flex flex-wrap items-center gap-3 p-3">
                      <Checkbox checked={!!selected} onCheckedChange={() => toggleAuditor(auditor.id)} />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{auditor.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {auditor.type ? titleCase(auditor.type) : 'Internal'}
                          {auditor.competencyLevel ? ` - ${titleCase(auditor.competencyLevel)}` : ''}
                        </p>
                      </div>
                      <label className={cn('flex items-center gap-1.5 text-xs', !selected && 'opacity-50')}>
                        <input
                          type="radio"
                          name="lead-auditor"
                          className="h-4 w-4"
                          disabled={!selected}
                          checked={!!selected?.isLead}
                          onChange={() => setLead(auditor.id)}
                        />
                        Lead
                      </label>
                    </div>
                  );
                })
              )}
            </div>
            <p className="text-sm text-muted-foreground">{selectedAuditors.length} auditor(s) selected</p>
          </CardContent>
        </Card>
      )}

      {step === 7 && (
        <Card>
          <CardHeader>
            <CardTitle>Schedule</CardTitle>
            <CardDescription>Add audit sessions and set the planned dates.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:max-w-2xl sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Planned start</Label>
                <Input type="date" value={plannedStart} onChange={(event) => setPlannedStart(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Planned end</Label>
                <Input type="date" value={plannedEnd} onChange={(event) => setPlannedEnd(event.target.value)} />
              </div>
            </div>

            <div className="space-y-3">
              {scheduleItems.map((row) => (
                <div key={row.key} className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Clause</Label>
                    <Select value={row.clauseId} onValueChange={(value) => updateScheduleRow(row.key, { clauseId: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select clause" />
                      </SelectTrigger>
                      <SelectContent>
                        {clauseOptions.map((node) => (
                          <SelectItem key={node.id} value={node.id}>
                            {node.number} {node.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Auditor</Label>
                    <Select
                      value={row.auditorId}
                      onValueChange={(value) => updateScheduleRow(row.key, { auditorId: value })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select auditor" />
                      </SelectTrigger>
                      <SelectContent>
                        {selectedAuditors.map((entry) => (
                          <SelectItem key={entry.auditorId} value={entry.auditorId}>
                            {auditorById.get(entry.auditorId)?.name ?? entry.auditorId}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={row.date}
                      onChange={(event) => updateScheduleRow(row.key, { date: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Start time</Label>
                    <Input
                      type="time"
                      value={row.startTime}
                      onChange={(event) => updateScheduleRow(row.key, { startTime: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>End time</Label>
                    <Input
                      type="time"
                      value={row.endTime}
                      onChange={(event) => updateScheduleRow(row.key, { endTime: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Input
                      value={row.notes}
                      onChange={(event) => updateScheduleRow(row.key, { notes: event.target.value })}
                      placeholder="Optional"
                    />
                  </div>
                  <div className="flex items-end sm:col-span-2 lg:col-span-3">
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeScheduleRow(row.key)}>
                      <Trash2 className="h-4 w-4 text-destructive" /> Remove row
                    </Button>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addScheduleRow}>
                <Plus className="h-4 w-4" /> Add session
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 8 && (
        <Card>
          <CardHeader>
            <CardTitle>Review and submit</CardTitle>
            <CardDescription>Confirm the captured details before submitting for approval.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">
            <SummaryGrid
              rows={[
                ['Title', title || '-'],
                [
                  'Standard',
                  (standardsQuery.data ?? []).find((standard) => standard.id === standardId)?.name ?? '-',
                ],
                ['Audit type', auditType?.name ?? '-'],
                ['Programme', (programsQuery.data ?? []).find((program) => program.id === programId)?.name ?? '-'],
                ['Category', titleCase(category)],
                ['Plant', (plantsQuery.data ?? []).find((plant) => plant.id === plantId)?.name ?? '-'],
                ['Department', departmentOptions.find((dept) => dept.id === departmentId)?.name ?? '-'],
                ['Planned start', plannedStart ? fmtDate(plannedStart) : '-'],
                ['Planned end', plannedEnd ? fmtDate(plannedEnd) : '-'],
                ['Clauses selected', String(selectedClauseIds.length)],
                ['Auditors', String(selectedAuditors.length)],
                ['Schedule sessions', String(scheduleItems.length)],
              ]}
            />

            <div className="space-y-2">
              <p className="font-medium">Scope</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{scopeText || '-'}</p>
              <p className="font-medium">Objectives</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{objectives || '-'}</p>
              <p className="font-medium">Criteria</p>
              <p className="whitespace-pre-wrap text-muted-foreground">{criteria || '-'}</p>
            </div>

            {readOnly ? (
              <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm text-muted-foreground">
                This audit is {STATUS_LABELS[audit?.status ?? ''] ?? titleCase(audit?.status ?? '')} and can no longer be
                submitted. Continue from the audit detail page.
              </div>
            ) : (
              <Button variant="accent" onClick={submit} disabled={saving}>
                <Send className="h-4 w-4" /> Submit for QMR Approval
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      <div className="flex items-center justify-between gap-4">
        <Button variant="outline" onClick={back} disabled={step === 0 || saving}>
          <ArrowLeft className="h-4 w-4" /> Back
        </Button>
        <span className="text-xs text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </span>
        {step < STEPS.length - 1 ? (
          <Button onClick={next} disabled={saving}>
            {saving ? 'Saving...' : 'Next'} <ArrowRight className="h-4 w-4" />
          </Button>
        ) : (
          <span className="w-[88px]" />
        )}
      </div>
    </div>
  );
}

function Stepper({ step, onSelect }: { step: number; onSelect: (index: number) => void }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1 pb-1">
      <ol className="flex min-w-max items-center gap-2">
        {STEPS.map((label, index) => {
          const done = index < step;
          const active = index === step;
          const clickable = index < step;
          return (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelect(index)}
                className={cn(
                  'flex items-center gap-2 rounded-md px-2 py-1 text-left transition-colors',
                  clickable && 'hover:bg-secondary',
                  !clickable && 'cursor-default',
                )}
              >
                <span
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold',
                    active
                      ? 'border-accent bg-accent text-accent-foreground'
                      : done
                        ? 'border-emerald-500 bg-emerald-100 text-emerald-700'
                        : 'border-border text-muted-foreground',
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                <span className={cn('text-xs font-medium', active ? 'text-foreground' : 'text-muted-foreground')}>
                  {label}
                </span>
              </button>
              {index < STEPS.length - 1 && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function ClauseTree({
  nodes,
  selected,
  onToggle,
  depth = 0,
}: {
  nodes: ClauseNode[];
  selected: string[];
  onToggle: (ids: string[], add: boolean) => void;
  depth?: number;
}) {
  return (
    <ul className={cn('space-y-1', depth > 0 && 'border-l border-border pl-4')}>
      {nodes.map((node) => {
        const ids = collectIds(node);
        const selectedCount = ids.filter((id) => selected.includes(id)).length;
        const allSelected = selectedCount === ids.length && ids.length > 0;
        const someSelected = selectedCount > 0 && !allSelected;
        return (
          <li key={node.id} className="space-y-1">
            <label className="flex items-start gap-2 text-sm">
              <Checkbox
                className="mt-0.5"
                checked={allSelected ? true : someSelected ? 'indeterminate' : false}
                onCheckedChange={() => onToggle(ids, !allSelected)}
              />
              <span>
                <span className="font-medium">{node.number}</span> {node.title}
              </span>
            </label>
            {node.children && node.children.length > 0 && (
              <ClauseTree nodes={node.children} selected={selected} onToggle={onToggle} depth={depth + 1} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

function SummaryGrid({ rows }: { rows: [string, string][] }) {
  return (
    <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
      {rows.map(([label, value]) => (
        <div key={label} className="flex items-start justify-between gap-4">
          <span className="text-muted-foreground">{label}</span>
          <span className="text-right font-medium">{value}</span>
        </div>
      ))}
    </div>
  );
}
