/**
 * Provider-layer message contracts.
 *
 * These are upstream-shape-agnostic: every concrete provider (OpenRouter,
 * OpenAI, Anthropic, Google, Mock, …) accepts a `ChatCompletionRequest` and
 * emits either a `ChatCompletionResponse` or an async iterable of
 * `ChatStreamChunk`. Adapters convert between this neutral shape and each
 * upstream's native wire format.
 */
import type { ModelCapabilities, ProviderKind } from '@freellm/shared';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | ChatMessageContent[];
  name?: string;
  // Tool call surface (OpenAI-compat shape; mapped to provider-specific in adapters)
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface ChatMessageContent {
  type: 'text' | 'image_url' | 'input_audio' | 'tool_result';
  text?: string;
  image_url?: { url: string; detail?: 'auto' | 'low' | 'high' };
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatCompletionRequest {
  /** Upstream-native model id, e.g. `meta-llama/llama-3.3-70b-instruct:free`. */
  model: string;
  messages: ChatMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  presence_penalty?: number;
  frequency_penalty?: number;
  stop?: string | string[];
  response_format?: { type: 'text' | 'json_object' | 'json_schema'; json_schema?: unknown };
  tools?: Array<{ type: 'function'; function: { name: string; description?: string; parameters?: unknown } }>;
  tool_choice?: 'auto' | 'none' | 'required' | { type: 'function'; function: { name: string } };
  // FreeLLM-internal hints (stripped before sending upstream)
  /** Per-attempt cancellation signal. */
  signal?: AbortSignal;
  /** Per-attempt timeout override (ms). */
  timeoutMs?: number;
  /** Capability requirements the routing engine has already verified — adapters MAY trust these. */
  requiredCapabilities?: Partial<ModelCapabilities>;
}

export interface ChatCompletionUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: { role: 'assistant'; content: string; tool_calls?: ChatToolCall[] };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | null;
  }>;
  usage?: ChatCompletionUsage;
  /** Provider-supplied metadata propagated to logs/headers (not OpenAI-spec). */
  providerMeta?: Record<string, unknown>;
}

export interface ChatStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: { role?: 'assistant'; content?: string; tool_calls?: ChatToolCall[] };
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'error' | null;
  }>;
  /** Set on the final chunk when the upstream reports usage in-stream. */
  usage?: ChatCompletionUsage;
}

export interface ProviderHealthReport {
  ok: boolean;
  status: 'active' | 'degraded' | 'rate_limited' | 'disabled';
  latencyMs?: number;
  message?: string;
  detail?: unknown;
}

export interface ProviderBalance {
  balanceRaw?: unknown;
  limitRemaining?: number;
  usage?: number;
  currency?: string;
  asOf: string; // ISO timestamp
}

export interface ProviderListModelsResult {
  upstreamId: string;
  displayName: string;
  contextLength: number;
  pricing?: { prompt?: string; completion?: string; request?: string; image?: string };
  capabilities: ModelCapabilities;
  topProvider?: string;
  description?: string;
  paramsSupported?: string[];
  raw: unknown;
}

/** Minimal "what does this provider need to talk to its upstream" config. */
export interface ProviderCredential {
  apiKey: string | null;
  baseUrl: string;
  headerOverrides?: Record<string, string>;
}

/** Reasons a provider call ended early — surfaced to the executor / classifier. */
export interface ProviderCallOutcome {
  ok: boolean;
  durationMs: number;
  firstTokenMs?: number;
  /** Upstream HTTP status (or `null` for network errors). */
  status: number | null;
  errorKind?: string;
  errorMessage?: string;
  upstreamModel?: string;
}

export type ProviderKindTag = ProviderKind;

// ───────── Tick 17 v1.1.0.0：Embeddings 类型扩展（OpenAI 兼容） ─────────

export interface EmbeddingRequest {
  /** 上游模型 id 或 FreeLLM 别名（router 解析）。 */
  model: string;
  /** 字符串单条或数组多条。OpenAI 也允许整数 token id 数组；本网关只支持文本。 */
  input: string | string[];
  /** OpenAI 字段：response 编码格式。本网关默认 'float'。 */
  encoding_format?: 'float' | 'base64';
  /** OpenAI 字段：用户希望的输出维度。Mock 与多数 provider 透传；不支持的 provider 会忽略。 */
  dimensions?: number;
  /** OpenAI 字段：用户标签（透传到上游，本网关不写日志）。 */
  user?: string;
  /** Provider 调用超时（毫秒）。 */
  timeoutMs?: number;
  /** AbortSignal 透传。 */
  signal?: AbortSignal;
}

export interface EmbeddingData {
  object: 'embedding';
  /** 在批次中的位置（0-based）。 */
  index: number;
  /** 当 encoding_format='float' 时为 number[]；'base64' 时为 base64 字符串。 */
  embedding: number[] | string;
}

export interface EmbeddingResponse {
  object: 'list';
  data: EmbeddingData[];
  model: string;
  usage: {
    prompt_tokens: number;
    total_tokens: number;
  };
}
