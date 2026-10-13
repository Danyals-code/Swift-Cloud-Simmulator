/** Preview runtime/SDK are independent of the exported minimum deployment target. */
export interface PreviewTarget {
  readonly runtime: 'ios-27'
  readonly sdk: 'ios-27'
  readonly appearance: 'ios-27'
}

export const DEFAULT_PREVIEW_TARGET: PreviewTarget = Object.freeze({
  runtime: 'ios-27', sdk: 'ios-27', appearance: 'ios-27',
})

/** The iOS version a new project targets: the one the preview draws. A saved project keeps its own. */
export const DEFAULT_DEPLOYMENT_TARGET = '27.0'

/** The iOS version a deployment target names, as a number: '17.0' is 17. A missing or unreadable one is the default. */
export function deploymentVersion(target: string | undefined): number {
  const version = Number.parseFloat(target ?? DEFAULT_DEPLOYMENT_TARGET)
  return Number.isFinite(version) ? version : Number.parseFloat(DEFAULT_DEPLOYMENT_TARGET)
}

export function isPreviewTarget(value: unknown): value is PreviewTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Record<string, unknown>
  return target.runtime === 'ios-27' && target.sdk === 'ios-27' && target.appearance === 'ios-27'
}

/** Migrate old local projects and tolerate stale saved settings. */
export function normalizePreviewTarget(value: unknown): PreviewTarget {
  return isPreviewTarget(value) ? { ...value } : { ...DEFAULT_PREVIEW_TARGET }
}

/** Updated only after the native comparison gate has recorded approved evidence. */
export const APPEARANCE_CALIBRATION = { profile: 'ios-27', status: 'provisional', nativeEvidence: 'docs/parity/native/iphone18pro-light/measurements.json' } as const
