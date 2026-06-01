/**
 * Page-agnostic React hooks. Per-page hooks live in each page's directory.
 */
import { useEffect, useState } from 'react';

export function useMounted(): boolean {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

/** Tracks `(prefers-color-scheme: dark)` so `auto` theme can mirror the OS. */
export function useSystemDark(): boolean {
  const [dark, setDark] = useState(
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : true,
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  return dark;
}

/** Returns `true` after `delay` ms — handy for staged Framer entrances. */
export function useDelayedFlag(delay: number): boolean {
  const [flag, setFlag] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setFlag(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  return flag;
}

/** Window pointer position normalised to [0..1] for hero spotlight effects. */
export function usePointerFraction(): { x: number; y: number } {
  const [pos, setPos] = useState({ x: 0.5, y: 0.3 });
  useEffect(() => {
    const handler = (e: PointerEvent) => {
      setPos({
        x: Math.max(0, Math.min(1, e.clientX / window.innerWidth)),
        y: Math.max(0, Math.min(1, e.clientY / window.innerHeight)),
      });
    };
    window.addEventListener('pointermove', handler, { passive: true });
    return () => window.removeEventListener('pointermove', handler);
  }, []);
  return pos;
}
