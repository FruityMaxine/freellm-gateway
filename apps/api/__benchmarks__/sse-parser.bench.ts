/**
 * SSE 解析 bench：模拟 OpenAI 流式响应的逐 chunk 解析吞吐。
 * 每次流式调用都要把上游 SSE 字节流切成 ChatStreamChunk —— 长会话有数千次解析。
 */
import { bench, describe } from 'vitest';

// 重现 openai-compat 的内联 SSE 解析器（解决基准 vs 真实代码偏差）
function* parseSseEvents(buf: string): Generator<{ data: string } | null> {
  let cursor = 0;
  while (cursor < buf.length) {
    const lineEnd = buf.indexOf('\n', cursor);
    if (lineEnd === -1) return;
    const line = buf.slice(cursor, lineEnd).trim();
    cursor = lineEnd + 1;
    if (!line || line.startsWith(':')) continue;
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (data === '[DONE]') {
      yield null;
      return;
    }
    yield { data };
  }
}

const sampleChunk = JSON.stringify({
  id: 'chatcmpl-abc',
  object: 'chat.completion.chunk',
  created: Math.floor(Date.now() / 1000),
  model: 'gpt-4',
  choices: [
    { index: 0, delta: { content: '你好，FreeLLM。这是流式回复的第 N 个 token。' }, finish_reason: null },
  ],
});

const smallStream = Array.from({ length: 10 }, () => `data: ${sampleChunk}\n\n`).join('');
const largeStream = Array.from({ length: 200 }, () => `data: ${sampleChunk}\n\n`).join('') + 'data: [DONE]\n\n';

describe('sse 解析', () => {
  bench('解析 10 chunk 流', () => {
    const events = [...parseSseEvents(smallStream)];
    events.length;
  });

  bench('解析 200 chunk 流 + [DONE]', () => {
    const events = [...parseSseEvents(largeStream)];
    events.length;
  });

  bench('单条 JSON.parse', () => {
    JSON.parse(sampleChunk);
  });
});
