import { Moon, Sun, SunMoon } from 'lucide-react';
import { motion } from 'framer-motion';
import { useTheme } from '@/components/layout/ThemeProvider';

export function ThemeToggleFAB() {
  const { mode, setMode } = useTheme();
  const Icon = mode === 'dark' ? Moon : mode === 'light' ? Sun : SunMoon;
  const next = mode === 'dark' ? 'light' : mode === 'light' ? 'auto' : 'dark';
  return (
    <motion.button
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 }}
      onClick={() => setMode(next)}
      aria-label={`Theme: ${mode}. Click to switch to ${next}.`}
      className="fixed bottom-6 right-6 z-40 grid size-12 place-items-center rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface-card)]/85 backdrop-blur text-[var(--color-ink)] shadow-[var(--shadow-elevated)] hover:text-[var(--color-primary)] hover:border-[var(--color-primary)]/40 transition-colors"
    >
      <Icon className="size-5" />
    </motion.button>
  );
}
