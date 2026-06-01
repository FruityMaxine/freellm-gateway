/**
 * Process-wide configuration. Loaded once at bootstrap; subsequent reads come
 * from this module so tests can swap the export with a fixture.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, type FreeLLMEnv } from '@freellm/shared';

export interface RuntimeConfig {
  env: FreeLLMEnv;
  version: string;
}

function readVersion(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  // src/ → apps/api/ → repo root
  const candidates = [
    resolve(here, '../../../VERSION'),
    resolve(here, '../../../../VERSION'),
    resolve(process.cwd(), 'VERSION'),
    join('/app', 'VERSION'),
  ];
  for (const p of candidates) {
    try {
      const raw = readFileSync(p, 'utf8').trim();
      if (raw) return raw;
    } catch {
      // try next candidate
    }
  }
  return '0.0.0.0';
}

let _cached: RuntimeConfig | null = null;

export function getConfig(): RuntimeConfig {
  if (!_cached) {
    _cached = {
      env: loadEnv(),
      version: readVersion(),
    };
  }
  return _cached;
}

/** Replace the cached config — for unit tests only. */
export function _setConfigForTests(cfg: RuntimeConfig): void {
  _cached = cfg;
}
