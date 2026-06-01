/**
 * EventBus 的 Redis Pub/Sub 适配器（Tick 22 v1.4.1.0 引入）。
 *
 * 单实例下 `globalEventBus` 是进程内事件总线；多实例下进程间事件不互通。
 * 本适配器把 `EventBus.emit()` 包装成「本地分发 + Redis PUBLISH」双轨：
 *
 *   - 本进程 emit() → 本地 listeners 立即收 + Redis PUBLISH freellm:events <json>
 *   - 其他进程 SUBSCRIBE 收到 → 调用 localEmit() 在本地重 emit（不再二次发 publish）
 *
 * 防 fanout 循环：远端注入的事件用 `_remoteEmit()` 路径，跳过 publish 步骤。
 *
 * 当 `FREELLM_REDIS_URL` 未设或 ioredis 未装时，`attachRedisPubSub()` 静默不挂接，
 * 行为退化为单实例（与 Tick 21 一致）。
 */
import { createRequire } from 'node:module';
import { EventBus } from './event-bus.js';

const CHANNEL = 'freellm:events';
const nodeRequire = createRequire(import.meta.url);

export interface PubSubAttachOptions {
  /** Redis 连接串；缺省读 `FREELLM_REDIS_URL`。 */
  redisUrl?: string;
  /** 自定义 channel 名（多 FreeLLM 集群共享 Redis 时区分用）。 */
  channel?: string;
}

interface RemoteEnvelope {
  topic: string;
  payload: unknown;
  /** 发送者实例 ID，避免自己接到自己发的消息后再循环。 */
  sender: string;
}

const INSTANCE_ID = `freellm-${process.pid}-${Math.random().toString(36).slice(2, 10)}`;

/**
 * 挂接 Pub/Sub 到给定 EventBus。
 * 返回一个 detach 函数，用于停机或测试清理。
 * 若 Redis 不可用，返回 noop detach 且 attached=false。
 */
export function attachRedisPubSub(
  bus: EventBus,
  opts: PubSubAttachOptions = {},
): { attached: boolean; detach: () => Promise<void> } {
  const url = opts.redisUrl ?? process.env.FREELLM_REDIS_URL;
  if (!url) {
    return { attached: false, detach: async () => undefined };
  }

  let IORedis: unknown;
  try {
    IORedis = nodeRequire('ioredis');
  } catch (err) {
    console.warn('[event-bus-redis] ioredis 未装，跨实例广播禁用：', (err as Error).message);
    return { attached: false, detach: async () => undefined };
  }

  const channel = opts.channel ?? CHANNEL;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Ctor = IORedis as any;
  const pub = new Ctor(url, { lazyConnect: false });
  const sub = new Ctor(url, { lazyConnect: false });

  // 注入本地 emit hook：每次本进程 emit 完本地分发后，再向 Redis publish 一份。
  const originalEmit = bus.emit.bind(bus);
  bus.emit = async function patchedEmit<T>(topic: string, payload: T): Promise<void> {
    await originalEmit(topic, payload);
    try {
      const env: RemoteEnvelope = { topic, payload, sender: INSTANCE_ID };
      await pub.publish(channel, JSON.stringify(env));
    } catch (err) {
      console.warn('[event-bus-redis] publish 失败：', (err as Error).message);
    }
  };

  sub.subscribe(channel, (err: Error | null) => {
    if (err) {
      console.warn('[event-bus-redis] 订阅频道失败：', err.message);
    }
  });
  sub.on('message', (ch: string, message: string) => {
    if (ch !== channel) return;
    let env: RemoteEnvelope;
    try {
      env = JSON.parse(message) as RemoteEnvelope;
    } catch (err) {
      console.warn('[event-bus-redis] 消息 JSON 解析失败：', (err as Error).message);
      return;
    }
    // 跳过自己发的消息（防止 fanout 循环）。
    if (env.sender === INSTANCE_ID) return;
    // 调原始 emit（不走 patched 版本，避免再次 publish）。
    void originalEmit(env.topic, env.payload);
  });

  const detach = async (): Promise<void> => {
    bus.emit = originalEmit;
    try {
      await sub.unsubscribe(channel);
      await sub.quit();
    } catch {
      /* ignore */
    }
    try {
      await pub.quit();
    } catch {
      /* ignore */
    }
  };

  console.info('[event-bus-redis] 已挂接 Redis Pub/Sub 跨实例广播，频道：', channel);
  return { attached: true, detach };
}

/** 仅供测试：返回当前实例 ID，验证 fanout 循环防护。 */
export function _instanceId(): string {
  return INSTANCE_ID;
}
