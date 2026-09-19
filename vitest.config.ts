import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit tests only at this tier; integration tests (real PGlite) get their own
    // opt-in suite later so the fast feedback loop stays fast.
    include: [
      'config/**/*.test.ts',
      'packages/*/src/**/*.test.ts',
      'apps/api/src/**/*.test.ts',
      // Web 侧的纯逻辑测试（如 Markdown 解析、时间格式化）；React 组件测试另配环境。
      'apps/web/src/lib/**/*.test.ts',
    ],
    environment: 'node',
    restoreMocks: true,
  },
});