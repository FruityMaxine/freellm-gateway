import { describe, it, expect } from 'vitest';
import { EventBus } from '../src/services/event-bus.js';

describe('EventBus', () => {
  it('dispatches to topic subscribers', async () => {
    const bus = new EventBus();
    const received: number[] = [];
    bus.on<number>('count', (n) => {
      received.push(n);
    });
    await bus.emit('count', 1);
    await bus.emit('count', 2);
    expect(received).toEqual([1, 2]);
  });

  it('dispatches to wildcard subscribers', async () => {
    const bus = new EventBus();
    const received: Array<{ topic: string; payload: unknown }> = [];
    bus.onAny((ev) => {
      received.push(ev);
    });
    await bus.emit('foo', 'a');
    await bus.emit('bar', 42);
    expect(received).toHaveLength(2);
    expect(received[0]!.topic).toBe('foo');
    expect(received[1]!.payload).toBe(42);
  });

  it('off removes subscribers', async () => {
    const bus = new EventBus();
    const received: string[] = [];
    const listener = (s: string) => {
      received.push(s);
    };
    bus.on('topic', listener);
    await bus.emit('topic', 'a');
    bus.off('topic', listener);
    await bus.emit('topic', 'b');
    expect(received).toEqual(['a']);
  });

  it('failing listener does not stop others', async () => {
    const bus = new EventBus();
    const seen: string[] = [];
    bus.on('topic', () => {
      throw new Error('boom');
    });
    bus.on<string>('topic', (s) => {
      seen.push(s);
    });
    await bus.emit('topic', 'continues');
    expect(seen).toEqual(['continues']);
  });
});
