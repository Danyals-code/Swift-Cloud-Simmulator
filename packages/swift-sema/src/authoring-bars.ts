import { CONTENT_SLOT_NAMES, MODIFIER_SLOTS, PAGE_SLOTS, TOOLBAR_CONTENT, TOOLBAR_ITEMS, deploymentVersion, isNonView, type AuthoringNode, type AuthoringOperation, type ScreenBarItem, type ScreenBars, type SourceFile, type ToolbarPlacement } from '@studio/shared'
import { Lexer, afterOffMarkers, forEachChild, insertView, type CallExpr, type Node, type Stmt, type StructDecl } from '@studio/swift-syntax'
import { applyPatches, expressionOf, indentAt, insertMember, layerById, modifierIndent, namedStruct, scalarType, type FeatureContext, type SourcePatch } from './authoring-context'
import { nameTaken } from './authoring-behavior'
import { swiftString, viewCallChain } from './design-controls'
import { navigationAround, navigationStackPatches } from './authoring-navigation'
import { TOOLBAR_PLACEMENTS, toolbarPlacement } from './design-object-controls'
import { modifierSegment } from './authoring-modifiers'
import { modifierName } from './authoring-border'
import { pagesThrough } from './page-style'

/**
 * A screen's bars (Wave 4b): its toolbar items and search field, added from the Bars section
 * of Screen settings, and read back for it. Each goes where `.navigationTitle` goes: on the
 * screen's content inside its stack, never on the stack itself, where iOS shows nothing. A
 * screen with no bar is wrapped in a NavigationStack, as a link does.
 */

/** What gives the views inside it a navigation bar: a stack, or a split view's columns. */
const BARRED: ReadonlySet<string> = new Set(['NavigationStack', 'NavigationView', 'NavigationSplitView'])
/** What an item a designer adds shows until it is changed: a title in place of the title, and elsewhere a button for an action (`DEFAULT_ITEM`). */
const DEFAULT_ITEMS: Readonly<Partial<Record<ToolbarPlacement, string>>> = { leading: 'Button("Edit") { }', trailing: 'Button("Add", systemImage: "plus") { }', principal: 'Text("Title")' }
const DEFAULT_ITEM = 'Button("Action") { }'
/** The items of a screen with no toolbar, shared by every such screen: most screens, built on every model build. */
const NO_ITEMS: readonly ScreenBarItem[] = Object.freeze([])
/** Why a screen of tabs takes nothing in its bars: each tab's screen has bars of its own. */
const TABBED = 'This screen holds the app’s tabs. Add this to a tab’s screen.'

/** What a definition's own views hold for its bars, its helpers' included and none of the pages it opens. */
interface Found {
  readonly title?: { readonly node: AuthoringNode; readonly control: string }
  /** Whether the title is on or in a TabView, whose tabs each have their own bars. */
  readonly titleTabbed: boolean
  readonly toolbars: readonly AuthoringNode[]
  readonly search?: AuthoringNode
  /** The first TabView, as the preview finds the app's tabs: the screen's content, or beside other views (Wave 6c). */
  readonly tabs?: AuthoringNode
}
const NOTHING: Found = { titleTabbed: false, toolbars: [] }
/** What each definition holds, found once for each model: a helper's views are in every screen that calls it. */
const foundIn = new WeakMap<FeatureContext, Map<string, Found>>()

/**
 * What `definition`'s views hold, in the order written: the first title and search field, and
 * every toolbar. `calling` are the helpers being read, which a helper calling itself leads back
 * to; what is found while one does (`cut`) is kept for that walk alone.
 */
function found(ctx: FeatureContext, definition: AuthoringNode, calling: ReadonlySet<string> = new Set(), cut = { cut: false }): Found {
  let known = foundIn.get(ctx)
  if (!known) foundIn.set(ctx, known = new Map())
  const already = known.get(definition.id)
  if (already) return already
  if (calling.has(definition.id)) { cut.cut = true; return NOTHING }
  const seen = new Set<string>(), toolbars: AuthoringNode[] = [], within = { cut: false }
  let next: Set<string> | undefined, title: Found['title'], titleTabbed = false, search: AuthoringNode | undefined, tabs: AuthoringNode | undefined
  const visit = (node: AuthoringNode, tabbed: boolean): void => {
    if (seen.has(node.id) || node.kind === 'branch' && PAGE_SLOTS.has(node.name)) return
    seen.add(node.id)
    if (node.kind === 'branch' && node.name === MODIFIER_SLOTS.toolbar) toolbars.push(node)
    const inTabs = tabbed || node.name === 'TabView'
    if (inTabs && !tabbed) tabs ??= node
    if (node.kind !== 'definition' && node.modifiers) for (const modifier of node.modifiers) {
      if (!modifier.enabled) continue
      if (!search && modifier.name === 'searchable') search = node
      if (title || modifier.name !== 'navigationTitle') continue
      const control = node.controls?.find(c => c.id.startsWith('modifier:') && c.label.startsWith('navigationTitle'))
      if (control) { title = { node, control: control.id }; titleTabbed = inTabs }
    }
    for (const id of node.children) { const child = layerById(ctx, id); if (child) visit(child, inTabs) }
    // A helper's views are the screen's, written where it is declared.
    const helper = node.helper && node.kind !== 'definition' ? layerById(ctx, node.definitionId) : undefined
    if (!helper) return
    const held = found(ctx, helper, next ??= new Set(calling).add(definition.id), within)
    if (!title && held.title) { title = held.title; titleTabbed = inTabs || held.titleTabbed }
    search ??= held.search
    tabs ??= held.tabs
    toolbars.push(...held.toolbars)
  }
  visit(definition, false)
  const result: Found = { title, titleTabbed, toolbars, search, tabs }
  if (within.cut) cut.cut = true
  else known.set(definition.id, result)
  return result
}

/** A screen's own views as Bars reads them: where its title goes, its toolbars and its search field. */
interface ScreenParts {
  readonly title?: Found['title']
  readonly toolbars: readonly AuthoringNode[]
  readonly search?: AuthoringNode
  /** The screen's one top view. */
  readonly root?: AuthoringNode
  /** Where its title, toolbar and search field go: the view its title is on, or its content inside its stack. */
  readonly site?: AuthoringNode
  /** Whether that is in a TabView: a screen of tabs, whose tabs each have their own bars. */
  readonly tabbed: boolean
  /** The tab bar it holds, whose search tab Bars switches (Wave 6c): its TabView, alone or beside other views, as written. */
  readonly tabs?: { readonly node: AuthoringNode; readonly call: CallExpr }
}

/** The tab bar a TabView is, as written: its call, unless its pages are swiped through, which have no tab bar. */
function tabBar(ctx: FeatureContext, node: AuthoringNode | undefined): ScreenParts['tabs'] {
  const expr = node && expressionOf(ctx, node), chain = expr && viewCallChain(expr)
  return chain && !pagesThrough(chain.modifiers) ? { node: node!, call: chain.base } : undefined
}

function screenParts(ctx: FeatureContext, definition: AuthoringNode): ScreenParts {
  const top = definition.children.length === 1 ? layerById(ctx, definition.children[0]) : undefined
  const root = top && (top.kind === 'view' || top.kind === 'component' || top.kind === 'collection') ? top : undefined
  const barred = !!root && BARRED.has(root.name)
  const inside = barred ? root!.children.flatMap(id => layerById(ctx, id) ?? []).filter(child => !(child.kind === 'branch' && CONTENT_SLOT_NAMES.has(child.name))) : []
  const content = !barred ? root : inside.length === 1 && inside[0]!.kind !== 'branch' && inside[0]!.kind !== 'opaque' ? inside[0] : undefined
  const held = found(ctx, definition)
  // A title written on the stack itself shows nothing; what goes beside it goes on the content.
  const titled = held.title && !BARRED.has(held.title.node.name) ? held.title.node : undefined
  const tabs = held.tabs && tabBar(ctx, held.tabs)
  return { title: held.title, toolbars: held.toolbars, search: held.search, root, site: titled ?? content, tabbed: titled ? held.titleTabbed : content?.name === 'TabView' || !!tabs, tabs }
}

/** Why `parts` can't take a bar's part that needs iOS `minimum`, named as `what` needs it; undefined when it can. */
function placeProblem(ctx: FeatureContext, parts: ScreenParts, minimum: number, what: string): string | undefined {
  const version = deploymentVersion(ctx.deploymentTarget)
  if (version < minimum) return `${what} need${what.endsWith('s') ? '' : 's'} iOS ${minimum} or newer. Change the deployment target to add one.`
  if (!parts.site) return 'This screen’s views aren’t in one view to put this on. Change it in Code.'
  if (parts.tabbed) return TABBED
  if (version < 16 && needsStack(ctx, parts)) return `${what} need${what.endsWith('s') ? '' : 's'} a navigation stack here, which needs iOS 16 or newer. Change the deployment target to add one.`
  return undefined
}

/** Whether the screen's bars need a NavigationStack around it to show: none is around where they go, nor a split view's bar. */
function needsStack(ctx: FeatureContext, parts: ScreenParts): boolean {
  const around = navigationAround(ctx, parts.site!)
  return around.stack !== true && around.bar !== true
}

/** The operations Bars sends, each to a screen's definition. */
type BarsOperation = Extract<AuthoringOperation, { kind: 'toolbar-item-add' | 'searchable-add' | 'searchable-remove' | 'search-tab-add' | 'search-tab-remove' }>

/**
 * A screen's parts, when `node` is a screen's definition, which has bars: a view of the
 * project's own declared at the top of its file, not a helper, a `#Preview` or the app, whose
 * scene is no view. Read from the layers alone, as every definition is asked on every build;
 * an edit finds its struct (`namedStruct`) too.
 */
function screenOf(ctx: FeatureContext, node: AuthoringNode): ScreenParts | undefined {
  if (node.kind !== 'definition' || node.helper || node.owner !== node.name || node.name === '#Preview') return undefined
  const parts = screenParts(ctx, node)
  return parts.root && isNonView(parts.root) ? undefined : parts
}

export function barsEdit(ctx: FeatureContext, node: AuthoringNode, operation: BarsOperation): { files: SourceFile[]; offset: number } {
  const parts = screenOf(ctx, node)
  if (!parts || !namedStruct(ctx, node.name)) throw new Error('Select a screen to change its bars.')
  if (operation.kind === 'search-tab-add' || operation.kind === 'search-tab-remove') return { files: applyPatches(ctx, searchTabPatches(ctx, parts, operation.kind === 'search-tab-add')), offset: node.source.start }
  const patches = operation.kind === 'toolbar-item-add' ? toolbarItem(ctx, node, parts, operation) : operation.kind === 'searchable-add' ? searchField(ctx, node, parts, operation.prompt) : noSearchField(ctx, parts)
  return { files: operation.kind === 'searchable-remove' ? applyPatches(ctx, patches) : withStack(ctx, parts, patches), offset: node.source.start }
}

/**
 * A search field on the screen: `.searchable(text:prompt:)` where the title goes, searching
 * text kept in the screen's state (`searchedText`). A screen with one already is left as it is.
 */
function searchField(ctx: FeatureContext, definition: AuthoringNode, parts: ScreenParts, prompt: string): SourcePatch[] {
  if (typeof prompt !== 'string' || prompt.length > 200) throw new Error('Enter a prompt of up to 200 characters.')
  if (parts.search) return []
  const problem = placeProblem(ctx, parts, 15, 'A search field')
  if (problem) throw new Error(problem)
  const site = parts.site!, owner = namedStruct(ctx, definition.name)!
  const searched = searchedText(owner) ?? { name: freeName(ctx, site, owner), kept: false }
  const at = afterOffMarkers(ctx.files.find(f => f.id === site.source.file)?.text ?? '', site.source.end)
  const field: SourcePatch = { file: site.source.file, start: at, end: at, text: `\n${modifierIndent(ctx, site)}.searchable(text: $${searched.name}${prompt ? `, prompt: ${swiftString(prompt)}` : ''})` }
  return searched.kept ? [field] : [insertMember(ctx, owner, `@State private var ${searched.name} = ""`), field]
}

/** `searchText`, or the first of its numbered names nothing on the screen takes. */
function freeName(ctx: FeatureContext, site: AuthoringNode, owner: StructDecl): string {
  let name = 'searchText'
  for (let suffix = 2; nameTaken(ctx, site, owner, name); suffix++) name = `searchText${suffix}`
  return name
}

/**
 * The text a screen keeps already that a new search field searches (Wave 4b): a `String` in
 * its state that no search field is bound to, the one its filter reads, or else the one called
 * `searchText`, as a field switched off leaves it. Undefined when it keeps none.
 */
function searchedText(owner: StructDecl): { name: string; kept: true } | undefined {
  const strings = owner.members.flatMap(member => {
    if (member.kind !== 'varDecl' || member.isLet || member.accessor || !member.attributes.some(a => a.name === 'State')) return []
    const type = scalarType(member.typeAnnotation, member.initializer)
    return type?.type === 'String' && !type.optional ? [member.name] : []
  })
  if (!strings.length) return undefined
  const bound = new Set<string>(), filtered = new Set<string>()
  const visit = (node: Node, filtering: boolean): void => {
    if (node.kind === 'identifier' && filtering) filtered.add(node.name)
    const call = node.kind === 'call' ? node : undefined, member = call?.callee.kind === 'memberAccess' ? call.callee.member : ''
    const text = member === 'searchable' ? call!.args.find(a => a.label === 'text')?.value : undefined
    if (text?.kind === 'identifier' && text.name.startsWith('$')) bound.add(text.name.slice(1))
    forEachChild(node, child => visit(child, filtering || member === 'filter' && child !== call!.callee))
  }
  visit(owner, false)
  const free = strings.filter(name => !bound.has(name))
  const read = free.filter(name => filtered.has(name))
  const name = read.length === 1 ? read[0] : free.find(candidate => candidate === 'searchText')
  return name ? { name, kept: true } : undefined
}

/** The screen's search field taken away, as `modifier-remove` takes a modifier, and the state it searches when nothing else reads it. */
function noSearchField(ctx: FeatureContext, parts: ScreenParts): SourcePatch[] {
  const node = parts.search, expr = node && expressionOf(ctx, node), chain = expr && viewCallChain(expr)
  const modifier = chain?.modifiers.find(m => m.callee.kind === 'memberAccess' && m.callee.member === 'searchable')
  if (!node || !expr || !modifier) return []
  const file = node.source.file, text = ctx.files.find(f => f.id === file)!.text
  const removal = modifierSegment(expr, text, modifier)
  if (!removal) throw new Error('A note or an #if in this view’s modifiers keeps the search field where it is. Take it away in Code.')
  const patches: SourcePatch[] = [{ file, ...removal, text: '' }]
  const state = boundState(ctx, node, modifier)
  if (!state || state.span.file !== file) return patches
  // Nothing else reads it: no other use of its name, in any file.
  const name = state.name, from = Math.min(state.span.start, ...state.attributes.map(a => a.span.start), ...state.modifiers.map(m => m.span.start))
  const uses = ctx.files.reduce((count, f) => count + Lexer.tokenize(f.text, f.id).tokens.filter(t => t.kind === 'identifier' && (t.text === name || t.text === `$${name}`)).length, 0)
  const lineStart = text.lastIndexOf('\n', from - 1) + 1, lineEnd = text.indexOf('\n', state.span.end)
  if (uses !== 2 || text.slice(lineStart, from).trim() || text.slice(state.span.end, lineEnd < 0 ? text.length : lineEnd).trim()) return patches
  return [...patches, { file, start: lineStart, end: lineEnd + 1, text: '' }]
}

/** The `@State` a search field's `text: $name` is bound to, on the view's own struct. */
function boundState(ctx: FeatureContext, node: AuthoringNode, modifier: CallExpr) {
  const bound = modifier.args.find(a => a.label === 'text')?.value
  const name = bound?.kind === 'identifier' && bound.name.startsWith('$') ? bound.name.slice(1) : undefined
  const state = name ? namedStruct(ctx, node.owner)?.members.find(m => m.kind === 'varDecl' && m.name === name && m.attributes.some(a => a.name === 'State')) : undefined
  return state?.kind === 'varDecl' ? state : undefined
}

/**
 * An item at `placement` in the screen's toolbar: the last of the toolbar the screen has, when
 * that holds items, or a toolbar of its own where the title goes. `snippet` is what it shows,
 * a button for its placement when none is given; a snippet that is toolbar content already is
 * added as written.
 */
function toolbarItem(ctx: FeatureContext, definition: AuthoringNode, parts: ScreenParts, { placement, snippet }: Extract<AuthoringOperation, { kind: 'toolbar-item-add' }>): SourcePatch[] {
  if (!(placement in TOOLBAR_PLACEMENTS) || snippet !== undefined && (typeof snippet !== 'string' || !snippet.trim())) throw new Error('Choose where the item goes.')
  const problem = placeProblem(ctx, parts, 14, 'Toolbar items')
  if (problem) throw new Error(problem)
  const file = definition.source.file, text = ctx.files.find(f => f.id === file)?.text ?? ''
  const { unit } = indentAt(text, parts.site!.source.start)
  const shown = (snippet ?? DEFAULT_ITEMS[placement] ?? DEFAULT_ITEM).trim()
  const item = TOOLBAR_CONTENT.has(/^\w+/.exec(shown)?.[0] ?? '') ? shown : `ToolbarItem${placement === 'automatic' ? '' : `(placement: .${TOOLBAR_PLACEMENTS[placement]})`} {\n${shown.split('\n').map(line => line && unit + line).join('\n')}\n}`
  // A toolbar written on the stack itself shows nothing, so an item goes in one that shows.
  const toolbar = parts.toolbars.find(written => !BARRED.has(layerById(ctx, written.parentId)?.name ?? ''))
  const holdsViews = toolbar && toolbar.children.some(id => { const child = layerById(ctx, id); return !!child && !TOOLBAR_CONTENT.has(child.name) && child.kind !== 'branch' })
  if (toolbar && !holdsViews && text[toolbar.source.start] === '{') {
    // A toolbar written on one line takes the item on that line.
    const oneLine = !text.slice(toolbar.source.start, toolbar.source.end).includes('\n') && !item.includes('//')
    let refusal = 'There’s no room for an item in this toolbar. Add it in Code.'
    const added = insertView(text, file, toolbar.source.start, oneLine ? item.replace(/\s*\n\s*/g, ' ') : item, reason => { refusal = reason }, { slot: true })
    if (!added) throw new Error(refusal)
    return [inserted(file, text, added.text)]
  }
  // A toolbar of views takes no item beside them, so the item comes in a toolbar of its own beside it.
  const site = holdsViews ? layerById(ctx, toolbar!.parentId) : parts.site
  if (!site) throw new Error('This screen’s views aren’t in one view to put this on. Change it in Code.')
  const indent = modifierIndent(ctx, site), at = afterOffMarkers(text, site.source.end)
  return [{ file, start: at, end: at, text: `\n${indent}.toolbar {\n${item.split('\n').map(line => line && indent + unit + line).join('\n')}\n${indent}}` }]
}

/** The one stretch `after` adds to `before`, as a patch. */
function inserted(file: string, before: string, after: string): SourcePatch {
  let start = 0
  while (start < before.length && before[start] === after[start]) start++
  let end = 0
  while (end < before.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  return { file, start, end: before.length - end, text: after.slice(start, after.length - end) }
}

/**
 * The project after `patches`, with the screen's top view wrapped in a NavigationStack when its
 * bars have no bar to show in (`needsStack`), as a link does.
 */
function withStack(ctx: FeatureContext, parts: ScreenParts, patches: readonly SourcePatch[]): SourceFile[] {
  const files = applyPatches(ctx, patches)
  const root = parts.root
  if (!patches.length || !root || !needsStack(ctx, parts)) return files
  // The root moves by what is written before it, and grows by what is written in it.
  const shift = (offset: number) => offset + patches.filter(p => p.file === root.source.file && p.end <= offset).reduce((moved, p) => moved + p.text.length - (p.end - p.start), 0)
  const text = files.find(f => f.id === root.source.file)!.text
  const start = shift(root.source.start), end = afterOffMarkers(text, shift(afterOffMarkers(ctx.files.find(f => f.id === root.source.file)!.text, root.source.end)))
  const next = { ...ctx, files }
  return applyPatches(next, navigationStackPatches(next, { ...root.source, start, end }, end))
}

/** A tab as a TabView's closure writes it (Wave 6c): its statement and call chain, and the statements of the TabSection it is in. */
interface WrittenTab {
  readonly statement: Stmt
  readonly chain: ReturnType<typeof viewCallChain>
  readonly section?: readonly Stmt[]
}

/** The tab bar's search tab as Bars reads it (Wave 6c): the TabView's statements, its search tab and the stretch removing it takes away. */
interface SearchTabs {
  readonly statements: readonly Stmt[]
  readonly search?: { readonly node?: AuthoringNode; readonly removal?: { readonly start: number; readonly end: number } }
  readonly problem?: string
}

const ALONE_IN_SECTION = 'This search tab is the only tab in its section. Take it away in Code.'
const SHARES_LINES = 'This search tab shares its lines with other code. Take it away in Code.'

/** What a call's trailing closure holds. */
const closureStatements = (call: CallExpr): readonly Stmt[] => call.trailingClosure?.body.statements ?? []
/** The name a view's call is written with: `Tab`, `TabSection`; empty for any other callee. */
const viewName = (call: CallExpr) => call.callee.kind === 'identifier' ? call.callee.name : ''

/** A TabView's tabs as written, each TabSection's tabs in its place, as a phone shows them. */
function writtenTabs(call: CallExpr, section?: readonly Stmt[]): WrittenTab[] {
  return closureStatements(call).flatMap(statement => {
    const chain = statement.kind === 'exprStmt' ? viewCallChain(statement.expression) : null
    return chain && viewName(chain.base) === 'TabSection' ? writtenTabs(chain.base, closureStatements(chain.base)) : [{ statement, chain, section }]
  })
}

/** Whether a tab is the search tab: `Tab(role: .search)`, whatever else it says. */
const isSearchTab = ({ chain }: WrittenTab) => !!chain && viewName(chain.base) === 'Tab' && chain.base.args.some(a => a.label === 'role' && a.value.kind === 'memberAccess' && !a.value.base && a.value.member === 'search')

/** The lines a statement is written on, with a note ending its last one; undefined when other code shares them. */
function ownLines(text: string, statement: Stmt): { start: number; end: number } | undefined {
  const start = text.lastIndexOf('\n', statement.span.start - 1), lineEnd = text.indexOf('\n', statement.span.end)
  const end = lineEnd < 0 ? text.length : lineEnd
  if (start < 0 || text.slice(start + 1, statement.span.start).trim() || !/^\s*(?:\/\/.*)?$/.test(text.slice(statement.span.end, end))) return undefined
  return { start, end }
}

/**
 * The search tab of the tab bar a screen holds (Wave 6c), alone or beside other views;
 * undefined when it holds none. A search tab is a `Tab`, so one goes only beside tabs each
 * written as a `Tab`, in a `TabSection` or not, at iOS 18, in a TabView that keeps no
 * selection, which would need the search tab to have a value of its own.
 */
function searchTabs(ctx: FeatureContext, parts: ScreenParts): SearchTabs | undefined {
  if (!parts.tabs) return undefined
  const { node, call } = parts.tabs, statements = closureStatements(call), tabs = writtenTabs(call)
  const found = tabs.find(isSearchTab)
  if (found) {
    const removal = ownLines(ctx.files.find(f => f.id === node.source.file)!.text, found.statement)
    const layer = node.children.map(id => layerById(ctx, id)).find(child => child?.source.start === found.statement.span.start)
    return { statements, search: { node: layer, removal }, problem: found.section?.length === 1 ? ALONE_IN_SECTION : removal ? undefined : SHARES_LINES }
  }
  // What stops the switch for good is said before what a newer deployment target would fix.
  const below18 = deploymentVersion(ctx.deploymentTarget) < 18
  const problem = tabs.some(tab => tab.chain?.modifiers.some(m => modifierName(m) === 'tabItem'))
    ? `These tabs are written with .tabItem. Write them as Tab${below18 ? ', at iOS 18 or newer,' : ''} to add a search tab in Code.`
    : !tabs.length || !tabs.every(tab => tab.chain && viewName(tab.chain.base) === 'Tab') ? 'These tabs are built in Swift, so a search tab is added in Code.'
    : below18 ? 'A search tab needs iOS 18 or newer. Change the deployment target to add one.'
    : call.args.some(a => a.label === 'selection') ? 'This TabView keeps which tab is selected, so a search tab needs a value of its own. Add it in Code.'
    : undefined
  return { statements, problem }
}

/**
 * The search tab switched on, as the last of the tabs at their indent, or off, taking its lines
 * away with a note ending them (Wave 6c). Switching it to what it is writes nothing.
 */
function searchTabPatches(ctx: FeatureContext, parts: ScreenParts, on: boolean): SourcePatch[] {
  const tabs = searchTabs(ctx, parts)
  if (!tabs) throw new Error('This screen has no tab bar to add a search tab to.')
  if (on === !!tabs.search) return []
  if (tabs.problem) throw new Error(tabs.problem)
  const file = parts.tabs!.node.source.file, text = ctx.files.find(f => f.id === file)!.text
  if (tabs.search) return [{ file, ...tabs.search.removal!, text: '' }]
  const last = tabs.statements.at(-1)!, { indent, unit } = indentAt(text, last.span.start)
  // After a note ending the last tab's line, unless more code follows it there.
  const lineEnd = text.indexOf('\n', last.span.end), rest = text.slice(last.span.end, lineEnd < 0 ? text.length : lineEnd)
  const at = /^\s*(?:\/\/.*)?$/.test(rest) ? last.span.end + rest.length : last.span.end
  const lines = ['Tab(role: .search) {', `${unit}NavigationStack {`, `${unit}${unit}Text("Search")`, `${unit}${unit}${unit}.navigationTitle("Search")`, `${unit}}`, '}']
  return [{ file, start: at, end: at, text: lines.map(line => `\n${indent}${line}`).join('') }]
}

/** A screen's bars for Screen settings (Wave 4b); undefined for what is no screen: a helper, a `#Preview` or the app. */
export function screenBars(ctx: FeatureContext, definition: AuthoringNode): ScreenBars | undefined {
  const parts = screenOf(ctx, definition)
  if (!parts) return undefined
  const at = parts.title?.node ?? parts.site, tabs = searchTabs(ctx, parts)
  return {
    title: parts.title && { node: parts.title.node.id, control: parts.title.control },
    barless: at && navigationAround(ctx, at).bar === false || undefined,
    items: parts.toolbars.length ? parts.toolbars.flatMap(toolbar => toolbarItems(ctx, toolbar)) : NO_ITEMS,
    search: parts.search && searchOf(parts.search),
    problem: placeProblem(ctx, parts, 14, 'Toolbar items'),
    searchProblem: parts.search ? undefined : placeProblem(ctx, parts, 15, 'A search field'),
    searchTab: tabs && { on: !!tabs.search, node: tabs.search?.node?.id, problem: tabs.problem },
  }
}

/** The items a toolbar lists: each item, and each view written in it bare, which iOS places itself. */
function toolbarItems(ctx: FeatureContext, toolbar: AuthoringNode): ScreenBarItem[] {
  return toolbar.children.flatMap(id => {
    const node = layerById(ctx, id)
    if (!node) return []
    if (node.kind === 'branch') return toolbarItems(ctx, node)
    const item = TOOLBAR_ITEMS.has(node.name)
    const placement = !item ? 'automatic' : toolbarPlacement(node.properties.find(p => p.name === 'placement')?.expression)
    const shows = item ? node.children.flatMap(child => layerById(ctx, child) ?? []) : [node]
    return [{ node: node.id, placement, label: shows.map(view => labelOf(ctx, view)).join(', ') || node.name }]
  })
}

/**
 * What a view in a toolbar shows, in words: a title, its text, or its symbol, the first found,
 * a menu's from its label; its name otherwise.
 */
function labelOf(ctx: FeatureContext, node: AuthoringNode): string {
  for (const id of ['title', 'content', 'icon', 'image']) {
    const value = node.controls?.find(c => c.id === id)?.value
    if (value) return value
  }
  const children = node.children.flatMap(id => layerById(ctx, id) ?? [])
  for (const child of [...children.filter(c => c.kind === 'branch' && c.name === 'Label'), ...children]) {
    const label = labelOf(ctx, child)
    if (label !== child.name) return label
  }
  return node.name
}

/** The search field `.searchable` on `node` makes: its prompt when written as words, and its Prompt control, read only where it can't be changed. */
function searchOf(node: AuthoringNode): NonNullable<ScreenBars['search']> {
  const index = node.modifiers?.filter(m => m.enabled).findIndex(m => m.name === 'searchable') ?? -1
  const control = node.controls?.find(c => c.id === `modifier:${index}:detail:prompt`)
  return { node: node.id, prompt: control && !control.disabledReason && control.value || undefined, control: control?.id }
}
