import { motion } from 'framer-motion';
import { ArrowRight, Boxes, Globe2, Server, ShieldCheck } from 'lucide-react';

const NODES = [
  { Icon: Globe2, label: '你的应用', meta: '一个 base URL' },
  { Icon: ShieldCheck, label: 'fllm_* 密钥', meta: 'sha256 哈希 · RPM / 日额上限' },
  { Icon: Server, label: 'FreeLLM 网关', meta: '127.0.0.1 · Fastify · Prisma' },
  { Icon: Boxes, label: '上游池', meta: 'OpenRouter · OpenAI · Mock' },
];

export function ArchDiagram() {
  return (
    <section className="relative border-b border-[var(--color-hairline)] py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 max-w-2xl">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--color-primary)]">
            架构
          </div>
          <h2 className="mt-2 text-4xl font-bold tracking-tight">
            你与免费模型之间，只隔一跳。
          </h2>
          <p className="mt-3 text-[var(--color-body)]">
            上游 API 密钥永不离开网关进程；下游只看到一个 OpenAI 兼容 URL。
          </p>
        </div>
        <div className="overflow-x-auto">
          <div className="flex min-w-[820px] items-center gap-4">
            {NODES.map(({ Icon, label, meta }, i) => (
              <motion.div
                key={label}
                initial={{ opacity: 0, x: -10 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, margin: '-40px' }}
                transition={{ duration: 0.34, delay: i * 0.07 }}
                className="flex flex-1 items-stretch gap-4"
              >
                <div className="relative flex flex-1 flex-col items-center gap-2 rounded-[var(--radius-xl)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-card)] px-5 py-7 text-center shadow-[var(--shadow-card)]">
                  <div className="grid size-12 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/12 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
                    <Icon className="size-5" />
                  </div>
                  <div className="mt-2 font-semibold text-[var(--color-ink)]">{label}</div>
                  <div className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                    {meta}
                  </div>
                  {i === 2 && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-[var(--color-primary)] px-2 py-0.5 text-[10px] uppercase tracking-wider text-[var(--color-on-primary)]">
                      FreeLLM
                    </div>
                  )}
                </div>
                {i < NODES.length - 1 && (
                  <div className="flex w-12 items-center justify-center text-[var(--color-muted)]">
                    <ArrowRight className="size-5" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        <div className="mt-10 grid gap-3 text-xs text-[var(--color-body)] md:grid-cols-3">
          {[
            '正向路径：9 维评分器挑选当前最优、未冷却、能力匹配的免费模型。',
            '失败路径：分类 → 冷却 → 切换下一候选（受 max attempts 上限保护）。',
            '可观测：每次尝试落 route_attempts；每次请求落一行 request_logs。',
          ].map((line, i) => (
            <div
              key={i}
              className="rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 px-4 py-3"
            >
              <span className="mr-2 font-mono text-[10px] text-[var(--color-primary)]">
                0{i + 1}
              </span>
              {line}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
