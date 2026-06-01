/**
 * Attach a `req_<10char>` id to every incoming request, propagate it as a
 * response header, and use it as the pino log binding.
 */
import fp from 'fastify-plugin';
import type { FastifyPluginCallback } from 'fastify';
import { newPublicRequestId } from '@freellm/shared';

declare module 'fastify' {
  interface FastifyRequest {
    requestId: string;
  }
}

const plugin: FastifyPluginCallback = (app, _opts, done) => {
  app.addHook('onRequest', (req, reply, next) => {
    const incoming = req.headers['x-request-id'];
    const id =
      typeof incoming === 'string' && /^req_[a-z0-9]{6,16}$/.test(incoming)
        ? incoming
        : newPublicRequestId();
    req.requestId = id;
    reply.header('x-freellm-request-id', id);
    next();
  });
  done();
};

export default fp(plugin, { name: 'reqid' });
