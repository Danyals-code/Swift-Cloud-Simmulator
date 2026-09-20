import type { AppNavigationModel, AppTab, NavigationOperation, SourceFile, SourceSpan } from '@studio/shared'
import { forEachChild, type CallExpr, type Expr, type Node, type StructDecl } from '@studio/swift-syntax'
import { viewCallChain, swiftString } from './design-controls'
import { allDeclarations, identifier, namedStruct, patch, raw, sourceRoot, type FeatureContext, type SourcePatch } from './authoring-context'

/**
 * The app's own navigation: which screen it starts on, or which tabs it has.
 *
 * Tabs are the one part of an app's structure a designer changes as a list rather
 * than as a view, so the studio reads `TabView { Screen().tabItem { Label(…) } }`
 * back into rows and writes the same shape out again. Anything else - a computed
 * list of tabs, a custom tab bar - is shown as it is and opened in Code: the point
 * is never to rewrite code the studio did not write.
 */

/** Where the tab bar is written, beside the app's own files. */
export const navigationFile = (ctx: FeatureContext) => `${sourceRoot(ctx)}App/AppNavigation.swift`
/** The path a new project uses, for callers that have no project in hand. */
export const NAVIGATION_FILE = 'Sources/App/AppNavigation.swift'

/** A screen's name as a tab would show it: `HomeScreen` becomes `Home`. */
const screenLabel = (view: string) => view.replace(/(Screen|View)$/, '') || view

/** Apple's guidance is five tabs on iPhone; above that the bar collapses into More. */
export const TAB_LIMIT = 5

interface TabSite {
  readonly tab: AppTab
  /** The whole `Screen().tabItem { … }` expression, for moving and removing. */
  readonly span: SourceSpan
  readonly nameSpan?: SourceSpan
  readonly iconSpan?: SourceSpan
  readonly screenSpan?: SourceSpan
}

interface TabContainer {
  readonly call: CallExpr
  readonly sites: readonly TabSite[]
  readonly file: string
}

/** The `@main` App struct, and the view its window shows. */
function entry(ctx: FeatureContext): { app: StructDecl; content?: CallExpr } | undefined {
  const app = allDeclarations(ctx).find((d): d is StructDecl => d.kind === 'structDecl' && d.attributes.some(a => a.name === 'main'))
  if (!app) return undefined
  let content: CallExpr | undefined
  const visit = (node: Node) => {
    if (content) return
    if (node.kind === 'call' && node.callee.kind === 'identifier' && node.callee.name === 'WindowGroup') {
      const body = node.trailingClosure?.body.statements ?? []
      const only = body.length === 1 ? body[0] : undefined
      const expr = only?.kind === 'exprStmt' ? only.expression : undefined
      const chain = expr ? viewCallChain(expr) : null
      if (chain) content = chain.base
      return
    }
    forEachChild(node, visit)
  }
  visit(app)
  return { app, ...(content ? { content } : {}) }
}

/** The view a call names, when it is a plain `SomeScreen()` in this project. */
function calledView(ctx: FeatureContext, call: CallExpr | undefined): StructDecl | undefined {
  if (call?.callee.kind !== 'identifier') return undefined
  return namedStruct(ctx, call.callee.name)
}

/** The single expression a view's `body` returns. */
function bodyExpression(struct: StructDecl | undefined): Expr | undefined {
  const body = struct?.members.find(m => m.kind === 'varDecl' && m.name === 'body')
  const statements = body?.kind === 'varDecl' ? body.accessor?.statements ?? [] : []
  const only = statements.length === 1 ? statements[0] : undefined
  return only?.kind === 'exprStmt' ? only.expression : undefined
}

/** The text of a literal the editor can read and write back, or undefined. */
function plainText(expr: Expr): string | undefined {
  if (expr.kind !== 'stringLiteral' || !expr.segments.every(segment => segment.kind === 'text')) return undefined
  return expr.segments.map(segment => segment.kind === 'text' ? segment.value : '').join('')
}

interface LabelPart { readonly span: SourceSpan; readonly text: string }

/**
 * The name and symbol a `Label("Name", systemImage: "icon")` carries.
 *
 * Only plain text counts. A label built from a value - `Label(title, …)` - or one
 * with interpolation in it has no part here, which is what makes the tab read-only
 * rather than something the editor would rewrite into a different app.
 */
function labelParts(inside: Node): { name?: LabelPart; icon?: LabelPart } {
  const parts: { name?: LabelPart; icon?: LabelPart } = {}
  const visit = (node: Node) => {
    if (node.kind === 'call' && node.callee.kind === 'identifier' && ['Label', 'Image', 'Text'].includes(node.callee.name)) {
      for (const arg of node.args) {
        const text = plainText(arg.value)
        if (text === undefined) continue
        if (arg.label === null && !parts.name && node.callee.name !== 'Image') parts.name = { span: arg.value.span, text }
        if ((arg.label === 'systemImage' || arg.label === 'systemName') && !parts.icon) parts.icon = { span: arg.value.span, text }
      }
    }
    forEachChild(node, visit)
  }
  visit(inside)
  return parts
}

/**
 * The `TabView { … }` the app shows, however deeply it is wrapped.
 *
 * Follows the views the app builds as well as the expression itself: an app whose
 * root shows `MainTabs()` has a tab bar, and reading it as a single stack would
 * offer to wrap the whole app in a second one.
 */
function findTabView(ctx: FeatureContext, expr: Expr, seen = new Set<string>()): CallExpr | undefined {
  let found: CallExpr | undefined
  const nested: StructDecl[] = []
  const visit = (node: Node) => {
    if (found) return
    if (node.kind === 'call' && node.callee.kind === 'identifier') {
      if (node.callee.name === 'TabView' && node.trailingClosure) { found = node; return }
      const view = namedStruct(ctx, node.callee.name)
      if (view && !seen.has(view.name)) nested.push(view)
    }
    forEachChild(node, visit)
  }
  visit(expr)
  if (found || seen.size >= 3) return found
  for (const view of nested) {
    seen.add(view.name)
    const body = bodyExpression(view)
    const inside = body ? findTabView(ctx, body, seen) : undefined
    if (inside) return inside
  }
  return undefined
}

/** The `TabView { … }` the app shows, read back as a list of tabs. */
function tabContainer(ctx: FeatureContext): TabContainer | undefined {
  const root = entry(ctx)
  if (!root) return undefined
  const candidates = [bodyExpression(calledView(ctx, root.content)), root.content as Expr | undefined]
  for (const candidate of candidates) {
    // Anywhere in the view, not only at its root: an app whose tab bar sits inside a
    // NavigationStack still has tabs, and reading it as a single stack would offer
    // to build a second tab bar around the first.
    const call = candidate ? findTabView(ctx, candidate) : undefined
    if (!call?.trailingClosure) continue
    const sites: TabSite[] = []
    for (const statement of call.trailingClosure.body.statements) {
      if (statement.kind !== 'exprStmt') return { call, sites: [], file: call.span.file }
      const chain = viewCallChain(statement.expression)
      const item = chain?.modifiers.find(modifier => modifier.callee.kind === 'memberAccess' && modifier.callee.member === 'tabItem')
      if (!chain || !item) return { call, sites: [], file: call.span.file }
      const parts = item.trailingClosure ? labelParts(item.trailingClosure) : {}
      const screen = chain.base.callee.kind === 'identifier' ? chain.base.callee.name : ''
      let content = raw(ctx, statement.expression.span)
      for (const modifier of [...chain.modifiers].reverse()) {
        if (modifier.callee.kind !== 'memberAccess' || !modifier.callee.base || !['tabItem', 'tag'].includes(modifier.callee.member)) continue
        const start = modifier.callee.base.span.end - statement.expression.span.start
        const end = modifier.span.end - statement.expression.span.start
        content = content.slice(0, start) + content.slice(end)
      }
      sites.push({
        tab: {
          name: parts.name?.text ?? '',
          icon: parts.icon?.text ?? '',
          screen,
          content,
        },
        span: statement.expression.span,
        ...(parts.name ? { nameSpan: parts.name.span } : {}),
        ...(parts.icon ? { iconSpan: parts.icon.span } : {}),
        ...(chain.base.callee.kind === 'identifier' ? { screenSpan: chain.base.callee.span } : {}),
      })
    }
    return { call, sites, file: call.span.file }
  }
  return undefined
}

/**
 * What the App panel shows: the style, the tabs, and whether they can be edited.
 *
 * A tab is editable when its name and symbol are plain text in the source. That is
 * the whole test: the studio changes those strings, and refuses anything it would
 * have to rewrite to understand.
 */
export function appNavigation(ctx: FeatureContext): AppNavigationModel {
  const root = entry(ctx)
  if (!root) return { style: 'none', tabs: [], editable: false, reason: 'This project has no App entry point yet.' }
  const container = tabContainer(ctx)
  if (container) {
    // A tab can be renamed, re-symboled, reordered or removed whenever its name and
    // symbol are plain text. Pointing it at another screen needs more - a tab whose
    // content is written inline says so when that is tried.
    const usable = container.sites.length > 0 && container.sites.every(site => site.nameSpan && site.iconSpan)
    return {
      style: 'tabs',
      tabs: container.sites.map(site => site.tab),
      editable: usable,
      source: container.call.span,
      ...(usable ? {} : { reason: 'These tabs are built in Swift. Open the code to change them.' }),
    }
  }
  const screen = calledView(ctx, root.content)
  return {
    style: 'stack',
    tabs: [],
    editable: !!screen,
    ...(screen ? { root: screen.name, source: screen.span } : { reason: 'The app’s first screen is built in Swift. Open the code to change it.' }),
  }
}

const tabLine = (screen: string, name: string, icon: string, indent: string) =>
  `${indent}${screen}()\n${indent}    .tabItem { Label(${swiftString(name)}, systemImage: ${swiftString(icon)}) }`

/** The indent of the line a span starts on. */
function indentOf(ctx: FeatureContext, span: SourceSpan): string {
  const text = ctx.files.find(f => f.id === span.file)?.text ?? ''
  return /^[\t ]*/.exec(text.slice(text.lastIndexOf('\n', span.start - 1) + 1, span.start))?.[0] ?? '            '
}

function validTab(name: string, icon: string): void {
  if (!name.trim() || name.length > 40) throw new Error('Enter a tab name of 1–40 characters.')
  if (!/^[a-z0-9.]+$/i.test(icon)) throw new Error('Choose an SF Symbol for the tab.')
}

/**
 * Every tab change, as an edit to the app's own source.
 *
 * Adding the first tab to an app that has none writes `AppNavigation.swift` and
 * points the window at it, so the app that started on one screen now starts on a
 * tab bar - one file, one clear place, the same shape the reader above expects.
 */
export function navigationPatches(ctx: FeatureContext, operation: NavigationOperation): { patches: SourcePatch[]; created?: SourceFile[] } {
  const model = appNavigation(ctx)
  const container = tabContainer(ctx)
  if (operation.kind === 'navigation-style') {
    if (operation.style === 'tabs') {
      if (model.style === 'tabs') return { patches: [] }
      return useTabs(ctx, operation.name, operation.icon)
    }
    if (model.style !== 'tabs') return { patches: [] }
    if (!container || container.sites.length !== 1) throw new Error('Remove the other tabs first; a single stack starts on one screen.')
    // Keep the original lexical scope, initializer arguments and inline content.
    // Moving a bare type name into WindowGroup loses all three.
    return { patches: [patch(container.call.span, container.sites[0]!.tab.content!)] }
  }
  if (operation.kind === 'tab-add' && model.style !== 'tabs') {
    if (!identifier(operation.screen) || !namedStruct(ctx, operation.screen)) throw new Error('Choose a screen for this tab.')
    validTab(operation.name, operation.icon)
    const first = model.root
    if (!first) throw new Error('This app’s first screen is built in Swift. Open the code to add tabs.')
    if (operation.screen === first) return useTabs(ctx, operation.name, operation.icon)
    // The screen the app already starts on keeps its own name; the tab being added
    // is the second one. Naming both after the new tab is how an app ends up with
    // two tabs called "Saved".
    return useTabs(ctx, screenLabel(first), 'house', { screen: operation.screen, name: operation.name, icon: operation.icon })
  }
  if (!container || !model.editable) throw new Error(model.reason ?? 'These tabs are built in Swift. Open the code to change them.')
  const sites = container.sites
  if (operation.kind === 'tab-add') {
    validTab(operation.name, operation.icon)
    if (!identifier(operation.screen) || !namedStruct(ctx, operation.screen)) throw new Error('Choose a screen for this tab.')
    if (sites.some(site => site.tab.screen === operation.screen)) throw new Error('That screen is already a tab.')
    const last = sites.at(-1)
    if (!last) throw new Error('This tab bar is built in Swift. Open the code to change it.')
    const indent = indentOf(ctx, last.span)
    return { patches: [{ file: last.span.file, start: last.span.end, end: last.span.end, text: '\n' + tabLine(operation.screen, operation.name, operation.icon, indent) }] }
  }
  const site = sites[operation.index]
  if (!site) throw new Error('That tab is no longer there. Try again.')
  if (operation.kind === 'tab-remove') {
    if (sites.length === 1) throw new Error('An app with tabs needs at least one. Switch to a single stack instead.')
    const text = ctx.files.find(f => f.id === site.span.file)?.text ?? ''
    const start = text.lastIndexOf('\n', site.span.start - 1)
    return { patches: [{ file: site.span.file, start: start < 0 ? site.span.start : start, end: site.span.end, text: '' }] }
  }
  if (operation.kind === 'tab-move') {
    if (operation.toIndex < 0 || operation.toIndex >= sites.length || operation.toIndex === operation.index) return { patches: [] }
    // Moved, not swapped: a tab dragged from first to last leaves the ones it passed
    // in their order. Each line is rewritten with the text of the tab that now sits
    // there, so whatever a person added to a tab travels with it.
    const order = sites.map(item => raw(ctx, item.span))
    const [moved] = order.splice(operation.index, 1)
    order.splice(operation.toIndex, 0, moved!)
    return { patches: sites.flatMap((item, index) => order[index] === raw(ctx, item.span) ? [] : [patch(item.span, order[index]!)]) }
  }
  const name = operation.name ?? site.tab.name, icon = operation.icon ?? site.tab.icon
  validTab(name, icon)
  const patches: SourcePatch[] = []
  if (operation.name !== undefined && site.nameSpan) patches.push(patch(site.nameSpan, swiftString(name)))
  if (operation.icon !== undefined && site.iconSpan) patches.push(patch(site.iconSpan, swiftString(icon)))
  if (operation.screen !== undefined && operation.screen !== site.tab.screen) {
    if (!identifier(operation.screen) || !namedStruct(ctx, operation.screen)) throw new Error('Choose a screen for this tab.')
    if (sites.some(other => other !== site && other.tab.screen === operation.screen)) throw new Error('That screen is already a tab.')
    if (!site.screenSpan) throw new Error('This tab’s screen is built in Swift. Open the code to change it.')
    patches.push(patch(site.screenSpan, operation.screen))
  }
  return { patches }
}

/** Point the window at a view, wherever the entry point writes it. */
function entryPatch(ctx: FeatureContext, view: string): SourcePatch {
  const root = entry(ctx)
  if (!root?.content) throw new Error('This app’s entry point is built in Swift. Open the code to change it.')
  return patch(root.content.span, `${view}()`)
}

/** Move an app onto a tab bar: one new file, and the window pointed at it. */
function useTabs(ctx: FeatureContext, name: string, icon: string, second?: { screen: string; name: string; icon: string }): { patches: SourcePatch[]; created: SourceFile[] } {
  validTab(name, icon)
  const model = appNavigation(ctx)
  const first = model.root
  if (!first) throw new Error(model.reason ?? 'This app’s first screen is built in Swift. Open the code to add tabs.')
  const file = navigationFile(ctx)
  if (first === 'AppNavigation') {
    const body = bodyExpression(namedStruct(ctx, first))
    if (!body) throw new Error('This navigation view is built in Swift. Open the code to change it.')
    const lines = [`            ${raw(ctx, body.span)}\n                .tabItem { Label(${swiftString(name)}, systemImage: ${swiftString(icon)}) }`]
    if (second) { validTab(second.name, second.icon); lines.push(tabLine(second.screen, second.name, second.icon, '            ')) }
    return { patches: [patch(body.span, `TabView {\n${lines.join('\n')}\n        }`)], created: [] }
  }
  let navigationName = 'AppNavigation', destination = file
  const names = new Set(allDeclarations(ctx).flatMap(d => 'name' in d ? [d.name] : []))
  for (let suffix = 2; names.has(navigationName) || ctx.files.some(existing => existing.id === destination); suffix++) {
    navigationName = `AppNavigation${suffix}`
    destination = file.replace(/AppNavigation\.swift$/, `${navigationName}.swift`)
  }
  const lines = [tabLine(first, name, icon, '            ')]
  if (second) { validTab(second.name, second.icon); lines.push(tabLine(second.screen, second.name, second.icon, '            ')) }
  const text = `import SwiftUI\n\n/// The app's tabs. Each tab shows one screen.\nstruct ${navigationName}: View {\n    var body: some View {\n        TabView {\n${lines.join('\n')}\n        }\n    }\n}\n`
  return { patches: [entryPatch(ctx, navigationName)], created: [{ id: destination, text }] }
}
