import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  AlarmClock,
  AlertTriangle,
  Bell,
  CalendarClock,
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardCheck,
  Info,
  RefreshCw,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadingBlock } from '@/components/ui/spinner';
import { EmptyState } from '@/components/ui/empty-state';
import { PageHeader } from '@/components/common/page-header';
import { api, apiError, resources } from '@/lib/api';
import { relativeTime } from '@/lib/format';
import { useAuth } from '@/store/auth';
import { cn } from '@/lib/utils';

type NotificationType =
  | 'AUDIT_SCHEDULED'
  | 'DEADLINE_UPCOMING'
  | 'NC_ASSIGNED'
  | 'CAPA_OVERDUE'
  | 'APPROVAL_REQUIRED'
  | 'APPROVAL_DECISION'
  | 'SYSTEM';

interface NotificationRecord {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  read: boolean;
  createdAt: string;
  emailedAt?: string | null;
}

interface ScanResult {
  upcomingAudits: number;
  dueFindings: number;
  overdueCapas: number;
  notificationsCreated: number;
}

const TYPE_META: Record<NotificationType, { icon: LucideIcon; className: string }> = {
  AUDIT_SCHEDULED: { icon: CalendarClock, className: 'bg-emerald-100 text-emerald-700' },
  DEADLINE_UPCOMING: { icon: AlarmClock, className: 'bg-amber-100 text-amber-700' },
  NC_ASSIGNED: { icon: AlertTriangle, className: 'bg-red-100 text-red-700' },
  CAPA_OVERDUE: { icon: Wrench, className: 'bg-orange-100 text-orange-700' },
  APPROVAL_REQUIRED: { icon: ClipboardCheck, className: 'bg-amber-100 text-amber-700' },
  APPROVAL_DECISION: { icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-700' },
  SYSTEM: { icon: Info, className: 'bg-secondary text-muted-foreground' },
};

function metaFor(type: NotificationType) {
  return TYPE_META[type] ?? { icon: Bell, className: 'bg-secondary text-muted-foreground' };
}

function routeFor(entityType?: string | null, entityId?: string | null): string | null {
  if (!entityType || !entityId) return null;
  switch (entityType.toLowerCase()) {
    case 'finding':
      return `/findings/${entityId}`;
    case 'capa':
      return `/capa/${entityId}`;
    case 'audit':
      return `/audits/${entityId}`;
    default:
      return null;
  }
}

export function NotificationsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const can = useAuth((s) => s.can);
  const canScan = can('notifications.broadcast');

  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(1);

  const listQuery = useQuery({
    queryKey: ['notifications', tab, page],
    queryFn: () =>
      resources.list<NotificationRecord>('/notifications', {
        page,
        pageSize: 20,
        ...(tab === 'unread' ? { unread: true } : {}),
      }),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({
    mutationFn: (id: string) => api.post(`/notifications/${id}/read`).then((r) => r.data),
    onSuccess: invalidate,
    onError: (error) => toast.error(apiError(error)),
  });

  const markAllRead = useMutation({
    mutationFn: () => api.post('/notifications/read-all').then((r) => r.data),
    onSuccess: () => {
      toast.success('All notifications marked as read');
      invalidate();
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const scanDeadlines = useMutation({
    mutationFn: () => api.post<ScanResult>('/notifications/scan-deadlines').then((r) => r.data),
    onSuccess: (result) => {
      toast.success(`${result.notificationsCreated} notification(s) created`, {
        description: `${result.upcomingAudits} upcoming audits, ${result.dueFindings} due findings, ${result.overdueCapas} overdue CAPAs`,
      });
      invalidate();
    },
    onError: (error) => toast.error(apiError(error)),
  });

  const openNotification = (record: NotificationRecord) => {
    if (!record.read) markRead.mutate(record.id);
    const route = routeFor(record.entityType, record.entityId);
    if (route) navigate(route);
  };

  const items = listQuery.data?.items ?? [];
  const data = listQuery.data;

  const renderList = () => {
    if (listQuery.isLoading) return <LoadingBlock />;
    if (items.length === 0) {
      return (
        <EmptyState
          icon={Bell}
          title={tab === 'unread' ? 'No unread notifications' : 'No notifications'}
          description={tab === 'unread' ? 'You are all caught up.' : 'Notifications will appear here as activity occurs.'}
        />
      );
    }
    return (
      <div className="rounded-lg border border-border bg-card">
        {items.map((record) => {
          const meta = metaFor(record.type);
          const Icon = meta.icon;
          return (
            <div
              key={record.id}
              role="button"
              tabIndex={0}
              onClick={() => openNotification(record)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  openNotification(record);
                }
              }}
              className={cn(
                'flex w-full cursor-pointer items-start gap-3 border-b border-border px-4 py-3 text-left transition-colors last:border-0 hover:bg-secondary/50',
                !record.read && 'bg-accent/5',
              )}
            >
              <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', meta.className)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  {!record.read && <span className="h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />}
                  <span className="truncate text-sm font-medium text-foreground">{record.title}</span>
                </span>
                <span className="mt-0.5 block text-sm text-muted-foreground">{record.message}</span>
                <span className="mt-1 block text-xs text-muted-foreground">{relativeTime(record.createdAt)}</span>
              </span>
              {!record.read && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0"
                  disabled={markRead.isPending}
                  onClick={(e) => {
                    e.stopPropagation();
                    markRead.mutate(record.id);
                  }}
                >
                  <Check className="h-3.5 w-3.5" /> Mark read
                </Button>
              )}
            </div>
          );
        })}
        {data && data.total > 0 && (
          <div className="flex items-center justify-between border-t border-border px-4 py-3 text-sm text-muted-foreground">
            <span>
              {data.total} notification{data.total === 1 ? '' : 's'} - page {data.page} of {data.totalPages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={data.page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={data.page >= data.totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Alerts for audits, findings, CAPA and approvals."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
            >
              <CheckCheck className="h-4 w-4" /> Mark all read
            </Button>
            {canScan && (
              <Button variant="accent" size="sm" disabled={scanDeadlines.isPending} onClick={() => scanDeadlines.mutate()}>
                <RefreshCw className={cn('h-4 w-4', scanDeadlines.isPending && 'animate-spin')} /> Scan deadlines
              </Button>
            )}
          </>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setTab(v as 'all' | 'unread');
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsTrigger value="unread">Unread</TabsTrigger>
        </TabsList>
      </Tabs>

      {renderList()}
    </div>
  );
}
