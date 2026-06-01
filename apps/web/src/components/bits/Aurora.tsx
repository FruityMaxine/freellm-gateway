/**
 * Slowly drifting conic "aurora" sweep — used as a section divider or to
 * accent secondary CTAs without dominating the visual hierarchy.
 */
import { motion } from 'framer-motion';

export function Aurora({ className = '' }: { className?: string }) {
  return (
    <div className={'pointer-events-none absolute inset-0 overflow-hidden ' + className} aria-hidden>
      <motion.div
        className="absolute -inset-32 opacity-40 blur-3xl"
        animate={{ rotate: 360 }}
        transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
        style={{
          background:
            'conic-gradient(from 220deg at 50% 50%, rgba(250,255,105,0.15), rgba(139,92,246,0.18), rgba(6,182,212,0.16), rgba(250,255,105,0.15))',
        }}
      />
    </div>
  );
}
