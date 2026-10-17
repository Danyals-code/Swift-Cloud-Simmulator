import type { RGBA, ResolvedFont } from '@studio/shared'
import { describe, type SwiftValue } from '@studio/swift-runtime'
import { CENTER, insets, type EdgeInsets, type LayoutElement, type ScrollElement } from '@studio/swiftui-layout'
import { SURFACES, listAppearance } from '../appearance/surfaces'
import { asView, payloadOf, EDGE_INSETS_TYPE, TOKEN_TYPE, type TokenPayload, type ViewValue } from '../view-value'
import { numberArg, resolveColorArg, resolveFillArg, stringArg, type ColorScheme } from '../style'
import { inheritVisualStyle, visualModifiers } from '../inherited-style'
import type { Margins } from '../to-layout'

interface Context {
  readonly showsIndicators?: boolean
  readonly width: number
  readonly scheme: ColorScheme
  readonly tint?: RGBA
  readonly captionFont: ResolvedFont
  readonly headerFont: ResolvedFont
  readonly separatorHeight: number
  /** `.contentMargins` for the list's content, each edge given or not, and its `.safeAreaPadding` (Wave 6d). */
  readonly margins?: Margins
  readonly padding?: EdgeInsets
  convert(view: ViewValue, path: string): LayoutElement
  swipe(view: ViewValue, content: LayoutElement, path: string): LayoutElement
  text(id: string, value: string, style: string, color: string, weight?: number): LayoutElement
  color(name: string): RGBA
  background(child: LayoutElement, id: string, color: RGBA, radius?: number): LayoutElement
}
const arg = (v: ViewValue, name: string) => v.modifiers.find(m => m.name === name)?.args[0]?.value
const token = (value: SwiftValue | undefined) => payloadOf<TokenPayload>(value, TOKEN_TYPE)?.name ?? null
const column = (id: string, children: LayoutElement[], spacing = 0): LayoutElement => ({ kind: 'stack', id, axis: 'vertical', spacing, alignment: CENTER, children })
const pad = (id: string, child: LayoutElement, edges: EdgeInsets): LayoutElement => ({ kind: 'modified', id, modifier: { kind: 'padding', insets: edges }, child })
const frame = (id: string, child: LayoutElement, minHeight = 0): LayoutElement => ({ kind: 'modified', id, modifier: { kind: 'frame', maxWidth: Infinity, minHeight, alignment: { horizontal: 'leading', vertical: 'center' } }, child })

/** Lists own row and section chrome; ordinary view conversion stays with the caller. */
export function buildList(view: ViewValue, path: string, origin: object, c: Context): LayoutElement {
  const m = SURFACES.list
  const style = listAppearance(token(arg(view, 'listStyle')), view.name === 'Form', c.width)
  const grouped = style === 'grouped' || style === 'insetGrouped'
  const margins = c.margins
  const inset = style === 'insetGrouped' ? Math.max(m.inset, (c.width - m.regularMaxWidth) / 2) : style === 'sidebar' || style === 'inset' ? m.inset : 0
  // A side margin is the card's inset on that side, in place of the list's own (Wave 6d).
  const leading = margins?.leading ?? inset, trailing = margins?.trailing ?? inset
  const spacing = numberArg(arg(view, 'listRowSpacing')) ?? 0
  const sectionGap = numberArg(arg(view, 'listSectionSpacing')) ?? (style === 'plain' ? m.plainSectionGap : m.sectionGap)
  const flatten = (children: readonly ViewValue[]): ViewValue[] => children.flatMap(child =>
    ['ForEach', 'Group'].includes(child.name)
      ? flatten(child.children.map(v => ({ ...inheritVisualStyle(v, visualModifiers(view)), modifiers: [...v.modifiers, ...child.modifiers] })))
      : child.name === 'EmptyView' ? [] : [child])
  const sections: { view?: ViewValue; rows: ViewValue[] }[] = []
  let loose: ViewValue[] = []
  for (const child of flatten(view.children)) {
    if (child.name === 'Section') {
      if (loose.length) sections.push({ rows: loose })
      loose = []
      sections.push({ view: child, rows: flatten(child.children) })
    } else loose.push(child)
  }
  if (loose.length) sections.push({ rows: loose })

  /** The `.listRowSeparator` or `.listRowSeparatorTint` a row writes for one of its edges, `edges:` all of them by default. */
  const separatorSetting = (row: ViewValue, name: string, edge: 'top' | 'bottom') => {
    const modifier = row.modifiers.find(m => m.name === name)
    const edges = token(modifier?.args.find(a => a.label === 'edges')?.value)
    return !edges || edges === 'all' || edges === edge ? modifier?.args[0]?.value : undefined
  }
  const hiddenSeparator = (row: ViewValue, edge: 'top' | 'bottom') => token(separatorSetting(row, 'listRowSeparator', edge)) === 'hidden'
  // Between two rows, the upper row's bottom tint wins over the lower row's top, as in iOS 27.
  const separatorTint = (row: ViewValue, next: ViewValue) =>
    resolveColorArg(separatorSetting(row, 'listRowSeparatorTint', 'bottom') ?? separatorSetting(next, 'listRowSeparatorTint', 'top'), c.scheme, c.tint)
  const rowInsets = (row: ViewValue) => {
    const custom = payloadOf<EdgeInsets>(arg(row, 'listRowInsets'), EDGE_INSETS_TYPE)
    if (custom) return custom
    const buttonToggle = row.name === 'Toggle' && token(arg(row, 'toggleStyle')) === 'button'
    const y = buttonToggle ? 15 : row.name === 'Toggle' ? 12 : row.name === 'Stepper' ? 10 : m.rowY
    return insets(y, m.rowX, y, m.rowX)
  }
  const expandedRows = (rows: readonly ViewValue[], indent = 0): { row: ViewValue; indent: number }[] =>
    rows.flatMap(row => [{ row, indent }, ...(row.name === 'DisclosureGroup' ? expandedRows(flatten(row.children), indent + 20) : [])])
  const blocks: LayoutElement[] = []
  let previousHadFooter = false
  sections.forEach((section, index) => {
    const id = `${path}s${index}`
    const accessory = (name: 'header' | 'footer'): LayoutElement | null => {
      if (!section.view) return null
      const custom = section.view.args.filter(a => a.label === name).map(a => asView(a.value)).filter((v): v is ViewValue => !!v)
      const title = stringArg(section.view.args.find(a => a.label === name)?.value) ??
        (name === 'header' ? stringArg(section.view.args.find(a => a.label === null)?.value) : null)
      if (!custom.length && !title) return null
      let content = custom.length
        ? column(`${id}${name}custom`, custom.map((v, i) => c.convert(inheritVisualStyle(v, visualModifiers(section.view!)), `${id}${name}${i}`)))
        : c.text(`${id}${name === 'header' ? 'hdr' : 'ftr'}`, title!, name === 'header' ? 'headline' : 'footnote', 'secondaryLabel', name === 'header' ? 600 : undefined)
      if (custom.length) content = { kind: 'modified', id: `${id}${name}font`, modifier: { kind: 'font', font: name === 'header' ? c.headerFont : c.captionFont }, child: { kind: 'modified', id: `${id}${name}color`, modifier: { kind: 'foregroundStyle', color: c.color('secondaryLabel') }, child: content } }
      return pad(`${id}${name}`, frame(`${id}${name}frame`, content), insets(name === 'header' ? m.headerTop : m.footerTop, leading + m.rowX, name === 'header' ? m.headerBottom : 0, trailing + m.rowX))
    }
    const header = accessory('header'), footer = accessory('footer')
    // A top margin is the least gap above an unheaded first section, and space above a header (Wave 6d).
    const gap = index === 0 ? (grouped && !header ? Math.max(0, m.unheadedGap - (margins?.top ?? 0)) : 0)
      : arg(view, 'listSectionSpacing') ? sectionGap
      : previousHadFooter ? (header ? m.afterFooterHeaderGap : m.afterFooterGap)
      : header ? sectionGap : m.unheadedGap
    if (gap) blocks.push({ kind: 'modified', id: `${id}gap`, modifier: { kind: 'frame', height: gap, alignment: CENTER }, child: { kind: 'empty', id: `${id}gapx` } })
    if (header) blocks.push(header)
    const rows: LayoutElement[] = []
    const visibleRows = expandedRows(section.rows)
    visibleRows.forEach(({ row, indent }, i) => {
      const rid = row.path ?? `${id}r${i}`
      let raw = c.convert(row, rid)
      const badge = arg(row, 'badge')
      if (badge && badge.kind !== 'nil' && !(badge.kind === 'int' && badge.value === 0)) {
        const value = badge.kind === 'opaque' ? asView(badge)?.args[0]?.value : badge
        // A string badge is its text, `.badge("New")`, not Swift's quoted description of it.
        const text = value ? describe(value, false) : ''
        if (text) {
          const decorate = (child: LayoutElement): LayoutElement => ({ kind: 'stack', id: `${rid}badge-row`, axis: 'horizontal', spacing: 8, alignment: CENTER,
            children: [child, { kind: 'spacer', id: `${rid}badge-space`, axis: 'horizontal', minLength: 0 }, c.text(`${rid}badge-text`, text, 'body', 'secondaryLabel')] })
          raw = raw.kind === 'modified' && raw.modifier.kind === 'hitTarget' ? { ...raw, child: decorate(raw.child) } : decorate(raw)
        }
      }
      const next = visibleRows[i + 1]?.row
      const edges = { ...rowInsets(row), leading: rowInsets(row).leading + indent }
      // A row swiped open has no separators beside it, as in iOS 27.
      const separator = next && style !== 'sidebar' && !hiddenSeparator(row, 'bottom') && !hiddenSeparator(next, 'top') && !row.swipe?.offset && !next.swipe?.offset
      const wrap = (content: LayoutElement): LayoutElement => {
        let result = frame(`${rid}rowsize`, pad(`${rid}rowpad`, content, edges), m.row)
        const fill = resolveFillArg(arg(row, 'listRowBackground'), c.scheme, c.tint)
        if (fill) result = { kind: 'modified', id: `${rid}rowbg`, modifier: { kind: 'background', content: { kind: 'fill', id: `${rid}rowbgf`, fill } }, child: result }
        return result
      }
      let item = raw.kind === 'modified' && raw.modifier.kind === 'hitTarget' && ['button', 'toggle'].includes(raw.modifier.role) ? { ...raw, child: wrap(raw.child) } : wrap(raw)
      if (row.swipe) item = c.swipe(row, item, rid)
      rows.push(i > 0 && spacing !== 0 ? pad(`${rid}spacing`, item, insets(spacing, 0, 0, 0)) : item)
      if (separator) {
        // It starts under the row's first text, as iOS 27 draws it: a Label's title, in a
        // NavigationLink too, or the text beside an icon. A row with no text starts it at
        // the row's inset.
        const rule = pad(`${id}r${i}sep`, { kind: 'modified', id: `${id}r${i}sepf`, modifier: { kind: 'frame', height: c.separatorHeight, alignment: CENTER }, child: { kind: 'fill', id: `${id}r${i}sepl`, pixelAligned: true, fill: { kind: 'solid', color: separatorTint(row, next) ?? c.color('separator') } } }, insets(0, 0, 0, rowInsets(row).trailing))
        rows[rows.length - 1] = { kind: 'modified', id: `${rid}separator-overlay`, modifier: { kind: 'overlay', alignment: { horizontal: 'center', vertical: 'bottom' }, content: rule, underFirstText: { otherwise: edges.leading } }, child: rows[rows.length - 1]! }
      }
    })
    let card = c.background(column(id, rows), `${id}bg`, c.color(grouped ? 'secondarySystemGroupedBackground' : style === 'sidebar' ? 'systemGroupedBackground' : 'systemBackground'), style === 'insetGrouped' ? m.corner : 0)
    if (style === 'insetGrouped') card = { kind: 'modified', id: `${id}clip`, modifier: { kind: 'clip', shape: 'roundedRectangle', cornerRadius: m.corner, style: 'continuous' }, child: card }
    blocks.push(pad(`${id}inset`, card, insets(0, leading, 0, trailing)))
    if (footer) blocks.push(footer)
    previousHadFooter = !!footer
  })
  const safe = c.padding
  const content = pad(`${path}margins`, column(`${path}rows`, blocks), insets((style === 'sidebar' ? m.sidebarTop : 0) + (margins?.top ?? 0) + (safe?.top ?? 0),
    safe?.leading ?? 0, (margins?.bottom ?? m.bottom) + (safe?.bottom ?? 0), safe?.trailing ?? 0))
  const scroll: LayoutElement = { kind: 'scroll', id: path, axis: 'vertical', showsIndicators: c.showsIndicators ?? token(arg(view, 'scrollIndicators')) !== 'hidden', content, ...origin }
  return token(arg(view, 'scrollContentBackground')) === 'hidden' ? scroll : c.background(scroll, `${path}bg`, c.color(grouped || style === 'sidebar' ? 'systemGroupedBackground' : 'systemBackground'))
}

/**
 * The list with its first section at its top, as iOS 27 draws a grouped list under a large
 * title or a search field in the bar's drawer: a first section without a header sits right
 * below them, where anywhere else it is `unheadedGap` down. A section with a header keeps
 * its header's padding.
 */
export function startListAtTop(scroll: ScrollElement): ScrollElement {
  const margins = scroll.content
  if (margins.kind !== 'modified' || margins.id !== `${scroll.id}margins` || margins.child.kind !== 'stack') return scroll
  const [first, ...rest] = margins.child.children
  return first?.id === `${scroll.id}s0gap` ? { ...scroll, content: { ...margins, child: { ...margins.child, children: rest } } } : scroll
}
