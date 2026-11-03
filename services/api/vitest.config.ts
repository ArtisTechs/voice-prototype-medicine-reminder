import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['tests/global-setup.ts'],
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // One MySQL + one Redis: files run one after another, tests inside a file too.
    fileParallelism: false,
    testTimeout: 30000,
    hookTimeout: 60000,
  },
});
