/**
 * Vercel-inspired multi-color mesh gradient — cyan / blue / magenta / amber.
 * Lives behind hero content and slow-drifts via Framer Motion.
 */
import { motion } from 'framer-motion';

export function MeshGradient() {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <motion.div
        className="absolute inset-0 opacity-60 blur-3xl"
        animate={{
          backgroundPosition: ['0% 0%', '100% 100%', '0% 0%'],
        }}
        transition={{ duration: 22, repeat: Infinity, ease: 'easeInOut' }}
        style={{
          backgroundImage:
            'radial-gradient(at 22% 28%, rgba(80,227,194,0.22) 0px, transparent 50%),' +
            'radial-gradient(at 78% 14%, rgba(11,113,255,0.28) 0px, transparent 50%),' +
            'radial-gradient(at 45% 90%, rgba(217,70,239,0.18) 0px, transparent 50%),' +
            'radial-gradient(at 90% 80%, rgba(245,158,11,0.16) 0px, transparent 50%)',
          backgroundSize: '200% 200%',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
            'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage:
            'radial-gradient(ellipse at 50% 0%, rgba(0,0,0,0.85), transparent 70%)',
          WebkitMaskImage:
            'radial-gradient(ellipse at 50% 0%, rgba(0,0,0,0.85), transparent 70%)',
        }}
      />
    </div>
  );
}
