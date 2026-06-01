import { cn } from '@/lib/utils';

export function GradientText({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn('bg-clip-text text-transparent', className)}
      style={{
        backgroundImage:
          'linear-gradient(115deg, var(--color-primary) 0%, var(--color-accent-cyan) 50%, var(--color-primary) 100%)',
        backgroundSize: '200% 100%',
        animation: 'gradient-shift 8s ease-in-out infinite',
      }}
    >
      <style>{`@keyframes gradient-shift {0%{background-position:0% 50%}50%{background-position:100% 50%}100%{background-position:0% 50%}}`}</style>
      {children}
    </span>
  );
}
