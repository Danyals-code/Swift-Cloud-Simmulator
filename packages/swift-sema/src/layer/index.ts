import type { LayerChange, LayerProperties, LayerSectionId, LayerValue, SourceSpan } from '@studio/shared'
import { Parser, forEachChild, type CallExpr, type Expr, type Node, type StructDecl } from '@studio/swift-syntax'
import { applyPatch, type Patch } from './chain-edit'
import { readCorners, writeCorners } from './corners'
import { readEffects, writeEffects } from './effects'
import { readFill, writeFill } from './fill'
import { readLayout, writeLayout } from './layout'
import { chainSlots, type ChainSlots } from './slots'
import { readStroke, writeStroke } from './stroke'
import { readText, writeText } from './text'
import type { LayerContext } from './context'

export { edgeSetMembers, layerContext, layerProject, parentKind, type LayerContext, type LayerProject } from './context'

/**
 * A view's layer: one value per Figma property, read from its modifier chain, and each
 * change written back as one edit.
 *
 * Each section reads the modifiers it understands and claims them, so the stack can say
 * which section shows them. A change is written by its section into the chain only:
 * nothing before the view's own call or after its chain moves.
 */

const LOCKED = 'This view has a modifier the studio does not know. Change its layout and style in Code until its return type is known.'

/** The context a chain is read and written in: nothing new goes into one with a modifier the studio does not know. */
export const chainContext = (slots: ChainSlots, ctx: Omit<LayerContext, 'locked'>): LayerContext => ({ ...ctx, ...(slots.unknown ? { locked: LOCKED } : {}) })

const claim = (claimed: Record<string, LayerSectionId>, value: LayerValue<unknown> | undefined, section: LayerSectionId) => {
  for (const id of value?.from ?? []) claimed[id] ??= section
}

export function readLayer(expr: Expr, ctx: Omit<LayerContext, 'locked'>): LayerProperties | undefined {
  const slots = chainSlots(expr, ctx.text, ctx.names)
  if (!slots) return undefined
  const full = chainContext(slots, ctx)
  const layout = readLayout(slots, full)
  const claimed: Record<string, LayerSectionId> = {}
  for (const value of [layout.width, layout.height, layout.alignment, layout.padding, layout.margin, layout.offset, layout.pin]) claim(claimed, value, 'layout')
  const fill = readFill(slots, full)
  claim(claimed, fill, 'fill')
  const corners = readCorners(slots, full), stroke = readStroke(slots, full)
  claim(claimed, corners, 'corners')
  claim(claimed, stroke, 'stroke')
  const text = readText(slots, full)
  for (const value of text ? Object.values(text) : []) claim(claimed, value, 'text')
  const effects = readEffects(slots, full)
  claim(claimed, effects.opacity, 'effects')
  claim(claimed, effects.blur, 'effects')
  return {
    layout,
    fill,
    corners,
    stroke,
    ...(text ? { text } : {}),
    effects,
    claimed,
    ...(full.locked ? { locked: full.locked } : {}),
    chain: { file: expr.span.file, start: slots.base.span.end, end: expr.span.end },
  }
}

function writeSection(slots: ChainSlots, change: LayerChange, ctx: LayerContext): Patch[] {
  switch (change.section) {
    case 'layout': return writeLayout(slots, change, ctx)
    case 'effects': return writeEffects(slots, change, ctx)
    case 'fill': return writeFill(slots, change, ctx)
    case 'corners': return writeCorners(slots, change, ctx)
    case 'stroke': return writeStroke(slots, change, ctx)
    case 'text': return writeText(slots, change, ctx)
    default: throw new Error(`The ${(change as LayerChange).section} section cannot be changed here.`)
  }
}

/** The call written exactly over `span`, in any of `trees`: the view a request names, found again. */
export function callAt(trees: readonly Node[], span: SourceSpan): CallExpr | undefined {
  let found: CallExpr | undefined
  const visit = (node: Node): void => {
    if (found) return
    if (node.kind === 'call' && node.span.file === span.file && node.span.start === span.start && node.span.end === span.end) found = node
    else forEachChild(node, visit)
  }
  trees.forEach(visit)
  return found
}

/**
 * The file after the changes, each written by its section in turn on what the one before
 * wrote, and where the view starts in it. Throws the reason, in the panel's words, when
 * one cannot be made.
 *
 * A section writes inside the view's modifier chain, and nowhere else but a property of
 * the view's own struct that the change needs, such as an `@ScaledMetric` size.
 */
export function writeLayer(expr: Expr, changes: readonly LayerChange[], ctx: Omit<LayerContext, 'locked'>): { readonly text: string; readonly start: number } {
  const before = ctx.text, file = expr.span.file
  const chainStart = chainSlots(expr, before, ctx.names)?.base.span.end ?? expr.span.start
  let text = before, start = expr.span.start, end = expr.span.end, current: Expr | undefined = expr, owner = ctx.owner, declared = false, labelled = false
  for (const [index, change] of changes.entries()) {
    if (index > 0) {
      const tree = Parser.parse(text, file).sourceFile
      current = callAt([tree], { file, start, end })
      owner = owner && tree.declarations.find((decl): decl is StructDecl => decl.kind === 'structDecl' && decl.name === owner!.name)
    }
    const slots = current && chainSlots(current, text, index ? undefined : ctx.names)
    if (!slots) throw new Error('This view no longer has an editable modifier chain. Select it again.')
    const patches = writeSection(slots, change, chainContext(slots, { ...ctx, text, owner }))
    let delta = 0, shift = 0
    for (const patch of [...patches].sort((a, b) => b.start - a.start)) {
      // A Button is sized on its label, inside its own call (Layout).
      const inChain = patch.start >= ('label' in patch ? slots.base.span.start : slots.base.span.end) && patch.end <= end
      const inStruct = !!patch.declaration && !!owner && patch.start >= owner.span.start && patch.end <= owner.span.end && (patch.end <= start || patch.start >= end)
      if (!inChain && !inStruct) throw new Error('This change would reach outside the view. Nothing was changed.')
      text = applyPatch(text, patch)
      const grown = patch.text.length - (patch.end - patch.start)
      delta += grown
      if (patch.end <= start) shift += grown
      declared ||= !!patch.declaration
      labelled ||= 'label' in patch
    }
    start += shift
    end += delta
  }
  // Only the chain may change, besides a declared property: what comes before the view's own call and after its last modifier stays byte for byte.
  const after = before.length - expr.span.end
  const kept = labelled ? expr.span.start : chainStart
  if (!declared && (text.slice(0, kept) !== before.slice(0, kept) || text.slice(text.length - after) !== before.slice(before.length - after))) throw new Error('This change would reach outside the view. Nothing was changed.')
  // Where the view now starts: a property declared above it moves it down the file.
  return { text, start }
}
