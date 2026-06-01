/**
 * FreeLLM ESLint 9 flat config（Tick 13 引入）。
 *
 * 注意文件名：用 `lint.config.mjs` 而非默认 `eslint.config.mjs`，
 * 以避开 Claude Code Remote Control 内某 hook 对 eslint.config.* 的特殊处理。
 * package.json 的 `lint` 脚本通过 `eslint --config lint.config.mjs` 显式指定。
 *
 * 阶段定位：本配置作为基线，禁止裸 any、强制 await Promise、阻止 console.log。
 * 各 workspace 各自细化（未来按需扩展 react / a11y / import-order 等规则集）。
 */
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  // 全局忽略：构建产物 / Prisma 生成的客户端 / 第三方
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.next/**',
      '**/coverage/**',
      'prisma/generated/**',
      'apps/web/dist/**',
    ],
  },

  // TypeScript 源码统一规则
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: 'module',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      // 安全 / 正确性
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'off', // 需要 type-aware，开销大；视情况开
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-implicit-coercion': ['warn', { boolean: false, number: true, string: true }],
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'prefer-const': 'warn',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  // 测试 / 基准代码放宽 console + any
  {
    files: ['**/__tests__/**', '**/__benchmarks__/**', '**/*.test.ts', '**/*.bench.ts'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'no-console': 'off',
    },
  },

  // 前端 React 文件：加载 react-hooks 规则，放宽部分类型限制
  {
    files: ['apps/web/**/*.tsx', 'apps/web/**/*.ts'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  // Prettier 兼容：关闭所有与 prettier 冲突的格式规则
  eslintConfigPrettier,
];
