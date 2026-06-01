import * as React from 'react';
import { cn } from '@/lib/utils';

interface MarqueeProps extends React.HTMLAttributes<HTMLDivElement> {
  speed?: number;
}

/** Edge-fading marquee — used for partner logos / model family ticker. */
export function Marquee({ children, className, speed = 38, ...props }: MarqueeProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden',
        '[mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]',
        className,
      )}
      {...props}
    >
      <div
        className="flex w-max gap-12 animate-[marquee_var(--marquee-duration)_linear_infinite]"
        style={{ ['--marquee-duration' as never]: `${speed}s` }}
      >
        <div className="flex shrink-0 gap-12">{children}</div>
        <div className="flex shrink-0 gap-12" aria-hidden>
          {children}
        </div>
      </div>
      <style>{`@keyframes marquee {from{transform:translateX(0)}to{transform:translateX(-50%)}}`}</style>
    </div>
  );
}
