import * as React from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

interface GlassCardProps extends React.HTMLAttributes<HTMLDivElement> {
  glow?: 'none' | 'soft' | 'strong';
}

export const GlassCard = React.forwardRef<HTMLDivElement, GlassCardProps>(
  ({ className, glow = 'soft', children, ...props }, ref) => (
    <motion.div
      ref={ref}
      whileHover={{ y: -3, scale: 1.005 }}
      transition={{ type: 'spring', stiffness: 220, damping: 22 }}
      className={cn(
        'group relative overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-hairline)] bg-[var(--color-surface-card)]/80 backdrop-blur-md',
        glow === 'soft' && 'hover:border-[var(--color-primary)]/30 hover:shadow-[var(--shadow-glow-soft)]',
        glow === 'strong' && 'hover:border-[var(--color-primary)]/60 hover:shadow-[var(--shadow-glow)]',
        'transition-[border-color,box-shadow,transform]',
        className,
      )}
      {...(props as React.ComponentProps<typeof motion.div>)}
    >
      <div className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <div
          aria-hidden
          className="absolute inset-x-0 -top-px h-px"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--color-primary), transparent)',
          }}
        />
      </div>
      {children}
    </motion.div>
  ),
);
GlassCard.displayName = 'GlassCard';
