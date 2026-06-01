/**
 * Route executor.
 *
 * Walks the candidate list from the Router. For each candidate:
 *   1. checks the cooldown gate;
 *   2. calls the upstream Provider;
 *   3. classifies failures into a FreeLLM error kind;
 *   4. registers the failure with the cooldown engine;
 *   5. moves on to the next candidate (subject to streaming rules).
 *
 * Streaming rule: once a single chunk has been written to the downstream
 * response we never fall back — partial failure is surfaced verbatim so the
 * caller can decide.
 */
import type { PrismaClient } from '@prisma/client';
import {
  Router,
  CooldownEngine,
  classifyRoutingError,
  isRetriableKind,
  type Candidate,
  type CooldownStore,
  type PoolModel,
  type RouteRequestContext,
  type ScoreExplanation,
} from '@freellm/routing-core';
import type {
  BaseProvider,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatStreamChunk,
  ProviderRegistry,
} from '@freellm/provider-core';
import type { FreeLLMErrorKind } from '@freellm/shared';
import { FreeLLMError, mapKindToHttpStatus } from '@freellm/shared';
import { newPublicRequestId } from '@freellm/shared';

// Audit TS H-6: narrow arbitrary provider errorKind strings down to a known kind.
function toKind(s: string | undefined | null): FreeLLMErrorKind {
  if (!s) return 'unknown';
  // mapKindToHttpStatus returns 500 for unknown keys; we use it as the membership oracle.
  const status = mapKindToHttpStatus(s as FreeLLMErrorKind);
  // 'unknown' maps to 500 too, so we still need to allow it through explicitly.
  if (s === 'unknown') return 'unknown';
  return status === 500 && !KNOWN_KINDS.has(s) ? 'unknown' : (s as FreeLLMErrorKind);
}
const KNOWN_KINDS = new Set<string>([
  'bad_request', 'unauthorized', 'forbidden', 'not_found', 'unsupported_capability',
  'context_overflow', 'rate_limited', 'provider_unavailable', 'timeout', 'network_error',
  'invalid_response', 'content_filter', 'balance_insufficient', 'auth_failure',
  'no_route_available', 'all_attempts_failed', 'cooldown_active', 'unknown',
]);
function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
import type { ScoreUpdater } from './score-updater.service.js';
import {
  type RetryPolicy,
  computeBackoff,
  shouldRetry,
} from './retry-policy.service.js';

export interface ExecuteOptions {
  request: ChatCompletionRequest;
  ctx: RouteRequestContext;
  pool: PoolModel[];
  streaming: boolean;
  /** Tags used purely for logging / route_attempts metadata. */
  metadata?: { virtualKeyId?: string | null; clientIp?: string | null };
  /** Override the request id (otherwise we mint a fresh one). */
  requestId?: string;
}

export interface AttemptReport {
  ordinal: number;
  modelId: string;
  providerSlug: string;
  upstreamModel: string;
  durationMs: number;
  firstTokenMs?: number;
  ok: boolean;
  status: number | null;
  errorKind?: FreeLLMErrorKind;
  errorMessage?: string;
  cooldownTriggered: boolean;
  rationale: string;
  score: number;
  scoreExplanation: ScoreExplanation;
}

export interface ExecuteResultBase {
  requestId: string;
  attempts: AttemptReport[];
  mode: string;
  ok: boolean;
}

export interface ExecuteCompletionResult extends ExecuteResultBase {
  ok: true;
  response: ChatCompletionResponse;
  upstreamProvider: string;
  upstreamModel: string;
}

export interface ExecuteStreamResult extends ExecuteResultBase {
  ok: true;
  stream: AsyncIterable<ChatStreamChunk>;
  upstreamProvider: string;
  upstreamModel: string;
}

export interface ExecuteFailureResult extends ExecuteResultBase {
  ok: false;
  error: FreeLLMError;
}

export type ExecuteResult = ExecuteCompletionResult | ExecuteStreamResult | ExecuteFailureResult;

export interface RouteExecutorOptions {
  prisma: PrismaClient;
  registry: ProviderRegistry;
  cooldownStore: CooldownStore;
  scoreUpdater?: ScoreUpdater;
  router?: Router;
  cooldown?: CooldownEngine;
  maxAttempts: number;
  /**
   * Tick 48 v1.7.20.0：可选 RetryPolicy。
   *  - 提供时：maxAttempts 覆盖 opts.maxAttempts；attempt 间 sleep computeBackoff()；
   *    retryOnStatusCodes/retryOnErrorKinds 白名单覆盖默认 isRetriableKind。
   *  - 不提供：保留 Tick 47 之前的行为（无 sleep，用 isRetriableKind）。
   */
  retryPolicy?: RetryPolicy;
  /** 测试钩子：替代 setTimeout 的 sleep，让单测无须真等。 */
  sleepFn?: (ms: number) => Promise<void>;
}

export class RouteExecutorService {
  private readonly router: Router;
  private readonly cooldown: CooldownEngine;

  constructor(private readonly opts: RouteExecutorOptions) {
    this.router = opts.router ?? new Router();
    this.cooldown = opts.cooldown ?? new CooldownEngine(opts.cooldownStore);
  }

  /** Tick 48: 决定本次失败是否应再尝试下一候选。policy 缺失走默认 isRetriableKind。 */
  private evalRetriable(
    status: number | null | undefined,
    kind: string | undefined | null,
    fallback?: boolean,
  ): boolean {
    const defaultRetriable = fallback ?? isRetriableKind(toKind(kind));
    if (!this.opts.retryPolicy) return defaultRetriable;
    return shouldRetry(this.opts.retryPolicy, { status, kind, defaultRetriable });
  }

  /** Tick 48: attempt 之间 sleep jittered backoff（仅 retryPolicy 提供时启用）。 */
  private async sleepBetweenAttempts(attemptIndex: number): Promise<void> {
    if (!this.opts.retryPolicy) return;
    const ms = computeBackoff(attemptIndex + 1, this.opts.retryPolicy);
    if (ms <= 0) return;
    const sleep = this.opts.sleepFn ?? defaultSleep;
    await sleep(ms);
  }

  async execute(args: ExecuteOptions): Promise<ExecuteResult> {
    const requestId = args.requestId ?? newPublicRequestId();
    const decision = this.router.decide(args.pool, args.ctx);
    if (decision.candidates.length === 0) {
      return this.fail(
        requestId,
        [],
        decision.mode,
        new FreeLLMError('no_route_available', '没有候选模型通过路由过滤条件', {
          context: { requestId, attempts: 0 },
        }),
      );
    }

    const attempts: AttemptReport[] = [];
    const effectiveMaxAttempts = this.opts.retryPolicy?.maxAttempts ?? this.opts.maxAttempts;
    const loopLimit = Math.min(effectiveMaxAttempts, decision.candidates.length);
    for (let i = 0; i < loopLimit; i += 1) {
      const cand = decision.candidates[i]!;
      const provider = this.opts.registry.get(cand.model.providerSlug);
      if (!provider) {
        attempts.push(this.makeAttempt(i + 1, cand, 0, null, 'unknown', 'provider not registered', false));
        continue;
      }

      const modelGate = await this.cooldown.check('model', cand.model.modelId);
      if (!modelGate.allowed) {
        attempts.push(
          this.makeAttempt(i + 1, cand, 0, null, 'cooldown_active', modelGate.reason ?? 'cooldown', false),
        );
        continue;
      }
      const provGate = await this.cooldown.check('provider', cand.model.providerSlug);
      if (!provGate.allowed) {
        attempts.push(
          this.makeAttempt(i + 1, cand, 0, null, 'cooldown_active', provGate.reason ?? 'cooldown', false),
        );
        continue;
      }

      const tStart = Date.now();
      try {
        if (args.streaming) {
          const result = await this.runStream(provider, args.request, cand);
          if (result.outcome.ok) {
            attempts.push(this.fromOutcome(i + 1, cand, result.outcome, true));
            await this.cooldown.registerSuccess('model', cand.model.modelId);
            await this.cooldown.registerSuccess('provider', cand.model.providerSlug);
            void this.opts.scoreUpdater?.recordAttempt(cand.model.modelId, {
              ok: true,
              durationMs: result.outcome.durationMs,
              ...(result.outcome.firstTokenMs !== undefined
                ? { firstTokenMs: result.outcome.firstTokenMs }
                : {}),
              kind: undefined,
            });
            await this.persistAttempts(requestId, attempts, args);
            return {
              ok: true,
              requestId,
              attempts,
              mode: decision.mode,
              stream: result.iter,
              upstreamProvider: cand.model.providerSlug,
              upstreamModel: cand.model.upstreamId,
            } satisfies ExecuteStreamResult;
          }
          attempts.push(this.fromOutcome(i + 1, cand, result.outcome, false));
          await this.handleFailure(cand, result.outcome);
          if (!this.evalRetriable(result.outcome.status, result.outcome.errorKind)) break;
          await this.sleepBetweenAttempts(i);
        } else {
          const result = await provider.complete({ ...args.request, stream: false });
          if (result.outcome.ok) {
            attempts.push(this.fromOutcome(i + 1, cand, result.outcome, true));
            await this.cooldown.registerSuccess('model', cand.model.modelId);
            await this.cooldown.registerSuccess('provider', cand.model.providerSlug);
            void this.opts.scoreUpdater?.recordAttempt(cand.model.modelId, {
              ok: true,
              durationMs: result.outcome.durationMs,
              kind: undefined,
            });
            await this.persistAttempts(requestId, attempts, args);
            return {
              ok: true,
              requestId,
              attempts,
              mode: decision.mode,
              response: result.response,
              upstreamProvider: cand.model.providerSlug,
              upstreamModel: cand.model.upstreamId,
            } satisfies ExecuteCompletionResult;
          }
          attempts.push(this.fromOutcome(i + 1, cand, result.outcome, false));
          await this.handleFailure(cand, result.outcome);
          if (!this.evalRetriable(result.outcome.status, result.outcome.errorKind)) break;
          await this.sleepBetweenAttempts(i);
        }
      } catch (err) {
        const classified = classifyRoutingError({
          status: null,
          message: (err as Error).message,
          causeName: (err as Error).name,
        });
        attempts.push(
          this.makeAttempt(
            i + 1,
            cand,
            Date.now() - tStart,
            null,
            classified.kind,
            classified.reason,
            true,
          ),
        );
        await this.cooldown.registerFailure({
          scope: 'model',
          key: cand.model.modelId,
          reason: classified.kind,
          ...(classified.hintMs !== undefined ? { hintMs: classified.hintMs } : {}),
        });
        if (!this.evalRetriable(null, classified.kind, classified.retriable)) break;
        await this.sleepBetweenAttempts(i);
      }
    }

    await this.persistAttempts(requestId, attempts, args);
    return this.fail(
      requestId,
      attempts,
      decision.mode,
      new FreeLLMError('all_attempts_failed', `${attempts.length} attempt(s) failed`, {
        context: { requestId, attempts: attempts.length },
      }),
    );
  }

  private async runStream(
    provider: BaseProvider,
    request: ChatCompletionRequest,
    _cand: Candidate,
  ): Promise<{ iter: AsyncIterable<ChatStreamChunk>; outcome: ReturnType<NonNullable<Awaited<ReturnType<BaseProvider['stream']>>['outcome']>> }> {
    const res = await provider.stream({ ...request, stream: true });
    // Drain a single chunk synthetically to confirm the provider yielded — we
    // wrap the iterator so the downstream still gets every chunk, including
    // the first one we peeked at.
    const original = res.iter;
    const probe = await peekFirst(original);
    if (!probe.ok) {
      return { iter: probe.iter, outcome: res.outcome() };
    }
    return { iter: probe.iter, outcome: res.outcome() };
  }

  private fromOutcome(
    ordinal: number,
    cand: Candidate,
    outcome: {
      ok: boolean;
      durationMs: number;
      firstTokenMs?: number;
      status: number | null;
      errorKind?: string;
      errorMessage?: string;
    },
    ok: boolean,
  ): AttemptReport {
    return {
      ordinal,
      modelId: cand.model.modelId,
      providerSlug: cand.model.providerSlug,
      upstreamModel: cand.model.upstreamId,
      durationMs: outcome.durationMs,
      ...(outcome.firstTokenMs !== undefined ? { firstTokenMs: outcome.firstTokenMs } : {}),
      ok,
      status: outcome.status,
      ...(outcome.errorKind ? { errorKind: outcome.errorKind as FreeLLMErrorKind } : {}),
      ...(outcome.errorMessage ? { errorMessage: outcome.errorMessage } : {}),
      cooldownTriggered: !ok,
      rationale: cand.rationale,
      score: cand.score.composite,
      scoreExplanation: cand.score,
    };
  }

  private makeAttempt(
    ordinal: number,
    cand: Candidate,
    durationMs: number,
    status: number | null,
    errorKind: FreeLLMErrorKind | string,
    errorMessage: string,
    cooldownTriggered: boolean,
  ): AttemptReport {
    return {
      ordinal,
      modelId: cand.model.modelId,
      providerSlug: cand.model.providerSlug,
      upstreamModel: cand.model.upstreamId,
      durationMs,
      ok: false,
      status,
      errorKind: errorKind as FreeLLMErrorKind,
      errorMessage,
      cooldownTriggered,
      rationale: cand.rationale,
      score: cand.score.composite,
      scoreExplanation: cand.score,
    };
  }

  private async handleFailure(
    cand: Candidate,
    outcome: { errorKind?: string; status: number | null; errorMessage?: string },
  ): Promise<void> {
    const classified = classifyRoutingError({
      status: outcome.status,
      message: outcome.errorMessage ?? '',
    });
    await this.cooldown.registerFailure({
      scope: 'model',
      key: cand.model.modelId,
      reason: classified.kind,
      ...(classified.hintMs !== undefined ? { hintMs: classified.hintMs } : {}),
    });
    if (classified.providerLevel) {
      await this.cooldown.registerFailure({
        scope: 'provider',
        key: cand.model.providerSlug,
        reason: classified.kind,
        ...(classified.hintMs !== undefined ? { hintMs: classified.hintMs * 2 } : {}),
      });
    }
    void this.opts.scoreUpdater?.recordAttempt(cand.model.modelId, {
      ok: false,
      durationMs: 0,
      kind: classified.kind,
    });
  }

  private fail(
    requestId: string,
    attempts: AttemptReport[],
    mode: string,
    err: FreeLLMError,
  ): ExecuteFailureResult {
    return { ok: false, requestId, attempts, mode, error: err };
  }

  private async persistAttempts(
    requestId: string,
    attempts: AttemptReport[],
    args: ExecuteOptions,
  ): Promise<void> {
    if (attempts.length === 0) return;
    try {
      // We need an anchoring RequestLog row; create a placeholder if none exists
      // yet (the v1/chat-completions route in Tick 5 will create the real one).
      await this.opts.prisma.requestLog.upsert({
        where: { requestId },
        update: { attempts: attempts.length },
        create: {
          requestId,
          virtualKeyId: args.metadata?.virtualKeyId ?? null,
          attempts: attempts.length,
          streaming: args.streaming,
          modelAlias: args.ctx.alias ?? null,
          routingMode: args.ctx.policy.mode,
          startedAt: new Date(),
          finishedAt: new Date(),
        },
      });

      const lastAttempt = attempts.find((a) => a.ok) ?? attempts[attempts.length - 1]!;
      await this.opts.prisma.requestLog.update({
        where: { requestId },
        data: {
          upstreamProvider: lastAttempt.providerSlug,
          upstreamModel: lastAttempt.upstreamModel,
          status: lastAttempt.ok ? 200 : 502,
          ...(lastAttempt.errorKind ? { errorKind: lastAttempt.errorKind } : {}),
        },
      });

      await this.opts.prisma.routeAttempt.createMany({
        data: attempts.map((a) => ({
          requestId,
          ordinal: a.ordinal,
          modelId: a.modelId,
          upstreamModel: a.upstreamModel,
          startedAt: new Date(),
          finishedAt: new Date(),
          durationMs: a.durationMs,
          ...(a.firstTokenMs !== undefined ? { firstTokenMs: a.firstTokenMs } : {}),
          status: a.status ?? null,
          errorKind: a.errorKind ?? null,
          errorMessage: a.errorMessage ?? null,
          cooldownTriggered: a.cooldownTriggered,
          notes: a.rationale,
        })),
      });
    } catch (err) {
      // Audit P0-6: telemetry failures must leave an audit trail. Console is a
      // last-resort because this service has no logger injected; the API layer
      // captures stdout/stderr through pino transport.
      console.error('[route-executor] persistAttempts failed', {
        requestId,
        attempts: attempts.length,
        err: (err as Error).message,
      });
    }
  }
}

async function peekFirst<T>(it: AsyncIterable<T>): Promise<{ ok: boolean; iter: AsyncIterable<T> }> {
  const iter = it[Symbol.asyncIterator]();
  const first = await iter.next();
  if (first.done) {
    return {
      ok: false,
      iter: (async function* () {
        // empty
      })(),
    };
  }
  const wrapped = (async function* () {
    yield first.value;
    while (true) {
      const r = await iter.next();
      if (r.done) return;
      yield r.value;
    }
  })();
  return { ok: true, iter: wrapped };
}
