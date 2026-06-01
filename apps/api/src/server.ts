/**
 * FreeLLM API entrypoint.
 *
 * Builds the Fastify app, binds to the loopback address declared by env, and
 * wires graceful shutdown so in-flight requests drain and Prisma disconnects
 * cleanly when the orchestrator sends SIGTERM.
 */
import { buildApp } from './bootstrap.js';
import { getConfig } from './config.js';
import { disconnectPrisma } from './lib/prisma.js';
import { setupHttpDispatcher } from './lib/http-dispatcher.js';

async function main(): Promise<void> {
  // 注：必须在 buildApp 前安装，确保所有 provider fetch 调用都走 keep-alive 池。
  setupHttpDispatcher();
  const { env, version } = getConfig();
  const { app } = await buildApp();

  const close = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'shutting down');
    try {
      await app.close();
    } catch (err) {
      app.log.error({ err }, 'fastify close failed');
    }
    try {
      await disconnectPrisma();
    } catch (err) {
      app.log.error({ err }, 'prisma disconnect failed');
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException');
    void close('uncaughtException');
  });
  process.on('unhandledRejection', (reason) => {
    app.log.error({ reason }, 'unhandledRejection');
  });

  await app.listen({ host: env.FREELLM_API_HOST, port: env.FREELLM_API_PORT });
  app.log.info(
    { host: env.FREELLM_API_HOST, port: env.FREELLM_API_PORT, version },
    'freellm-api listening',
  );
}

main().catch((err) => {
  console.error('[freellm-api] failed to start', err);
  process.exit(1);
});
