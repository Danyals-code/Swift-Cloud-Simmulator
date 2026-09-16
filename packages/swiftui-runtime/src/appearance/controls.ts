/** Initial control geometry in points; iOS 27 native calibration is pending. */
export const CONTROL_METRICS = {
  mini: { fontSize: 12, lineHeight: 16, weight: 400, padX: 10, padY: 4, height: 24 },
  small: { fontSize: 15, lineHeight: 20, weight: 400, padX: 12, padY: 5, height: 30 },
  regular: { fontSize: 17, lineHeight: 22, weight: 400, padX: 14, padY: 7, height: 36 },
  large: { fontSize: 17, lineHeight: 22, weight: 600, padX: 20, padY: 11, height: 44 },
  extraLarge: { fontSize: 20, lineHeight: 25, weight: 600, padX: 24, padY: 14, height: 53 },
} as const

export const CONTROL_PARTS = {
  switch: { width: 64, height: 28, knob: 24, knobWidth: 38, inset: 2, shadow: 0 },
  slider: { height: 31, thumb: 28, track: 4, tick: 2 },
  field: { height: 34, insetX: 7, insetY: 6, radius: 6 },
  stepper: { width: 94, height: 32, radius: 8, separator: 18 },
  progress: { height: 4, radius: 2, spinner: 20 },
  segmented: { height: 32, inset: 2, radius: 9, selectedRadius: 7, padX: 12, padY: 5 },
} as const

export function controlMetrics(size = 'regular') {
  return CONTROL_METRICS[size as keyof typeof CONTROL_METRICS] ?? CONTROL_METRICS.regular
}
