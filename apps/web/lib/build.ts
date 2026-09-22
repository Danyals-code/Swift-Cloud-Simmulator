import type { StudioBuild } from '@studio/exporter'

/**
 * The build this page came from, stamped in by next.config.ts.
 *
 * Shown in the More menu and written into every export, so each study result can be
 * tied to the pinned deployment that produced it.
 */
export const STUDIO_BUILD: StudioBuild = {
  commit: process.env.STUDIO_BUILD_COMMIT ?? 'unknown',
  builtAt: process.env.STUDIO_BUILD_TIME ?? '',
}

/** "Build 0f1e2d3": the short commit, which is what a person compares. */
export const BUILD_NAME = `Build ${STUDIO_BUILD.commit.slice(0, 7)}`

/** "1 Oct", or nothing when the build time is unknown. */
export const BUILD_DATE = STUDIO_BUILD.builtAt
  ? new Date(STUDIO_BUILD.builtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  : ''
