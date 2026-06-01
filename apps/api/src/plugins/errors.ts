/**
 * 全局错误处理器：把任意抛出值规整成与 OpenAI 错误信封兼容的 JSON。
 * FreeLLMError 保留自身的 kind / httpStatus；普通 Error 一律降级为 unknown / 500。
 */
import fp from 'fastify-plugin';
import type { FastifyError, FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { FreeLLMError, isFreeLLMError } from '@freellm/shared';

function shape(error: unknown, requestId: string) {
  if (isFreeLLMError(error)) {
    return {
      httpStatus: error.httpStatus,
      payload: { ...error.toOpenAIError(), request_id: requestId },
    };
  }
  // 鸭式回退：workspace symlink 可能产生多份 FreeLLMError 类实例，导致 instanceof 失效。
  // 这里直接按形状契约判定，确保 cross-package throw 能正确归一化。
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { kind?: unknown }).kind === 'string' &&
    typeof (error as { httpStatus?: unknown }).httpStatus === 'number' &&
    typeof (error as { toOpenAIError?: unknown }).toOpenAIError === 'function'
  ) {
    const fe = error as { httpStatus: number; toOpenAIError: () => Record<string, unknown> };
    return { httpStatus: fe.httpStatus, payload: { ...fe.toOpenAIError(), request_id: requestId } };
  }
  const fe = error as FastifyError;
  const httpStatus =
    typeof fe?.statusCode === 'number' && fe.statusCode >= 400 && fe.statusCode < 600
      ? fe.statusCode
      : 500;
  const msg = (error as Error)?.message ?? '未预期的服务器错误';
  const code = typeof fe?.code === 'string' ? fe.code : 'unknown';
  return {
    httpStatus,
    payload: {
      error: { message: msg, type: 'api_error', code },
      request_id: requestId,
    },
  };
}

const plugin: FastifyPluginCallback = (app, _opts, done) => {
  app.setErrorHandler((err, req: FastifyRequest, reply: FastifyReply) => {
    const requestId = req.requestId ?? 'req_unknown';
    const { httpStatus, payload } = shape(err, requestId);
    if (httpStatus >= 500) {
      req.log.error({ err, requestId }, '未处理异常');
    } else {
      req.log.warn({ err: { message: (err as Error).message, code: (err as FastifyError).code }, requestId }, '请求异常');
    }
    reply.status(httpStatus).send(payload);
  });

  app.setNotFoundHandler((req, reply) => {
    const err = new FreeLLMError('not_found', `路由 ${req.method} ${req.url} 不存在`);
    reply.status(err.httpStatus).send({ ...err.toOpenAIError(), request_id: req.requestId });
  });

  done();
};

export default fp(plugin, { name: 'errors' });
