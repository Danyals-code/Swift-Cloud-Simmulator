import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'

/**
 * Packages that must stay free of React and of any DOM/browser global.
 *
 * This is the architectural boundary from docs/02-ARCHITECTURE.md §3: the compiler,
 * runtime and layout engine run inside a Web Worker and must be unit-testable in plain
 * Node. Keeping them DOM-free is also what lets them be reused headlessly later (CI
 * conformance runs, a CLI, an editor extension).
 *
 * `swiftui-render-dom`, `project-model` (IndexedDB), `exporter` and `apps/web` are
 * deliberately NOT in this list.
 */
const PURE_PACKAGES = [
  'packages/shared/**/*.ts',
  'packages/swift-syntax/**/*.ts',
  'packages/swift-sema/**/*.ts',
  'packages/swift-runtime/**/*.ts',
  'packages/swiftui-runtime/**/*.ts',
  'packages/swiftui-layout/**/*.ts',
  'packages/sim-shell/**/*.ts',
]

const FORBIDDEN_BROWSER_GLOBALS = [
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch',
  'HTMLElement',
]

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  {
    name: 'architecture/pure-packages-are-dom-free',
    files: PURE_PACKAGES,
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-dom', 'react/*', 'react-dom/*', 'next', 'next/*'],
              message:
                'Compiler/runtime/layout packages must not depend on React or Next. ' +
                'Move view-layer code into packages/swiftui-render-dom or apps/web. ' +
                'See docs/02-ARCHITECTURE.md §3.',
            },
            {
              group: ['@studio/swiftui-render-dom', '@studio/project-model', '@studio/exporter'],
              message:
                'Pure packages must not depend on DOM-facing packages. Dependencies point ' +
                'inward only: app -> render/export -> runtime -> syntax -> shared.',
            },
          ],
        },
      ],
      'no-restricted-globals': [
        'error',
        ...FORBIDDEN_BROWSER_GLOBALS.map((name) => ({
          name,
          message:
            `'${name}' is a browser global; these packages must run in a Web Worker and in ` +
            'plain Node for tests. Inject the capability instead (see the TextMetrics port ' +
            'in docs/02-ARCHITECTURE.md §7.3).',
        })),
      ],
    },
  },

  {
    name: 'react/hooks',
    files: ['apps/web/**/*.tsx', 'apps/web/**/*.ts', 'packages/swiftui-render-dom/**/*.tsx'],
    // v7 keeps the legacy (array-plugins) shapes at the top level; the flat-config
    // variants live under `.flat`.
    ...reactHooks.configs.flat['recommended-latest'],
  },

  {
    name: 'browser-globals',
    files: ['apps/web/**/*.{ts,tsx}', 'packages/swiftui-render-dom/**/*.{ts,tsx}', 'packages/project-model/**/*.ts', 'packages/exporter/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, ...globals.worker },
    },
  },

  {
    name: 'node-scripts',
    files: ['tooling/**/*.mjs', '*.config.ts', '*.config.mjs', 'e2e/**/*.ts'],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-console': 'off',
    },
  },

  {
    name: 'tests/relaxed',
    files: ['**/*.test.ts', '**/*.test.tsx', 'e2e/**/*.ts'],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
