import { execSync } from 'node:child_process'
import type { NextConfig } from 'next'

/**
 * The commit this build is made from, shown in the More menu and written into every
 * export. Vercel and GitHub Actions each name it in their own variable, which
 * turbo.json declares so a new commit never replays a cached build; a local build
 * asks git.
 */
function buildCommit(): string {
  const named = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (named) return named
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'unknown'
  }
}

const config: NextConfig = {
  reactStrictMode: true,
  // `env` rather than NEXT_PUBLIC_ variables, which the docs now prefer: those are
  // read from the environment as it stands, and the commit is sometimes only known
  // by asking git here.
  env: {
    STUDIO_BUILD_COMMIT: buildCommit(),
    STUDIO_BUILD_TIME: new Date().toISOString(),
  },
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
