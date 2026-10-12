import { Router, type Response } from 'express';
import PDFDocument from 'pdfkit';
import { stringify } from 'csv-stringify';
import { prisma } from '../lib/prisma.js';
import { asyncHandler, ApiError } from '../lib/http.js';
import { authenticate } from '../middleware/auth.js';
import { authorize } from '../middleware/rbac.js';

export const reportsRouter = Router();
reportsRouter.use(authenticate);
reportsRouter.use(authorize('reports.view'));

function sendCsv(res: Response, filename: string, columns: string[], rows: Record<string, unknown>[]) {
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  const stringifier = stringify({ header: true, columns });
  stringifier.pipe(res);
  for (const row of rows) stringifier.write(row);
  stringifier.end();
}

function sendPdf(
  res: Response,
  filename: string,
  title: string,
  subtitle: string,
  headers: string[],
  widths: number[],
  rows: string[][],
) {
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  const doc = new PDFDocument({ size: 'A4', margin: 40, layout: 'landscape' });
  doc.pipe(res);

  doc.fontSize(18).fillColor('#0f172a').text(title);
  doc.moveDown(0.2);
  doc.fontSize(9).fillColor('#64748b').text(subtitle);
  doc.moveDown(0.6);

  const startX = doc.x;
  const totalWidth = widths.reduce((a, b) => a + b, 0);
  let y = doc.y;
  const rowHeight = 20;

  const drawHeader = () => {
    doc.rect(startX, y, totalWidth, rowHeight).fill('#1e293b');
    doc.fillColor('#ffffff').fontSize(9);
    let x = startX;
    headers.forEach((h, i) => {
      doc.text(h, x + 4, y + 6, { width: widths[i] - 8, ellipsis: true });
      x += widths[i];
    });
    y += rowHeight;
    doc.y = y;
  };

  drawHeader();
  doc.fillColor('#0f172a').fontSize(8);

  rows.forEach((row, idx) => {
    if (y + rowHeight > doc.page.height - 50) {
      doc.addPage();
      y = doc.y;
      drawHeader();
      doc.fillColor('#0f172a');
    }
    if (idx % 2 === 1) {
      doc.rect(startX, y, totalWidth, rowHeight).fill('#f1f5f9');
      doc.fillColor('#0f172a');
    }
    let x = startX;
    row.forEach((cell, i) => {
      doc.text(String(cell ?? ''), x + 4, y + 6, { width: widths[i] - 8, ellipsis: true });
      x += widths[i];
    });
    y += rowHeight;
    doc.y = y;
  });

  doc.end();
}

reportsRouter.get(
  '/nc-register',
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? 'csv');
    const now = new Date();
    const findings = await prisma.finding.findMany({
      where: { type: 'NC' },
      include: { audit: { select: { code: true } }, department: { select: { name: true } }, capa: true },
      orderBy: { createdAt: 'desc' },
    });
    const rows = findings.map((f) => ({
      code: f.code,
      audit: f.audit.code,
      department: f.department?.name ?? '-',
      severity: f.severity ?? '-',
      title: f.title,
      status: f.status,
      capaStatus: f.capa?.status ?? 'NONE',
      dueDate: f.dueDate ? f.dueDate.toISOString().slice(0, 10) : '-',
      overdue: f.dueDate && f.dueDate < now && f.status !== 'CLOSED' ? 'YES' : 'NO',
    }));
    if (format === 'pdf') {
      sendPdf(
        res,
        'nc-register',
        'Nonconformity Register',
        `Generated ${now.toISOString().slice(0, 10)} - ${rows.length} record(s)`,
        ['Code', 'Audit', 'Department', 'Severity', 'Title', 'Status', 'CAPA', 'Due', 'Overdue'],
        [70, 70, 90, 65, 220, 70, 70, 65, 55],
        rows.map((r) => [r.code, r.audit, r.department, r.severity, r.title, r.status, r.capaStatus, r.dueDate, r.overdue]),
      );
      return;
    }
    sendCsv(res, 'nc-register', ['code', 'audit', 'department', 'severity', 'title', 'status', 'capaStatus', 'dueDate', 'overdue'], rows);
  }),
);

reportsRouter.get(
  '/department-findings',
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? 'csv');
    const findings = await prisma.finding.findMany({
      include: {
        department: { select: { name: true } },
        clause: { select: { number: true, title: true } },
        audit: { select: { code: true } },
      },
      orderBy: [{ departmentId: 'asc' }, { createdAt: 'asc' }],
    });
    const rows = findings.map((f) => ({
      department: f.department?.name ?? 'Unassigned',
      audit: f.audit.code,
      clause: f.clause ? `${f.clause.number} ${f.clause.title}` : '-',
      type: f.type,
      severity: f.severity ?? '-',
      title: f.title,
      status: f.status,
    }));
    if (format === 'pdf') {
      sendPdf(
        res,
        'department-findings',
        'Department / Clause-wise Findings',
        `Generated ${new Date().toISOString().slice(0, 10)} - ${rows.length} record(s)`,
        ['Department', 'Audit', 'Clause', 'Type', 'Severity', 'Title', 'Status'],
        [110, 70, 200, 50, 70, 260, 70],
        rows.map((r) => [r.department, r.audit, r.clause, r.type, r.severity, r.title, r.status]),
      );
      return;
    }
    sendCsv(res, 'department-findings', ['department', 'audit', 'clause', 'type', 'severity', 'title', 'status'], rows);
  }),
);

reportsRouter.get(
  '/audit-summary/:id',
  asyncHandler(async (req, res) => {
    const format = String(req.query.format ?? 'pdf');
    const audit = await prisma.audit.findUnique({
      where: { id: req.params.id },
      include: {
        standard: true,
        auditType: true,
        plant: true,
        department: true,
        team: { include: { auditor: true } },
        findings: { include: { clause: true } },
        responses: true,
        clauses: true,
      },
    });
    if (!audit) throw ApiError.notFound('Audit not found');

    const summary = {
      code: audit.code,
      title: audit.title,
      standard: audit.standard?.name ?? '-',
      type: audit.auditType?.name ?? audit.category,
      plant: audit.plant?.name ?? '-',
      department: audit.department?.name ?? '-',
      status: audit.status,
      planned: `${audit.plannedStart?.toISOString().slice(0, 10) ?? '-'} to ${audit.plannedEnd?.toISOString().slice(0, 10) ?? '-'}`,
      clauses: audit.clauses.length,
      answered: audit.responses.length,
      findings: audit.findings.length,
      nc: audit.findings.filter((f) => f.type === 'NC').length,
      ofi: audit.findings.filter((f) => f.type === 'OFI').length,
      team: audit.team.map((t) => `${t.auditor.name}${t.isLead ? ' (Lead)' : ''}`).join(', '),
    };

    if (format === 'csv') {
      const record = summary as unknown as Record<string, unknown>;
      sendCsv(res, `audit-${audit.code}`, Object.keys(record), [record]);
      return;
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="audit-${audit.code}.pdf"`);
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    doc.pipe(res);
    doc.fontSize(20).fillColor('#0f172a').text('Audit Summary Report');
    doc.moveDown(0.3);
    doc.fontSize(11).fillColor('#334155').text(`${audit.code} - ${audit.title}`);
    doc.moveDown(1);
    Object.entries(summary).forEach(([key, value]) => {
      doc.fontSize(10).fillColor('#64748b').text(`${key}:`, { continued: true });
      doc.fillColor('#0f172a').text(` ${String(value)}`);
    });
    doc.moveDown(1);
    doc.fontSize(13).fillColor('#0f172a').text('Findings');
    doc.moveDown(0.4);
    if (audit.findings.length === 0) {
      doc.fontSize(10).fillColor('#64748b').text('No findings recorded.');
    } else {
      audit.findings.forEach((f) => {
        doc
          .fontSize(10)
          .fillColor('#0f172a')
          .text(`${f.code} [${f.type}/${f.severity ?? '-'}] ${f.clause ? `${f.clause.number} - ` : ''}${f.title}`);
        doc.fontSize(9).fillColor('#475569').text(f.observation, { indent: 12 });
        doc.moveDown(0.4);
      });
    }
    doc.end();
  }),
);
