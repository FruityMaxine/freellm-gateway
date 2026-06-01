/**
 * GET /admin/events —— 管理后台 SSE 实时事件推送（Tick 17 v1.1.0.0 引入；Tick 18 加 auth 显式说明）。
 *
 * 取代 Dashboard 5s 轮询：模型变化、冷却触发、请求完成等服务端 EventBus 事件
 * 通过此 SSE 流实时推送到前端。
 *
 * 鉴权：
 * - 本端点路径 `/admin/*` 自动走 `admin-auth` plugin 的 `onRequest` hook。
 *   无 `freellm_admin_session` cookie 或 cookie 已失效 → 401 `需要管理员登录会话`。
 * - `EventSource` 默认随同源请求带 cookie，前端无需额外处理。
 *
 * 协议：
 * - 标准 SSE：`event: <topic>\ndata: <json>\n\n`
 * - 客户端用 `new EventSource('/admin/events', { withCredentials: true })` 接入；浏览器自动重连。
 * - 服务端每 25 秒发一个 `event: heartbeat` 防止反代 idle 超时。
 *
 * 推送的事件类型（与 EventBus 拓扑同名）：
 *   - `model:added` / `model:removed` / `model:paid_now` / `model:capability_changed`
 *   - `discovery:cycle`
 *   - `request:complete`（Tick 18 v1.2.0.0 新增）
 *   - 后续 tick 可继续往 EventBus emit 新事件，无需改本路由。
 */
import type { FastifyPluginAsync } from 'fastify';
import { globalEventBus } from '../../services/event-bus.js';

const HEARTBEAT_MS = 25_000;

const plugin: FastifyPluginAsync = async (app) => {
  app.get('/admin/events', async (req, reply) => {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    // 首条事件：告诉客户端连上了，包含 server 版本与时间戳，方便前端校时。
    const hello = JSON.stringify({
      requestId: req.requestId,
      serverTime: new Date().toISOString(),
    });
    reply.raw.write(`event: ready\ndata: ${hello}\n\n`);

    const wildcardOff = globalEventBus.onAny(({ topic, payload }) => {
      try {
        reply.raw.write(`event: ${topic}\ndata: ${JSON.stringify(payload)}\n\n`);
      } catch (err) {
        // 客户端可能已关闭连接；下面 close handler 会清理。
        app.log.debug({ err: (err as Error).message }, 'SSE write 失败 (客户端可能已断开)');
      }
    });

    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`event: heartbeat\ndata: ${Date.now()}\n\n`);
      } catch {
        // ignore；close handler 会清掉 interval
      }
    }, HEARTBEAT_MS);

    const cleanup = () => {
      clearInterval(heartbeat);
      wildcardOff();
      try {
        reply.raw.end();
      } catch {
        /* already ended */
      }
    };

    req.raw.on('close', cleanup);
    req.raw.on('end', cleanup);
    req.raw.on('error', cleanup);

    // 让 Fastify 知道我们在异步写 raw，本 handler 不会再 reply.send()。
    return reply;
  });
};

export default plugin;
