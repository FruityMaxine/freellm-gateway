/**
 * Playground 公开试用页（Tick 23 v1.5.0.0 引入，Tick 36 v1.7.8.0 升级多轮 + 历史会话）。
 *
 * 流程：
 * 1. 访客打开 /playground → 调 POST /public/demo-key 拿一把临时 demo 虚拟密钥
 * 2. 用此密钥调 /v1/chat/completions（free/auto 模式）进行多轮对话
 * 3. 每次响应附加到当前会话 messages 末尾，会话首条用户消息触发自动建会话
 * 4. 侧栏可切换 / 重命名 / 删除历史会话；ownerId 持久化在浏览器 localStorage
 *
 * 限制：额度紧（15 请求 / 1000 token 每天），关闭页面后密钥不可恢复（但会话历史按 ownerId 保留）。
 */
import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Copy,
  Check,
  KeyRound,
  Sparkles,
  AlertTriangle,
  Terminal,
  History,
  Plus,
  Trash2,
  MessageSquare,
  Settings as SettingsIcon,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/bits/GlassCard';
import { GradientText } from '@/components/bits/GradientText';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/api';
import { toast } from 'sonner';
import {
  useCreatePlaygroundSession,
  useDeletePlaygroundSession,
  useOrCreateOwnerId,
  usePlaygroundSession,
  usePlaygroundSessions,
  useUpdatePlaygroundSession,
  type PlaygroundMessage,
} from '@/lib/usePlaygroundSessions';
import {
  useCreatePlaygroundPreset,
  useMarkPresetUsed,
  usePlaygroundPresets,
  type PlaygroundPresetRow,
} from '@/lib/usePlaygroundPresets';
import { timeAgo } from '@/lib/utils';

interface DemoKey {
  id: string;
  secret: string;
  prefix: string;
  isDemo: boolean;
  limits: {
    requestsPerDay: number;
    tokensPerDay: number;
    requestsPerMinute: number;
  };
  notice: string;
}

export function PlaygroundPage() {
  const [demoKey, setDemoKey] = useState<DemoKey | null>(null);
  const [prompt, setPrompt] = useState('你好 FreeLLM，请用一句话介绍你自己。');
  const [pending, setPending] = useState(false);
  const [copied, setCopied] = useState(false);
  const [messages, setMessages] = useState<PlaygroundMessage[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const ownerId = useOrCreateOwnerId();
  const { data: sessionsData, refetch: refetchSessions } = usePlaygroundSessions(ownerId);
  const { data: sessionDetail } = usePlaygroundSession(activeSessionId, ownerId);
  const createSession = useCreatePlaygroundSession();
  const updateSession = useUpdatePlaygroundSession();
  const deleteSession = useDeletePlaygroundSession();

  // Tick 45 v1.7.17.0：预设选择 + 创建对话框
  const { data: presetsData } = usePlaygroundPresets(ownerId);
  const createPreset = useCreatePlaygroundPreset();
  const markUsed = useMarkPresetUsed();
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [showPresetForm, setShowPresetForm] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState<string>('');

  // 加载历史会话详情 → 同步到本地 messages
  useEffect(() => {
    if (sessionDetail?.session) {
      setMessages(sessionDetail.session.messages);
    }
  }, [sessionDetail]);

  const copySecret = async () => {
    if (!demoKey) return;
    try {
      await navigator.clipboard.writeText(demoKey.secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
      toast.success('密钥已复制到剪贴板');
    } catch {
      toast.error('复制失败，请手动选择文本');
    }
  };

  const curlExample = (secret: string) => `curl http://localhost:3001/v1/chat/completions \\
  -H "Authorization: Bearer ${secret}" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "free/auto",
    "messages": [{"role":"user","content":"你好"}],
    "stream": false
  }'`;

  const acquireKey = async () => {
    setPending(true);
    try {
      const res = await api.post('/public/demo-key');
      setDemoKey(res.data.key);
      toast.success('已签发试用密钥');
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status === 403) {
        toast.error('Playground 试用未启用，请联系管理员');
      } else {
        toast.error('签发失败：' + (err as Error).message);
      }
    } finally {
      setPending(false);
    }
  };

  const newConversation = () => {
    setActiveSessionId(null);
    setMessages([]);
    setHistoryOpen(false);
  };

  const switchToSession = (id: string) => {
    setActiveSessionId(id);
    setHistoryOpen(false);
  };

  const removeSession = async (id: string) => {
    try {
      await deleteSession.mutateAsync({ id, ownerId });
      toast.success('已删除会话');
      if (activeSessionId === id) {
        setActiveSessionId(null);
        setMessages([]);
      }
    } catch (err) {
      toast.error('删除失败：' + (err as Error).message);
    }
  };

  const persistMessages = async (nextMessages: PlaygroundMessage[]) => {
    if (activeSessionId) {
      try {
        await updateSession.mutateAsync({ id: activeSessionId, ownerId, messages: nextMessages });
      } catch (err) {
        console.warn('会话更新失败', err);
      }
    } else {
      try {
        const created = await createSession.mutateAsync({
          ownerId,
          messages: nextMessages,
          demoVkPrefix: demoKey?.prefix ?? undefined,
        });
        setActiveSessionId(created.session.id);
      } catch (err) {
        console.warn('会话创建失败', err);
      }
    }
    void refetchSessions();
  };

  const runChat = async () => {
    if (!demoKey) {
      toast.error('请先签发试用密钥');
      return;
    }
    const userMsg: PlaygroundMessage = { role: 'user', content: prompt };
    const withUser = [...messages, userMsg];
    setMessages(withUser);
    setPending(true);
    const startedAt = Date.now();
    try {
      const res = await fetch('/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${demoKey.secret}`,
        },
        body: JSON.stringify({
          model: 'free/auto',
          messages: [
            // Tick 45 v1.7.17.0：若已应用预设的 system prompt，则插在 messages 最前
            ...(systemPrompt
              ? [{ role: 'system' as const, content: systemPrompt }]
              : []),
            ...withUser.map((m) => ({ role: m.role, content: m.content })),
          ],
          stream: false,
        }),
      });
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        error?: { message?: string };
        model?: string;
      };
      let assistantMsg: PlaygroundMessage;
      if (!res.ok) {
        assistantMsg = {
          role: 'assistant',
          content: `(错误) ${json.error?.message ?? `HTTP ${res.status}`}`,
        };
      } else {
        assistantMsg = {
          role: 'assistant',
          content: json.choices?.[0]?.message?.content ?? '(空响应)',
          meta: {
            ...(json.model ? { upstreamModel: json.model } : {}),
            durationMs: Date.now() - startedAt,
          },
        };
      }
      const next = [...withUser, assistantMsg];
      setMessages(next);
      setPrompt('');
      await persistMessages(next);
    } catch (err) {
      const next = [
        ...withUser,
        { role: 'assistant' as const, content: `(网络错误) ${(err as Error).message}` },
      ];
      setMessages(next);
      await persistMessages(next);
    } finally {
      setPending(false);
    }
  };

  const sessions = sessionsData?.data ?? [];

  return (
    <div className="relative">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center"
        >
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)]/80 px-3 py-1 text-xs tracking-wider text-[var(--color-body)] backdrop-blur">
            <Sparkles className="size-3.5 text-[var(--color-primary)]" />
            Playground · 公开试用
          </div>
          <h1 className="font-display text-4xl md:text-5xl font-bold tracking-tight text-[var(--color-ink)]">
            <GradientText>5 秒试用</GradientText> FreeLLM 路由
          </h1>
          <p className="mt-3 text-[var(--color-body)] max-w-xl mx-auto">
            匿名访客也能用一把临时密钥跑通完整 9 维评分 + 自动回退路由链。
            额度受限：每天 15 次请求 / 1000 token。
          </p>
        </motion.div>

        {/* Tick 45 v1.7.17.0：预设选择条 */}
        {presetsData?.data && presetsData.data.length > 0 && (
          <div className="mt-6 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
              <SettingsIcon className="mr-1 inline size-3" /> 预设
            </span>
            {presetsData.data.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => {
                  setActivePresetId(p.id);
                  setSystemPrompt(p.systemPrompt ?? '');
                  void markUsed.mutateAsync({ id: p.id, ownerId });
                  toast.success(`已应用预设：${p.name}`);
                }}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  activePresetId === p.id
                    ? 'border-[var(--color-primary)]/60 bg-[var(--color-primary)]/15 text-[var(--color-primary)]'
                    : 'border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/60 text-[var(--color-body)] hover:border-[var(--color-primary)]/40'
                }`}
              >
                {p.name}
              </button>
            ))}
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowPresetForm(true)}
            >
              <Plus className="size-3" /> 新预设
            </Button>
          </div>
        )}
        {(!presetsData?.data || presetsData.data.length === 0) && (
          <div className="mt-6 flex items-center gap-2 text-[11px] text-[var(--color-muted)]">
            <SettingsIcon className="size-3" />
            <span>预设：尚无配置</span>
            <Button variant="ghost" size="sm" onClick={() => setShowPresetForm(true)}>
              <Plus className="size-3" /> 创建预设
            </Button>
          </div>
        )}

        {/* Tick 36 v1.7.8.0：历史会话工具条 */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setHistoryOpen((o) => !o)}
            >
              <History className="size-3.5" /> 历史会话（{sessions.length}）
            </Button>
            {activeSessionId && (
              <Badge tone="primary">
                会话: {sessions.find((s) => s.id === activeSessionId)?.name ?? '当前'}
              </Badge>
            )}
            {systemPrompt && (
              <Badge tone="info">含 system prompt</Badge>
            )}
          </div>
          <Button variant="subtle" size="sm" onClick={newConversation}>
            <Plus className="size-3.5" /> 新对话
          </Button>
        </div>

        {historyOpen && (
          <GlassCard className="mt-3 max-h-72 overflow-auto p-3">
            {sessions.length === 0 ? (
              <div className="py-6 text-center text-xs text-[var(--color-muted)]">
                暂无历史会话。开始对话后会自动保存到本浏览器。
              </div>
            ) : (
              <div className="space-y-1">
                {sessions.map((s) => (
                  <div
                    key={s.id}
                    className={`flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border px-3 py-2 text-xs transition-colors ${
                      activeSessionId === s.id
                        ? 'border-[var(--color-primary)]/50 bg-[var(--color-primary)]/10'
                        : 'border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/40 hover:border-[var(--color-primary)]/30'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => switchToSession(s.id)}
                      className="flex-1 truncate text-left"
                    >
                      <div className="flex items-center gap-1.5">
                        <MessageSquare className="size-3 shrink-0" />
                        <span className="truncate font-medium text-[var(--color-ink)]">{s.name}</span>
                      </div>
                      <div className="mt-0.5 text-[10px] text-[var(--color-muted)]">
                        {timeAgo(s.lastMessageAt)} · {s.demoVkPrefix ?? '匿名'}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确认删除会话 "${s.name}"？`)) void removeSession(s.id);
                      }}
                      className="text-[var(--color-muted)] hover:text-[var(--color-error)]"
                      aria-label="删除会话"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
        )}

        <div className="mt-6 space-y-6">
          {!demoKey ? (
            <GlassCard className="p-8 text-center">
              <Button size="lg" variant="primary" onClick={acquireKey} disabled={pending}>
                <KeyRound className="size-4" />
                {pending ? '签发中…' : '签发试用密钥'}
              </Button>
              <p className="mt-3 text-xs text-[var(--color-muted)]">
                提示：管理员需先在环境变量中开启 <code className="font-mono">FREELLM_DEMO_ENABLED=true</code>
              </p>
            </GlassCard>
          ) : (
            <GlassCard className="p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm">
                  <KeyRound className="size-4 text-[var(--color-primary)]" />
                  <span className="font-mono text-[var(--color-body)]">{demoKey.prefix}</span>
                  <Badge tone="warning">试用</Badge>
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  额度：每天 {demoKey.limits.requestsPerDay} 次请求 · {demoKey.limits.tokensPerDay} token
                </div>
              </div>
              <div className="mt-4 flex items-start gap-2 rounded-[var(--radius-md)] border border-[var(--color-warning)]/30 bg-[var(--color-warning)]/10 px-3 py-2 text-xs text-[var(--color-warning)]">
                <AlertTriangle className="size-4 shrink-0 mt-0.5" />
                <span>{demoKey.notice}</span>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  <span>完整密钥（明文，仅显示一次）</span>
                  <Button variant="ghost" size="sm" onClick={copySecret}>
                    {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                    {copied ? '已复制' : '复制密钥'}
                  </Button>
                </div>
                <pre className="mt-2 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[#06070a] p-3 font-mono text-[11px] text-[var(--color-primary)]">
                  {demoKey.secret}
                </pre>
              </div>

              <div className="mt-4">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-[var(--color-muted)]">
                  <Terminal className="size-3.5" /> curl 示例
                </div>
                <pre className="mt-2 overflow-auto rounded-[var(--radius-md)] border border-[var(--color-hairline)] bg-[#06070a] p-3 font-mono text-[11px] leading-relaxed text-[var(--color-body-strong)]">
                  {curlExample(demoKey.secret)}
                </pre>
              </div>
            </GlassCard>
          )}

          {/* Tick 36 v1.7.8.0：多轮 messages 时间线 */}
          {messages.length > 0 && (
            <GlassCard className="p-5">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-medium text-[var(--color-ink)]">对话记录</div>
                <span className="text-[11px] text-[var(--color-muted)]">{messages.length} 条消息</span>
              </div>
              <div className="space-y-3">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={`rounded-[var(--radius-md)] border px-3 py-2 ${
                      m.role === 'user'
                        ? 'border-[var(--color-primary)]/30 bg-[var(--color-primary)]/5'
                        : 'border-[var(--color-hairline)] bg-[var(--color-surface-soft)]'
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--color-muted)]">
                      <span>{m.role === 'user' ? '你' : '助手'}</span>
                      {m.meta?.upstreamModel && (
                        <span className="font-mono text-[var(--color-muted)]">
                          {m.meta.upstreamModel}
                          {m.meta.durationMs ? ` · ${m.meta.durationMs}ms` : ''}
                        </span>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap text-sm text-[var(--color-ink)]">
                      {m.content}
                    </div>
                  </div>
                ))}
              </div>
            </GlassCard>
          )}

          {demoKey && (
            <GlassCard className="p-5 space-y-3">
              <div className="text-sm font-medium text-[var(--color-ink)]">
                {messages.length === 0 ? '首条消息' : '继续对话'}
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.currentTarget.value)}
                rows={4}
                placeholder="输入你的提问 …"
                className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 font-mono text-sm text-[var(--color-ink)] focus-visible:border-[var(--color-primary)] focus-visible:outline-none"
              />
              <div className="flex justify-end">
                <Button
                  variant="primary"
                  size="md"
                  onClick={runChat}
                  disabled={pending || !prompt.trim()}
                >
                  {pending ? '路由中…' : '发送'} <ArrowRight className="size-4" />
                </Button>
              </div>
            </GlassCard>
          )}
        </div>
      </div>

      {/* Tick 45 v1.7.17.0：预设创建对话框 */}
      {showPresetForm && (
        <PresetFormDialog
          ownerId={ownerId}
          onClose={() => setShowPresetForm(false)}
          onCreated={(p) => {
            setActivePresetId(p.id);
            setSystemPrompt(p.systemPrompt ?? '');
            setShowPresetForm(false);
            toast.success(`预设 "${p.name}" 已创建并应用`);
          }}
          createPreset={createPreset}
        />
      )}
    </div>
  );
}

function PresetFormDialog({
  ownerId,
  onClose,
  onCreated,
  createPreset,
}: {
  ownerId: string;
  onClose: () => void;
  onCreated: (p: PlaygroundPresetRow) => void;
  createPreset: ReturnType<typeof useCreatePlaygroundPreset>;
}) {
  const [name, setName] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [preferredModel, setPreferredModel] = useState('');
  const [temperature, setTemperature] = useState<string>('');
  const submit = async () => {
    if (!name.trim()) {
      toast.error('预设名称必填');
      return;
    }
    try {
      const r = await createPreset.mutateAsync({
        ownerId,
        input: {
          name: name.trim(),
          systemPrompt: systemPrompt.trim() || null,
          preferredModel: preferredModel.trim() || null,
          temperature: temperature ? Number(temperature) : null,
        },
      });
      onCreated(r.preset);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-[var(--radius-lg)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-elevated)] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-sm font-medium text-[var(--color-ink)]">创建预设</div>
        <input
          className="w-full rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 text-sm text-[var(--color-ink)]"
          placeholder="预设名称（例：代码助手）"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <textarea
          className="w-full resize-y rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 font-mono text-xs text-[var(--color-ink)]"
          rows={5}
          placeholder="system prompt（可选）"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            className="rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 font-mono text-xs text-[var(--color-ink)]"
            placeholder="偏好模型 (可选)"
            value={preferredModel}
            onChange={(e) => setPreferredModel(e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={2}
            step={0.1}
            className="rounded-[var(--radius-md)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)] px-3 py-2 font-mono text-xs text-[var(--color-ink)]"
            placeholder="温度 0-2 (可选)"
            value={temperature}
            onChange={(e) => setTemperature(e.target.value)}
          />
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" onClick={onClose}>
            取消
          </Button>
          <Button variant="primary" onClick={submit} disabled={createPreset.isPending}>
            {createPreset.isPending ? '保存中 …' : '保存预设'}
          </Button>
        </div>
      </div>
    </div>
  );
}
