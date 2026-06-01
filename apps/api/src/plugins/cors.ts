/**
 * CORS — admin UI origin only by default. Wider in dev/test.
 */
import fp from 'fastify-plugin';
import cors from '@fastify/cors';
import type { FastifyPluginAsync } from 'fastify';
import { getConfig } from '../config.js';

const plugin: FastifyPluginAsync = async (app) => {
  const { env } = getConfig();
  await app.register(cors, {
    origin: env.FREELLM_NODE_ENV === 'production' ? [env.FREELLM_WEB_ORIGIN] : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-request-id'],
    exposedHeaders: [
      'x-freellm-request-id',
      'x-freellm-upstream-provider',
      'x-freellm-upstream-model',
      'x-freellm-route-attempts',
      'x-freellm-cache-hit',
    ],
  });
};

export default fp(plugin, { name: 'cors' });
