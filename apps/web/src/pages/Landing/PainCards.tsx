import { motion } from 'framer-motion';
import { AlertTriangle, KeyRound, Shuffle } from 'lucide-react';
import { GlassCard } from '@/components/bits/GlassCard';

const PAINS = [
  {
    Icon: Shuffle,
    title: '免费模型每周洗牌',
    body:
      'OpenRouter 的 `:free` 池每天在变，ID 新增 / 下线 / 转付费毫无预告。手写在代码里的模型名几天就过期。',
    metric: { label: '平均寿命', value: '5.2 天' },
  },
  {
    Icon: AlertTriangle,
    title: '429 风暴毁掉演示',
    body:
      '某个热门免费模型被限流，整个池跟着变慢。你的项目从 100ms 飙升到 504，往往用户先吐槽你才知道。',
    metric: { label: 'P99 429 突刺', value: '+38×' },
  },
  {
    Icon: KeyRound,
    title: '密钥扩散即风险',
    body:
      '同一把 `sk-or-v1-…` 复制到一堆副项目，泄露面就翻倍。一旦轮换，全部一起报警。',
    metric: { label: '平均暴露面', value: '7+ 项目' },
  },
];

export function PainCards() {
  return (
    <section className="relative border-b border-[var(--color-hairline)] py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--color-primary)]">
            我们替代什么
          </div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight">
            三种早已不想再忍受的失败模式。
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {PAINS.map(({ Icon, title, body, metric }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: i * 0.06 }}
              viewport={{ once: true, margin: '-60px' }}
            >
              <GlassCard className="h-full p-6">
                <div className="flex items-start justify-between">
                  <div className="grid size-11 place-items-center rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] text-[var(--color-primary)]">
                    <Icon className="size-5" />
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      {metric.label}
                    </div>
                    <div className="font-mono text-sm text-[var(--color-ink)] tabular">
                      {metric.value}
                    </div>
                  </div>
                </div>
                <h3 className="mt-5 text-lg font-semibold leading-tight text-[var(--color-ink)]">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--color-body)]">{body}</p>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
