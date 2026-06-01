/**
 * Generous global rate limit so we never accidentally tarpit the admin UI.
 * Per-virtual-key limits live in `virtual-key-auth` (Tick 5).
 */
import fp from 'fastify-plugin';
import rateLimit from '@fastify/rate-limit';
import type { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (app) => {
  await app.register(rateLimit, {
    max: 600,
    timeWindow: '1 minute',
    allowList: (req) => req.url.startsWith('/health') || req.url.startsWith('/metrics'),
    errorResponseBuilder: (req, ctx) => ({
      error: {
        message: `Rate limit exceeded — try again in ${Math.ceil(Number(ctx.ttl) / 1000)}s`,
        type: 'rate_limit_error',
        code: 'rate_limited',
      },
    }),
  });
};

export default fp(plugin, { name: 'ratelimit' });
