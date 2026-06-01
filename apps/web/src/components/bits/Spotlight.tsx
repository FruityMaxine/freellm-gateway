/**
 * Mouse-following spotlight — adds a subtle "alive" feel to hero areas
 * without obscuring foreground content.
 */
import { usePointerFraction } from '@/lib/hooks';

export function Spotlight({
  intensity = 0.18,
  color = 'rgba(250,255,105,1)',
}: {
  intensity?: number;
  color?: string;
}) {
  const { x, y } = usePointerFraction();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 transition-[background] duration-500"
      style={{
        background: `radial-gradient(540px circle at ${x * 100}% ${y * 100}%, ${color.replace('1)', `${intensity})`)}, transparent 60%)`,
      }}
    />
  );
}
