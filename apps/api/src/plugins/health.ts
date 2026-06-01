/**
 * Liveness + readiness routes.
 *
 * `/health` is unauthenticated and cheap — used by the monitoring loop.
 * `/ready` performs a DB ping so orchestrators don't route traffic until
 * migrations are applied.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginCallback } from 'fastify';
import { getConfig } from '../config.js';
import { getPrisma } from '../lib/prisma.js';

const plugin: FastifyPluginCallback = (app, _opts, done) => {
  app.get('/health', async () => {
    const { version, env } = getConfig();
    return {
      ok: true,
      service: 'freellm-api',
      version,
      env: env.FREELLM_NODE_ENV,
      timestamp: new Date().toISOString(),
    };
  });

  app.get('/ready', async (_req, reply) => {
    try {
      const prisma = getPrisma();
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, db: 'ok', timestamp: new Date().toISOString() };
    } catch (err) {
      reply.status(503);
      return {
        ok: false,
        db: 'fail',
        message: (err as Error).message,
        timestamp: new Date().toISOString(),
      };
    }
  });

  done();
};

export default fp(plugin, { name: 'health' });
