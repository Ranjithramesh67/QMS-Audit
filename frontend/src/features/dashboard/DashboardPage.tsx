import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  Lightbulb,
  ShieldAlert,
} from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { StatCard } from '@/components/common/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge, statusVariant } from '@/components/ui/badge';
import { LoadingBlock } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { resources } from '@/lib/api';
import { fmtDate } from '@/lib/format';

interface AnalyticsSummary {
  audits: { total: number; completed: number; active: number; plannedVsCompletedRate: number };
  findings: { total: number; majorNc: number; minorNc: number; ofi: number; openNc: number; overdueNc: number };
  capa: { total: number; closed: number; effectivenessRate: number };
}

interface AuditsByMonth {
  month: string;
  planned: number;
  completed: number;
}

interface NcTrend {
  month: string;
  major: number;
  minor: number;
  ofi: number;
}

interface OverdueFinding {
  id: string;
  code: string;
  title: string;
  dueDate: string | null;
  department?: { name: string } | null;
  audit?: { code: string } | null;
}

interface OverdueCapa {
  id: string;
  status: string;
  targetDate: string | null;
  finding?: { code: string; title: string } | null;
}

interface OverdueResponse {
  overdueFindings: OverdueFinding[];
  overdueCapas: OverdueCapa[];
}

function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

export function DashboardPage() {
  const summaryQuery = useQuery({
    queryKey: ['analytics', 'summary'],
    queryFn: () => resources.get<AnalyticsSummary>('/analytics/summary'),
  });
  const auditsByMonthQuery = useQuery({
    queryKey: ['analytics', 'audits-by-month'],
    queryFn: () => resources.all<AuditsByMonth>('/analytics/audits-by-month'),
  });
  const ncTrendsQuery = useQuery({
    queryKey: ['analytics', 'nc-trends'],
    queryFn: () => resources.all<NcTrend>('/analytics/nc-trends'),
  });
  const overdueQuery = useQuery({
    queryKey: ['analytics', 'overdue'],
    queryFn: () => resources.get<OverdueResponse>('/analytics/overdue'),
  });

  const summary = summaryQuery.data;
  const auditsByMonth = (auditsByMonthQuery.data ?? []).map((item) => ({
    label: monthLabel(item.month),
    planned: item.planned,
    completed: item.completed,
  }));
  const ncTrends = (ncTrendsQuery.data ?? []).map((item) => ({
    label: monthLabel(item.month),
    major: item.major,
    minor: item.minor,
    ofi: item.ofi,
  }));

  const overdueFindings = overdueQuery.data?.overdueFindings ?? [];
  const overdueCapas = overdueQuery.data?.overdueCapas ?? [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="Quality Dashboard"
        description="Live overview of audit progress, findings and corrective actions."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Total Audits"
          value={summary ? summary.audits.total : '-'}
          hint={summary ? `${summary.audits.active} active` : undefined}
          icon={ClipboardList}
        />
        <StatCard
          label="Completed Audits"
          value={summary ? summary.audits.completed : '-'}
          hint={summary ? `${summary.audits.plannedVsCompletedRate}% completion rate` : undefined}
          icon={CheckCircle2}
          tone="success"
        />
        <StatCard
          label="Open NCs"
          value={summary ? summary.findings.openNc : '-'}
          hint={summary ? `${summary.findings.total} findings total` : undefined}
          icon={AlertTriangle}
          tone="warning"
        />
        <StatCard
          label="Overdue NCs"
          value={summary ? summary.findings.overdueNc : '-'}
          hint="Past due date"
          icon={Clock}
          tone="danger"
        />
        <StatCard
          label="Major NC"
          value={summary ? summary.findings.majorNc : '-'}
          hint={summary ? `${summary.findings.minorNc} minor` : undefined}
          icon={ShieldAlert}
          tone="danger"
        />
        <StatCard
          label="OFI"
          value={summary ? summary.findings.ofi : '-'}
          hint="Opportunities for improvement"
          icon={Lightbulb}
          tone="info"
        />
        <StatCard
          label="CAPA Effectiveness"
          value={summary ? `${summary.capa.effectivenessRate}%` : '-'}
          hint={summary ? `${summary.capa.closed}/${summary.capa.total} closed` : undefined}
          icon={BadgeCheck}
          tone="success"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Audits planned vs completed</CardTitle>
            <CardDescription>Monthly audit execution against plan.</CardDescription>
          </CardHeader>
          <CardContent>
            {auditsByMonthQuery.isLoading ? (
              <LoadingBlock />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={auditsByMonth} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="planned" name="Planned" stroke="#047857" strokeWidth={2} />
                    <Line type="monotone" dataKey="completed" name="Completed" stroke="#22c55e" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>NC trends</CardTitle>
            <CardDescription>Major, minor and OFI findings over time.</CardDescription>
          </CardHeader>
          <CardContent>
            {ncTrendsQuery.isLoading ? (
              <LoadingBlock />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={ncTrends} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="major" name="Major" fill="#ef4444" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="minor" name="Minor" fill="#f59e0b" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="ofi" name="OFI" fill="#F59E0B" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overdue findings</CardTitle>
            <CardDescription>Findings past their due date.</CardDescription>
          </CardHeader>
          <CardContent>
            {overdueQuery.isLoading ? (
              <LoadingBlock />
            ) : overdueFindings.length === 0 ? (
              <EmptyState title="No overdue findings" description="All findings are within their due dates." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead>Due</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueFindings.map((finding) => (
                    <TableRow key={finding.id}>
                      <TableCell className="font-medium">
                        <Link to={`/findings/${finding.id}`} className="text-accent hover:underline">
                          {finding.code}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[16rem] truncate">{finding.title}</TableCell>
                      <TableCell>{finding.department?.name ?? '-'}</TableCell>
                      <TableCell className="whitespace-nowrap text-destructive">{fmtDate(finding.dueDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Overdue CAPA</CardTitle>
            <CardDescription>Corrective actions past their target date.</CardDescription>
          </CardHeader>
          <CardContent>
            {overdueQuery.isLoading ? (
              <LoadingBlock />
            ) : overdueCapas.length === 0 ? (
              <EmptyState title="No overdue CAPA" description="All corrective actions are on track." />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Finding</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Target</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {overdueCapas.map((capa) => (
                    <TableRow key={capa.id}>
                      <TableCell className="font-medium">
                        <Link to={`/capa/${capa.id}`} className="text-accent hover:underline">
                          {capa.finding?.code ?? capa.id}
                        </Link>
                        <span className="ml-2 text-xs text-muted-foreground">{capa.finding?.title ?? ''}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(capa.status)}>{capa.status.replace(/_/g, ' ')}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-destructive">{fmtDate(capa.targetDate)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
