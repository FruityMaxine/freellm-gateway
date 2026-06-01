import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]',
        'placeholder:text-[var(--color-muted)] disabled:opacity-50',
        'focus-visible:border-[var(--color-primary)] focus-visible:outline-none',
        'transition-colors duration-150',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
