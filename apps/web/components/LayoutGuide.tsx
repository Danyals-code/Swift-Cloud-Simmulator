import type { CSSProperties } from 'react'
import type { AuthoringNode } from '@studio/shared'
import { propertyOptionLabel } from './PropertyControl'
import styles from './AuthoringInspector.module.css'

/** An illustration of direction and alignment, with spacing explicitly labelled. */
export function LayoutGuide({ node }: { node: AuthoringNode }) {
  const overlay = node.name === 'ZStack'
  const row = node.name.includes('HStack')
  const alignment = node.controls?.find(control => control.id === 'alignment')?.value ?? 'center'
  const spacing = node.controls?.find(control => control.id === 'spacing')?.value
  // Auto spreads the views out with Spacers, as Figma's Auto does (D4); no value at all is SwiftUI's default.
  const auto = spacing === 'auto'
  const unset = spacing === undefined || spacing.trim() === ''
  const amount = unset || auto ? 8 : Number(spacing)
  const horizontal = /leading/i.test(alignment) ? 'start' : /trailing/i.test(alignment) ? 'end' : 'center'
  const vertical = /top/i.test(alignment) ? 'start' : /bottom/i.test(alignment) ? 'end' : 'center'
  const alignItems = row ? alignment.includes('Baseline') ? (alignment === 'lastTextBaseline' ? 'last baseline' : 'baseline') : vertical : horizontal
  const style: CSSProperties = overlay ? { justifyItems: horizontal, alignItems: vertical } : { gap: Math.min(24, Math.max(0, amount)), alignItems }
  return <div className={styles.layoutGuide} aria-label="Layout preview">
    <div aria-hidden="true" data-direction={overlay ? 'overlay' : row ? 'row' : 'column'} data-spread={auto || undefined} style={style}>
      {[0, 1, 2].map(index => <span key={index} style={overlay ? { width: 64 - index * 16, height: 42 - index * 10, zIndex: index } : row ? { height: 16 + index * 7 } : { width: 28 + index * 14 }}>{index + 1}</span>)}
    </div>
    <p>{overlay ? 'Children overlap back to front.' : row ? 'Children flow left to right.' : 'Children flow top to bottom.'} {propertyOptionLabel(alignment)} alignment.{!overlay && ` ${auto ? 'Auto spacing: the views spread out to fill it' : unset ? 'Default spacing' : `${spacing} pt spacing`}.`}</p>
    {!overlay && amount > 24 && <small>Spacing is scaled to fit this illustration.</small>}
  </div>
}
