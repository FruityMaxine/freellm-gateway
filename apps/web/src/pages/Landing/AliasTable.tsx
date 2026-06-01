import { motion } from 'framer-motion';
import { Badge } from '@/components/ui/badge';

const ALIASES = [
  { alias: 'free/auto', behaviour: '按综合评分挑当前最优免费模型。', tag: '默认' },
  { alias: 'free/best', behaviour: '免费池中质量最高的模型；允许牺牲时延。', tag: '质量' },
  { alias: 'free/fast', behaviour: '免费池中时延最低的模型。', tag: '速度' },
  { alias: 'free/large-context', behaviour: '免费池中上下文窗口最大的模型。', tag: '≥100K' },
  { alias: 'openrouter/free', behaviour: '直接透传到 OpenRouter 的 :free 路由模型。', tag: '透传' },
  { alias: '<provider>/<model>', behaviour: '显式锁定；受虚拟密钥黑白名单约束。', tag: '精确' },
];

export function AliasTable() {
  return (
    <section className="relative border-b border-[var(--color-hairline)] py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--color-primary)]">
            模型别名
          </div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight">
            别再手写易过期的模型 ID。
          </h2>
          <p className="mt-3 text-[var(--color-body)]">
            把下表任一别名传给 OpenAI 的 <code className="font-mono">model</code> 字段，FreeLLM 在请求时实时解析。
          </p>
        </div>

        <div className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-hairline)] bg-[var(--color-surface-card)]/70 backdrop-blur">
          <div className="grid grid-cols-[1.2fr_2fr_0.8fr] border-b border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/80 px-6 py-3 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
            <div>别名</div>
            <div>行为</div>
            <div className="text-right">标签</div>
          </div>
          {ALIASES.map((a, i) => (
            <motion.div
              key={a.alias}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.04 }}
              className="grid grid-cols-[1.2fr_2fr_0.8fr] items-center border-b border-[var(--color-hairline)] px-6 py-4 last:border-b-0 hover:bg-[var(--color-surface-soft)]/30"
            >
              <code className="font-mono text-sm text-[var(--color-primary)]">{a.alias}</code>
              <div className="text-sm text-[var(--color-body)]">{a.behaviour}</div>
              <div className="text-right">
                <Badge tone="muted" className="uppercase">
                  {a.tag}
                </Badge>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
