import { sameStart, stackLayoutOf, stackSpacing, type AuthoringNode, type SourceFile, type SourceSpan } from '@studio/shared'
import type { SourceFileNode } from '@studio/swift-syntax'
import { viewCallChain } from '../design-controls'
import { callAt, chainContext, layerContext, layerProject } from './index'
import { draftChain, layoutDraftPlaces, type DraftChain, type LayoutDraftPlaces } from './layout'
import { chainSlots } from './slots'

/**
 * Where a drag on the canvas would write, for the preview to lay the page out with the
 * dragged values before anything is planned (Wave 2b). Worked out once as the drag starts,
 * from the same reading of the chain the Layout section writes with, so the draft and the
 * written result land in the same place.
 */

/**
 * The view's chains, and where each value a drag sets goes in them: the Layout section's
 * places (`chain: 'view'` indices count in `view`, `chain: 'label'` ones in `label`), and a
 * stack's spacing, which its Spacing control writes.
 */
export interface LayerDraftSites extends LayoutDraftPlaces {
  readonly view: DraftChain
  /** `auto` when Spacers make the gaps, which a number takes out. */
  readonly spacing?: { readonly auto: boolean }
}

export interface LayerDraftInput {
  readonly trees: readonly SourceFileNode[]
  readonly files: readonly SourceFile[]
  readonly nodes: readonly AuthoringNode[]
  /** The view, as its authoring node's source; one edited since keeps its start. */
  readonly target: SourceSpan
  readonly deploymentTarget?: string
}

/** The view's node: the one written over exactly this span, or else the one that starts where it did. */
function viewAt(nodes: readonly AuthoringNode[], target: SourceSpan): AuthoringNode | undefined {
  const views = nodes.filter(node => node.kind !== 'definition' && node.kind !== 'branch' && node.kind !== 'template' && sameStart(node.source, target))
  return views.find(node => node.source.end === target.end) ?? views[0]
}

/**
 * The view's chains, and where each value a drag sets goes in them; null when the view is
 * no longer written there. A value Design cannot write has no place, and a view the panel
 * shows no layer for has only its chain, for the geometry the canvas draws on it.
 */
export function layerDraftSites(input: LayerDraftInput): LayerDraftSites | null {
  const node = viewAt(input.nodes, input.target)
  const text = node && input.files.find(file => file.id === node.source.file)?.text
  const expr = node && text !== undefined ? callAt(input.trees, node.source) : undefined
  const chain = expr && viewCallChain(expr)
  if (!node || text === undefined || !expr || !chain) return null
  const view = draftChain({ expr, modifiers: chain.modifiers })
  if (!node.layer) return { view }
  const ctx = layerContext(layerProject(input.trees, input.deploymentTarget), node, input.nodes.find(n => n.id === node.parentId), text)
  const slots = chainSlots(expr, text, ctx.names)
  if (!slots) return { view }
  const layout = stackLayoutOf(node.name), spacing = stackSpacing(node)
  return {
    view,
    ...layoutDraftPlaces(slots, chainContext(slots, ctx)),
    ...(spacing && (layout === 'VStack' || layout === 'HStack') ? { spacing: { auto: spacing.auto } } : {}),
  }
}
