/**
 * FreeLLM design tokens — locked at Tick 7 (v0.5.0.0).
 *
 * Baseline: ClickHouse design system (deep-black canvas + electric-yellow
 * voltage brand colour + multi-tier surface stack + glass-morphic cards).
 * Hero decoration: Vercel mesh gradient overlay (cyan / blue / magenta / amber).
 *
 * Token names below MUST NOT be renamed in subsequent ticks — all 7 pages
 * across Tick 8/9/10 depend on this contract.
 */

export const DESIGN_TOKEN_VERSION = '1.0.0';

export const palette = {
  // Brand
  primary: '#faff69', // electric yellow — voltage / CTA / key metrics
  primaryActive: '#e6eb52',
  primaryDisabled: '#3a3a1f',
  onPrimary: '#0a0a0a', // text on yellow

  // Inks
  ink: '#ffffff',
  body: '#cccccc',
  bodyStrong: '#e6e6e6',
  muted: '#888888',
  mutedSoft: '#5a5a5a',
  hairline: '#2a2a2a',
  hairlineStrong: '#3a3a3a',

  // Surfaces (dark stack)
  canvas: '#0a0a0a',
  surfaceSoft: '#121212',
  surfaceCard: '#1a1a1a',
  surfaceElevated: '#242424',
  surfaceGlow: '#2f2f2f',

  // Accents (mesh / chart)
  accentEmerald: '#22c55e',
  accentRose: '#ef4444',
  accentBlue: '#3b82f6',
  accentCyan: '#06b6d4',
  accentMagenta: '#d946ef',
  accentAmber: '#f59e0b',
  accentViolet: '#8b5cf6',

  // Semantic
  success: '#22c55e',
  warning: '#f59e0b',
  error: '#ef4444',
  info: '#3b82f6',

  // Light theme overrides (auto/light mode)
  light: {
    canvas: '#ffffff',
    surfaceSoft: '#fafafa',
    surfaceCard: '#f5f5f5',
    surfaceElevated: '#ebebeb',
    ink: '#0a0a0a',
    body: '#3a3a3a',
    bodyStrong: '#171717',
    muted: '#888888',
    hairline: '#e5e5e5',
    hairlineStrong: '#d4d4d4',
  },
} as const;

export const typography = {
  fontSans: "'Inter var', Inter, system-ui, -apple-system, 'Segoe UI', sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
  fontDisplay: "'Inter var', Inter, system-ui, sans-serif",
  size: {
    xs: '0.75rem',
    sm: '0.875rem',
    base: '1rem',
    lg: '1.125rem',
    xl: '1.25rem',
    '2xl': '1.5rem',
    '3xl': '1.875rem',
    '4xl': '2.25rem',
    '5xl': '3rem',
    '6xl': '3.75rem',
    '7xl': '4.5rem',
    '8xl': '6rem',
    hero: 'clamp(2.5rem, 6vw + 1rem, 5.5rem)',
  },
  weight: { regular: '400', medium: '500', semibold: '600', bold: '700', black: '800' },
  leading: { tight: '1.1', snug: '1.25', normal: '1.5', relaxed: '1.625', loose: '2' },
  tracking: { tighter: '-0.04em', tight: '-0.02em', normal: '0', wide: '0.04em', wider: '0.08em' },
} as const;

export const spacing = {
  px: '1px',
  '0_5': '0.125rem',
  1: '0.25rem',
  2: '0.5rem',
  3: '0.75rem',
  4: '1rem',
  5: '1.25rem',
  6: '1.5rem',
  8: '2rem',
  10: '2.5rem',
  12: '3rem',
  16: '4rem',
  20: '5rem',
  24: '6rem',
  32: '8rem',
  40: '10rem',
  48: '12rem',
  56: '14rem',
  64: '16rem',
} as const;

export const radius = {
  none: '0',
  sm: '4px',
  md: '8px',
  lg: '12px',
  xl: '16px',
  '2xl': '20px',
  '3xl': '28px',
  full: '9999px',
} as const;

export const shadows = {
  glow: '0 0 0 1px rgba(250,255,105,0.18), 0 8px 28px -8px rgba(250,255,105,0.32)',
  glowSoft: '0 0 0 1px rgba(250,255,105,0.08), 0 4px 14px -4px rgba(250,255,105,0.16)',
  card: '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 1px 2px 0 rgba(0,0,0,0.6), 0 8px 24px -12px rgba(0,0,0,0.7)',
  elevated:
    '0 1px 0 0 rgba(255,255,255,0.06) inset, 0 4px 8px 0 rgba(0,0,0,0.5), 0 24px 48px -16px rgba(0,0,0,0.8)',
  hairline: '0 0 0 1px rgba(255,255,255,0.04)',
  hairlineStrong: '0 0 0 1px rgba(255,255,255,0.08)',
  focus: '0 0 0 2px rgba(250,255,105,0.4), 0 0 0 4px rgba(10,10,10,1)',
} as const;

export const motion = {
  duration: {
    instant: '60ms',
    fast: '160ms',
    base: '240ms',
    slow: '400ms',
    slower: '640ms',
  },
  ease: {
    standard: 'cubic-bezier(0.22, 1, 0.36, 1)',
    enter: 'cubic-bezier(0.16, 1, 0.3, 1)',
    exit: 'cubic-bezier(0.4, 0, 1, 1)',
    spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
  },
} as const;

export const gradients = {
  // Vercel-style mesh gradient for Landing hero
  meshHero:
    'radial-gradient(at 22% 28%, rgba(80,227,194,0.22) 0px, transparent 50%),' +
    'radial-gradient(at 78% 14%, rgba(11,113,255,0.28) 0px, transparent 50%),' +
    'radial-gradient(at 45% 90%, rgba(217,70,239,0.18) 0px, transparent 50%),' +
    'radial-gradient(at 90% 80%, rgba(245,158,11,0.16) 0px, transparent 50%)',
  // Aurora — secondary background sweep
  aurora:
    'conic-gradient(from 220deg at 50% 50%, rgba(250,255,105,0.06), rgba(139,92,246,0.08), rgba(6,182,212,0.06), rgba(250,255,105,0.06))',
  // Subtle yellow halo for primary CTAs
  primaryGlow: 'radial-gradient(circle at center, rgba(250,255,105,0.3), transparent 60%)',
  // Grid overlay — works as a Section divider
  grid:
    'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),' +
    'linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)',
} as const;

export const breakpoints = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
} as const;

export type DesignTokens = {
  palette: typeof palette;
  typography: typeof typography;
  spacing: typeof spacing;
  radius: typeof radius;
  shadows: typeof shadows;
  motion: typeof motion;
  gradients: typeof gradients;
  breakpoints: typeof breakpoints;
};

export const tokens: DesignTokens = {
  palette,
  typography,
  spacing,
  radius,
  shadows,
  motion,
  gradients,
  breakpoints,
};
