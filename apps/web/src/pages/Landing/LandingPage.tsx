import { Link } from 'react-router-dom';
import { ArrowRight, Sparkles, ShieldCheck } from 'lucide-react';
import { motion } from 'framer-motion';
import { Hero } from '@/components/bits/Hero';
import { GradientText } from '@/components/bits/GradientText';
import { TypingText } from '@/components/bits/TypingText';
import { Marquee } from '@/components/bits/Marquee';
import { Aurora } from '@/components/bits/Aurora';
import { AnimatedNumber } from '@/components/bits/AnimatedNumber';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PainCards } from './PainCards';
import { FeatureCards } from './FeatureCards';
import { ArchDiagram } from './ArchDiagram';
import { AliasTable } from './AliasTable';
import { CurlExample } from './CurlExample';
import { ThemeToggleFAB } from './ThemeToggleFAB';

export function LandingPage() {
  return (
    <div className="relative">
      <Hero className="pt-12">
        <div className="grid gap-12 lg:grid-cols-[1.2fr_1fr] lg:items-center">
          <div>
            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 }}
              className="mb-5 inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)]/80 px-3 py-1 text-xs tracking-wider text-[var(--color-body)] backdrop-blur"
            >
              <Sparkles className="size-3.5 text-[var(--color-primary)]" />
              v0.9.1.0 · 实时发现 360+ 免费模型
            </motion.div>

            <h1 className="font-display text-5xl md:text-7xl font-bold leading-[1.04] tracking-tight text-[var(--color-ink)]">
              <span className="block">自适应</span>
              <GradientText className="block">免费模型</GradientText>
              <span className="block">网关</span>
            </h1>

            <p className="mt-6 max-w-xl text-lg leading-relaxed text-[var(--color-body)]">
              一个 base URL、一把虚拟密钥。FreeLLM 自动发现 OpenRouter 持续变化的免费模型池，智能路由，并在{' '}
              <span className="text-[var(--color-ink)] font-medium">
                <TypingText
                  phrases={[
                    '429 时自动回退。',
                    '坏模型自动冷却。',
                    '真实密钥保管在后端。',
                    '凌晨三点不会把你叫醒。',
                  ]}
                />
              </span>
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/playground">
                  立即试用
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link to="/dashboard">
                  打开仪表盘
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <a href="#docs">查看文档</a>
              </Button>
              <span className="ml-2 hidden md:inline-flex items-center gap-1.5 text-xs text-[var(--color-muted)]">
                <ShieldCheck className="size-3.5" /> 绑定 127.0.0.1 · Cookie + Bearer · 静态 AES-256-GCM
              </span>
            </div>

            <Marquee speed={48} className="mt-12 -ml-2">
              {['OpenRouter', 'Anthropic', 'OpenAI', 'DeepSeek', 'Gemini', 'Mistral', 'Qwen', 'Llama 3.3'].map(
                (label) => (
                  <span
                    key={label}
                    className="font-mono text-xs uppercase tracking-[0.22em] text-[var(--color-muted)]"
                  >
                    {label}
                  </span>
                ),
              )}
            </Marquee>
          </div>

          <motion.aside
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2, type: 'spring', stiffness: 100 }}
            className="relative"
          >
            <div className="relative rounded-[var(--radius-2xl)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-card)]/70 p-6 backdrop-blur shadow-[var(--shadow-elevated)]">
              <div className="flex items-baseline justify-between">
                <span className="text-xs uppercase tracking-[0.2em] text-[var(--color-muted)]">
                  实时计数 · 免费池
                </span>
                <Badge tone="success">在线</Badge>
              </div>
              <div className="mt-5 flex items-baseline gap-3">
                <AnimatedNumber
                  value={360}
                  className="tabular font-display text-7xl font-semibold text-[var(--color-primary)] text-glow"
                />
                <span className="text-sm text-[var(--color-muted)]">个模型在池</span>
              </div>
              <div className="mt-2 text-xs text-[var(--color-body)]">
                每 30 分钟自动同步 OpenRouter + 5 个 fixture mock 数据源。
              </div>

              <div className="mt-6 grid grid-cols-3 gap-3 text-xs">
                {[
                  { k: '免费 / 付费', v: '30 / 330' },
                  { k: '最大上下文', v: '1.04 M' },
                  { k: 'SLA', v: '99.4%' },
                  { k: 'P50 时延', v: '480 ms' },
                  { k: '回退率', v: '14.2%' },
                  { k: '冷却数', v: '4' },
                ].map((s) => (
                  <div
                    key={s.k}
                    className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 px-3 py-2"
                  >
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      {s.k}
                    </div>
                    <div className="mt-1 font-semibold text-[var(--color-ink)] tabular">{s.v}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.aside>
        </div>
      </Hero>

      <PainCards />
      <FeatureCards />
      <ArchDiagram />
      <AliasTable />
      <CurlExample />

      <section className="relative isolate overflow-hidden border-y border-[var(--color-hairline)] py-24">
        <Aurora />
        <div className="relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="text-4xl font-bold tracking-tight">
            准备好 <GradientText>淘汰</GradientText> 那些写死的模型字符串了吗？
          </h2>
          <p className="mt-4 text-[var(--color-body)]">
            把 <code className="font-mono text-[var(--color-primary)]">free/auto</code> 写进
            base URL，FreeLLM 替你挑模型 · 每 30 分钟刷新池 · 冷却强制执行 · 每次请求落审计。
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="lg">
              <Link to="/virtual-keys">
                签发密钥
                <ArrowRight className="size-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/routing-lab">打开路由实验室</Link>
            </Button>
          </div>
        </div>
      </section>

      <Footer />
      <ThemeToggleFAB />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-[var(--color-hairline)] py-10 text-xs text-[var(--color-muted)]">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-6 md:flex-row md:items-center md:justify-between">
        <div>
          FreeLLM 是自托管网关，默认绑定 <code className="font-mono">127.0.0.1</code>，
          公网暴露请通过 Caddy / Nginx 反代。
        </div>
        <div className="flex items-center gap-5">
          <a href="#docs" className="hover:text-[var(--color-primary)]">文档</a>
          <a href="#api" className="hover:text-[var(--color-primary)]">API</a>
          <a href="#routing" className="hover:text-[var(--color-primary)]">路由</a>
          <a href="#security" className="hover:text-[var(--color-primary)]">安全</a>
        </div>
      </div>
    </footer>
  );
}
