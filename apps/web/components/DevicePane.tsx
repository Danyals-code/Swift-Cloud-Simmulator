'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { RenderTreeView } from '@studio/swiftui-render-dom'
import { EMPTY_RENDER_TREE, type RenderNode, type RenderTree, type UIEvent } from '@studio/shared'
import type { DeviceSpec } from '@studio/sim-shell'
import { InspectorReadout } from './InspectorReadout'

export interface DevicePaneProps {
  device: DeviceSpec
  tree: RenderTree | null
  stale: boolean
  onEvent: (event: UIEvent) => void
  inspecting: boolean
  /** Reveal a view's source. Null origin means the node has no source position. */
  onRevealSource: (node: RenderNode) => void
  colorScheme: 'light' | 'dark'
}

/** Chrome around the screen: bezel thickness plus breathing room in the pane. */
const BEZEL = 12
const PANE_PADDING = 32

/**
 * The simulated device.
 *
 * The bezel, Dynamic Island, status bar and home indicator are all drawn in CSS.
 * Apple's device artwork is not licensed for redistribution (risk R2), and a CSS
 * frame has the side benefit of scaling cleanly to any zoom level.
 */
export function DevicePane({
  device,
  tree,
  stale,
  onEvent,
  inspecting,
  onRevealSource,
  colorScheme,
}: DevicePaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  const [hovered, setHovered] = useState<RenderNode | null>(null)

  // Derived rather than cleared in an effect: a stale highlight must not survive
  // leaving inspector mode, and "only meaningful while inspecting" is a property of
  // the value, not something to synchronise after the fact.
  const highlighted = inspecting ? hovered : null

  // Fit-to-pane. Never scales above 1:1 - an upscaled simulator looks convincing
  // and is quietly misleading about how much fits on a real screen.
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return

    const fit = () => {
      const availableH = el.clientHeight - PANE_PADDING * 2 - BEZEL * 2
      const availableW = el.clientWidth - PANE_PADDING * 2 - BEZEL * 2
      if (availableH <= 0 || availableW <= 0) return
      setScale(Math.min(1, availableH / device.height, availableW / device.width))
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [device.height, device.width])

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full items-center justify-center overflow-hidden bg-[#0d0d10]"
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
        }}
      >
        <div
          data-testid="device-frame"
          style={{
            position: 'relative',
            width: device.width + BEZEL * 2,
            height: device.height + BEZEL * 2,
            padding: BEZEL,
            borderRadius: device.cornerRadius + BEZEL,
            background: 'linear-gradient(160deg, #4a4a52 0%, #2a2a30 45%, #3d3d45 100%)',
            boxShadow:
              '0 24px 60px rgb(0 0 0 / 0.55), 0 0 0 1px rgb(255 255 255 / 0.08) inset, 0 2px 6px rgb(255 255 255 / 0.12) inset',
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
            }}
          >
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
            <StatusBar device={device} colorScheme={colorScheme} />
            {device.hasDynamicIsland ? <DynamicIsland device={device} /> : null}
            {device.homeIndicator ? <HomeIndicator device={device} /> : null}
          </div>
        </div>
      </div>

      <InspectorReadout node={highlighted} active={inspecting} />
    </div>
  )
}

function StatusBar({ device, colorScheme }: { device: DeviceSpec; colorScheme: 'light' | 'dark' }) {
  const [now, setNow] = useState<string>('')

  // Rendering the real clock makes screenshots look alive; guarded to client-only
  // so the server and first client render agree (no hydration mismatch).
  useEffect(() => {
    const tick = () =>
      setNow(new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }))
    tick()
    const id = setInterval(tick, 15_000)
    return () => clearInterval(id)
  }, [])

  return (
    <div
      style={{
        position: 'absolute',
        inset: `0 0 auto 0`,
        height: device.statusBarHeight,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: `0 ${device.hasDynamicIsland ? 28 : 12}px`,
        paddingTop: device.hasDynamicIsland ? 12 : 0,
        fontSize: 15,
        fontWeight: 600,
        fontFamily: '"Inter", -apple-system, system-ui, sans-serif',
        color: colorScheme === 'dark' ? '#fff' : '#000',
        pointerEvents: 'none',
        zIndex: 10_000,
      }}
    >
      <span style={{ minWidth: 54 }}>{now || ' '}</span>
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
          x={i * 4.5}
          y={11 - (i + 1) * 2.6}
          width="3"
          height={(i + 1) * 2.6}
          rx="1"
          fill="currentColor"
        />
      ))}
    </svg>
  )
}

function WifiGlyph() {
  return (
    <svg width="16" height="12" viewBox="0 0 16 12" aria-hidden>
      <path
        d="M8 10.5 5.6 7.9a3.4 3.4 0 0 1 4.8 0L8 10.5Zm0-5.2a6 6 0 0 0-4.3 1.8L2.3 5.6a8 8 0 0 1 11.4 0l-1.4 1.5A6 6 0 0 0 8 5.3Z"
        fill="currentColor"
      />
    </svg>
  )
}

function BatteryGlyph() {
  return (
    <svg width="26" height="13" viewBox="0 0 26 13" aria-hidden>
      <rect x="0.5" y="0.5" width="22" height="12" rx="3.5" fill="none" stroke="currentColor" opacity="0.4" />
      <rect x="2" y="2" width="16" height="9" rx="2" fill="currentColor" />
      <path d="M24 4.5v4a2.2 2.2 0 0 0 0-4Z" fill="currentColor" opacity="0.5" />
    </svg>
  )
}

function DynamicIsland({ device }: { device: DeviceSpec }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 11,
        left: device.width / 2 - 62,
        width: 124,
        height: 36,
        borderRadius: 18,
        background: '#000',
        pointerEvents: 'none',
        zIndex: 10_001,
      }}
    />
  )
}

function HomeIndicator({ device }: { device: DeviceSpec }) {
  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: device.width / 2 - 67,
        width: 134,
        height: 5,
        borderRadius: 3,
        background: 'rgb(0 0 0 / 0.85)',
        pointerEvents: 'none',
        zIndex: 10_001,
      }}
    />
  )
}
