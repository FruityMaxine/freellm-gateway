import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider whitespace-nowrap',
  {
    variants: {
      tone: {
        default:
          'border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] text-[var(--color-body-strong)]',
        primary:
          'border-[var(--color-primary)]/40 bg-[var(--color-primary)]/15 text-[var(--color-primary)]',
        success:
          'border-[var(--color-success)]/40 bg-[var(--color-success)]/15 text-[var(--color-success)]',
        warning:
          'border-[var(--color-warning)]/40 bg-[var(--color-warning)]/15 text-[var(--color-warning)]',
        danger:
          'border-[var(--color-error)]/40 bg-[var(--color-error)]/15 text-[var(--color-error)]',
        info:
          'border-[var(--color-info)]/40 bg-[var(--color-info)]/15 text-[var(--color-info)]',
        muted:
          'border-[var(--color-hairline)] bg-transparent text-[var(--color-muted)]',
      },
    },
    defaultVariants: { tone: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
