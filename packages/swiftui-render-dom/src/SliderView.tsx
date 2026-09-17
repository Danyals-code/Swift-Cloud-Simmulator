import { cssColor, type SliderPayload } from '@studio/shared'

/** Paint only. The overlaid range input owns drag, focus and keyboard behavior. */
export function SliderView({ slider, width, height }: { slider: SliderPayload; width: number; height: number }) {
  const diameter = Math.min(slider.thumbDiameter, width)
  const thumbHeight = Math.min(slider.thumbHeight ?? diameter, height)
  const r = diameter / 2, cy = height / 2, length = Math.max(0, width - diameter)
  const x = r + length * slider.fraction
  return <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ overflow: 'visible', display: 'block' }}>
    <rect x={0} y={cy - slider.trackHeight / 2} width={width} height={slider.trackHeight} rx={slider.trackHeight / 2} fill={cssColor(slider.trackColor)} />
    <rect x={0} y={cy - slider.trackHeight / 2} width={x} height={slider.trackHeight} rx={slider.trackHeight / 2} fill={cssColor(slider.tint)} />
    {slider.ticks ? slider.ticks.map((fraction, i) => <circle key={i} cx={r + length * fraction} cy={cy} r={1} fill={fraction <= slider.fraction ? 'white' : cssColor(slider.tint)} opacity={0.65} />) : null}
    <rect x={x - r} y={cy - thumbHeight / 2} width={diameter} height={thumbHeight} rx={thumbHeight / 2} fill={cssColor(slider.thumbColor)} stroke="rgb(0 0 0 / 0.04)" strokeWidth={0.5} style={{ filter: 'drop-shadow(0px 1px 2px rgb(0 0 0 / 0.22))' }} />
  </svg>
}

export function ControlStyles() {
  return <style>{`
    [data-testid="render-tree"] .swiftui-field { appearance: none; -webkit-appearance: none; border-radius: 0; opacity: 1; -webkit-text-fill-color: currentColor; }
    [data-testid="render-tree"] .swiftui-field::placeholder { color: var(--field-placeholder); opacity: 1; }
    [data-testid="render-tree"] .swiftui-range { appearance: none; -webkit-appearance: none; background: transparent; border: 0; padding: 0; outline: none; }
    [data-testid="render-tree"] .swiftui-range::-webkit-slider-runnable-track { height: 4px; background: transparent; }
    [data-testid="render-tree"] .swiftui-range::-webkit-slider-thumb { appearance: none; -webkit-appearance: none; width: var(--range-thumb); height: var(--range-thumb); margin-top: calc((4px - var(--range-thumb)) / 2); border: 0; border-radius: 50%; background: transparent; }
    [data-testid="render-tree"] .swiftui-range::-moz-range-track { height: 4px; background: transparent; }
    [data-testid="render-tree"] .swiftui-range::-moz-range-thumb { width: var(--range-thumb); height: var(--range-thumb); border: 0; border-radius: 50%; background: transparent; }
    [data-testid="render-tree"] [data-kind]:focus-visible,
    [data-testid="render-tree"] [data-kind]:has(> input:focus-visible) { outline: 2px solid Highlight; outline-offset: 2px; }
  `}</style>
}
