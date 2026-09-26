import type { AppAccent } from '@studio/shared'
import type { Expr, VarDecl } from '@studio/swift-syntax'
import type { FeatureContext } from './authoring-context'
import { bodyExpression, calledView, onlyExpression, plainText, windowContent } from './authoring-navigation-app'
import { AUTHORING_COLOR_HEX, AUTHORING_COLOR_HEX_DARK } from './authoring-resources'
import { viewCallChain } from './design-controls'

/** Containers whose content is still the app's root, so a tint written on it covers the whole app. */
const ROOT_CONTAINERS = new Set(['NavigationStack', 'NavigationView', 'NavigationSplitView', 'Group'])

/**
 * The app's accent: the tint written at its root, as the hex its colour set holds in
 * light and dark. The root is the view its window shows, the body of the project's
 * view that is, and the content of a navigation stack there, but not a tab: a tint
 * inside one tab is that tab's.
 *
 * The preview draws that tint wherever `Color.accentColor` is used. In the iOS 27
 * simulator `Color.accentColor` follows a tint written on a navigation stack, and stays
 * the system blue under one written on the stack's content, so the export writes the
 * tint into AccentColor, and the phone draws it everywhere the preview does.
 */
export function appAccent(ctx: FeatureContext): AppAccent | undefined {
  let expr = windowContent(ctx)?.content
  for (let depth = 0; expr && depth < 4; depth++) {
    const chain = viewCallChain(expr)
    if (!chain) return undefined
    // The tint closest to the view is the one its content takes.
    const tint = chain.modifiers.find(m => m.callee.kind === 'memberAccess' && ['tint', 'accentColor'].includes(m.callee.member))
    if (tint) return colorOf(ctx, tint.args[0]?.value)
    const view = calledView(ctx, chain.base)
    const container = chain.base.callee.kind === 'identifier' && ROOT_CONTAINERS.has(chain.base.callee.name)
    expr = view ? bodyExpression(view) : container ? onlyExpression(chain.base.trailingClosure?.body.statements) : undefined
  }
  return undefined
}

/**
 * A colour written as `.teal` or `Color.teal`, as `Color("Brand")`, one of the project's
 * colour sets, or as a token the project declares, `.brand` or `Theme.brand`, followed
 * to the colour it was given.
 */
function colorOf(ctx: FeatureContext, value: Expr | undefined, depth = 0): AppAccent | undefined {
  if (!value || depth > 3) return undefined
  if (value.kind === 'memberAccess' && (!value.base || value.base.kind === 'identifier')) {
    const owner = value.base?.kind === 'identifier' ? value.base.name : undefined
    const light = !owner || owner === 'Color' ? AUTHORING_COLOR_HEX[value.member] : undefined
    if (light) return { light, dark: AUTHORING_COLOR_HEX_DARK[value.member] ?? light }
    return colorOf(ctx, tokenValue(ctx, owner, value.member), depth + 1)
  }
  if (value.kind === 'call' && value.callee.kind === 'identifier' && value.callee.name === 'Color' && value.args.length === 1 && value.args[0]!.label === null) {
    const name = plainText(value.args[0]!.value)
    const set = name === undefined ? undefined : ctx.colors?.find(color => color.name === name)
    return set ? { light: set.light, dark: set.dark ?? set.light } : undefined
  }
  return undefined
}

/** The value of a static token: in `owner`, or with none, in an extension of Color or ShapeStyle. */
function tokenValue(ctx: FeatureContext, owner: string | undefined, name: string): Expr | undefined {
  const hosts = owner ? [owner] : ['Color', 'ShapeStyle']
  for (const decl of ctx.ast.flatMap(file => file.declarations)) {
    if (!('members' in decl) || !hosts.includes(decl.name)) continue
    const token = decl.members.find((member): member is VarDecl => member.kind === 'varDecl' && member.name === name && member.modifiers.some(modifier => modifier.name === 'static'))
    if (token?.initializer) return token.initializer
  }
  return undefined
}
