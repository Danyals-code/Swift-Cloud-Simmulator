/**
 * Device definitions.
 *
 * Pure data - no rendering. The bezel is drawn in CSS by the app shell because
 * Apple's device artwork is not licensed for redistribution (risk R2 in
 * docs/01-REQUIREMENTS.md).
 *
 * All measurements are in logical points, matching what SwiftUI sees. Safe-area
 * insets are the values `@Environment(\.safeAreaInsets)` reports in portrait.
 */

export interface EdgeInsets {
  readonly top: number
  readonly leading: number
  readonly bottom: number
  readonly trailing: number
}

export interface DeviceSpec {
  readonly key: DeviceKey
  readonly name: string
  /** logical points, portrait */
  readonly width: number
  readonly height: number
  /** physical pixels per point - affects nothing in layout, informational */
  readonly scale: number
  readonly safeArea: EdgeInsets
  /** screen corner radius in points; 0 for square-cornered devices */
  readonly cornerRadius: number
  /** true for Dynamic Island / notch devices, which changes the status bar treatment */
  readonly hasDynamicIsland: boolean
  readonly statusBarHeight: number
  readonly homeIndicator: boolean
}

export type DeviceKey = 'iphone-se-3' | 'iphone-15' | 'iphone-16-pro-max' | 'iphone-18-pro' | 'ipad-11'

export const DEVICES: Readonly<Record<DeviceKey, DeviceSpec>> = {
  'iphone-se-3': {
    key: 'iphone-se-3',
    name: 'iPhone SE (3rd gen)',
    width: 375,
    height: 667,
    scale: 2,
    safeArea: { top: 20, leading: 0, bottom: 0, trailing: 0 },
    cornerRadius: 0,
    hasDynamicIsland: false,
    statusBarHeight: 20,
    homeIndicator: false,
  },
  'iphone-15': {
    key: 'iphone-15',
    name: 'iPhone 15',
    width: 393,
    height: 852,
    scale: 3,
    safeArea: { top: 59, leading: 0, bottom: 34, trailing: 0 },
    cornerRadius: 55,
    hasDynamicIsland: true,
    statusBarHeight: 54,
    homeIndicator: true,
  },
  'iphone-16-pro-max': {
    key: 'iphone-16-pro-max',
    name: 'iPhone 16 Pro Max',
    width: 440,
    height: 956,
    scale: 3,
    safeArea: { top: 62, leading: 0, bottom: 34, trailing: 0 },
    cornerRadius: 55,
    hasDynamicIsland: true,
    statusBarHeight: 57,
    homeIndicator: true,
  },
  // 1206 × 2622 user-supplied Simulator capture at 3×. Insets are the calibration
  // assumptions recorded with that evidence; hardware artwork remains approximate.
  'iphone-18-pro': {
    key: 'iphone-18-pro', name: 'iPhone 18 Pro', width: 402, height: 874, scale: 3,
    safeArea: { top: 62, leading: 0, bottom: 34, trailing: 0 },
    cornerRadius: 55, hasDynamicIsland: true, statusBarHeight: 57, homeIndicator: true,
  },
  'ipad-11': {
    key: 'ipad-11',
    name: 'iPad Pro 11"',
    width: 834,
    height: 1194,
    scale: 2,
    safeArea: { top: 24, leading: 0, bottom: 20, trailing: 0 },
    cornerRadius: 18,
    hasDynamicIsland: false,
    statusBarHeight: 24,
    homeIndicator: true,
  },
}

/** The device a new project starts on: the iPhone 18 Pro, whose iOS 27 simulator the preview is measured against. */
export const DEFAULT_DEVICE: DeviceKey = 'iphone-18-pro'

/**
 * The device for a key, falling back rather than returning undefined.
 *
 * The key can come from a share link or from a project saved by an older build, so
 * "not a device we have" is ordinary input, not a programming error. Returning
 * undefined put it one property access away from taking the whole studio down.
 */
export function getDevice(key: DeviceKey | string): DeviceSpec {
  return DEVICES[key as DeviceKey] ?? DEVICES[DEFAULT_DEVICE]
}

/** Whether a string names a device this build knows. */
export function isDeviceKey(value: string): value is DeviceKey {
  return Object.hasOwn(DEVICES, value)
}

export const DEVICE_LIST: readonly DeviceSpec[] = Object.values(DEVICES)

/**
 * The rect SwiftUI lays content into, i.e. the screen minus safe-area insets.
 * This is the root proposal handed to the layout engine.
 */
export function contentRect(device: DeviceSpec): {
  x: number
  y: number
  width: number
  height: number
} {
  return {
    x: device.safeArea.leading,
    y: device.safeArea.top,
    width: device.width - device.safeArea.leading - device.safeArea.trailing,
    height: device.height - device.safeArea.top - device.safeArea.bottom,
  }
}
