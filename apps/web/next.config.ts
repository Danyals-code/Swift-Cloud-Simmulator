import type { NextConfig } from 'next'

const config: NextConfig = {
  reactStrictMode: true,
  // Workspace packages ship TypeScript source rather than a build artefact, so the
  // app compiles them. Keeps `pnpm dev` instant and avoids orchestrating a build
  // graph for packages that only ever have one consumer.
  transpilePackages: [
    '@studio/shared',
    '@studio/sim-shell',
    '@studio/project-model',
    '@studio/exporter',
    '@studio/swiftui-runtime',
    '@studio/swiftui-render-dom',
    '@studio/swift-syntax',
    '@studio/swift-sema',
    '@studio/swift-runtime',
    '@studio/swiftui-layout',
  ],
  // Linting is its own CI job across the whole workspace. Next 16 no longer runs
  // ESLint during `next build`, so there is nothing to opt out of here.
}

export default config
