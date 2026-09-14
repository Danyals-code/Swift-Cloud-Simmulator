import type { SourceSpan } from '@studio/shared'
import type { Expr, Stmt } from '@studio/swift-syntax'

/**
 * A view-shaped summary of an expression tree.
 *
 * This is not the Phase 3 view graph — there is no identity, no state, no layout.
 * It is a structural read of what the parser understood, used to show the user
 * something true about their own code while the runtime is still being built.
 *
 * It also turns out to be the natural precursor to the Phase 4 inspector, which
 * needs exactly this: a node, its modifiers, and the source span to jump to.
 */
export interface OutlineNode {
  readonly name: string
  /** A literal argument worth showing inline, e.g. the text of a `Text`. */
  readonly detail: string | null
  /** Modifier names in source order. */
  readonly modifiers: readonly string[]
  readonly children: readonly OutlineNode[]
  readonly span: SourceSpan
}

/**
 * Peels a modifier chain down to the view it decorates.
 *
 * `Text("x").font(.largeTitle).padding()` parses as a call whose callee is a member
 * access whose base is another call — the chain is inside out. Unwinding it yields
 * the base view plus its modifiers in the order they were written.
 */
function peelModifiers(expr: Expr): { base: Expr; modifiers: string[] } {
  const modifiers: string[] = []
  let current = expr

  for (;;) {
    if (current.kind === 'call' && current.callee.kind === 'memberAccess' && current.callee.base) {
      modifiers.unshift(current.callee.member)
      current = current.callee.base
      continue
    }
    if (current.kind === 'memberAccess' && current.base) {
      modifiers.unshift(current.member)
      current = current.base
      continue
    }
    return { base: current, modifiers }
  }
}

/** The first string literal in an argument list, for display next to the node name. */
function literalDetail(expr: Expr): string | null {
  if (expr.kind !== 'call') return null

  for (const arg of expr.args) {
    if (arg.value.kind === 'stringLiteral') {
      const text = arg.value.segments
        .map((s) => (s.kind === 'text' ? s.value : '\\(…)'))
        .join('')
      return `"${text}"`
    }
    if (arg.value.kind === 'integerLiteral' || arg.value.kind === 'floatLiteral') {
      return arg.label ? `${arg.label}: ${arg.value.value}` : String(arg.value.value)
    }
  }
  return null
}

function nameOf(expr: Expr): string {
  switch (expr.kind) {
    case 'identifier':
      return expr.name
    case 'call':
      return nameOf(expr.callee)
    case 'memberAccess':
      return expr.base ? `${nameOf(expr.base)}.${expr.member}` : `.${expr.member}`
    case 'selfExpr':
      return 'self'
    case 'stringLiteral':
      return 'String'
    case 'integerLiteral':
    case 'floatLiteral':
      return 'Number'
    case 'ternary':
      return 'if/else'
    default:
      return expr.kind
  }
}

/**
 * Views whose trailing closure is an *action* rather than content.
 *
 * `Button("Save") { save() }` reads structurally identical to `VStack { Text(…) }`,
 * but the closure holds behaviour, not children. Outlining it as content shows the
 * body's statements as if they were views — which is both wrong and confusing, since
 * `count -= 1` is not a view by any reading.
 *
 * The distinguishing fact available without type information is the label argument:
 * `Button("Save") { action }` has one, `Button(action: …) { Label(…) }` does not.
 */
const ACTION_TRAILING_CLOSURE: ReadonlySet<string> = new Set(['Button', 'Link', 'NavigationLink'])

function trailingClosureIsAction(name: string, expr: Expr): boolean {
  if (!ACTION_TRAILING_CLOSURE.has(name)) return false
  if (expr.kind !== 'call') return false
  return expr.args.some((a) => a.label === null || a.label === 'title')
}

export function outlineExpression(expr: Expr): OutlineNode | null {
  const { base, modifiers } = peelModifiers(expr)
  const name = nameOf(base)

  const children: OutlineNode[] = []
  if (base.kind === 'call' && base.trailingClosure && !trailingClosureIsAction(name, base)) {
    children.push(...outlineStatements(base.trailingClosure.body.statements))
  }

  return {
    name,
    detail: literalDetail(base),
    modifiers,
    children,
    span: expr.span,
  }
}

export function outlineStatements(statements: readonly Stmt[]): OutlineNode[] {
  const nodes: OutlineNode[] = []

  for (const statement of statements) {
    if (statement.kind === 'exprStmt') {
      // Assignments are statements, never views. They appear in action closures, and
      // listing them alongside real views misrepresents the structure.
      if (statement.expression.kind === 'assign') continue
      const node = outlineExpression(statement.expression)
      if (node) nodes.push(node)
      continue
    }

    if (statement.kind === 'returnStmt' && statement.value) {
      const node = outlineExpression(statement.value)
      if (node) nodes.push(node)
      continue
    }

    // `if` inside a ViewBuilder produces conditional content; show both arms.
    if (statement.kind === 'ifStmt') {
      nodes.push({
        name: 'if',
        detail: null,
        modifiers: [],
        children: [
          ...outlineStatements(statement.then.statements),
          ...(statement.else?.kind === 'block' ? outlineStatements(statement.else.statements) : []),
        ],
        span: statement.span,
      })
      continue
    }

    if (statement.kind === 'forInStmt') {
      nodes.push({
        name: 'for-in',
        detail: statement.variable,
        modifiers: [],
        children: outlineStatements(statement.body.statements),
        span: statement.span,
      })
    }
  }

  return nodes
}

/** Depth-first flattening, carrying depth so the renderer can indent. */
export function flattenOutline(
  nodes: readonly OutlineNode[],
  depth = 0,
): { node: OutlineNode; depth: number }[] {
  const out: { node: OutlineNode; depth: number }[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    out.push(...flattenOutline(node.children, depth + 1))
  }
  return out
}
