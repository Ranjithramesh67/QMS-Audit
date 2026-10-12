import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileText } from 'lucide-react';
import { PageHeader } from '@/components/common/page-header';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { api, apiError, resources } from '@/lib/api';

interface Audit {
  id: string;
  code: string;
  title: string;
  status: string;
}

export function ReportsPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [auditId, setAuditId] = useState<string>('');

  const auditsQuery = useQuery({
    queryKey: ['audits', 'report-options'],
    queryFn: () => resources.list<Audit>('/audits', { page: 1, pageSize: 100 }),
  });
  const audits = auditsQuery.data?.items ?? [];

  const download = async (path: string, filename: string) => {
    setBusy(filename);
    try {
      const response = await api.get(path, { responseType: 'blob' });
      const url = URL.createObjectURL(response.data as Blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded ${filename}`);
    } catch (error) {
      toast.error(apiError(error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title="Reports" description="Export audit records and findings for offline review." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>NC Register</CardTitle>
            <CardDescription>Full register of non-conformities and observations.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => download('/reports/nc-register?format=csv', 'nc-register.csv')}
              disabled={busy === 'nc-register.csv'}
            >
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => download('/reports/nc-register?format=pdf', 'nc-register.pdf')}
              disabled={busy === 'nc-register.pdf'}
            >
              <FileText /> PDF
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Department / Clause-wise Findings</CardTitle>
            <CardDescription>Findings aggregated by department and standard clause.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => download('/reports/department-findings?format=csv', 'department-findings.csv')}
              disabled={busy === 'department-findings.csv'}
            >
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => download('/reports/department-findings?format=pdf', 'department-findings.pdf')}
              disabled={busy === 'department-findings.pdf'}
            >
              <FileText /> PDF
            </Button>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Audit Summary</CardTitle>
          <CardDescription>Select an audit to export its summary report.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="max-w-md">
            <Select value={auditId} onValueChange={setAuditId}>
              <SelectTrigger>
                <SelectValue placeholder={auditsQuery.isLoading ? 'Loading audits...' : 'Select an audit'} />
              </SelectTrigger>
              <SelectContent>
                {audits.map((audit) => (
                  <SelectItem key={audit.id} value={audit.id}>
                    {audit.code} - {audit.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => download(`/reports/audit-summary/${auditId}?format=csv`, `audit-summary-${auditId}.csv`)}
              disabled={!auditId || busy === `audit-summary-${auditId}.csv`}
            >
              <Download /> CSV
            </Button>
            <Button
              variant="outline"
              onClick={() => download(`/reports/audit-summary/${auditId}?format=pdf`, `audit-summary-${auditId}.pdf`)}
              disabled={!auditId || busy === `audit-summary-${auditId}.pdf`}
            >
              <FileText /> PDF
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
