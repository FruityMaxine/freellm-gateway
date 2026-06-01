/**
 * 预置上游 Provider 模板（Tick 54 v1.7.26.0 引入）。
 *
 * 选完 template 用户只填 API Key（+ 可选改名/优先级），baseUrl + kind +
 * compatibleMode 自动填上。也允许"自定义" 进 OpenAI-compat 兜底。
 */

export interface ProviderTemplate {
  id: string;
  kind:
    | 'openrouter'
    | 'openai'
    | 'anthropic'
    | 'deepseek'
    | 'google'
    | 'openai-compat'
    | 'mistral'
    | 'groq'
    | 'together'
    | 'moonshot'
    | 'qwen'
    | 'mock';
  name: string;
  defaultSlug: string;
  baseUrl: string;
  compatibleMode: 'openai' | 'anthropic' | 'google';
  homepage: string;
  keyHint: string; // 引导文案
  free: boolean;
  notes?: string;
}

export const PROVIDER_TEMPLATES: ProviderTemplate[] = [
  {
    id: 'openrouter',
    kind: 'openrouter',
    name: 'OpenRouter',
    defaultSlug: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    compatibleMode: 'openai',
    homepage: 'https://openrouter.ai',
    keyHint: 'sk-or-v1-...',
    free: true,
    notes: '免费模型自动发现来源 + 200+ 模型聚合 + 统一计费',
  },
  {
    id: 'openai',
    kind: 'openai',
    name: 'OpenAI',
    defaultSlug: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    compatibleMode: 'openai',
    homepage: 'https://platform.openai.com',
    keyHint: 'sk-...',
    free: false,
    notes: 'GPT-4o / o1 / o3 / GPT-5 等',
  },
  {
    id: 'anthropic',
    kind: 'anthropic',
    name: 'Anthropic Claude',
    defaultSlug: 'anthropic',
    baseUrl: 'https://api.anthropic.com',
    compatibleMode: 'anthropic',
    homepage: 'https://console.anthropic.com',
    keyHint: 'sk-ant-...',
    free: false,
    notes: 'Claude Sonnet / Opus / Haiku 系列',
  },
  {
    id: 'deepseek',
    kind: 'deepseek',
    name: 'DeepSeek',
    defaultSlug: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    compatibleMode: 'openai',
    homepage: 'https://platform.deepseek.com',
    keyHint: 'sk-...',
    free: false,
    notes: 'DeepSeek-V3 / R1 推理模型, 性价比高',
  },
  {
    id: 'google',
    kind: 'google',
    name: 'Google Gemini',
    defaultSlug: 'google',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    compatibleMode: 'google',
    homepage: 'https://aistudio.google.com',
    keyHint: 'AIza...',
    free: true,
    notes: 'Gemini 2.5 Pro / Flash 系列, 含免费层',
  },
  {
    id: 'moonshot',
    kind: 'moonshot',
    name: 'Moonshot (Kimi)',
    defaultSlug: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    compatibleMode: 'openai',
    homepage: 'https://platform.moonshot.cn',
    keyHint: 'sk-...',
    free: false,
    notes: 'Kimi K2 系列, 长上下文擅长',
  },
  {
    id: 'qwen',
    kind: 'qwen',
    name: '阿里通义千问 Qwen',
    defaultSlug: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    compatibleMode: 'openai',
    homepage: 'https://dashscope.console.aliyun.com',
    keyHint: 'sk-...',
    free: true,
    notes: 'Qwen 3 / Max / Plus / Turbo, 含免费层',
  },
  {
    id: 'groq',
    kind: 'groq',
    name: 'Groq',
    defaultSlug: 'groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    compatibleMode: 'openai',
    homepage: 'https://console.groq.com',
    keyHint: 'gsk_...',
    free: true,
    notes: '超低延迟 LPU, Llama / Mixtral 等开源模型, 免费 quota 大',
  },
  {
    id: 'together',
    kind: 'together',
    name: 'Together AI',
    defaultSlug: 'together',
    baseUrl: 'https://api.together.xyz/v1',
    compatibleMode: 'openai',
    homepage: 'https://api.together.ai',
    keyHint: '...',
    free: false,
    notes: '200+ 开源模型托管, Llama / DeepSeek / Qwen 等',
  },
  {
    id: 'mistral',
    kind: 'mistral',
    name: 'Mistral AI',
    defaultSlug: 'mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    compatibleMode: 'openai',
    homepage: 'https://console.mistral.ai',
    keyHint: '...',
    free: true,
    notes: 'Mistral Large / Codestral / Pixtral, 法国出品',
  },
  {
    id: 'custom',
    kind: 'openai-compat',
    name: '自定义 (OpenAI 兼容)',
    defaultSlug: 'custom-openai',
    baseUrl: 'https://your-endpoint/v1',
    compatibleMode: 'openai',
    homepage: '',
    keyHint: '...',
    free: false,
    notes: '兼容 OpenAI API 协议的任意 endpoint (如 vLLM / LM Studio / Ollama)',
  },
];

export function templateByKind(kind: string): ProviderTemplate | undefined {
  return PROVIDER_TEMPLATES.find((t) => t.kind === kind || t.id === kind);
}
