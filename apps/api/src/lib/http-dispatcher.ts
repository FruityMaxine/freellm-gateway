/**
 * 全局 undici dispatcher：为所有 `fetch()` 调用开启 keep-alive 连接复用。
 *
 * 背景：Node 18+ 的内置 `fetch` 用 undici 实现，默认每次请求开新 TCP 连接，
 * 高 QPS 转发场景下 TCP 握手开销会显著拖慢延迟。
 *
 * 配置要点：
 * - `keepAliveTimeout` 30s：连接空闲 30 秒后关闭
 * - `keepAliveMaxTimeout` 60s：硬上限
 * - `connections` 256：单个 origin 池大小（FreeLLM 主要打 OpenRouter / OpenAI 等少数 origin）
 * - `pipelining` 1：保守关闭 HTTP/1.1 pipelining（很多上游 LB 不支持）
 *
 * 在 server.ts 启动早期调用 setupHttpDispatcher() 即可，幂等。
 */
import { Agent, setGlobalDispatcher } from 'undici';

let installed = false;

export function setupHttpDispatcher(): void {
  if (installed) return;
  installed = true;
  const agent = new Agent({
    keepAliveTimeout: 30_000,
    keepAliveMaxTimeout: 60_000,
    connections: 256,
    pipelining: 1,
    bodyTimeout: 60_000,
    headersTimeout: 30_000,
  });
  setGlobalDispatcher(agent);
}

export function __isHttpDispatcherInstalled(): boolean {
  return installed;
}
