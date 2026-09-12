import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Two enforcement layers here:
 *
 * 1. General hygiene (recommended sets, no-unused-vars).
 * 2. Import boundaries — the module discipline of this project, as a compiler:
 *      web → api → domain packages → (kernel / db)   AND   nobody below imports
 *      framework code upward.
 *
 * The boundary rules are what make "only the access package decides access" a
 * property the build checks, not a habit to keep up.
 */

const DEEP_IMPORT_BAN = ['**/src/**'];

const NEVER_BELOW_FRAMEWORK_PATHS = [
  { name: 'next', message: 'packages/* 与 config/ 禁止依赖 Next.js' },
  { name: 'hono', message: 'packages/* 与 config/ 禁止依赖 HTTP 框架' },
];

const deepImportPatterns = () =>
  DEEP_IMPORT_BAN.map((pattern) => ({
    group: [pattern],
    message: '禁止深层 import：只允许从包的公开出口（package.json exports）导入。',
  }));

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/.next/**',
    '**/.npm-cache/**',
    '**/coverage/**',
    '**/.data/**',
    '**/migrations/**',
    '**/dist/**',
  ]),

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` is used deliberately in exactly one place (the driver-agnostic
      // Db type). Kept allowed project-wide for now; revisit with P2.
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },

  // ---- packages/* and config/ -----------------------------------------
  // Shared infrastructure may never pull the UI or HTTP frameworks upward.
  {
    files: ['packages/**/*.{ts,tsx}', 'config/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: NEVER_BELOW_FRAMEWORK_PATHS, patterns: deepImportPatterns() },
      ],
    },
  },

  // Only @ycomm/db may touch the database DRIVERS (pg). The query DSL
  // (`drizzle-orm` operators) is used by every domain package against the
  // client @ycomm/db hands out — that is the intended shape.
  {
    files: [
      'packages/{kernel,identity,access,forum,downloads,moderation,notify,jobs,media,audit}/**/*.{ts,tsx}',
      'config/**/*.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'pg', message: '只有 @ycomm/db 可以接触数据库驱动' }],
        },
      ],
    },
  },

  // kernel is the bottom layer: it may not see anything above it.
  {
    files: ['packages/kernel/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NEVER_BELOW_FRAMEWORK_PATHS,
            { name: '@ycomm/config', message: 'kernel 是最底层，禁止向上依赖 config' },
            { name: '@ycomm/db', message: 'kernel 是最底层，禁止依赖数据库' },
          ],
          patterns: deepImportPatterns(),
        },
      ],
    },
  },

  // config is read-only defaults: no database, no framework.
  {
    files: ['config/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            ...NEVER_BELOW_FRAMEWORK_PATHS,
            { name: '@ycomm/db', message: 'config 只承载代码默认值，禁止依赖数据库' },
          ],
          patterns: deepImportPatterns(),
        },
      ],
    },
  },

  // ---- node scripts ---------------------------------------------------
  {
    files: ['scripts/**/*.mjs', '*.config.{mjs,js}', 'eslint.config.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        require: 'readonly',
        module: 'readonly',
        __dirname: 'readonly',
      },
    },
  },

  // ---- apps/api --------------------------------------------------------
  // The API layer programs against domain packages and kernel, never into their
  // internals; and it must stay independent of Next.js so it can be extracted
  // to its own process later without a rewrite.
  {
    files: ['apps/api/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'next', message: 'api 是独立于 Next 的层' }],
          patterns: deepImportPatterns(),
        },
      ],
    },
  },

  // ---- apps/web --------------------------------------------------------
  // The web layer talks to the backend ONLY through @ycomm/api. No database,
  // no session tables, no domain rules — physically impossible to bypass the
  // access decision chain by importing something lower.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: '@ycomm/db', message: 'web 层禁止直接接触数据库' },
            { name: '@ycomm/identity', message: 'web 层禁止直接接触账号逻辑，走 @ycomm/api' },
            { name: '@ycomm/access', message: 'web 层禁止直接接触权限逻辑，走 @ycomm/api' },
            { name: '@ycomm/forum', message: 'web 层禁止直接接触论坛逻辑，走 @ycomm/api' },
            { name: '@ycomm/downloads', message: 'web 层禁止直接接触下载逻辑，走 @ycomm/api' },
            { name: '@ycomm/moderation', message: 'web 层禁止直接接触治理逻辑，走 @ycomm/api' },
            { name: '@ycomm/notify', message: 'web 层禁止直接接触通知逻辑，走 @ycomm/api' },
            { name: '@ycomm/jobs', message: 'web 层禁止直接接触任务逻辑，走 @ycomm/api' },
          ],
          patterns: deepImportPatterns(),
        },
      ],
    },
  },
]);