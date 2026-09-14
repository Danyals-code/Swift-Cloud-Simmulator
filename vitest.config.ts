import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['packages/**/src/**/*.test.ts', 'apps/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.next/**', '**/dist/**', 'e2e/**'],
    environment: 'node',
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
  },
})
