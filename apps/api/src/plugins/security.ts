/**
 * Helmet + sensible secure defaults. We keep CSP off here because the admin
 * UI is served from a separate Vite origin in dev; production deployments
 * fronted by Caddy can layer their own CSP at the proxy.
 */
import fp from 'fastify-plugin';
import helmet from '@fastify/helmet';
import sensible from '@fastify/sensible';
import type { FastifyPluginAsync } from 'fastify';

const plugin: FastifyPluginAsync = async (app) => {
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });
  await app.register(sensible);
};

export default fp(plugin, { name: 'security' });
