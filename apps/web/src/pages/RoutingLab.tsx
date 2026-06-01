import { useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Cpu,
  Layers,
  Play,
  Shuffle,
  Sparkles,
  Target,
  TrendingUp,
  XCircle,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { PageHeader } from './_PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { GlassCard } from '@/components/bits/GlassCard';
import { useTestChat } from '@/lib/lab-keys-logs-hooks';
import { formatDuration } from '@/lib/utils';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type Mode =
  | 'auto-best-free'
  | 'round-robin-free'
  | 'weighted-free'
  | 'openrouter-free-router'
  | 'prefer-model-fallback'
  | 'provider-specific'
  | 'paid-allowed';

const MODES: Array<{ id: Mode; icon: typeof Activity; title: string; desc: string }> = [
  { id: 'auto-best-free', icon: Sparkles, title: '最优免费', desc: '得分最高的免费模型' },
  { id: 'round-robin-free', icon: Shuffle, title: '轮询', desc: '在免费池均匀分发' },
  { id: 'weighted-free', icon: TrendingUp, title: '权重抽样', desc: '按评分加权随机' },
  { id: 'openrouter-free-router', icon: Layers, title: 'OpenRouter :free', desc: '透传路由' },
  { id: 'prefer-model-fallback', icon: Target, title: '指定优先 + 回退', desc: '先用指定再回 auto 池' },
  { id: 'provider-specific', icon: Cpu, title: '锁定上游', desc: '只走单一上游' },
  { id: 'paid-allowed', icon: Zap, title: '付费回退', desc: '免费池干涸时升级到付费' },
];

interface RunRecord {
  ts: number;
  prompt: string;
  mode: Mode;
  ok: boolean;
  requestId: string;
  upstreamProvider?: string;
  upstreamModel?: string;
  attemptsCount: number;
  totalMs: number;
}

const HISTORY_KEY = 'freellm.lab.history';

function loadHistory(): RunRecord[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]') as RunRecord[];
  } catch {
    return [];
  }
}

function saveHistory(rs: RunRecord[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(rs.slice(0, 10)));
  } catch {
    /* ignore quota */
  }
}

export function RoutingLabStub() {
  const [prompt, setPrompt] = useState('你好，FreeLLM。请选择最优免费模型回答这条问题。');
  const [model, setModel] = useState('free/auto');
  const [mode, setMode] = useState<Mode>('auto-best-free');
  const [history, setHistory] = useState<RunRecord[]>(() => loadHistory());
  const testChat = useTestChat();

  const result = testChat.data;
  const attempts = result?.attempts ?? [];

  const handleRun = async () => {
    try {
      const res = await testChat.mutateAsync({ model, prompt, routingMode: mode });
      const rec: RunRecord = {
        ts: Date.now(),
        prompt,
        mode,
        ok: res.ok,
        requestId: res.requestId,
        ...(res.upstreamProvider ? { upstreamProvider: res.upstreamProvider } : {}),
        ...(res.upstreamModel ? { upstreamModel: res.upstreamModel } : {}),
        attemptsCount: res.attempts.length,
        totalMs: res.attempts.reduce((acc, a) => acc + (a.durationMs ?? 0), 0),
      };
      const next = [rec, ...history].slice(0, 10);
      setHistory(next);
      saveHistory(next);
      toast.success(res.ok ? `已通过 ${res.upstreamModel} 完成` : `全部 ${res.attempts.length} 次尝试均失败`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <div>
      <PageHeader
        eyebrow="实验台"
        title="路由实验室"
        description="交互式路由 + 回放：选模式、发 prompt，回退时间轴实时呈现。"
        status={result ? (result.ok ? '成功' : '失败') : '待命'}
        statusTone={result ? (result.ok ? 'success' : 'danger') : 'muted'}
        actions={
          <Button variant="primary" size="sm" onClick={handleRun} disabled={testChat.isPending}>
            <Play className={cn('size-3.5', testChat.isPending && 'animate-pulse')} />
            {testChat.isPending ? '执行中…' : '运行实验'}
          </Button>
        }
      />

      <div className="mx-auto max-w-7xl px-6 py-8 grid gap-6 lg:grid-cols-[1.05fr_1.2fr]">
        {/* LEFT — prompt + mode */}
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium text-[var(--color-ink)]">Prompt 提示词</div>
              <span className="text-[11px] text-[var(--color-muted)]">{prompt.length} 字符</span>
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.currentTarget.value)}
              rows={8}
              className="mt-3 w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm font-mono text-[var(--color-ink)] focus-visible:border-[var(--color-primary)] focus-visible:outline-none"
            />
            <div className="mt-3 flex items-center gap-3">
              <Input
                value={model}
                onChange={(e) => setModel(e.currentTarget.value)}
                className="font-mono"
                placeholder="free/auto"
              />
              <Button variant="ghost" size="sm" onClick={() => setModel('free/auto')}>
                free/auto
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setModel('openrouter/free')}>
                openrouter/free
              </Button>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-sm font-medium text-[var(--color-ink)]">路由模式</div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {MODES.map(({ id, icon: Icon, title, desc }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={cn(
                    'rounded-[var(--radius-md)] border bg-[var(--color-surface-soft)]/60 px-3 py-3 text-left transition-colors',
                    mode === id
                      ? 'border-[var(--color-primary)] bg-[var(--color-primary)]/10 text-[var(--color-ink)] shadow-[var(--shadow-glow-soft)]'
                      : 'border-[var(--color-hairline)] hover:border-[var(--color-hairline-strong)]',
                  )}
                >
                  <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-[var(--color-muted)]">
                    <Icon className="size-3.5 text-[var(--color-primary)]" /> {title}
                  </div>
                  <div className="mt-1 text-sm text-[var(--color-body)]">{desc}</div>
                </button>
              ))}
            </div>
          </GlassCard>
        </div>

        {/* RIGHT — timeline + result */}
        <div className="space-y-4">
          <GlassCard className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium text-[var(--color-ink)]">回退时间轴</div>
              {result && (
                <Badge tone={result.ok ? 'success' : 'danger'}>
                  {result.attempts.length} 次尝试
                </Badge>
              )}
            </div>
            <AnimatePresence mode="wait">
              {testChat.isPending ? (
                <motion.div
                  key="loading"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="mt-6 h-48 grid place-items-center text-[var(--color-muted)]"
                >
                  路由执行中…
                </motion.div>
              ) : attempts.length === 0 ? (
                <div className="mt-6 h-48 grid place-items-center rounded-[var(--radius-md)] border border-dashed border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)]/30 text-[var(--color-muted)]">
                  点击 <span className="mx-1 font-mono text-[var(--color-primary)]">运行实验</span> 查看候选时间轴。
                </div>
              ) : (
                <motion.div
                  key={result?.requestId}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="mt-4 space-y-2"
                >
                  {attempts.map((a, i) => (
                    <motion.div
                      key={`${a.ordinal}-${a.upstreamModel}`}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className={cn(
                        'flex items-center gap-3 rounded-[var(--radius-md)] border px-3 py-2.5 text-sm',
                        a.ok
                          ? 'border-[var(--color-success)]/40 bg-[var(--color-success)]/10 text-[var(--color-success)]'
                          : 'border-[var(--color-error)]/30 bg-[var(--color-error)]/8 text-[var(--color-body)]',
                      )}
                    >
                      <span className="font-mono text-xs tabular text-[var(--color-muted)]">
                        #{a.ordinal}
                      </span>
                      {a.ok ? (
                        <CheckCircle2 className="size-4 text-[var(--color-success)]" />
                      ) : (
                        <XCircle className="size-4 text-[var(--color-error)]" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-mono text-[12px] text-[var(--color-body-strong)]">
                          {a.upstreamModel}
                        </div>
                        <div className="text-[11px] text-[var(--color-muted)]">
                          {a.providerSlug} · 评分 {a.score.toFixed(2)} · {a.rationale}
                        </div>
                      </div>
                      <div className="text-right text-[11px]">
                        <div className="tabular text-[var(--color-body-strong)]">
                          {formatDuration(a.durationMs)}
                        </div>
                        <div className="text-[var(--color-muted)]">{a.errorKind ?? '正常'}</div>
                      </div>
                    </motion.div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="flex items-baseline justify-between">
              <div className="text-sm font-medium text-[var(--color-ink)]">最终返回</div>
              {result?.upstreamModel && (
                <Badge tone="primary" className="font-mono">
                  {result.upstreamModel}
                </Badge>
              )}
            </div>
            <div className="mt-3 max-h-72 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[#06070a] p-4">
              <pre className="font-mono text-[12px] leading-relaxed text-[var(--color-body-strong)]">
                {result
                  ? result.ok
                    ? JSON.stringify(result.response, null, 2)
                    : JSON.stringify(result.error, null, 2)
                  : '—'}
              </pre>
            </div>
          </GlassCard>

          <GlassCard className="p-5">
            <div className="text-sm font-medium text-[var(--color-ink)] mb-3">最近执行</div>
            {history.length === 0 ? (
              <div className="text-[11px] text-[var(--color-muted)]">
                本地记录 · 最近 10 次执行仅保存在当前设备。
              </div>
            ) : (
              <div className="space-y-1.5">
                {history.map((r) => (
                  <div
                    key={r.ts}
                    className="grid grid-cols-[100px_1fr_80px_60px] items-center gap-2 text-[11px]"
                  >
                    <span className="tabular text-[var(--color-muted)]">
                      {new Date(r.ts).toLocaleTimeString()}
                    </span>
                    <span className="truncate text-[var(--color-body)]">{r.prompt}</span>
                    <span className="font-mono text-[var(--color-primary)] tabular">
                      {r.upstreamModel ?? '—'}
                    </span>
                    <span className="text-right tabular text-[var(--color-muted)]">
                      {formatDuration(r.totalMs)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        </div>
      </div>
    </div>
  );
}
