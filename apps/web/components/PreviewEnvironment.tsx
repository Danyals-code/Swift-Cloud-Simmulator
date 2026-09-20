'use client'

import { DYNAMIC_TYPE_SIZES, dynamicTypeForScale, type DynamicTypeSize } from '@studio/shared'
import { DEVICE_LIST, type DeviceKey, type DeviceSpec } from '@studio/sim-shell'
import type { PreviewSettings } from '../lib/store'
import { PopupButton, type MenuItem } from './ui/Menu'
import { SegmentedControl } from './ui/Control'

/**
 * The preview's environment: which device, which appearance, which text size.
 *
 * These are SwiftUI's environment for the whole preview - every screen is drawn
 * under the same values - so they sit together, once, rather than beside each phone.
 */

/** Dynamic Type steps, matching the iOS accessibility slider's usable range. */
export const TYPE_SCALES: readonly MenuItem[] = DYNAMIC_TYPE_SIZES.map((value) => ({
  value,
  label: ({ xSmall: 'Text XS', small: 'Text S', medium: 'Text M', large: 'Text L',
    xLarge: 'Text XL', xxLarge: 'Text XXL', xxxLarge: 'Text XXXL',
    accessibility1: 'Text AX1', accessibility2: 'Text AX2', accessibility3: 'Text AX3',
    accessibility4: 'Text AX4', accessibility5: 'Text AX5' })[value],
  ...(value === 'large' ? { detail: 'Default' } : {}),
}))

export const ZOOMS: readonly MenuItem[] = [
  { value: 'fit', label: 'Fit', detail: 'Auto' },
  { value: '1', label: '100%' },
  { value: '0.75', label: '75%' },
  { value: '0.5', label: '50%' },
  { value: '0.33', label: '33%' },
]

export function DevicePicker({ device, onChange, className }: { device: DeviceSpec; onChange: (key: DeviceKey) => void; className?: string }) {
  return <PopupButton items={DEVICE_LIST.map(d => ({ value: d.key, label: d.name, detail: `${d.width} × ${d.height}` }))} value={device.key} onChange={value => onChange(value as DeviceKey)} label="Device" title="Device size for every screen" testId="device-select" className={className} />
}

export function AppearancePicker({ preview, onChange }: { preview: PreviewSettings; onChange: (settings: Partial<PreviewSettings>) => void }) {
  return <SegmentedControl label="Appearance" testId="scheme-toggle" options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} value={preview.colorScheme} onChange={value => onChange({ colorScheme: value as 'light' | 'dark' })} />
}

export function TextSizePicker({ preview, onChange, className }: { preview: PreviewSettings; onChange: (settings: Partial<PreviewSettings>) => void; className?: string }) {
  return <PopupButton items={TYPE_SCALES} value={preview.dynamicTypeSize ?? dynamicTypeForScale(preview.typeScale)} onChange={value => onChange({ dynamicTypeSize: value as DynamicTypeSize })} label="Dynamic Type size" title="Text size for every screen" testId="type-scale-select" className={className} />
}

export function ZoomPicker({ preview, scale, onChange, className }: { preview: PreviewSettings; scale: number; onChange: (settings: Partial<PreviewSettings>) => void; className?: string }) {
  const items = ZOOMS.some(item => item.value === preview.zoom) ? ZOOMS : [...ZOOMS, { value: preview.zoom, label: `${Math.round(Number(preview.zoom) * 100)}%` }]
  return <PopupButton items={items} value={preview.zoom} onChange={value => onChange({ zoom: value })} label="Zoom" title={`Zoom — ${Math.round(scale * 100)}%`} testId="zoom-select" className={className} />
}
