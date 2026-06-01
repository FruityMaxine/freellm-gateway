/**
 * Tiny in-process pub/sub used by Model Discovery, Routing, and (later)
 * the dashboard's SSE feed. Deliberately small so we don't ship an
 * external dependency for a single-process server. Replace with Redis
 * pub/sub or Postgres LISTEN/NOTIFY when we go multi-process.
 */

export type EventBusListener<T = unknown> = (event: T) => void | Promise<void>;

export class EventBus {
  private listeners = new Map<string, Set<EventBusListener>>();
  private wildcards = new Set<EventBusListener<{ topic: string; payload: unknown }>>();

  on<T>(topic: string, listener: EventBusListener<T>): () => void {
    if (!this.listeners.has(topic)) this.listeners.set(topic, new Set());
    this.listeners.get(topic)!.add(listener as EventBusListener);
    return () => this.off(topic, listener);
  }

  off<T>(topic: string, listener: EventBusListener<T>): void {
    this.listeners.get(topic)?.delete(listener as EventBusListener);
  }

  onAny(listener: EventBusListener<{ topic: string; payload: unknown }>): () => void {
    this.wildcards.add(listener);
    return () => this.wildcards.delete(listener);
  }

  async emit<T>(topic: string, payload: T): Promise<void> {
    const subs = this.listeners.get(topic);
    const tasks: Promise<unknown>[] = [];
    if (subs) {
      for (const sub of subs) {
        // Wrap in Promise.resolve so synchronous throws become rejected
        // promises and are absorbed by Promise.allSettled below.
        tasks.push(Promise.resolve().then(() => sub(payload)));
      }
    }
    for (const w of this.wildcards) {
      tasks.push(Promise.resolve().then(() => w({ topic, payload })));
    }
    await Promise.allSettled(tasks);
  }

  clear(): void {
    this.listeners.clear();
    this.wildcards.clear();
  }
}

export const globalEventBus = new EventBus();
