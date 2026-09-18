import { defineConfig } from 'vitest/config'

const include = ['packages/**/src/**/*.test.ts', 'apps/**/*.test.ts', 'tests/**/*.test.ts', 'tooling/**/*.test.mjs']
const exclude = ['**/node_modules/**', '**/.next/**', '**/dist/**', 'e2e/**']
const performanceTests = ['packages/swiftui-runtime/src/bench.test.ts', 'tests/authoring-release-bench.test.ts']

export default defineConfig({
  test: {
    reporters: process.env.CI ? ['default', 'github-actions'] : ['default'],
    projects: [
      {
        test: {
          name: 'functional',
          include,
          exclude: [...exclude, ...performanceTests],
          environment: 'node',
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: 'performance',
          include: performanceTests,
          exclude,
          environment: 'node',
          // Measure the editor's budgets after CPU-heavy functional workers finish.
          // The benchmark fixtures, assertions and numerical limits are unchanged.
          sequence: { groupOrder: 1 },
          fileParallelism: false,
          maxWorkers: 1,
        },
      },
    ],
  },
})
