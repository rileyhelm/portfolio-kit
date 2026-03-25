import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '/tmp/portfolio-kit-vitest',
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    include: ['tests/frontend/**/*.test.ts'],
    setupFiles: ['tests/frontend/setup.ts'],
    restoreMocks: true,
  },
});
