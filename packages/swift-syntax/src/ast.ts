import type { SourceSpan } from '@studio/shared'

/**
 * The AST for the supported Swift subset (docs/04-SWIFT-SUBSET.md).
 *
 * Two properties are non-negotiable:
 *
 * 1. **Every node carries a span.** Diagnostics, the view inspector's jump-to-source,
 *    and runtime traps all need to point at real text.
 * 2. **Error and unsupported nodes are first class.** A parse failure produces a node
 *    rather than an exception, so a half-typed file still yields a usable tree for the
 *    rest of the source. FR-6.3 — keep showing the last good render — depends on it.
 */

export interface NodeBase {
  readonly span: SourceSpan
}

// ------------------------------------------------------------------- types

export type TypeRef =
  | NamedType
  | OptionalType
  | ArrayTypeRef
  | DictionaryTypeRef
  | SomeType
  | FunctionTypeRef
  | TupleTypeRef
  | ErrorType

export interface NamedType extends NodeBase {
  readonly kind: 'namedType'
  readonly name: string
  readonly generics: readonly TypeRef[]
}

export interface OptionalType extends NodeBase {
  readonly kind: 'optionalType'
  readonly wrapped: TypeRef
  /** `!` rather than `?` */
  readonly implicitlyUnwrapped: boolean
}

export interface ArrayTypeRef extends NodeBase {
  readonly kind: 'arrayType'
  readonly element: TypeRef
}

export interface DictionaryTypeRef extends NodeBase {
  readonly kind: 'dictionaryType'
  readonly key: TypeRef
  readonly value: TypeRef
}

/** `some View` — an opaque result type. */
export interface SomeType extends NodeBase {
  readonly kind: 'someType'
  readonly constraint: TypeRef
}

export interface FunctionTypeRef extends NodeBase {
  readonly kind: 'functionType'
  readonly params: readonly TypeRef[]
  readonly result: TypeRef
}

export interface TupleTypeRef extends NodeBase {
  readonly kind: 'tupleType'
  readonly elements: readonly TypeRef[]
}

export interface ErrorType extends NodeBase {
  readonly kind: 'errorType'
}

// -------------------------------------------------------------- attributes

export interface Attribute extends NodeBase {
  /** Without the leading `@`, e.g. `main`, `State`, `ViewBuilder`. */
  readonly name: string
  readonly args: readonly Argument[]
}

export interface Modifier extends NodeBase {
  /** `private`, `static`, `mutating`, … */
  readonly name: string
}

// ------------------------------------------------------------ declarations

export type Decl =
  | ImportDecl
  | StructDecl
  | FuncDecl
  | VarDecl
  | InitDecl
  | UnsupportedDecl
  | ErrorDecl

export interface DeclBase extends NodeBase {
  readonly attributes: readonly Attribute[]
  readonly modifiers: readonly Modifier[]
}

export interface ImportDecl extends NodeBase {
  readonly kind: 'importDecl'
  readonly module: string
}

export interface StructDecl extends DeclBase {
  readonly kind: 'structDecl'
  readonly name: string
  readonly nameSpan: SourceSpan
  /** Protocol conformances and inherited types, e.g. `View`, `App`. */
  readonly inherits: readonly NamedType[]
  readonly members: readonly Decl[]
}

export interface FuncDecl extends DeclBase {
  readonly kind: 'funcDecl'
  readonly name: string
  readonly nameSpan: SourceSpan
  readonly params: readonly Param[]
  readonly returnType: TypeRef | null
  readonly body: Block | null
}

export interface InitDecl extends DeclBase {
  readonly kind: 'initDecl'
  readonly params: readonly Param[]
  readonly body: Block | null
}

export interface VarDecl extends DeclBase {
  readonly kind: 'varDecl'
  readonly isLet: boolean
  readonly name: string
  readonly nameSpan: SourceSpan
  readonly typeAnnotation: TypeRef | null
  readonly initializer: Expr | null
  /** Present for computed properties: `var body: some View { … }`. */
  readonly accessor: Block | null
}

/**
 * A construct the parser recognised but the subset does not support — `class`,
 * `enum`, `protocol`, and friends.
 *
 * Parsed to a node rather than dropped so that the diagnostic can name the feature
 * precisely (FR-3.9) and so the rest of the file still parses. The body is skipped
 * by brace matching.
 */
export interface UnsupportedDecl extends NodeBase {
  readonly kind: 'unsupportedDecl'
  readonly feature: string
  readonly name: string | null
}

export interface ErrorDecl extends NodeBase {
  readonly kind: 'errorDecl'
  readonly message: string
}

export interface Param extends NodeBase {
  /** `_` for an omitted label; null when only one name was written. */
  readonly externalName: string | null
  readonly internalName: string
  readonly type: TypeRef | null
  readonly defaultValue: Expr | null
}

// -------------------------------------------------------------- statements

export type Stmt =
  | ExprStmt
  | DeclStmt
  | IfStmt
  | ForInStmt
  | ReturnStmt
  | UnsupportedStmt
  | ErrorStmt

export interface Block extends NodeBase {
  readonly kind: 'block'
  readonly statements: readonly Stmt[]
}

export interface ExprStmt extends NodeBase {
  readonly kind: 'exprStmt'
  readonly expression: Expr
}

export interface DeclStmt extends NodeBase {
  readonly kind: 'declStmt'
  readonly declaration: Decl
}

export interface IfStmt extends NodeBase {
  readonly kind: 'ifStmt'
  readonly condition: Expr
  readonly then: Block
  /** Either a `Block` or a nested `IfStmt` for `else if`. */
  readonly else: Block | IfStmt | null
}

export interface ForInStmt extends NodeBase {
  readonly kind: 'forInStmt'
  readonly variable: string
  readonly variableSpan: SourceSpan
  readonly sequence: Expr
  readonly body: Block
}

export interface ReturnStmt extends NodeBase {
  readonly kind: 'returnStmt'
  readonly value: Expr | null
}

export interface UnsupportedStmt extends NodeBase {
  readonly kind: 'unsupportedStmt'
  readonly feature: string
}

export interface ErrorStmt extends NodeBase {
  readonly kind: 'errorStmt'
  readonly message: string
}

// ------------------------------------------------------------- expressions

export type Expr =
  | IntegerLiteralExpr
  | FloatLiteralExpr
  | BooleanLiteralExpr
  | StringLiteralExpr
  | NilLiteralExpr
  | ArrayLiteralExpr
  | DictionaryLiteralExpr
  | IdentifierExpr
  | SelfExpr
  | MemberAccessExpr
  | CallExpr
  | SubscriptExpr
  | ClosureExpr
  | UnaryExpr
  | BinaryExpr
  | AssignExpr
  | TernaryExpr
  | TupleExpr
  | ForceUnwrapExpr
  | OptionalChainExpr
  | ErrorExpr

export interface IntegerLiteralExpr extends NodeBase {
  readonly kind: 'integerLiteral'
  readonly value: number
}

export interface FloatLiteralExpr extends NodeBase {
  readonly kind: 'floatLiteral'
  readonly value: number
}

export interface BooleanLiteralExpr extends NodeBase {
  readonly kind: 'booleanLiteral'
  readonly value: boolean
}

export interface NilLiteralExpr extends NodeBase {
  readonly kind: 'nilLiteral'
}

/** Interpolation segments are already parsed into expressions. */
export interface StringLiteralExpr extends NodeBase {
  readonly kind: 'stringLiteral'
  readonly segments: readonly StringExprSegment[]
}

export type StringExprSegment =
  | { readonly kind: 'text'; readonly value: string; readonly span: SourceSpan }
  | { readonly kind: 'interpolation'; readonly expression: Expr; readonly span: SourceSpan }

export interface ArrayLiteralExpr extends NodeBase {
  readonly kind: 'arrayLiteral'
  readonly elements: readonly Expr[]
}

export interface DictionaryLiteralExpr extends NodeBase {
  readonly kind: 'dictionaryLiteral'
  readonly entries: readonly { readonly key: Expr; readonly value: Expr }[]
}

export interface IdentifierExpr extends NodeBase {
  readonly kind: 'identifier'
  readonly name: string
}

export interface SelfExpr extends NodeBase {
  readonly kind: 'selfExpr'
}

/**
 * `base.member`, or `.member` with a null base.
 *
 * The null-base form is implicit member syntax — `.largeTitle`, `.infinity`,
 * `.primary` — which is pervasive in SwiftUI and resolves against the expected
 * type rather than against a value.
 */
export interface MemberAccessExpr extends NodeBase {
  readonly kind: 'memberAccess'
  readonly base: Expr | null
  readonly member: string
  readonly memberSpan: SourceSpan
}

export interface Argument {
  readonly label: string | null
  readonly labelSpan: SourceSpan | null
  readonly value: Expr
  readonly span: SourceSpan
}

export interface CallExpr extends NodeBase {
  readonly kind: 'call'
  readonly callee: Expr
  readonly args: readonly Argument[]
  /** `Button("Plus") { … }` — kept separate from `args` so the shape is faithful. */
  readonly trailingClosure: ClosureExpr | null
}

export interface SubscriptExpr extends NodeBase {
  readonly kind: 'subscript'
  readonly base: Expr
  readonly args: readonly Argument[]
}

export interface ClosureParam extends NodeBase {
  readonly name: string
  readonly type: TypeRef | null
}

export interface ClosureExpr extends NodeBase {
  readonly kind: 'closure'
  readonly params: readonly ClosureParam[]
  /** false when the closure relies on `$0` shorthand. */
  readonly hasExplicitParams: boolean
  readonly body: Block
}

export interface UnaryExpr extends NodeBase {
  readonly kind: 'unary'
  readonly operator: string
  readonly operand: Expr
}

export interface BinaryExpr extends NodeBase {
  readonly kind: 'binary'
  readonly operator: string
  readonly left: Expr
  readonly right: Expr
}

export interface AssignExpr extends NodeBase {
  readonly kind: 'assign'
  /** `=`, `+=`, `-=`, … */
  readonly operator: string
  readonly target: Expr
  readonly value: Expr
}

export interface TernaryExpr extends NodeBase {
  readonly kind: 'ternary'
  readonly condition: Expr
  readonly then: Expr
  readonly else: Expr
}

export interface TupleExpr extends NodeBase {
  readonly kind: 'tuple'
  readonly elements: readonly Expr[]
}

export interface ForceUnwrapExpr extends NodeBase {
  readonly kind: 'forceUnwrap'
  readonly operand: Expr
}

export interface OptionalChainExpr extends NodeBase {
  readonly kind: 'optionalChain'
  readonly operand: Expr
}

export interface ErrorExpr extends NodeBase {
  readonly kind: 'errorExpr'
  readonly message: string
}

// ------------------------------------------------------------- source file

export interface SourceFileNode extends NodeBase {
  readonly kind: 'sourceFile'
  readonly file: string
  readonly declarations: readonly Decl[]
}

export type Node = SourceFileNode | Decl | Stmt | Expr | Block | TypeRef

// ----------------------------------------------------------------- walking

/**
 * Calls `visit` on every child node. Depth-first, pre-order, via `walk` below.
 *
 * Written as an explicit switch rather than a generic key-crawl so that adding a
 * node type without teaching the walker about it is a type error rather than a
 * silently skipped subtree.
 */
export function forEachChild(node: Node, visit: (child: Node) => void): void {
  switch (node.kind) {
    case 'sourceFile':
      node.declarations.forEach(visit)
      return
    case 'structDecl':
      node.members.forEach(visit)
      return
    case 'funcDecl':
      node.params.forEach((p) => {
        if (p.type) visit(p.type)
        if (p.defaultValue) visit(p.defaultValue)
      })
      if (node.returnType) visit(node.returnType)
      if (node.body) visit(node.body)
      return
    case 'initDecl':
      node.params.forEach((p) => {
        if (p.type) visit(p.type)
        if (p.defaultValue) visit(p.defaultValue)
      })
      if (node.body) visit(node.body)
      return
    case 'varDecl':
      if (node.typeAnnotation) visit(node.typeAnnotation)
      if (node.initializer) visit(node.initializer)
      if (node.accessor) visit(node.accessor)
      return
    case 'block':
      node.statements.forEach(visit)
      return
    case 'exprStmt':
      visit(node.expression)
      return
    case 'declStmt':
      visit(node.declaration)
      return
    case 'ifStmt':
      visit(node.condition)
      visit(node.then)
      if (node.else) visit(node.else)
      return
    case 'forInStmt':
      visit(node.sequence)
      visit(node.body)
      return
    case 'returnStmt':
      if (node.value) visit(node.value)
      return
    case 'stringLiteral':
      node.segments.forEach((s) => {
        if (s.kind === 'interpolation') visit(s.expression)
      })
      return
    case 'arrayLiteral':
      node.elements.forEach(visit)
      return
    case 'dictionaryLiteral':
      node.entries.forEach((e) => {
        visit(e.key)
        visit(e.value)
      })
      return
    case 'memberAccess':
      if (node.base) visit(node.base)
      return
    case 'call':
      visit(node.callee)
      node.args.forEach((a) => visit(a.value))
      if (node.trailingClosure) visit(node.trailingClosure)
      return
    case 'subscript':
      visit(node.base)
      node.args.forEach((a) => visit(a.value))
      return
    case 'closure':
      node.params.forEach((p) => {
        if (p.type) visit(p.type)
      })
      visit(node.body)
      return
    case 'unary':
    case 'forceUnwrap':
    case 'optionalChain':
      visit(node.kind === 'unary' ? node.operand : node.operand)
      return
    case 'binary':
      visit(node.left)
      visit(node.right)
      return
    case 'assign':
      visit(node.target)
      visit(node.value)
      return
    case 'ternary':
      visit(node.condition)
      visit(node.then)
      visit(node.else)
      return
    case 'tuple':
      node.elements.forEach(visit)
      return
    case 'optionalType':
      visit(node.wrapped)
      return
    case 'arrayType':
      visit(node.element)
      return
    case 'dictionaryType':
      visit(node.key)
      visit(node.value)
      return
    case 'someType':
      visit(node.constraint)
      return
    case 'functionType':
      node.params.forEach(visit)
      visit(node.result)
      return
    case 'tupleType':
      node.elements.forEach(visit)
      return
    case 'namedType':
      node.generics.forEach(visit)
      return
    // Leaves.
    case 'importDecl':
    case 'unsupportedDecl':
    case 'errorDecl':
    case 'unsupportedStmt':
    case 'errorStmt':
    case 'integerLiteral':
    case 'floatLiteral':
    case 'booleanLiteral':
    case 'nilLiteral':
    case 'identifier':
    case 'selfExpr':
    case 'errorExpr':
    case 'errorType':
      return
  }
}

/** Depth-first pre-order walk. Return `false` from `visit` to skip a subtree. */
export function walk(node: Node, visit: (n: Node) => boolean | void): void {
  if (visit(node) === false) return
  forEachChild(node, (child) => walk(child, visit))
}
