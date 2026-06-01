/**
 * Pino logger config exposed as Fastify-compatible options (Fastify owns the
 * pino instance lifecycle). Sensitive paths are redacted as defence in depth;
 * the first line of defence is that no code path writes secrets in the first
 * place.
 */
import { getConfig } from '../config.js';

export function buildLoggerOptions(): Record<string, unknown> {
  const { env } = getConfig();
  const isProd = env.FREELLM_NODE_ENV === 'production';
  return {
    level: env.FREELLM_LOG_LEVEL,
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'res.headers["set-cookie"]',
        '*.apiKey',
        '*.password',
        '*.token',
        '*.cipherText',
      ],
      remove: false,
      censor: '[redacted]',
    },
    transport: isProd
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l' },
        },
  };
}
