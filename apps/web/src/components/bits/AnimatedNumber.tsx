/**
 * Smoothly counts up to `value` over `duration` ms. Honors prefers-reduced-motion.
 */
import { useEffect, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import { formatNumber } from '@/lib/utils';

interface Props {
  value: number;
  duration?: number;
  digits?: number;
  className?: string;
  suffix?: string;
  prefix?: string;
}

export function AnimatedNumber({
  value,
  duration = 1200,
  digits = 0,
  className,
  suffix,
  prefix,
}: Props) {
  const reduced = useReducedMotion();
  const [display, setDisplay] = useState(reduced ? value : 0);

  useEffect(() => {
    if (reduced) {
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const from = display;
    let raf = 0;
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setDisplay(from + (value - from) * eased);
      if (elapsed < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, duration, reduced]);

  return (
    <span className={className}>
      {prefix}
      {formatNumber(display, digits)}
      {suffix}
    </span>
  );
}
