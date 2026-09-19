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
    /**
     * 串行跑测试文件：多个 PGlite(WASM) 实例并行会互相拖垮（表现为集成测试成片
     * 初始化超时、被整文件跳过），websocket 那类计时用例也会被并行负载压出假失败。
     * 单文件约几秒，整体仍在可接受范围。
     */
    fileParallelism: false,
  },
});