import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Browser fixtures stay predictable on machines with limited resources.
    maxWorkers: 1,
    projects: [
      {
        test: {
          name: 'server',
          environment: 'node',
          include: ['tests/**/*.test.ts'],
          testTimeout: 30000,
        },
      },
      {
        test: {
          name: 'ui',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx'],
          setupFiles: ['src/test-setup.ts'],
        },
      },
    ],
  },
});
