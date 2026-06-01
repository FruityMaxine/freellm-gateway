import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium select-none transition-[background,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'bg-[var(--color-primary)] text-[var(--color-on-primary)] shadow-[var(--shadow-glow)] hover:bg-[var(--color-primary-active)] hover:-translate-y-px',
        ghost:
          'bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-surface-soft)]',
        outline:
          'bg-transparent text-[var(--color-ink)] border border-[var(--color-hairline-strong)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)]',
        subtle:
          'bg-[var(--color-surface-soft)] text-[var(--color-ink)] border border-[var(--color-hairline)] hover:bg-[var(--color-surface-card)]',
        danger:
          'bg-[var(--color-error)]/15 text-[var(--color-error)] border border-[var(--color-error)]/30 hover:bg-[var(--color-error)]/25',
        link: 'text-[var(--color-primary)] underline-offset-4 hover:underline px-0',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-[var(--radius-md)]',
        md: 'h-10 px-4 text-sm rounded-[var(--radius-md)]',
        lg: 'h-12 px-6 text-base rounded-[var(--radius-lg)]',
        icon: 'size-9 rounded-[var(--radius-md)]',
      },
    },
    defaultVariants: { variant: 'subtle', size: 'md' },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
    );
  },
);
Button.displayName = 'Button';

export { buttonVariants };
