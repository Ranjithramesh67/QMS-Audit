import { useQuery } from '@tanstack/react-query';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/common/page-header';
import { DataTable, type Column } from '@/components/common/data-table';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingBlock } from '@/components/ui/spinner';
import { resources } from '@/lib/api';

interface DepartmentFinding {
  departmentId: string;
  department: string;
  total: number;
  nc: number;
  ofi: number;
}

interface ClauseFinding {
  clauseId: string;
  clause: string;
  count: number;
}

interface CapaStatus {
  status: string;
  count: number;
}

interface NcTrend {
  month: string;
  major: number;
  minor: number;
  ofi: number;
}

const PALETTE = ['#047857', '#ef4444', '#f59e0b', '#22c55e', '#92400e', '#14b8a6', '#ec4899', '#a8a29e'];

function monthLabel(month: string): string {
  const [year, m] = month.split('-');
  const date = new Date(Number(year), Number(m) - 1, 1);
  if (Number.isNaN(date.getTime())) return month;
  return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}

export function AnalyticsPage() {
  const departmentQuery = useQuery({
    queryKey: ['analytics', 'department-findings'],
    queryFn: () => resources.all<DepartmentFinding>('/analytics/department-findings'),
  });
  const clauseQuery = useQuery({
    queryKey: ['analytics', 'clause-findings'],
    queryFn: () => resources.all<ClauseFinding>('/analytics/clause-findings'),
  });
  const capaStatusQuery = useQuery({
    queryKey: ['analytics', 'capa-status'],
    queryFn: () => resources.all<CapaStatus>('/analytics/capa-status'),
  });
  const ncTrendsQuery = useQuery({
    queryKey: ['analytics', 'nc-trends'],
    queryFn: () => resources.all<NcTrend>('/analytics/nc-trends'),
  });

  const departments = departmentQuery.data ?? [];
  const clauses = (clauseQuery.data ?? []).slice(0, 12);
  const capaStatuses = capaStatusQuery.data ?? [];
  const ncTrends = (ncTrendsQuery.data ?? []).map((item) => ({
    label: monthLabel(item.month),
    major: item.major,
    minor: item.minor,
    ofi: item.ofi,
  }));

  const columns: Column<DepartmentFinding>[] = [
    { key: 'department', header: 'Department', sortable: true },
    { key: 'total', header: 'Total', sortable: true, className: 'w-24 text-right' },
    { key: 'nc', header: 'NC', sortable: true, className: 'w-24 text-right' },
    { key: 'ofi', header: 'OFI', sortable: true, className: 'w-24 text-right' },
  ];

  return (
    <div className="space-y-5">
      <PageHeader title="Analytics" description="Finding distribution and corrective action performance." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Findings by department</CardTitle>
            <CardDescription>Total findings and non-conformities per department.</CardDescription>
          </CardHeader>
          <CardContent>
            {departmentQuery.isLoading ? (
              <LoadingBlock />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={departments} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="department" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="total" name="Total" fill="#047857" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="nc" name="NC" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Findings by clause</CardTitle>
            <CardDescription>Top standard clauses by finding count.</CardDescription>
          </CardHeader>
          <CardContent>
            {clauseQuery.isLoading ? (
              <LoadingBlock />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={clauses}
                    layout="vertical"
                    margin={{ top: 4, right: 16, bottom: 0, left: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 12 }} />
                    <YAxis type="category" dataKey="clause" width={180} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" name="Findings" fill="#047857" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>CAPA status</CardTitle>
            <CardDescription>Corrective actions grouped by status.</CardDescription>
          </CardHeader>
          <CardContent>
            {capaStatusQuery.isLoading ? (
              <LoadingBlock />
            ) : (
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={capaStatuses} dataKey="count" nameKey="status" outerRadius={90} label>
                      {capaStatuses.map((entry, index) => (
                        <Cell key={entry.status} fill={PALETTE[index % PALETTE.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
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
                  <LineChart data={ncTrends} margin={{ top: 8, right: 16, bottom: 0, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="major" name="Major" stroke="#ef4444" strokeWidth={2} />
                    <Line type="monotone" dataKey="minor" name="Minor" stroke="#f59e0b" strokeWidth={2} />
                    <Line type="monotone" dataKey="ofi" name="OFI" stroke="#F59E0B" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Department-wise findings</CardTitle>
          <CardDescription>Breakdown of non-conformities and improvement opportunities.</CardDescription>
        </CardHeader>
        <CardContent>
          <DataTable
            columns={columns}
            rows={departments}
            loading={departmentQuery.isLoading}
            rowKey={(row) => row.departmentId}
            emptyTitle="No data available"
            emptyDescription="Department findings will appear once audits are executed."
          />
        </CardContent>
      </Card>
    </div>
  );
}
