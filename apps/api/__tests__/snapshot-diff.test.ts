import { describe, it, expect } from 'vitest';
import type { DiscoveredModel } from '@freellm/shared';
import { diffSnapshots } from '../src/services/snapshot-diff.service.js';

function dm(over: Partial<DiscoveredModel> & { upstreamId: string }): DiscoveredModel {
  return {
    upstreamId: over.upstreamId,
    displayName: over.displayName ?? over.upstreamId,
    contextLength: over.contextLength ?? 8192,
    pricing: over.pricing,
    capabilities: over.capabilities ?? {
      stream: true,
      json: false,
      tools: false,
      vision: false,
      audio: false,
    },
    paramsSupported: over.paramsSupported,
    topProvider: over.topProvider,
    description: over.description,
    family: over.family,
    classification: over.classification ?? 'free',
    classificationReason: over.classificationReason ?? 'pricing_all_zero@0.95',
    raw: over.raw ?? {},
  };
}

describe('diffSnapshots', () => {
  it('detects added models', () => {
    const r = diffSnapshots({
      discovered: [dm({ upstreamId: 'new/model:free' })],
      existing: [],
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('added');
    expect(r.stats.added).toBe(1);
  });

  it('detects removed models', () => {
    const r = diffSnapshots({
      discovered: [],
      existing: [
        {
          id: 'm1',
          upstreamId: 'leaving/model',
          contextLength: 8192,
          isFree: true,
          capabilitiesJson: JSON.stringify({ stream: true }),
          status: 'active',
        },
      ],
    });
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.kind).toBe('removed');
    expect(r.stats.removed).toBe(1);
  });

  it('emits paid_now when a free model becomes paid', () => {
    const r = diffSnapshots({
      discovered: [
        dm({
          upstreamId: 'flipping/model',
          classification: 'paid',
          pricing: { prompt: '0.0001' },
        }),
      ],
      existing: [
        {
          id: 'm1',
          upstreamId: 'flipping/model',
          contextLength: 8192,
          isFree: true,
          capabilitiesJson: JSON.stringify({ stream: true }),
          status: 'active',
        },
      ],
    });
    const ev = r.events.find((e) => e.kind === 'paid_now');
    expect(ev).toBeDefined();
    expect(r.stats.paidNow).toBe(1);
  });

  it('detects context length changes', () => {
    const r = diffSnapshots({
      discovered: [dm({ upstreamId: 'foo', contextLength: 200_000 })],
      existing: [
        {
          id: 'm1',
          upstreamId: 'foo',
          contextLength: 100_000,
          isFree: true,
          capabilitiesJson: JSON.stringify({ stream: true }),
          status: 'active',
        },
      ],
    });
    const ev = r.events.find((e) => e.kind === 'context_changed');
    expect(ev).toBeDefined();
    expect(r.stats.contextChanged).toBe(1);
  });

  it('detects capability additions and removals', () => {
    const r = diffSnapshots({
      discovered: [
        dm({
          upstreamId: 'foo',
          capabilities: {
            stream: true,
            json: true,
            tools: true,
            vision: false,
            audio: false,
          },
        }),
      ],
      existing: [
        {
          id: 'm1',
          upstreamId: 'foo',
          contextLength: 8192,
          isFree: true,
          capabilitiesJson: JSON.stringify({ stream: true, json: false, tools: false }),
          status: 'active',
        },
      ],
    });
    const ev = r.events.find((e) => e.kind === 'capability_changed');
    expect(ev).toBeDefined();
    if (ev && ev.kind === 'capability_changed') {
      expect(ev.added).toEqual(expect.arrayContaining(['json', 'tools']));
    }
  });

  it('emits status_changed when a removed model returns', () => {
    const r = diffSnapshots({
      discovered: [dm({ upstreamId: 'returns/model' })],
      existing: [
        {
          id: 'm1',
          upstreamId: 'returns/model',
          contextLength: 8192,
          isFree: true,
          capabilitiesJson: JSON.stringify({ stream: true }),
          status: 'paid_now',
        },
      ],
    });
    const ev = r.events.find((e) => e.kind === 'status_changed');
    expect(ev).toBeDefined();
    expect(r.stats.statusChanged).toBe(1);
  });

  it('counts unchanged models', () => {
    const existing = {
      id: 'm1',
      upstreamId: 'steady/model',
      contextLength: 8192,
      isFree: true,
      capabilitiesJson: JSON.stringify({
        stream: true,
        json: false,
        tools: false,
        vision: false,
        audio: false,
        reasoning: false,
        longContext: false,
      }),
      status: 'active',
    };
    const r = diffSnapshots({
      discovered: [dm({ upstreamId: 'steady/model' })],
      existing: [existing],
    });
    expect(r.stats.unchanged).toBe(1);
    expect(r.events).toHaveLength(0);
  });
});
