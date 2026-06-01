/**
 * useAdminEvents —— /admin/events SSE 客户端 hook（Tick 17 v1.1.0.0 引入）。
 *
 * 接 `EventSource('/admin/events')`，按事件类型回调 + 自动让 TanStack Query 失效相关键。
 *
 * 用法（Dashboard）：
 *   useAdminEvents({
 *     onModelChange: () => qc.invalidateQueries({ queryKey: ['admin','models'] }),
 *     onCooldown:    () => qc.invalidateQueries({ queryKey: ['admin','cooldowns'] }),
 *     onDiscoveryCycle: () => qc.invalidateQueries({ queryKey: ['admin','metrics'] }),
 *   });
 */
import { useEffect, useRef } from 'react';

export interface AdminEventHandlers {
  onModelChange?: (topic: string, payload: unknown) => void;
  onCooldown?: (payload: unknown) => void;
  onDiscoveryCycle?: (payload: unknown) => void;
  onRequestComplete?: (payload: unknown) => void;
  onReady?: (payload: { requestId: string; serverTime: string }) => void;
  onError?: (err: Event) => void;
}

const MODEL_TOPICS = new Set([
  'model:added',
  'model:removed',
  'model:paid_now',
  'model:capability_changed',
  'model:context_changed',
  'model:status_changed',
]);

export function useAdminEvents(handlers: AdminEventHandlers): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    // EventSource 同源带 cookie，不需手动鉴权。
    const src = new EventSource('/admin/events', { withCredentials: true });

    const parse = (e: MessageEvent): unknown => {
      try {
        return JSON.parse(e.data);
      } catch {
        return e.data;
      }
    };

    const onReady = (e: MessageEvent) => {
      handlersRef.current.onReady?.(parse(e) as { requestId: string; serverTime: string });
    };

    const onAny = (topic: string) => (e: MessageEvent) => {
      const payload = parse(e);
      if (MODEL_TOPICS.has(topic)) handlersRef.current.onModelChange?.(topic, payload);
      else if (topic === 'cooldown:triggered') handlersRef.current.onCooldown?.(payload);
      else if (topic === 'discovery:cycle') handlersRef.current.onDiscoveryCycle?.(payload);
      else if (topic === 'request:complete') handlersRef.current.onRequestComplete?.(payload);
    };

    src.addEventListener('ready', onReady);
    const topics = [
      'model:added',
      'model:removed',
      'model:paid_now',
      'model:capability_changed',
      'model:context_changed',
      'model:status_changed',
      'cooldown:triggered',
      'discovery:cycle',
      'request:complete',
    ];
    const listeners = topics.map((t) => {
      const fn = onAny(t);
      src.addEventListener(t, fn);
      return [t, fn] as const;
    });

    src.onerror = (err) => {
      handlersRef.current.onError?.(err);
      // EventSource 自带指数退避重连；这里不主动 close。
    };

    return () => {
      src.removeEventListener('ready', onReady);
      for (const [t, fn] of listeners) src.removeEventListener(t, fn);
      src.close();
    };
  }, []);
}
