import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        outline: 'border-border text-foreground',
        success: 'border-transparent bg-emerald-100 text-emerald-800',
        warning: 'border-transparent bg-amber-100 text-amber-800',
        danger: 'border-transparent bg-red-100 text-red-800',
        info: 'border-transparent bg-stone-100 text-stone-600',
        accent: 'border-transparent bg-emerald-50 text-emerald-700',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Maps audit/finding domain statuses to a badge variant. */
export function statusVariant(status: string): BadgeProps['variant'] {
  const s = status?.toUpperCase();
  if (['CLOSED', 'VERIFIED', 'APPROVED', 'C', 'DONE', 'ACCEPTED'].includes(s)) return 'success';
  if (['PENDING_APPROVAL', 'PENDING', 'MINOR', 'OFI', 'OBSERVATION', 'OPEN', 'SUBMITTED'].includes(s)) return 'warning';
  if (['REJECTED', 'CANCELLED', 'MAJOR', 'NC'].includes(s)) return 'danger';
  if (['IN_PROGRESS', 'CAPA_IN_PROGRESS', 'FINDINGS_RECORDED', 'ACKNOWLEDGED'].includes(s)) return 'info';
  return 'secondary';
}
