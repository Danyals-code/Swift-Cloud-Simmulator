import { DEFAULT_DEPLOYMENT_TARGET, deploymentVersion, type AuthoringNode, type SourceFile, type TokenValue } from '@studio/shared'
import type { FeatureContext } from '../authoring-context'
import type { SourceFileNode, StructDecl } from '@studio/swift-syntax'
import { EDGE_SET_MEMBERS } from '../structural-check'

/** What a section reads and writes a layer with, besides the chain itself. */
export interface LayerContext {
  /** The file the view is written in. */
  readonly text: string
  /** The `AuthoringModifier` id of each call in the chain, in order. */
  readonly ids: readonly string[]
  /** Each call's name as the modifier stack read it, `border` for a border, when it has been read. */
  readonly names?: readonly string[]
  /** `Edge.Set`'s members and any the project declares in an extension of it. */
  readonly edges: ReadonlySet<string>
  /** The deployment target, as a version number. */
  readonly target: number
  readonly node: AuthoringNode
  readonly parent: 'column' | 'row' | 'overlap' | 'other'
  readonly inButton: boolean
  /** The struct the view is written in, for the properties a layer reads, such as an `@ScaledMetric` size. */
  readonly owner?: StructDecl
  /**
   * The parent is an Overlap with a size of its own, Fixed or Fill both ways, so a view can
   * be pinned in it without the Overlap growing to take the pin.
   */
  readonly overlapSized?: boolean
  /** Why nothing new can be placed in this chain, when something in it is not known well enough. */
  readonly locked?: string
  /** The view is a run of texts joined with `+` (Wave 3a): only what keeps a Text a Text is written on it. */
  readonly run?: boolean
  /** The project as the authoring features read it, where the constants a value reads are declared (Wave 3b). */
  readonly project: FeatureContext
  /**
   * What each constant the view's values are linked to is declared as, by the token as
   * written (`LayerProperties.tokens`): the readers add each one as they meet it (`linkToken`).
   */
  readonly linked: Map<string, TokenValue>
}

/** Why a run of joined text takes nothing but text styles, for `what` the change is about. */
export const runRefusal = (what: string) => `Part of joined text takes text styles only. ${what}`

/** A native Card (`GroupBox`) draws its own surface, which Card fill turns into an editable layer. */
export const cardRefusal = (ctx: Pick<LayerContext, 'node'>): string | undefined => ctx.node.kind === 'view' && ctx.node.name === 'GroupBox'
  ? 'A Card draws its own fill, corners and outline. Choose a fill for it to make the card an editable layer.' : undefined

/** Why a value is left to Code, in the words every section uses: `what` is what the view's value is, `size` or `stroke`. */
export const setTwice = (what: string) => `This view’s ${what} is set in more than one place. Change it in Code.`
export const commented = (what: string) => `A comment is written in this view’s ${what}. Change it in Code.`
export const inSwift = (what: string) => `This view’s ${what} is worked out in Swift. Change it in Code.`

/**
 * What every layer in a project shares, worked out once for the whole project: what the
 * authoring model, the planner and a drag's draft each read their views' layers and
 * controls with, and hand on, so nothing of one compile outlives it.
 */
export interface LayerProject {
  readonly edges: ReadonlySet<string>
  readonly target: number
  readonly structs: ReadonlyMap<string, StructDecl>
  readonly trees: readonly SourceFileNode[]
  /**
   * The same files as the authoring features read them, whose indexes find the constants a
   * value reads (`declarationsNamed`, `extensionsNamed`), each found once for the project.
   */
  readonly context: FeatureContext
}

export function layerProject(trees: readonly SourceFileNode[], deploymentTarget = DEFAULT_DEPLOYMENT_TARGET, files: readonly SourceFile[] = []): LayerProject {
  const structs = new Map<string, StructDecl>()
  for (const tree of trees) for (const decl of tree.declarations) if (decl.kind === 'structDecl') structs.set(decl.name, decl)
  return { edges: edgeSetMembers(trees), target: deploymentVersion(deploymentTarget), structs, trees, context: { files, ast: trees, nodes: [], deploymentTarget } }
}

/** A view's layer context in its project; `node.modifiers` must already be read. */
export function layerContext(project: LayerProject, node: AuthoringNode, parent: AuthoringNode | undefined, text: string): Omit<LayerContext, 'locked'> {
  const calls = (node.modifiers ?? []).filter(modifier => modifier.enabled !== false)
  return {
    text, ids: calls.map(modifier => modifier.id), names: calls.map(modifier => modifier.name),
    edges: project.edges, target: project.target, node, parent: parentKind(parent),
    inButton: node.name === 'Button' || parent?.name === 'Button',
    owner: project.structs.get(node.owner.split('.')[0]!),
    run: !!node.textRun,
    project: project.context, linked: new Map(),
    overlapSized: parentKind(parent) === 'overlap' && !!parent?.layer && [parent.layer.layout.width, parent.layer.layout.height].every(axis => axis.value.mode !== 'hug'),
  }
}

/** `Edge.Set`'s own members and those a project's `extension Edge.Set` declares. */
export function edgeSetMembers(trees: readonly SourceFileNode[]): ReadonlySet<string> {
  const members = new Set(EDGE_SET_MEMBERS)
  for (const tree of trees) for (const decl of tree.declarations) {
    if (decl.kind !== 'extensionDecl' || decl.name !== 'Edge.Set') continue
    for (const member of decl.members) if (member.kind === 'varDecl') members.add(member.name)
  }
  return members
}

/** How a view's parent lays it out, in the words Figma uses: a column, a row or an overlap. */
export function parentKind(parent: AuthoringNode | undefined): LayerContext['parent'] {
  const name = parent?.name ?? ''
  if (['VStack', 'LazyVStack', 'List', 'Form', 'ScrollView'].includes(name)) return 'column'
  if (['HStack', 'LazyHStack'].includes(name)) return 'row'
  if (name === 'ZStack') return 'overlap'
  return 'other'
}
