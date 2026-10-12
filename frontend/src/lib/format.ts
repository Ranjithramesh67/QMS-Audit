import { format, formatDistanceToNow, isValid, parseISO } from 'date-fns';

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = typeof value === 'string' ? parseISO(value) : value;
  return isValid(date) ? date : null;
}

export function fmtDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy') : '-';
}

export function fmtDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy, HH:mm') : '-';
}

export function relativeTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? formatDistanceToNow(date, { addSuffix: true }) : '-';
}

export function toInputDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
}

export const titleCase = (value: string) =>
  value
    .toLowerCase()
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

/** Human-friendly labels for enum codes used across the app. */
export const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft',
  PLANNED: 'Planned',
  PENDING_APPROVAL: 'Pending Approval',
  APPROVED: 'Approved',
  IN_PROGRESS: 'In Progress',
  FINDINGS_RECORDED: 'Findings Recorded',
  CAPA_IN_PROGRESS: 'CAPA In Progress',
  VERIFICATION: 'Verification',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
  PENDING: 'Pending',
  ACKNOWLEDGED: 'Acknowledged',
  SUBMITTED: 'Submitted',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  VERIFIED: 'Verified',
  OPEN: 'Open',
};
