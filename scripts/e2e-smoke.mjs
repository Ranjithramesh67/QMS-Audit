#!/usr/bin/env node
/**
 * End-to-end smoke test for the QMS Audit Platform backend.
 *
 * Exercises the critical path: login -> plan (9-step) -> QMR approval ->
 * execution -> NC + CAPA -> effectiveness verification -> closure.
 *
 * Usage: node scripts/e2e-smoke.mjs [baseUrl]
 */

const BASE = process.argv[2] ?? 'http://localhost:3001/api';

let passed = 0;
let failed = 0;

function check(label, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  PASS  ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL  ${label} ${extra}`);
  }
}

async function request(method, path, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !raw) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { status: res.status, data };
}

const login = async (email) => {
  const { data } = await request('POST', '/auth/login', { body: { email, password: 'Password123!' } });
  if (!data?.token) throw new Error(`Login failed for ${email}`);
  return data.token;
};

async function main() {
  console.log(`QMS E2E smoke test against ${BASE}\n`);

  const lead = await login('lead@acme.example');
  const qmr = await login('qmr@acme.example');
  console.log('Stage 0: Authentication');
  check('Lead auditor + QMR logged in', !!lead && !!qmr);

  // Masters needed for planning.
  const plants = await request('GET', '/org/plants?pageSize=50', { token: lead });
  const departments = await request('GET', '/org/departments?pageSize=50', { token: lead });
  const standards = await request('GET', '/setup/standards?pageSize=50', { token: lead });
  const auditTypes = await request('GET', '/setup/audit-types?pageSize=50', { token: lead });
  const auditors = await request('GET', '/people/auditors?pageSize=50', { token: lead });

  const plant = plants.data.items[0];
  const department = departments.data.items.find((d) => d.code === 'ENGG') ?? departments.data.items[0];
  const standard = standards.data.items.find((s) => s.code === 'VDA63') ?? standards.data.items[0];
  const auditType = auditTypes.data.items.find((t) => t.category === 'PROCESS') ?? auditTypes.data.items[0];
  const leadAuditor = auditors.data.items.find((a) => a.competencyLevel === 'LEAD') ?? auditors.data.items[0];
  const memberAuditor = auditors.data.items.find((a) => a.id !== leadAuditor.id);

  console.log('\nStage 1: Audit Planning (9 steps)');
  const created = await request('POST', '/audits', {
    token: lead,
    body: { title: `E2E Process Audit ${Date.now()}`, category: 'PROCESS', standardId: standard.id, auditTypeId: auditType.id },
  });
  check('Draft audit created', created.status === 201 && created.data.status === 'DRAFT', JSON.stringify(created.data));
  const auditId = created.data.id;

  await request('PUT', `/audits/${auditId}/scope`, {
    token: lead,
    body: { plantId: plant.id, departmentId: department.id, scope: 'Machining', objectives: 'Verify ISO/VDA conformity', criteria: 'VDA 6.3' },
  });
  const scoped = await request('GET', `/audits/${auditId}`, { token: lead });
  check('Scope saved', scoped.data.scope === 'Machining' && scoped.data.departmentId === department.id);

  const checklists = await request('GET', `/setup/checklists?search=${encodeURIComponent(standard.name)}&pageSize=50`, { token: lead });
  const checklist = checklists.data.items[0];
  const tree = await request('GET', `/setup/checklists/${checklist.id}/tree`, { token: lead });
  const clauseIds = [];
  const walk = (nodes) => nodes.forEach((n) => { clauseIds.push(n.id); if (n.children?.length) walk(n.children); });
  walk(tree.data);
  const chosen = clauseIds.slice(0, 5);
  await request('PUT', `/audits/${auditId}/clauses`, { token: lead, body: { clauseIds: chosen } });
  const withClauses = await request('GET', `/audits/${auditId}`, { token: lead });
  check('Checklist clauses selected', withClauses.data.clauses.length === chosen.length);

  const teamRes = await request('PUT', `/audits/${auditId}/team`, {
    token: lead,
    body: {
      auditors: [
        { auditorId: leadAuditor.id, isLead: true },
        { auditorId: memberAuditor.id, isLead: false },
      ],
    },
  });
  check('Audit team assigned', teamRes.status === 200 && teamRes.data.team.length === 2, JSON.stringify(teamRes.data?.error));

  const now = Date.now();
  const scheduleRes = await request('PUT', `/audits/${auditId}/schedule`, {
    token: lead,
    body: {
      plannedStart: new Date(now).toISOString(),
      plannedEnd: new Date(now + 3 * 86400000).toISOString(),
      items: [
        { clauseId: chosen[0], auditorId: leadAuditor.id, date: new Date(now).toISOString(), startTime: '09:00', endTime: '11:00' },
        { clauseId: chosen[1], auditorId: memberAuditor.id, date: new Date(now).toISOString(), startTime: '11:00', endTime: '13:00' },
      ],
    },
  });
  check('Schedule saved', scheduleRes.status === 200 && scheduleRes.data.scheduleItems.length === 2, JSON.stringify(scheduleRes.data?.error));

  const overlap = await request('PUT', `/audits/${auditId}/schedule`, {
    token: lead,
    body: {
      items: [
        { auditorId: leadAuditor.id, date: new Date(now).toISOString(), startTime: '09:00', endTime: '11:00' },
        { auditorId: leadAuditor.id, date: new Date(now).toISOString(), startTime: '10:00', endTime: '12:00' },
      ],
    },
  });
  check('Overlapping schedule rejected', overlap.status === 400);

  const submitted = await request('POST', `/audits/${auditId}/submit`, { token: lead });
  check('Submitted for approval', submitted.data.status === 'PENDING_APPROVAL', JSON.stringify(submitted.data?.error));

  // Independence rule: assign an auditor from the audited department.
  const deptUserAuditor = auditors.data.items.find((a) => a.user?.departmentId === department.id);
  if (deptUserAuditor && department.id) {
    const conflict = await request('PUT', `/audits/${auditId}/team`, {
      token: lead,
      body: { auditors: [{ auditorId: deptUserAuditor.id, isLead: true }] },
    });
    check('Self-department auditor blocked', conflict.status === 400, JSON.stringify(conflict.data?.error));
    // restore a valid team
    await request('PUT', `/audits/${auditId}/team`, {
      token: lead,
      body: { auditors: [{ auditorId: leadAuditor.id, isLead: true }, { auditorId: memberAuditor.id, isLead: false }] },
    });
  }

  console.log('\nStage 2: QMR Approval');
  const approved = await request('POST', `/audits/${auditId}/approve`, { token: qmr, body: { notes: 'Approved by E2E' } });
  check('Audit approved and locked', approved.data.status === 'APPROVED' && approved.data.locked === true, JSON.stringify(approved.data?.error));

  console.log('\nStage 3: Audit Execution');
  const started = await request('POST', `/audits/${auditId}/start`, { token: lead });
  check('Execution started', started.data.status === 'IN_PROGRESS');

  const exec = await request('GET', `/audits/${auditId}/execution`, { token: lead });
  check('Execution payload exposes clauses', exec.data.clauses.length === chosen.length);

  let index = 0;
  for (const item of exec.data.clauses) {
    const documented = 'YES';
    const implemented = index === 0 ? 'NO' : 'YES';
    const put = await request('PUT', `/audits/${auditId}/execution/${item.clause.id}`, {
      token: lead,
      body: { documented, implemented, comments: 'E2E answer' },
    });
    if (index === 0) {
      check('Finding matrix derives NC for YES/NO', put.data.derived.type === 'NC' && put.data.derived.severity === 'MINOR', JSON.stringify(put.data?.derived));
    }
    index += 1;
  }

  const completed = await request('POST', `/audits/${auditId}/execution/complete`, { token: lead });
  check('Execution completed', completed.data.status === 'FINDINGS_RECORDED', JSON.stringify(completed.data?.error));

  console.log('\nStage 4: Findings');
  const finding = await request('POST', '/findings', {
    token: lead,
    body: {
      auditId,
      clauseId: chosen[0],
      departmentId: department.id,
      type: 'NC',
      severity: 'MAJOR',
      title: 'E2E nonconformity',
      observation: 'Observed process deviation during E2E run.',
      dueDate: new Date(now + 15 * 86400000).toISOString(),
    },
  });
  check('NC finding created', finding.status === 201 && finding.data.capa, JSON.stringify(finding.data?.error));
  const findingId = finding.data.id;

  const findingDetail = await request('GET', `/findings/${findingId}`, { token: lead });
  const capaId = findingDetail.data.capa.id;
  check('CAPA auto-created for NC', !!capaId);

  console.log('\nStage 5: CAPA (auditee response)');
  const ack = await request('POST', `/capas/${capaId}/acknowledge`, { token: lead });
  check('NC acknowledged', ack.data.status === 'ACKNOWLEDGED');

  const response = await request('PUT', `/capas/${capaId}/response`, {
    token: lead,
    body: {
      immediateCorrection: 'Corrected immediately.',
      rootCauseMethod: 'FIVE_WHY',
      rootCause: 'Document control distribution was not maintained.',
      targetDate: new Date(now + 10 * 86400000).toISOString(),
      whys: [
        { level: 1, question: 'Why?', answer: 'Instruction obsolete.' },
        { level: 2, question: 'Why?', answer: 'Distribution list stale.' },
      ],
      actions: [{ description: 'Update distribution procedure', responsible: 'QA', status: 'OPEN' }],
    },
  });
  check('Root cause and actions saved', response.data.whys.length === 2 && response.data.actions.length === 1);

  const capaSubmit = await request('POST', `/capas/${capaId}/submit`, { token: lead });
  check('CAPA submitted', capaSubmit.data.status === 'SUBMITTED', JSON.stringify(capaSubmit.data?.error));

  console.log('\nStage 6: Effectiveness Verification');
  const accept = await request('POST', `/capas/${capaId}/accept`, { token: lead });
  check('Action plan accepted', accept.data.status === 'ACCEPTED');

  const verify = await request('POST', `/capas/${capaId}/verify`, {
    token: lead,
    body: { verificationMethod: 'On-site check', verificationNotes: 'No recurrence', effectivenessResult: 'Effective', pass: true },
  });
  check('Effectiveness verified', verify.data.status === 'VERIFIED', JSON.stringify(verify.data?.error));

  console.log('\nStage 7: NC Closure');
  const close = await request('POST', `/capas/${capaId}/close`, { token: lead });
  check('CAPA closed', close.data.status === 'CLOSED', JSON.stringify(close.data?.error));

  const finalFinding = await request('GET', `/findings/${findingId}`, { token: lead });
  check('Finding closed', finalFinding.data.status === 'CLOSED');

  const finalAudit = await request('GET', `/audits/${auditId}`, { token: lead });
  check('Audit closed via CAPA lifecycle', finalAudit.data.status === 'CLOSED', finalAudit.data.status);

  console.log('\nStage 8: Analytics & Reporting');
  const summary = await request('GET', '/analytics/summary', { token: qmr });
  check('Analytics summary returns KPIs', summary.data.audits.total > 0 && summary.data.capa.total > 0);
  const csv = await fetch(`${BASE}/reports/nc-register?format=csv`, { headers: { Authorization: `Bearer ${lead}` } });
  const csvText = await csv.text();
  check('NC register CSV generated', csv.status === 200 && csvText.startsWith('code,'));

  console.log(`\nResult: ${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('E2E smoke test crashed:', error);
  process.exit(1);
});
