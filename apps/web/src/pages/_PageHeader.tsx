/**
 * Shared header for all 7 admin pages. Pages override the slot below to
 * inject filter bars, refresh controls, action buttons, etc.
 */
import * as React from 'react';
import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

interface Props {
  eyebrow?: string;
  title: string;
  description?: string;
  status?: string;
  statusTone?: 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'muted';
  actions?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  eyebrow,
  title,
  description,
  status,
  statusTone = 'default',
  actions,
  children,
  className,
}: Props) {
  return (
    <div
      className={cn(
        'border-b border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/40 backdrop-blur',
        className,
      )}
    >
      <div className="mx-auto max-w-7xl px-6 pt-8 pb-5">
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-wrap items-end justify-between gap-4"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {eyebrow && (
                <span className="text-xs uppercase tracking-[0.2em] text-[var(--color-primary)]">
                  {eyebrow}
                </span>
              )}
              {status && <Badge tone={statusTone}>{status}</Badge>}
            </div>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-[var(--color-ink)]">
              {title}
            </h1>
            {description && (
              <p className="mt-2 max-w-2xl text-sm text-[var(--color-body)]">{description}</p>
            )}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </motion.div>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  );
}
