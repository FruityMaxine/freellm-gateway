/**
 * AI 错误分类回归测试。
 *
 * 用 baselines.json 的 errors 用例对 classifyProviderError 输出做断言。
 * 错误分类影响 cooldown 决策、是否重试、用户能否看到上游细节 —— 一旦分错损害极大，
 * 因此把映射结果钉死在基线里。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classifyProviderError } from '@freellm/provider-core';

interface ErrCase {
  scenario: string;
  status: number | null;
  message: string;
  causeName?: string;
  expectedKind: string;
}

function loadBaselines(): { errors: ErrCase[] } {
  const p = resolve(__dirname, 'baselines.json');
  return JSON.parse(readFileSync(p, 'utf8')) as { errors: ErrCase[] };
}

describe('AI 回归 - 错误分类（baseline 对照）', () => {
  const { errors } = loadBaselines();

  for (const c of errors) {
    it(c.scenario, () => {
      const kind = classifyProviderError({
        status: c.status,
        message: c.message,
        ...(c.causeName ? { causeName: c.causeName } : {}),
      });
      expect(kind).toBe(c.expectedKind);
    });
  }
});
