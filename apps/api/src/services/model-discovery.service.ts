/**
 * Model Discovery Service.
 *
 * Pulls each provider's catalogue, classifies free vs paid, persists
 * snapshots, diffs against the live `models` rows, and emits change events
 * on the global EventBus.
 */
import type { PrismaClient } from '@prisma/client';
import { toDiscoveredModel, type ProviderRegistry, type BaseProvider } from '@freellm/provider-core';
import type { DiscoveredModel } from '@freellm/shared';
import { diffSnapshots, type ModelChangeEvent } from './snapshot-diff.service.js';
import { nextModelStatus } from '../lib/state-machine/model-status.js';
import { EventBus, globalEventBus } from './event-bus.js';
import { invalidatePoolCache } from '../lib/pool-cache.js';
import { invalidateMetricsCache } from '../routes/admin/metrics.routes.js';

export interface DiscoveryRunReport {
  providerSlug: string;
  ok: boolean;
  error?: string;
  durationMs: number;
  discovered: number;
  events: ModelChangeEvent[];
}

export interface DiscoveryServiceOptions {
  prisma: PrismaClient;
  registry: ProviderRegistry;
  events?: EventBus;
  /** Override for tests so they don't actually persist snapshots. */
  dryRun?: boolean;
}

export class ModelDiscoveryService {
  private readonly events: EventBus;

  constructor(private readonly opts: DiscoveryServiceOptions) {
    this.events = opts.events ?? globalEventBus;
  }

  /** Run discovery for every enabled provider registered in the registry. */
  async refreshAll(): Promise<DiscoveryRunReport[]> {
    const providers = this.opts.registry.list();
    const reports: DiscoveryRunReport[] = [];
    for (const provider of providers) {
      if (provider.config.enabled === false) continue;
      reports.push(await this.refreshOne(provider));
    }
    return reports;
  }

  async refreshSlug(slug: string): Promise<DiscoveryRunReport> {
    const provider = this.opts.registry.get(slug);
    if (!provider) {
      return {
        providerSlug: slug,
        ok: false,
        error: `provider '${slug}' not registered`,
        durationMs: 0,
        discovered: 0,
        events: [],
      };
    }
    return this.refreshOne(provider);
  }

  async refreshOne(provider: BaseProvider): Promise<DiscoveryRunReport> {
    const start = Date.now();
    const { prisma, dryRun } = this.opts;
    try {
      const raw = await provider.listModels();
      const discovered = raw.map((r) => toDiscoveredModel(r));

      // Look up provider row by slug to anchor `models.providerId` correctly.
      const providerRow = await prisma.provider.findUnique({
        where: { slug: provider.slug },
      });
      if (!providerRow) {
        return {
          providerSlug: provider.slug,
          ok: false,
          error: `provider row '${provider.slug}' missing in DB`,
          durationMs: Date.now() - start,
          discovered: discovered.length,
          events: [],
        };
      }

      const existing = await prisma.model.findMany({ where: { providerId: providerRow.id } });
      const diff = diffSnapshots({
        discovered,
        existing: existing.map((m) => ({
          id: m.id,
          upstreamId: m.upstreamId,
          contextLength: m.contextLength,
          isFree: m.isFree,
          pricingJson: m.pricingJson ?? null,
          capabilitiesJson: m.capabilitiesJson,
          status: m.status,
        })),
      });

      if (!dryRun) {
        await this.applyDiff(prisma, providerRow.id, discovered, diff.events);
        await this.persistSnapshots(prisma, providerRow.id, discovered);
        await prisma.provider.update({
          where: { id: providerRow.id },
          data: { lastSyncAt: new Date(), lastSuccessAt: new Date(), status: 'active' },
        });
        // 模型池已变动：让 router + Dashboard metrics 在下次请求时拿到最新数据，
        // 不依赖 5s TTL 自然过期。
        invalidatePoolCache();
        invalidateMetricsCache();
      }

      // Emit events for downstream consumers (admin SSE / dashboard / etc).
      for (const ev of diff.events) {
        await this.events.emit(`model:${ev.kind}`, ev);
      }
      await this.events.emit('discovery:cycle', {
        providerSlug: provider.slug,
        stats: diff.stats,
      });

      return {
        providerSlug: provider.slug,
        ok: true,
        durationMs: Date.now() - start,
        discovered: discovered.length,
        events: diff.events,
      };
    } catch (err) {
      const message = (err as Error).message;
      // Roll the provider into degraded status without touching its model rows
      // — we'd rather keep stale data than wipe everything because one sync failed.
      if (!dryRun) {
        try {
          await prisma.provider.update({
            where: { slug: provider.slug },
            data: { status: 'degraded', lastErrorAt: new Date(), lastErrorMessage: message },
          });
          await prisma.errorEvent.create({
            data: {
              kind: 'provider_outage',
              severity: 'warn',
              message: `discovery failed for ${provider.slug}: ${message}`,
              providerId: (await prisma.provider.findUnique({ where: { slug: provider.slug } }))?.id ?? null,
            },
          });
        } catch {
          /* swallow secondary failure — we still report it below */
        }
      }
      await this.events.emit('discovery:failed', { providerSlug: provider.slug, error: message });
      return {
        providerSlug: provider.slug,
        ok: false,
        error: message,
        durationMs: Date.now() - start,
        discovered: 0,
        events: [],
      };
    }
  }

  private async applyDiff(
    prisma: PrismaClient,
    providerId: string,
    discovered: DiscoveredModel[],
    events: ModelChangeEvent[],
  ): Promise<void> {
    const discoveredById = new Map(discovered.map((d) => [d.upstreamId, d]));
    const providerRow = await prisma.provider.findUnique({ where: { id: providerId } });
    const isMockProvider = providerRow
      ? providerRow.kind === 'mock' || providerRow.slug.startsWith('mock')
      : false;

    for (const ev of events) {
      switch (ev.kind) {
        case 'added': {
          const dm = ev.model;
          await prisma.model.create({
            data: {
              providerId,
              upstreamId: dm.upstreamId,
              ...(dm.family ? { family: dm.family } : {}),
              displayName: dm.displayName,
              contextLength: dm.contextLength,
              isFree: dm.classification === 'free',
              isFreeReason: dm.classificationReason,
              pricingJson: dm.pricing ? JSON.stringify(dm.pricing) : null,
              capabilitiesJson: JSON.stringify(dm.capabilities),
              paramsSupported: dm.paramsSupported ? JSON.stringify(dm.paramsSupported) : null,
              ...(dm.topProvider ? { topProvider: dm.topProvider } : {}),
              ...(dm.description ? { description: dm.description } : {}),
              status: 'active',
              lastSeenAt: new Date(),
              firstSeenAt: new Date(),
            },
          });
          // Initialise model score row so the scorer has somewhere to land.
          const created = await prisma.model.findFirst({
            where: { providerId, upstreamId: dm.upstreamId },
          });
          if (created) {
            await prisma.modelScore.upsert({
              where: { modelId: created.id },
              update: {},
              create: {
                modelId: created.id,
                costScore: dm.classification === 'free' ? 1 : 0,
                // mock-prefer: lift mock-family models to the top of the candidate
                // queue so /v1/chat/completions returns 200 without real upstream keys.
                ...(isMockProvider
                  ? {
                      availabilityScore: 0.99,
                      latencyScore: 0.99,
                      rateLimitScore: 0.99,
                      qualityScore: 0.85,
                      stabilityScore: 0.99,
                      composite: 0.95,
                      explanationJson: JSON.stringify({
                        seedReason: 'mock-prefer (Tick 10)',
                      }),
                    }
                  : {}),
              },
            });
          }
          await prisma.errorEvent.create({
            data: {
              kind: 'model_change',
              severity: 'info',
              message: `model added: ${dm.upstreamId} (${dm.classification})`,
              modelId: created?.id ?? null,
              providerId,
              detailsJson: JSON.stringify({ event: 'added', classification: dm.classification }),
            },
          });
          break;
        }
        case 'removed': {
          const transition = nextModelStatus('active', 'discovery_missing');
          await prisma.model.update({
            where: { id: ev.modelId },
            data: { status: transition.to, removedAt: new Date() },
          });
          await prisma.errorEvent.create({
            data: {
              kind: 'model_change',
              severity: 'warn',
              message: `model removed: ${ev.upstreamId}`,
              modelId: ev.modelId,
              providerId,
              detailsJson: JSON.stringify({ event: 'removed' }),
            },
          });
          break;
        }
        case 'paid_now': {
          await prisma.model.update({
            where: { id: ev.modelId },
            data: { status: 'paid_now', isFree: false, pricingJson: ev.newPricing ? JSON.stringify(ev.newPricing) : null },
          });
          await prisma.errorEvent.create({
            data: {
              kind: 'model_change',
              severity: 'warn',
              message: `model became paid: ${ev.upstreamId}`,
              modelId: ev.modelId,
              providerId,
              detailsJson: JSON.stringify({ event: 'paid_now', newPricing: ev.newPricing }),
            },
          });
          break;
        }
        case 'context_changed': {
          await prisma.model.update({
            where: { id: ev.modelId },
            data: { contextLength: ev.newContextLength },
          });
          await prisma.errorEvent.create({
            data: {
              kind: 'model_change',
              severity: 'info',
              message: `context changed: ${ev.upstreamId} ${ev.previousContextLength}→${ev.newContextLength}`,
              modelId: ev.modelId,
              providerId,
              detailsJson: JSON.stringify({ event: 'context_changed', previous: ev.previousContextLength, next: ev.newContextLength }),
            },
          });
          break;
        }
        case 'capability_changed': {
          await prisma.model.update({
            where: { id: ev.modelId },
            data: { capabilitiesJson: JSON.stringify(ev.newCapabilities) },
          });
          await prisma.errorEvent.create({
            data: {
              kind: 'model_change',
              severity: 'info',
              message: `capability changed: ${ev.upstreamId}`,
              modelId: ev.modelId,
              providerId,
              detailsJson: JSON.stringify({ event: 'capability_changed', added: ev.added, removed: ev.removed }),
            },
          });
          break;
        }
        case 'status_changed': {
          await prisma.model.update({
            where: { id: ev.modelId },
            data: { status: ev.newStatus },
          });
          await prisma.errorEvent.create({
            data: {
              kind: 'model_change',
              severity: 'info',
              message: `status changed: ${ev.upstreamId} ${ev.previousStatus}→${ev.newStatus}`,
              modelId: ev.modelId,
              providerId,
              detailsJson: JSON.stringify({ event: 'status_changed', previous: ev.previousStatus, next: ev.newStatus }),
            },
          });
          break;
        }
      }
    }

    // Touch lastSeenAt for every model that the upstream still reports.
    for (const upstreamId of discoveredById.keys()) {
      await prisma.model.updateMany({
        where: { providerId, upstreamId },
        data: { lastSeenAt: new Date() },
      });
    }
  }

  private async persistSnapshots(
    prisma: PrismaClient,
    providerId: string,
    discovered: DiscoveredModel[],
  ): Promise<void> {
    for (const dm of discovered) {
      const modelRow = await prisma.model.findFirst({
        where: { providerId, upstreamId: dm.upstreamId },
      });
      await prisma.modelSnapshot.create({
        data: {
          providerId,
          upstreamId: dm.upstreamId,
          ...(modelRow ? { modelId: modelRow.id } : {}),
          payloadJson: JSON.stringify(dm.raw ?? dm),
          isFree: dm.classification === 'free',
          contextLength: dm.contextLength,
        },
      });
    }
  }
}
