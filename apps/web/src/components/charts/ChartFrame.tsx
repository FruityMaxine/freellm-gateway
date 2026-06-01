import * as React from 'react';
import { GlassCard } from '@/components/bits/GlassCard';

interface Props {
  title: string;
  description?: string;
  height?: number;
  children: React.ReactNode;
}

export function ChartFrame({ title, description, height = 240, children }: Props) {
  return (
    <GlassCard className="p-5">
      <div className="flex items-baseline justify-between">
        <div className="text-sm font-medium text-[var(--color-ink)]">{title}</div>
        {description && (
          <div className="text-[11px] text-[var(--color-muted)]">{description}</div>
        )}
      </div>
      <div style={{ height }} className="mt-4">
        {children}
      </div>
    </GlassCard>
  );
}
