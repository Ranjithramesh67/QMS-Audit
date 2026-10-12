import { PrismaClient, type AuditCategory } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { DEFAULT_ROLES } from '../src/lib/permissions.js';

const prisma = new PrismaClient();

const DEFAULT_PASSWORD = 'Password123!';

async function reset() {
  // Order matters: children before parents.
  await prisma.auditLog.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.documentVersion.deleteMany();
  await prisma.document.deleteMany();
  await prisma.capaWhy.deleteMany();
  await prisma.capaAction.deleteMany();
  await prisma.capa.deleteMany();
  await prisma.finding.deleteMany();
  await prisma.auditResponse.deleteMany();
  await prisma.auditScheduleItem.deleteMany();
  await prisma.auditClause.deleteMany();
  await prisma.auditAuditor.deleteMany();
  await prisma.audit.deleteMany();
  await prisma.auditee.deleteMany();
  await prisma.auditor.deleteMany();
  await prisma.process.deleteMany();
  await prisma.clause.deleteMany();
  await prisma.checklist.deleteMany();
  await prisma.auditProgram.deleteMany();
  await prisma.standard.deleteMany();
  await prisma.auditType.deleteMany();
  await prisma.findingTypeConfig.deleteMany();
  await prisma.severityConfig.deleteMany();
  await prisma.user.deleteMany();
  await prisma.department.deleteMany();
  await prisma.plant.deleteMany();
  await prisma.company.deleteMany();
}

interface ClauseSeed {
  number: string;
  title: string;
  requirement?: string;
  children?: ClauseSeed[];
}

async function insertClauses(checklistId: string, nodes: ClauseSeed[], parentId: string | null = null, order = { value: 0 }) {
  for (const node of nodes) {
    const created = await prisma.clause.create({
      data: {
        checklistId,
        parentId,
        number: node.number,
        title: node.title,
        requirement: node.requirement ?? null,
        sortOrder: order.value++,
      },
    });
    if (node.children?.length) await insertClauses(checklistId, node.children, created.id, order);
  }
}

const ISO_9001: ClauseSeed[] = [
  {
    number: '4',
    title: 'Context of the organization',
    children: [
      { number: '4.1', title: 'Understanding the organization and its context' },
      { number: '4.2', title: 'Understanding the needs and expectations of interested parties' },
      { number: '4.3', title: 'Determining the scope of the quality management system' },
      { number: '4.4', title: 'Quality management system and its processes' },
    ],
  },
  {
    number: '5',
    title: 'Leadership',
    children: [
      { number: '5.1', title: 'Leadership and commitment' },
      { number: '5.2', title: 'Policy' },
      { number: '5.3', title: 'Organizational roles, responsibilities and authorities' },
    ],
  },
  {
    number: '6',
    title: 'Planning',
    children: [
      { number: '6.1', title: 'Actions to address risks and opportunities' },
      { number: '6.2', title: 'Quality objectives and planning to achieve them' },
      { number: '6.3', title: 'Planning of changes' },
    ],
  },
  {
    number: '7',
    title: 'Support',
    children: [
      { number: '7.1', title: 'Resources' },
      { number: '7.2', title: 'Competence' },
      { number: '7.3', title: 'Awareness' },
      { number: '7.4', title: 'Communication' },
      { number: '7.5', title: 'Documented information' },
    ],
  },
  {
    number: '8',
    title: 'Operation',
    children: [
      { number: '8.1', title: 'Operational planning and control' },
      { number: '8.2', title: 'Requirements for products and services' },
      { number: '8.3', title: 'Design and development of products and services' },
      { number: '8.4', title: 'Control of externally provided processes, products and services' },
      { number: '8.5', title: 'Production and service provision' },
      { number: '8.6', title: 'Release of products and services' },
      { number: '8.7', title: 'Control of nonconforming outputs' },
    ],
  },
  {
    number: '9',
    title: 'Performance evaluation',
    children: [
      { number: '9.1', title: 'Monitoring, measurement, analysis and evaluation' },
      { number: '9.2', title: 'Internal audit' },
      { number: '9.3', title: 'Management review' },
    ],
  },
  {
    number: '10',
    title: 'Improvement',
    children: [
      { number: '10.1', title: 'General' },
      { number: '10.2', title: 'Nonconformity and corrective action' },
      { number: '10.3', title: 'Continual improvement' },
    ],
  },
];

const IATF_16949: ClauseSeed[] = [
  { number: '4', title: 'Context of the organization (automotive supplement)', children: [{ number: '4.4.1.2', title: 'Product safety' }] },
  { number: '5', title: 'Leadership', children: [{ number: '5.3.1', title: 'Organization responsibilities and authorities' }] },
  { number: '7', title: 'Support', children: [{ number: '7.2.3', title: 'Internal auditor competency' }] },
  { number: '8', title: 'Operation', children: [{ number: '8.5.1.1', title: 'Control plan' }, { number: '8.5.6.1', title: 'Control of changes' }] },
  { number: '10', title: 'Improvement', children: [{ number: '10.2.3', title: 'Problem solving' }] },
];

const VDA_63: ClauseSeed[] = [
  {
    number: 'P2',
    title: 'Production process development',
    children: [{ number: 'P2.1', title: 'Are customer requirements taken into account?' }],
  },
  {
    number: 'P5',
    title: 'Supplier management',
    children: [{ number: 'P5.1', title: 'Are only approved suppliers used?' }],
  },
  {
    number: 'P6',
    title: 'Production process analysis',
    children: [
      { number: 'P6.1', title: 'Is the process input controlled?' },
      { number: 'P6.2', title: 'Are process flows and material flows controlled?' },
      { number: 'P6.3', title: 'Are personnel qualified for their tasks?' },
      { number: 'P6.4', title: 'Are production resources suitable and maintained?' },
      { number: 'P6.5', title: 'Is the effectiveness of the process demonstrated?' },
    ],
  },
  { number: 'P7', title: 'Customer care', children: [{ number: 'P7.1', title: 'Are customer requirements fulfilled?' }] },
];

async function main() {
  console.log('[seed] resetting database');
  await reset();

  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // --- Organisation ---------------------------------------------------------
  const company = await prisma.company.create({
    data: {
      code: 'ACME',
      name: 'Acme Manufacturing Group',
      address: '120 Industrial Parkway',
      city: 'Pune',
      country: 'India',
      email: 'quality@acme.example',
      website: 'https://acme.example',
    },
  });

  const plantA = await prisma.plant.create({
    data: { companyId: company.id, code: 'PUNE1', name: 'Pune Plant 1', city: 'Pune', country: 'India' },
  });
  const plantB = await prisma.plant.create({
    data: { companyId: company.id, code: 'CHN1', name: 'Chennai Plant', city: 'Chennai', country: 'India' },
  });

  const deptSeeds = [
    { code: 'QA', name: 'Quality Assurance' },
    { code: 'PROD', name: 'Production' },
    { code: 'ENGG', name: 'Engineering' },
    { code: 'SCM', name: 'Supply Chain Management' },
    { code: 'HR', name: 'Human Resources' },
    { code: 'MTCE', name: 'Maintenance' },
  ];
  const departments = [];
  for (const d of deptSeeds) {
    departments.push(
      await prisma.department.create({ data: { plantId: plantA.id, code: d.code, name: d.name } }),
    );
  }
  const [qa, prod, engg, scm, hr, mtce] = departments;

  const processSeeds: Record<string, { code: string; name: string; children?: string[] }[]> = {
    [prod.id]: [
      { code: 'PR-10', name: 'Machining', children: ['Turning', 'Milling'] },
      { code: 'PR-20', name: 'Assembly' },
      { code: 'PR-30', name: 'Final Inspection' },
    ],
    [qa.id]: [{ code: 'QA-10', name: 'Incoming Inspection' }, { code: 'QA-20', name: 'Calibration' }],
    [scm.id]: [{ code: 'SC-10', name: 'Procurement' }, { code: 'SC-20', name: 'Warehousing' }],
  };
  for (const [departmentId, processes] of Object.entries(processSeeds)) {
    for (const p of processes) {
      const parent = await prisma.process.create({ data: { departmentId, code: p.code, name: p.name } });
      if (p.children) {
        let i = 1;
        for (const child of p.children) {
          await prisma.process.create({
            data: { departmentId, parentId: parent.id, code: `${p.code}.${i++}`, name: child },
          });
        }
      }
    }
  }

  // --- Users ----------------------------------------------------------------
  const roleRecords = await Promise.all(
    DEFAULT_ROLES.map((def) =>
      prisma.role.upsert({
        where: { code: def.code },
        update: { name: def.name, description: def.description, permissions: def.permissions, isSystem: true },
        create: {
          code: def.code,
          name: def.name,
          description: def.description,
          permissions: def.permissions,
          isSystem: true,
        },
      }),
    ),
  );
  const roleByCode = Object.fromEntries(roleRecords.map((r) => [r.code, r]));

  const users = await Promise.all(
    [
      { email: 'admin@acme.example', name: 'System Administrator', roleId: roleByCode.ADMIN.id, designation: 'IT Administrator', departmentId: null },
      { email: 'qmr@acme.example', name: 'Priya Nair', roleId: roleByCode.QMR.id, designation: 'Quality Management Representative', departmentId: qa.id },
      { email: 'lead@acme.example', name: 'Rahul Verma', roleId: roleByCode.LEAD_AUDITOR.id, designation: 'Lead Auditor', departmentId: qa.id },
      { email: 'auditor@acme.example', name: 'Sana Kapoor', roleId: roleByCode.AUDITOR.id, designation: 'Internal Auditor', departmentId: qa.id },
      { email: 'auditor2@acme.example', name: 'Vikram Singh', roleId: roleByCode.AUDITOR.id, designation: 'Internal Auditor', departmentId: engg.id },
      { email: 'auditee@acme.example', name: 'Meera Joshi', roleId: roleByCode.AUDITEE.id, designation: 'Production Engineer', departmentId: prod.id },
      { email: 'prodhead@acme.example', name: 'Arjun Rao', roleId: roleByCode.DEPT_HEAD.id, designation: 'Head of Production', departmentId: prod.id },
    ].map((u) =>
      prisma.user.create({
        data: { ...u, passwordHash, plantId: plantA.id },
      }),
    ),
  );
  const [admin, qmr, leadUser, auditorUser, auditor2User, auditeeUser, prodHead] = users;

  // --- People masters -------------------------------------------------------
  const auditors = await Promise.all([
    prisma.auditor.create({
      data: {
        userId: leadUser.id,
        type: 'INTERNAL',
        name: leadUser.name,
        email: leadUser.email,
        competencyLevel: 'LEAD',
        qualifications: ['ISO 9001 Lead Auditor', 'IATF 16949'],
        certifications: ['IRCA Certified'],
        competencyExpiry: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
        competentForCategories: ['SYSTEM', 'PROCESS', 'PRODUCT'],
      },
    }),
    prisma.auditor.create({
      data: {
        userId: auditorUser.id,
        type: 'INTERNAL',
        name: auditorUser.name,
        email: auditorUser.email,
        competencyLevel: 'QUALIFIED',
        qualifications: ['ISO 9001 Internal Auditor'],
        competencyExpiry: new Date(new Date().setMonth(new Date().getMonth() + 1)),
        competentForCategories: ['SYSTEM', 'PROCESS'],
      },
    }),
    prisma.auditor.create({
      data: {
        userId: auditor2User.id,
        type: 'INTERNAL',
        name: auditor2User.name,
        email: auditor2User.email,
        competencyLevel: 'SENIOR',
        qualifications: ['ISO 9001', 'VDA 6.3 Process Auditor'],
        competencyExpiry: new Date(new Date().setDate(new Date().getDate() + 45)),
        competentForCategories: ['PROCESS', 'PRODUCT'],
      },
    }),
    prisma.auditor.create({
      data: {
        type: 'EXTERNAL',
        name: 'Global Certifications LLP',
        organisation: 'Global Certifications LLP',
        email: 'audit@globalcert.example',
        competencyLevel: 'SENIOR',
        qualifications: ['IATF 16949', 'VDA 6.3'],
        competentForCategories: ['SYSTEM', 'PRODUCT', 'PROCESS'],
      },
    }),
  ]);
  const [leadAuditor, auditor1, auditor2] = auditors;

  await prisma.auditee.createMany({
    data: [
      { name: auditeeUser.name, email: auditeeUser.email, designation: 'Production Engineer', departmentId: prod.id },
      { name: prodHead.name, email: prodHead.email, designation: 'Head of Production', departmentId: prod.id },
      { name: 'Deepa Menon', email: 'deepa@acme.example', designation: 'SCM Manager', departmentId: scm.id },
    ],
  });

  // --- Audit setup ----------------------------------------------------------
  const [systemType, productType, processType] = await Promise.all([
    prisma.auditType.create({ data: { code: 'SYS', name: 'System Audit', category: 'SYSTEM', description: 'Full QMS system audit' } }),
    prisma.auditType.create({ data: { code: 'PRD', name: 'Product Audit', category: 'PRODUCT', description: 'Product conformity audit' } }),
    prisma.auditType.create({ data: { code: 'PRC', name: 'Process Audit', category: 'PROCESS', description: 'Manufacturing process audit (VDA 6.3)' } }),
  ]);

  const iso = await prisma.standard.create({ data: { code: 'ISO9001', name: 'ISO 9001', version: '2015', description: 'Quality management systems' } });
  const iatf = await prisma.standard.create({ data: { code: 'IATF16949', name: 'IATF 16949', version: '2016', description: 'Automotive quality management' } });
  const vda = await prisma.standard.create({ data: { code: 'VDA63', name: 'VDA 6.3', version: '2023', description: 'Process audit' } });

  const isoChecklist = await prisma.checklist.create({ data: { standardId: iso.id, code: 'ISO9001-CL', name: 'ISO 9001:2015 Audit Checklist', version: '1.0' } });
  const iatfChecklist = await prisma.checklist.create({ data: { standardId: iatf.id, code: 'IATF-CL', name: 'IATF 16949 Audit Checklist', version: '1.0' } });
  const vdaChecklist = await prisma.checklist.create({ data: { standardId: vda.id, code: 'VDA63-CL', name: 'VDA 6.3 Process Audit Checklist', version: '1.0' } });

  await insertClauses(isoChecklist.id, ISO_9001);
  await insertClauses(iatfChecklist.id, IATF_16949);
  await insertClauses(vdaChecklist.id, VDA_63);

  const program = await prisma.auditProgram.create({
    data: { code: 'AP-2026', name: 'Annual Audit Programme 2026', year: 2026, standardId: iso.id, status: 'ACTIVE' },
  });

  await prisma.findingTypeConfig.createMany({
    data: [
      { code: 'C', name: 'Conformity', description: 'Requirement fulfilled', requiresCapa: false },
      { code: 'NC', name: 'Nonconformity', description: 'Requirement not fulfilled', requiresCapa: true },
      { code: 'OFI', name: 'Opportunity for Improvement', description: 'Potential improvement', requiresCapa: false },
      { code: 'NA', name: 'Not Applicable', description: 'Clause not applicable', requiresCapa: false },
    ],
  });
  await prisma.severityConfig.createMany({
    data: [
      { code: 'MAJOR', name: 'Major', weight: 3, color: '#dc2626', description: 'Systemic failure, high risk' },
      { code: 'MINOR', name: 'Minor', weight: 2, color: '#f59e0b', description: 'Isolated lapse' },
      { code: 'OBSERVATION', name: 'Observation', weight: 1, color: '#f59e0b', description: 'Improvement opportunity' },
    ],
  });

  // --- Demo audits ----------------------------------------------------------
  const allClauses = await prisma.clause.findMany({ where: { checklistId: isoChecklist.id }, orderBy: { number: 'asc' } });

  // Audit 1: closed audit with findings + CAPA
  const audit1 = await prisma.audit.create({
    data: {
      code: 'AUD-2025-0001',
      title: 'System Audit - Production Department',
      programId: program.id,
      standardId: iso.id,
      auditTypeId: systemType.id,
      category: 'SYSTEM',
      plantId: plantA.id,
      departmentId: prod.id,
      scope: 'Machining and assembly processes at Pune Plant 1',
      objectives: 'Verify conformity of the QMS to ISO 9001:2015 requirements',
      criteria: 'ISO 9001:2015, QMS Manual, applicable SOPs',
      plannedStart: new Date(Date.now() - 45 * 86400000),
      plannedEnd: new Date(Date.now() - 42 * 86400000),
      actualStart: new Date(Date.now() - 45 * 86400000),
      actualEnd: new Date(Date.now() - 42 * 86400000),
      status: 'CLOSED',
      locked: true,
      createdById: leadUser.id,
      approvedById: qmr.id,
      approvedAt: new Date(Date.now() - 50 * 86400000),
    },
  });
  await prisma.auditAuditor.createMany({
    data: [
      { auditId: audit1.id, auditorId: leadAuditor.id, isLead: true },
      { auditId: audit1.id, auditorId: auditor1.id, isLead: false },
    ],
  });
  await prisma.auditClause.createMany({ data: allClauses.map((c) => ({ auditId: audit1.id, clauseId: c.id })) });
  for (const clause of allClauses) {
    const documented = clause.number.startsWith('8') ? 'YES' : 'YES';
    await prisma.auditResponse.create({
      data: { auditId: audit1.id, clauseId: clause.id, documented, implemented: 'YES', applicable: true, answeredById: leadUser.id, answeredAt: new Date(Date.now() - 44 * 86400000) },
    });
  }

  const capa8_5 = await prisma.finding.create({
    data: {
      code: 'NC-2025-0001',
      auditId: audit1.id,
      clauseId: allClauses.find((c) => c.number === '8.5')?.id ?? null,
      departmentId: prod.id,
      type: 'NC',
      severity: 'MAJOR',
      title: 'Work instructions not available at the assembly station',
      requirement: 'ISO 9001:2015 8.5.1 - Controlled conditions',
      observation: 'At assembly station 3, the current work instruction revision was not available; operators referenced an obsolete revision.',
      objectiveEvidence: 'Photo evidence attached; revision 2.1 observed against the current revision 3.0.',
      status: 'CLOSED',
      raisedById: leadUser.id,
      dueDate: new Date(Date.now() - 10 * 86400000),
    },
  });
  await prisma.finding.create({
    data: {
      code: 'OFI-2025-0001',
      auditId: audit1.id,
      clauseId: allClauses.find((c) => c.number === '9.1')?.id ?? null,
      departmentId: prod.id,
      type: 'OFI',
      severity: 'OBSERVATION',
      title: 'Automate OEE data capture',
      observation: 'OEE is currently computed manually, increasing the risk of transcription errors.',
      status: 'OPEN',
      raisedById: leadUser.id,
    },
  });

  await prisma.capa.create({
    data: {
      findingId: capa8_5.id,
      status: 'CLOSED',
      acknowledgedAt: new Date(Date.now() - 40 * 86400000),
      acknowledgedBy: prodHead.name,
      immediateCorrection: 'Removed obsolete revision and re-issued current revision at the station.',
      correctionDate: new Date(Date.now() - 39 * 86400000),
      rootCauseMethod: 'FIVE_WHY',
      rootCause: 'Document control distribution list was not updated after the revision change.',
      targetDate: new Date(Date.now() - 10 * 86400000),
      responsibleId: prodHead.id,
      submittedAt: new Date(Date.now() - 20 * 86400000),
      acceptedAt: new Date(Date.now() - 18 * 86400000),
      acceptedBy: leadUser.name,
      verificationMethod: 'On-site verification of controlled document distribution.',
      verificationNotes: 'Current revision verified at all assembly stations.',
      effectivenessResult: 'Effective - no recurrence in 3 audits.',
      verifiedAt: new Date(Date.now() - 5 * 86400000),
      verifiedById: leadUser.id,
      closedAt: new Date(Date.now() - 4 * 86400000),
      whys: {
        create: [
          { level: 1, question: 'Why was the obsolete instruction available?', answer: 'The station folder was not updated.' },
          { level: 2, question: 'Why was the folder not updated?', answer: 'Distribution list was incomplete.' },
          { level: 3, question: 'Why was the distribution list incomplete?', answer: 'No trigger to review it on revision change.' },
          { level: 4, question: 'Why was there no trigger?', answer: 'Document change procedure lacked a distribution step.' },
          { level: 5, question: 'Why did the procedure lack it?', answer: 'Procedure not updated after ERP rollout.' },
        ],
      },
      actions: {
        create: [
          { description: 'Update document change procedure to include distribution verification', responsible: 'QA', status: 'DONE', completedAt: new Date(Date.now() - 15 * 86400000) },
          { description: 'Retrain operators on controlled document handling', responsible: 'Production', status: 'DONE', completedAt: new Date(Date.now() - 12 * 86400000) },
        ],
      },
    },
  });

  // Audit 2: in-progress audit with a partially completed, open NC + CAPA
  const audit2 = await prisma.audit.create({
    data: {
      code: 'AUD-2026-0001',
      title: 'Process Audit - Assembly Line',
      programId: program.id,
      standardId: vda.id,
      auditTypeId: processType.id,
      category: 'PROCESS',
      plantId: plantA.id,
      departmentId: engg.id,
      scope: 'Assembly line processes and control plan adherence',
      objectives: 'Assess process capability and control plan compliance',
      criteria: 'VDA 6.3, Control Plans',
      plannedStart: new Date(Date.now() - 3 * 86400000),
      plannedEnd: new Date(Date.now() + 2 * 86400000),
      actualStart: new Date(Date.now() - 3 * 86400000),
      status: 'CAPA_IN_PROGRESS',
      locked: true,
      createdById: leadUser.id,
      approvedById: qmr.id,
      approvedAt: new Date(Date.now() - 6 * 86400000),
    },
  });
  await prisma.auditAuditor.createMany({
    data: [
      { auditId: audit2.id, auditorId: leadAuditor.id, isLead: true },
      { auditId: audit2.id, auditorId: auditor2.id, isLead: false },
    ],
  });
  const vdaClauses = await prisma.clause.findMany({ where: { checklistId: vdaChecklist.id } });
  await prisma.auditClause.createMany({ data: vdaClauses.map((c) => ({ auditId: audit2.id, clauseId: c.id })) });
  for (const clause of vdaClauses) {
    await prisma.auditResponse.create({
      data: { auditId: audit2.id, clauseId: clause.id, documented: 'YES', implemented: clause.number === 'P6.4' ? 'NO' : 'YES', applicable: true, answeredById: leadUser.id, answeredAt: new Date() },
    });
  }
  const capaFinding = await prisma.finding.create({
    data: {
      code: 'NC-2026-0001',
      auditId: audit2.id,
      clauseId: vdaClauses.find((c) => c.number === 'P6.4')?.id ?? null,
      departmentId: engg.id,
      type: 'NC',
      severity: 'MINOR',
      title: 'Preventive maintenance overdue on press machine',
      requirement: 'VDA 6.3 P6.4 - Production resources',
      observation: 'Preventive maintenance for press machine PM-04 was overdue by 12 days.',
      objectiveEvidence: 'Maintenance register and PM schedule.',
      status: 'OPEN',
      raisedById: leadUser.id,
      dueDate: new Date(Date.now() + 20 * 86400000),
    },
  });
  await prisma.capa.create({
    data: {
      findingId: capaFinding.id,
      status: 'ACKNOWLEDGED',
      acknowledgedAt: new Date(Date.now() - 1 * 86400000),
      acknowledgedBy: prodHead.name,
      immediateCorrection: 'Immediate PM performed on PM-04.',
      correctionDate: new Date(Date.now() - 1 * 86400000),
      rootCauseMethod: 'FIVE_WHY',
      targetDate: new Date(Date.now() + 20 * 86400000),
      responsibleId: prodHead.id,
    },
  });

  // Audit 3: draft audit awaiting planning completion.
  await prisma.audit.create({
    data: {
      code: 'AUD-2026-0002',
      title: 'Product Audit - Machined Components',
      programId: program.id,
      standardId: iso.id,
      auditTypeId: productType.id,
      category: 'PRODUCT',
      plantId: plantB.id,
      departmentId: scm.id,
      status: 'DRAFT',
      createdById: leadUser.id,
    },
  });

  await prisma.document.create({
    data: {
      code: 'SOP-001',
      name: 'Document Control Procedure',
      type: 'SOP',
      standardId: iso.id,
      status: 'APPROVED',
      currentVersion: '3.0',
      description: 'Defines how controlled documents are created, approved and distributed.',
      uploadedById: qmr.id,
    },
  });

  console.log('[seed] complete');
  console.log(`[seed] login: admin@acme.example / ${DEFAULT_PASSWORD}`);
  console.log(`[seed] roles: qmr@acme.example, lead@acme.example, auditor@acme.example, auditee@acme.example, prodhead@acme.example`);
}

main()
  .catch((error) => {
    console.error('[seed] failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
