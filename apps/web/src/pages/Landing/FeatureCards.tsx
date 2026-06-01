import { motion } from 'framer-motion';
import {
  Activity,
  AlarmClockCheck,
  Boxes,
  BrainCog,
  KeyRound,
  Layers,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';

const FEATURES = [
  {
    Icon: Boxes,
    title: '自动模型发现',
    body:
      '每 30 分钟同步 OpenRouter，自动区分免费 / 付费，不可变快照历史，6 类变化事件。',
    tags: ['/admin/models', '/admin/test-chat'],
  },
  {
    Icon: BrainCog,
    title: '9 维评分路由',
    body:
      '综合可用性 / 时延 / 限流 / 质量 / 上下文 / 新鲜度 / 成本 / 稳定性 / 首 Token 评分。',
    tags: ['评分依据', '7 种模式'],
  },
  {
    Icon: Activity,
    title: '流式感知回退',
    body:
      '首 Token 前失败自动回退；流中失败以干净的 SSE error 信封收尾。',
    tags: ['SSE', '部分失败'],
  },
  {
    Icon: AlarmClockCheck,
    title: '指数退避冷却',
    body:
      '按模型 + 按上游分别指数退避，带 jitter / 半开探测 / 一键恢复。',
    tags: ['半开探测', '一键恢复'],
  },
  {
    Icon: KeyRound,
    title: '虚拟 API 密钥',
    body:
      'fllm_live_… / fllm_test_… 仅存 sha256，支持 RPM / 日额 / Token 上限 / 黑白名单 / 轮换吊销。',
    tags: ['增删改查', '轮换'],
  },
  {
    Icon: Layers,
    title: '审计优先的可观测性',
    body:
      '每请求 route_attempts 瀑布图 + 全局指标 + 日志摘要（可选保留全 prompt）。',
    tags: ['审计日志', '/v1/usage'],
  },
];

export function FeatureCards() {
  return (
    <section className="relative border-b border-[var(--color-hairline)] py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-12 flex flex-col items-start gap-3">
          <div className="text-xs uppercase tracking-[0.2em] text-[var(--color-primary)]">
            我们交付什么
          </div>
          <h2 className="text-4xl font-bold tracking-tight">
            6 个产品面，一把 fllm_* 密钥。
          </h2>
          <p className="max-w-2xl text-[var(--color-body)]">
            每一处都接入完整的{' '}
            <Badge tone="default" className="mx-1 align-middle">
              加载
            </Badge>
            <Badge tone="warning" className="mx-1 align-middle">
              空态
            </Badge>
            <Badge tone="danger" className="mx-1 align-middle">
              错误
            </Badge>
            和刷新按钮，没有任何 "TBD" 占位。
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ Icon, title, body, tags }, i) => (
            <motion.div
              key={title}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, delay: i * 0.05 }}
              viewport={{ once: true, margin: '-60px' }}
            >
              <GlassCard className="h-full p-6">
                <div className="flex items-center gap-3">
                  <div className="grid size-11 place-items-center rounded-[var(--radius-md)] bg-[var(--color-primary)]/10 text-[var(--color-primary)] ring-1 ring-[var(--color-primary)]/30">
                    <Icon className="size-5" />
                  </div>
                  <h3 className="text-lg font-semibold text-[var(--color-ink)]">{title}</h3>
                </div>
                <p className="mt-3 text-sm leading-relaxed text-[var(--color-body)]">{body}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  {tags.map((t) => (
                    <span
                      key={t}
                      className="rounded-[var(--radius-sm)] border border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/70 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[var(--color-muted)]"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
