/**
 * Reusable hero scaffold composing MeshGradient + Spotlight + Aurora.
 * Page-specific copy lives in `pages/Landing/LandingPage.tsx` etc.
 */
import * as React from 'react';
import { MeshGradient } from './MeshGradient';
import { Spotlight } from './Spotlight';
import { Aurora } from './Aurora';
import { cn } from '@/lib/utils';

export function Hero({
  children,
  className,
  variant = 'mesh',
}: {
  children: React.ReactNode;
  className?: string;
  variant?: 'mesh' | 'aurora' | 'plain';
}) {
  return (
    <section
      className={cn(
        'relative isolate overflow-hidden border-b border-[var(--color-hairline)]',
        className,
      )}
    >
      {variant === 'mesh' && (
        <>
          <MeshGradient />
          <Spotlight />
        </>
      )}
      {variant === 'aurora' && <Aurora />}
      <div className="relative mx-auto max-w-7xl px-6 py-24 md:py-32">{children}</div>
    </section>
  );
}
