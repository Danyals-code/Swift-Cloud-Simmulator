'use client'

import { DYNAMIC_TYPE_SIZES, dynamicTypeForScale, type DynamicTypeSize } from '@studio/shared'

import { useLayoutEffect, useRef, useState } from 'react'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { EMPTY_RENDER_TREE, type RenderNode, type RenderTree, type UIEvent } from '@studio/shared'
import type { DeviceSpec } from '@studio/sim-shell'
import type { PreviewSettings } from '../lib/store'
import { InspectorReadout } from './InspectorReadout'
import { PopupButton, type MenuItem } from './ui/Menu'
import { SegmentedControl } from './ui/Control'

export interface DevicePaneProps {
  device: DeviceSpec
  tree: RenderTree | null
  stale: boolean
  paused: boolean
  onEvent: (event: UIEvent) => void
  inspecting: boolean
  /** Reveal a view's source. Null origin means the node has no source position. */
  onRevealSource: (node: RenderNode) => void
  preview: PreviewSettings
  onPreviewChange: (settings: Partial<PreviewSettings>) => void
}

/** Chrome around the screen: bezel thickness plus breathing room in the pane. */
const BEZEL = 10
const PANE_PADDING = 28

/**
 * The device's own chrome sits above everything the app can draw.
 *
 * The app's layers run up to 200,000 - a navigation bar is placed at 100,000 and a
 * sheet at 200,000, so that bars paint over content and presentations over bars.
 * The status bar and the Dynamic Island are not layers in the app at all; they are
 * the hardware, and they were previously at 10,000 - underneath every navigation
 * bar, which is why a screen with one showed no clock and no island.
 */
const DEVICE_Z = 1_000_000

/** Dynamic Type steps, matching the iOS accessibility slider's usable range. */
const TYPE_SCALES: readonly MenuItem[] = DYNAMIC_TYPE_SIZES.map((value) => ({
  value,
  label: ({ xSmall: 'Text XS', small: 'Text S', medium: 'Text M', large: 'Text L',
    xLarge: 'Text XL', xxLarge: 'Text XXL', xxxLarge: 'Text XXXL',
    accessibility1: 'Text AX1', accessibility2: 'Text AX2', accessibility3: 'Text AX3',
    accessibility4: 'Text AX4', accessibility5: 'Text AX5' })[value],
  ...(value === 'large' ? { detail: 'Default' } : {}),
}))

const ZOOMS: readonly MenuItem[] = [
  { value: 'fit', label: 'Fit', detail: 'Auto' },
  { value: '1', label: '100%' },
  { value: '0.75', label: '75%' },
  { value: '0.5', label: '50%' },
  { value: '0.33', label: '33%' },
]

/**
 * The simulated device.
 *
 * The bezel, Dynamic Island, status bar and home indicator are all drawn in CSS.
 * Apple's device artwork is not licensed for redistribution (risk R2), and a CSS
 * frame has the side benefit of scaling cleanly to any zoom level.
 *
 * Appearance, Dynamic Type and zoom live on this pane's own bar rather than in the
 * toolbar. They describe how you are looking at the simulated app, so they belong
 * beside it - and a toolbar holding both "which device" and "how big is the text"
 * gives equal weight to a project setting and a viewing preference.
 */
export function DevicePane({
  device,
  tree,
  stale,
  paused,
  onEvent,
  inspecting,
  onRevealSource,
  preview,
  onPreviewChange,
}: DevicePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [fitScale, setFitScale] = useState(1)
  const [hovered, setHovered] = useState<RenderNode | null>(null)

  // Derived rather than cleared in an effect: a stale highlight must not survive
  // leaving inspector mode, and "only meaningful while inspecting" is a property of
  // the value, not something to synchronise after the fact.
  const highlighted = inspecting ? hovered : null
  const scale = preview.zoom === 'fit' ? fitScale : Number(preview.zoom)

  // Fit-to-pane. Never scales above 1:1 - an upscaled simulator looks convincing
  // and is quietly misleading about how much fits on a real screen.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const fit = () => {
      const availableH = el.clientHeight - PANE_PADDING * 2 - BEZEL * 2
      const availableW = el.clientWidth - PANE_PADDING * 2 - BEZEL * 2
      if (availableH <= 0 || availableW <= 0) return
      setFitScale(Math.min(1, availableH / device.height, availableW / device.width))
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [device.height, device.width])

  return (
    <section className="flex h-full min-w-0 flex-col bg-xc-canvas" aria-label="Preview">
      <header className="flex h-[28px] shrink-0 items-center gap-2 border-b border-black/30 bg-xc-sidebar px-2">
        <span className="shrink-0 text-[10px] text-xc-text-2" title="iOS 27 appearance preview — native calibration pending">iOS 27 Preview</span>
        <SegmentedControl
          label="Appearance"
          testId="scheme-toggle"
          options={[
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
          value={preview.colorScheme}
          onChange={(value) => onPreviewChange({ colorScheme: value as 'light' | 'dark' })}
        />

        <PopupButton
          items={TYPE_SCALES}
          value={preview.dynamicTypeSize ?? dynamicTypeForScale(preview.typeScale)}
          onChange={(value) => onPreviewChange({ dynamicTypeSize: value as DynamicTypeSize })}
          label="Dynamic Type size"
          title="Dynamic Type size - a layout input, not just a font size"
          testId="type-scale-select"
        />

        <span className="ml-auto flex items-center gap-2">
          {paused ? (
            <span
              className="rounded-[4px] bg-xc-warn/20 px-1.5 py-px text-[10px] text-xc-warn"
              data-testid="preview-paused"
            >
              Paused
            </span>
          ) : null}
          <PopupButton
            items={ZOOMS}
            value={preview.zoom}
            onChange={(value) => onPreviewChange({ zoom: value })}
            label="Zoom"
            title={`Zoom - currently ${Math.round(scale * 100)}%`}
            testId="zoom-select"
          />
        </span>
      </header>

      <div
        ref={containerRef}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
        data-testid="device-pane"
        // The pointer can leave the device without crossing any node's boundary -
        // straight off the bezel - so the pane itself has to clear the highlight.
        onPointerLeave={() => setHovered(null)}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            transition: 'transform 120ms ease-out',
            // Without this the unscaled box still claims its full size, so a 100%
            // zoom on a small pane scrolls to empty space around the device.
            width: device.width + BEZEL * 2,
            height: device.height + BEZEL * 2,
            flexShrink: 0,
          }}
        >
          <DeviceFrame device={device}>
            <RenderTreeView
              tree={tree ?? EMPTY_RENDER_TREE}
              onEvent={onEvent}
              stale={stale}
              {...(inspecting
                ? {
                    inspect: {
                      hovered: highlighted?.id ?? null,
                      onHover: setHovered,
                      onSelect: onRevealSource,
                    },
                  }
                : {})}
            />
            <StatusBar device={device} colorScheme={preview.colorScheme} />
            {device.hasDynamicIsland ? <DynamicIsland device={device} /> : null}
            {device.homeIndicator ? (
              <HomeIndicator device={device} colorScheme={preview.colorScheme} />
            ) : null}
          </DeviceFrame>
        </div>

        <InspectorReadout node={highlighted} active={inspecting} />
      </div>
    </section>
  )
}

/**
 * The bezel.
 *
 * Titanium rather than the silver gradient this used to draw: a real iPhone's
 * frame is near-black and reads as a thin dark rim, and a bright bevel around a
 * simulated screen pulls the eye to the chrome instead of to the app. The band of
 * lighter grey along the top edge is the one specular cue worth keeping - without
 * it the device reads as a flat rectangle with rounded corners.
 */
function DeviceFrame({ device, children }: { device: DeviceSpec; children: React.ReactNode }) {
  return (
    <div
      data-testid="device-frame"
      style={{
        position: 'relative',
        width: device.width + BEZEL * 2,
        height: device.height + BEZEL * 2,
        padding: BEZEL,
        boxSizing: 'border-box',
        borderRadius: device.cornerRadius + BEZEL,
        background: 'linear-gradient(150deg, #55555c 0%, #26262a 12%, #1c1c1f 50%, #303036 100%)',
        boxShadow: [
          '0 18px 50px rgb(0 0 0 / 0.5)',
          '0 2px 8px rgb(0 0 0 / 0.35)',
          '0 0 0 1px rgb(255 255 255 / 0.07)',
          'inset 0 1px 1px rgb(255 255 255 / 0.14)',
        ].join(', '),
      }}
    >
      <div
        style={{
          position: 'relative',
          width: device.width,
          height: device.height,
          borderRadius: device.cornerRadius,
          overflow: 'hidden',
          background: '#ffffff',
          // A hairline where the glass meets the frame, which is what stops the
          // screen from looking painted onto the bezel.
          boxShadow: 'inset 0 0 0 0.5px rgb(0 0 0 / 0.5)',
        }}
      >
        {children}
      </div>
    </div>
  )
}

/**
 * The status bar.
 *
 * 9:41 rather than the wall clock. It is what every Apple screenshot and every
 * Xcode preview shows, so a simulator reading 14:07 looks wrong to anybody who has
 * seen one - and a clock that ticks makes two screenshots of the same state differ.
 */
function StatusBar({ device, colorScheme }: { device: DeviceSpec; colorScheme: 'light' | 'dark' }) {
  const tint = colorScheme === 'dark' ? '#ffffff' : '#000000'
  const island = device.hasDynamicIsland

  return (
    <div
      data-testid="status-bar"
      style={{
        position: 'absolute',
        inset: '0 0 auto 0',
        height: device.statusBarHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        // The island splits the bar; the time sits in the left gap and the
        // indicators in the right one.
        padding: island ? '0 20px 0 30px' : '0 8px',
        paddingTop: island ? 14 : 0,
        fontSize: island ? 16 : 14,
        fontWeight: 600,
        letterSpacing: '-0.2px',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Inter", system-ui, sans-serif',
        color: tint,
        pointerEvents: 'none',
        zIndex: DEVICE_Z,
      }}
    >
      <span>9:41</span>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <SignalBars />
        <WifiGlyph />
        <BatteryGlyph />
      </span>
    </div>
  )
}

function SignalBars() {
  return (
    <svg width="18" height="12" viewBox="0 0 18 12" aria-hidden>
      {[0, 1, 2, 3].map((i) => (
        <rect
          key={i}
          x={i * 4.6}
          y={11 - (i + 1) * 2.55}
          width="3.2"
          height={(i + 1) * 2.55}
          rx="1.1"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

function WifiGlyph() {
  return (
    <svg width="17" height="12" viewBox="0 0 17 12" aria-hidden>
      <path
        d="M8.5 10.9 6.05 8.2a3.55 3.55 0 0 1 4.9 0L8.5 10.9Zm0-5.35a6.2 6.2 0 0 0-4.4 1.83L2.55 5.75a8.4 8.4 0 0 1 11.9 0l-1.55 1.63A6.2 6.2 0 0 0 8.5 5.55Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BatteryGlyph() {
  return (
    <svg width="27" height="13" viewBox="0 0 27 13" aria-hidden>
      <rect
        x="0.6"
        y="0.6"
        width="22.8"
        height="11.8"
        rx="3.6"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.1"
        opacity="0.38"
      />
      <rect x="2.2" y="2.2" width="19.6" height="8.6" rx="2.2" fill="currentColor" />
      <path
        d="M24.9 4.4c1 .3 1.4 1.1 1.4 2.1s-.4 1.8-1.4 2.1V4.4Z"
        fill="currentColor"
        opacity="0.38"
      />
    </svg>
  )
}

/** iPhone 15's island: 125 x 36.7 pt, 11 pt below the top edge. */
function DynamicIsland({ device }: { device: DeviceSpec }) {
  const width = 125
  const height = 37
  return (
    <div
      data-testid="dynamic-island"
      style={{
        position: 'absolute',
        top: 11,
        left: Math.round(device.width / 2 - width / 2),
        width,
        height,
        borderRadius: height / 2,
        background: '#000',
        pointerEvents: 'none',
        zIndex: DEVICE_Z + 2,
      }}
    />
  )
}

/**
 * The home indicator.
 *
 * Tinted against the appearance rather than always black: on a dark screen a black
 * bar is invisible, and iOS inverts it for exactly that reason.
 */
function HomeIndicator({
  device,
  colorScheme,
}: {
  device: DeviceSpec
  colorScheme: 'light' | 'dark'
}) {
  const width = 140
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: Math.round(device.width / 2 - width / 2),
        width,
        height: 5,
        borderRadius: 2.5,
        background: colorScheme === 'dark' ? 'rgb(255 255 255 / 0.65)' : 'rgb(0 0 0 / 0.75)',
        pointerEvents: 'none',
        zIndex: DEVICE_Z + 1,
      }}
    />
  )
}
