import { useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Copy, TerminalSquare } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

const SAMPLES = {
  curl: `curl http://127.0.0.1:3001/v1/chat/completions \\
  -H "Authorization: Bearer fllm_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -d '{
    "model": "free/auto",
    "messages": [{"role":"user","content":"Hello, FreeLLM"}],
    "stream": false
  }'`,
  stream: `curl http://127.0.0.1:3001/v1/chat/completions \\
  -H "Authorization: Bearer fllm_live_xxxxxxxxxxxx" \\
  -H "Content-Type: application/json" \\
  -N \\
  -d '{
    "model": "free/best",
    "messages": [{"role":"user","content":"Write a haiku about cooldowns."}],
    "stream": true
  }'`,
  python: `from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:3001/v1",
    api_key="fllm_live_xxxxxxxxxxxx",
)

response = client.chat.completions.create(
    model="free/auto",
    messages=[{"role": "user", "content": "Hello, FreeLLM"}],
)
print(response.choices[0].message.content)`,
  ts: `import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:3001/v1',
  apiKey: 'fllm_live_xxxxxxxxxxxx',
});

const result = await client.chat.completions.create({
  model: 'free/auto',
  messages: [{ role: 'user', content: 'Hello, FreeLLM' }],
});
console.log(result.choices[0]?.message?.content);`,
};

export function CurlExample() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (key: keyof typeof SAMPLES) => {
    await navigator.clipboard.writeText(SAMPLES[key]);
    setCopied(key);
    setTimeout(() => setCopied(null), 1400);
  };
  return (
    <section className="relative border-b border-[var(--color-hairline)] py-20">
      <div className="mx-auto max-w-7xl px-6">
        <div className="mb-10 flex items-end justify-between gap-6 flex-wrap">
          <div className="max-w-2xl">
            <div className="text-xs uppercase tracking-[0.2em] text-[var(--color-primary)]">
              快速试用
            </div>
            <h2 className="mt-2 text-4xl font-bold tracking-tight">OpenAI 客户端即插即用。</h2>
            <p className="mt-3 text-[var(--color-body)]">
              FreeLLM 完全兼容 OpenAI Chat 接口：选你熟悉的 SDK，改一下 base URL，换一把密钥，搞定。
            </p>
          </div>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--color-hairline-strong)] bg-[var(--color-surface-soft)]/80 px-3 py-1 text-xs text-[var(--color-muted)]">
            <TerminalSquare className="size-3.5" /> 127.0.0.1:3001
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-hairline-strong)] bg-[#06070a]/95 shadow-[var(--shadow-elevated)]"
        >
          <Tabs defaultValue="curl" className="w-full">
            <div className="flex items-center justify-between border-b border-[var(--color-hairline)] bg-[var(--color-surface-soft)]/30 px-3 py-2">
              <TabsList className="bg-transparent border-0 p-0">
                <TabsTrigger value="curl">curl</TabsTrigger>
                <TabsTrigger value="stream">curl 流式</TabsTrigger>
                <TabsTrigger value="python">python</TabsTrigger>
                <TabsTrigger value="ts">typescript</TabsTrigger>
              </TabsList>
              {(['curl', 'stream', 'python', 'ts'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => copy(k)}
                  className="hidden data-[active=true]:inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-card)] px-2 py-1 text-[11px] text-[var(--color-body)] hover:text-[var(--color-primary)]"
                />
              ))}
              <CopyAllButton onCopy={(k) => copy(k)} copied={copied} />
            </div>
            {(['curl', 'stream', 'python', 'ts'] as const).map((k) => (
              <TabsContent key={k} value={k} className="m-0">
                <pre className="overflow-auto px-5 py-5 font-mono text-[13px] leading-relaxed text-[var(--color-body-strong)]">
                  <code>{SAMPLES[k]}</code>
                </pre>
              </TabsContent>
            ))}
          </Tabs>
        </motion.div>
      </div>
    </section>
  );
}

function CopyAllButton({
  onCopy,
  copied,
}: {
  onCopy: (k: keyof typeof SAMPLES) => void;
  copied: string | null;
}) {
  // Reads the active tab via the underlying [data-state="active"] attribute by hooking into Radix.
  // Simpler approach: keep a single button that copies whichever sample is shown — derived from a `data-active` value we'll set by JS.
  // For the v0.5.0.0 release we hand-roll a lightweight detector.
  const handleClick = () => {
    const active = document.querySelector<HTMLButtonElement>(
      '[role="tablist"] [data-state="active"]',
    );
    const key = (active?.getAttribute('value') ?? 'curl') as keyof typeof SAMPLES;
    onCopy(key);
  };
  return (
    <button
      onClick={handleClick}
      className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--color-hairline-strong)] bg-[var(--color-surface-card)] px-2.5 py-1 text-[11px] text-[var(--color-body)] hover:text-[var(--color-primary)]"
    >
      {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
      {copied ? '已复制' : '复制'}
    </button>
  );
}
