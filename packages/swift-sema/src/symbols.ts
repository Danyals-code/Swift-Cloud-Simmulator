import type { SourceSpan } from '@studio/shared'
import type {
  Decl,
  EnumDecl,
  FuncDecl,
  Param,
  SourceFileNode,
  Stmt,
  StructDecl,
  TypeRef,
  VarDecl,
} from '@studio/swift-syntax'
import { collectConformance, Lexer, typeName as typeNameOf } from '@studio/swift-syntax'
import {
  PROPERTY_WRAPPERS,
  SUPPORTED_MODIFIERS,
  SUPPORTED_VIEWS,
  UNIMPLEMENTED_MODIFIERS,
  UNIMPLEMENTED_VIEWS,
  KNOWN_ATTRIBUTES,
  KNOWN_TYPES,
} from './builtins'

/**
 * The symbol index behind completion, go-to-definition, hover and rename.
 *
 * One principle shapes all of it, and it is the editor's version of the rule the
 * checker already follows: **a wrong answer is worse than no answer.** A completion
 * list that omits something costs a keystroke; one that offers a name which does not
 * exist, or jumps to the wrong declaration, teaches the user not to trust the editor -
 * and then the feature is worse than absent.
 *
 * So everything here is derived from declarations that were actually parsed, plus the
 * built-in tables the checker already uses. Where the receiver of a `.` cannot be
 * resolved, the answer is "modifiers and nothing else" rather than a guess at members.
 *
 * It lives in `swift-sema` because that is where both the AST and the built-in tables
 * are, and it runs in the worker like everything else Swift-shaped.
 */

export type SymbolKind =
  | 'type'
  | 'protocol'
  | 'enumCase'
  | 'function'
  | 'method'
  | 'property'
  | 'local'
  | 'parameter'
  | 'view'
  | 'modifier'
  | 'attribute'
  | 'keyword'

export interface SymbolInfo {
  readonly name: string
  readonly kind: SymbolKind
  /** A short signature or type, shown beside the name. */
  readonly detail: string
  /** Where it was declared, when the project declared it. */
  readonly span?: SourceSpan
  /** Text to insert, when it differs from the name - `frame(` and so on. */
  readonly insert?: string
  /** One line, shown in the completion detail panel and on hover. */
  readonly doc?: string
}

export interface CompletionResult {
  /** Offset where the word being completed starts, so the editor can replace it. */
  readonly from: number
  readonly items: readonly SymbolInfo[]
}

/** Swift keywords worth completing at statement level. */
const STATEMENT_KEYWORDS: readonly string[] = [
  'let', 'var', 'func', 'struct', 'class', 'enum', 'protocol', 'extension',
  'if', 'else', 'guard', 'for', 'while', 'repeat', 'switch', 'case', 'default',
  'return', 'break', 'continue', 'do', 'catch', 'throw', 'try', 'async', 'await',
  'init', 'self', 'super', 'true', 'false', 'nil', 'import', 'some', 'any',
  'private', 'static', 'mutating', 'override', 'throws', 'where', 'in',
]

// ------------------------------------------------------------------ positions

/** Does this span contain the offset? End-inclusive, so a caret just past a name is inside it. */
function contains(span: SourceSpan, file: string, offset: number): boolean {
  return span.file === file && offset >= span.start && offset <= span.end
}

/**
 * The word being typed at `offset`, and where it starts.
 *
 * Identifier characters only. `$` is included because `$binding` is one name, and a
 * leading `.` is not - the dot is the trigger, handled separately.
 */
function wordAt(text: string, offset: number): { word: string; from: number } {
  let from = offset
  while (from > 0 && /[A-Za-z0-9_$]/.test(text[from - 1]!)) from--
  return { word: text.slice(from, offset), from }
}

/**
 * The receiver expression immediately before a `.`, as written.
 *
 * Textual on purpose. Resolving it properly needs a type checker, and the honest
 * fallback - offer modifiers - is only reachable if this can say "I do not know".
 * Returns null when the dot has no receiver, which is contextual member syntax.
 */
function receiverBefore(text: string, dotOffset: number): string | null {
  let end = dotOffset
  while (end > 0 && /\s/.test(text[end - 1]!)) end--
  if (end === 0) return null

  // A call or subscript: walk back over the balanced group to its head.
  let start = end
  const closers: Record<string, string> = { ')': '(', ']': '[', '}': '{' }
  if (closers[text[end - 1]!]) {
    let depth = 0
    let i = end - 1
    for (; i >= 0; i--) {
      const ch = text[i]!
      if (ch === ')' || ch === ']' || ch === '}') depth++
      else if (ch === '(' || ch === '[' || ch === '{') {
        depth--
        if (depth === 0) break
      }
    }
    if (i < 0) return null
    start = i
    while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1]!)) start--
    return text.slice(start, i) || null
  }

  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1]!)) start--
  const word = text.slice(start, end)
  return word.length > 0 ? word : null
}

/** The nearest non-whitespace character before `offset`, skipping comments is not attempted. */
function previousMeaningful(text: string, offset: number): { ch: string; at: number } | null {
  let i = offset
  while (i > 0 && /\s/.test(text[i - 1]!)) i--
  return i > 0 ? { ch: text[i - 1]!, at: i - 1 } : null
}

// ----------------------------------------------------------------- signatures

function renderType(type: TypeRef | null): string {
  if (!type) return ''
  return typeNameOf(type) ?? ''
}

function signatureOf(decl: FuncDecl): string {
  const params = decl.params.map(renderParam).join(', ')
  const result = decl.returnType ? ` -> ${renderType(decl.returnType)}` : ''
  return `(${params})${result}`
}

function renderParam(param: Param): string {
  const label = param.externalName ?? param.internalName
  const type = renderType(param.type)
  return label === '_' ? type : `${label}: ${type}`
}

function propertyDetail(decl: VarDecl): string {
  const declared = renderType(decl.typeAnnotation)
  if (declared) return declared
  // No annotation: say what it is rather than inventing a type it might not have.
  return decl.isLet ? 'let' : 'var'
}

/** The call snippet for a name that takes arguments. */
function callInsert(name: string, takesArguments: boolean): string | undefined {
  return takesArguments ? `${name}(` : undefined
}

// ------------------------------------------------------------------- the index

export interface SymbolIndex {
  /** Every declaration in the project, by name. */
  readonly declarations: ReadonlyMap<string, SymbolInfo>
  readonly files: readonly SourceFileNode[]
}

export function buildSymbolIndex(files: readonly SourceFileNode[]): SymbolIndex {
  const declarations = new Map<string, SymbolInfo>()

  for (const file of files) {
    for (const decl of file.declarations) {
      const info = describeDeclaration(decl)
      if (info && !declarations.has(info.name)) declarations.set(info.name, info)
    }
  }

  return { declarations, files }
}

function describeDeclaration(decl: Decl): SymbolInfo | null {
  switch (decl.kind) {
    case 'structDecl':
      return {
        name: decl.name,
        kind: 'type',
        detail: decl.isReference ? 'class' : 'struct',
        span: decl.nameSpan,
        doc: decl.inherits.length > 0 ? `: ${decl.inherits.map((t) => t.name).join(', ')}` : undefined,
      }
    case 'enumDecl':
      return { name: decl.name, kind: 'type', detail: 'enum', span: decl.nameSpan }
    case 'protocolDecl':
      return { name: decl.name, kind: 'protocol', detail: 'protocol', span: decl.nameSpan }
    case 'funcDecl':
      return {
        name: decl.name,
        kind: 'function',
        detail: signatureOf(decl),
        span: decl.nameSpan,
        insert: callInsert(decl.name, decl.params.length > 0),
      }
    case 'varDecl':
      return { name: decl.name, kind: 'local', detail: propertyDetail(decl), span: decl.nameSpan }
    default:
      return null
  }
}

// ------------------------------------------------------------------ the scope

/**
 * Names visible at an offset, innermost last.
 *
 * Walks the declarations containing the offset rather than the whole file: a name is
 * in scope because of where it sits relative to the caret, and anything that does not
 * contain the caret cannot contribute.
 */
function scopeAt(files: readonly SourceFileNode[], file: string, offset: number): SymbolInfo[] {
  const found: SymbolInfo[] = []
  const conformance = collectConformance(files)

  for (const source of files) {
    for (const decl of source.declarations) {
      if (!contains(decl.span, file, offset)) continue
      collectScope(decl, file, offset, conformance, found)
    }
  }

  return found
}

function collectScope(
  decl: Decl,
  file: string,
  offset: number,
  conformance: ReturnType<typeof collectConformance>,
  out: SymbolInfo[],
): void {
  if (
    decl.kind === 'structDecl' ||
    decl.kind === 'enumDecl' ||
    decl.kind === 'protocolDecl' ||
    decl.kind === 'extensionDecl'
  ) {
    // Every member of the enclosing type is visible to every other, regardless of
    // order - and that includes members an extension or a protocol default supplied.
    const merged = conformance.types.get(decl.name)?.members ?? decl.members
    for (const member of merged) {
      const info = describeMember(member)
      if (info) out.push(info)
    }
    for (const member of decl.members) {
      if (contains(member.span, file, offset)) collectScope(member, file, offset, conformance, out)
    }
    return
  }

  if (decl.kind === 'funcDecl' || decl.kind === 'initDecl') {
    for (const param of decl.params) {
      out.push({
        name: param.internalName,
        kind: 'parameter',
        detail: renderType(param.type),
        span: param.span,
      })
    }
    if (decl.body) collectStatements(decl.body.statements, file, offset, conformance, out)
    return
  }

  if (decl.kind === 'varDecl' && decl.accessor) {
    collectStatements(decl.accessor.statements, file, offset, conformance, out)
  }
}

function collectStatements(
  statements: readonly Stmt[],
  file: string,
  offset: number,
  conformance: ReturnType<typeof collectConformance>,
  out: SymbolInfo[],
): void {
  for (const statement of statements) {
    // A `let` declared *after* the caret is not yet in scope, which is how Swift reads
    // a function body - unlike a type body, where order does not matter.
    if (statement.span.start > offset) break

    if (statement.kind === 'declStmt') {
      const info = describeDeclaration(statement.declaration)
      if (info) out.push(info)
      if (contains(statement.span, file, offset)) {
        collectScope(statement.declaration, file, offset, conformance, out)
      }
      continue
    }

    if (!contains(statement.span, file, offset)) continue

    switch (statement.kind) {
      case 'ifStmt':
        bindConditions(statement.conditions, out)
        collectStatements(statement.then.statements, file, offset, conformance, out)
        if (statement.else && statement.else.kind === 'block') {
          collectStatements(statement.else.statements, file, offset, conformance, out)
        } else if (statement.else) {
          collectStatements([statement.else], file, offset, conformance, out)
        }
        return
      case 'guardStmt':
        bindConditions(statement.conditions, out)
        collectStatements(statement.else.statements, file, offset, conformance, out)
        return
      case 'whileStmt':
        bindConditions(statement.conditions, out)
        collectStatements(statement.body.statements, file, offset, conformance, out)
        return
      case 'repeatStmt':
        collectStatements(statement.body.statements, file, offset, conformance, out)
        return
      case 'forInStmt':
        out.push({
          name: statement.variable,
          kind: 'local',
          detail: 'element',
          span: statement.variableSpan,
        })
        collectStatements(statement.body.statements, file, offset, conformance, out)
        return
      case 'switchStmt':
        for (const clause of statement.cases) {
          if (!contains(clause.span, file, offset)) continue
          for (const pattern of clause.patterns) {
            if (pattern.kind === 'binding') {
              out.push({ name: pattern.name, kind: 'local', detail: 'bound', span: pattern.span })
            } else if (pattern.kind === 'enumCase') {
              for (const binding of pattern.bindings) {
                if (binding.isWildcard) continue
                out.push({ name: binding.name, kind: 'local', detail: 'bound', span: binding.span })
              }
            }
          }
          collectStatements(clause.body.statements, file, offset, conformance, out)
        }
        return
      case 'doCatchStmt':
        collectStatements(statement.body.statements, file, offset, conformance, out)
        for (const clause of statement.catches) {
          if (!contains(clause.span, file, offset)) continue
          out.push({ name: clause.binding, kind: 'local', detail: 'Error', span: clause.span })
          collectStatements(clause.body.statements, file, offset, conformance, out)
        }
        return
      default:
        continue
    }
  }
}

function bindConditions(
  conditions: readonly { kind: string; name?: string; nameSpan?: SourceSpan }[],
  out: SymbolInfo[],
): void {
  for (const condition of conditions) {
    if (condition.kind === 'optionalBinding' && condition.name) {
      out.push({
        name: condition.name,
        kind: 'local',
        detail: 'unwrapped',
        span: condition.nameSpan,
      })
    }
  }
}

function describeMember(member: Decl): SymbolInfo | null {
  if (member.kind === 'varDecl') {
    const wrapper = member.attributes.find((a) => PROPERTY_WRAPPERS.has(a.name))?.name
    return {
      name: member.name,
      kind: 'property',
      detail: propertyDetail(member),
      span: member.nameSpan,
      doc: wrapper ? `@${wrapper}` : undefined,
    }
  }
  if (member.kind === 'funcDecl') {
    return {
      name: member.name,
      kind: 'method',
      detail: signatureOf(member),
      span: member.nameSpan,
      insert: callInsert(member.name, member.params.length > 0),
    }
  }
  return null
}

// ------------------------------------------------------------------ members of

/** The members of a named type, for completion after a `.`. */
function membersOfType(
  files: readonly SourceFileNode[],
  typeName: string,
): SymbolInfo[] | null {
  const conformance = collectConformance(files)
  const type = conformance.types.get(typeName)
  if (!type) return null

  const out: SymbolInfo[] = []

  if (type.decl?.kind === 'enumDecl') {
    for (const enumCase of type.decl.cases) {
      out.push({
        name: enumCase.name,
        kind: 'enumCase',
        detail: enumCase.associated.length > 0 ? `(${enumCase.associated.map(renderParam).join(', ')})` : 'case',
        span: enumCase.nameSpan,
        insert: callInsert(enumCase.name, enumCase.associated.length > 0),
      })
    }
  }

  for (const member of type.members) {
    const info = describeMember(member)
    if (info) out.push(info)
  }

  return out
}

/**
 * The declared type of a name in scope, when it has one.
 *
 * Only ever reads what was written - an annotation, or a constructor call on the
 * right of `=`. Inferring further needs the type checker, and a wrong type here sends
 * the member list for the wrong thing, which is exactly the failure this file exists
 * to avoid.
 */
function declaredTypeOf(files: readonly SourceFileNode[], file: string, offset: number, name: string): string | null {
  let found: string | null = null

  const consider = (decl: VarDecl): void => {
    if (decl.name !== name) return
    const annotated = renderType(decl.typeAnnotation)
    if (annotated) {
      found = annotated
      return
    }
    const init = decl.initializer
    if (init?.kind === 'call' && init.callee.kind === 'identifier') found = init.callee.name
  }

  const walkDecl = (decl: Decl): void => {
    if (decl.kind === 'varDecl') consider(decl)
    if (
      decl.kind === 'structDecl' ||
      decl.kind === 'enumDecl' ||
      decl.kind === 'protocolDecl' ||
      decl.kind === 'extensionDecl'
    ) {
      decl.members.forEach(walkDecl)
    }
    if ((decl.kind === 'funcDecl' || decl.kind === 'initDecl') && decl.body) {
      for (const statement of decl.body.statements) {
        if (statement.kind === 'declStmt') walkDecl(statement.declaration)
      }
      for (const param of decl.params) {
        if (param.internalName === name) found = renderType(param.type) || found
      }
    }
    if (decl.kind === 'varDecl' && decl.accessor) {
      for (const statement of decl.accessor.statements) {
        if (statement.kind === 'declStmt') walkDecl(statement.declaration)
      }
    }
  }

  for (const source of files) {
    for (const decl of source.declarations) {
      if (contains(decl.span, file, offset) || source.file === file) walkDecl(decl)
    }
  }

  return found
}

// ------------------------------------------------------------------ built-ins

function viewItems(): SymbolInfo[] {
  const out: SymbolInfo[] = []
  for (const name of SUPPORTED_VIEWS) {
    out.push({ name, kind: 'view', detail: 'View', insert: `${name}(` })
  }
  for (const name of UNIMPLEMENTED_VIEWS) {
    out.push({
      name,
      kind: 'view',
      detail: 'View',
      insert: `${name}(`,
      doc: 'Real SwiftUI the preview does not draw. Exports unchanged.',
    })
  }
  return out
}

function modifierItems(): SymbolInfo[] {
  const out: SymbolInfo[] = []
  for (const name of SUPPORTED_MODIFIERS) {
    out.push({ name, kind: 'modifier', detail: 'modifier', insert: `${name}(` })
  }
  for (const name of UNIMPLEMENTED_MODIFIERS) {
    out.push({
      name,
      kind: 'modifier',
      detail: 'modifier',
      insert: `${name}(`,
      doc: 'Recognised but not applied by the preview. Exports unchanged.',
    })
  }
  return out
}

function typeItems(): SymbolInfo[] {
  return [...KNOWN_TYPES].map((name) => ({ name, kind: 'type' as const, detail: 'type' }))
}

function attributeItems(): SymbolInfo[] {
  const out: SymbolInfo[] = []
  for (const [name, info] of PROPERTY_WRAPPERS) {
    out.push({
      name,
      kind: 'attribute',
      detail: 'property wrapper',
      doc: info.supported ? undefined : `Not supported in the preview yet (Phase ${info.phase}).`,
    })
  }
  for (const name of KNOWN_ATTRIBUTES) {
    out.push({ name, kind: 'attribute', detail: 'attribute' })
  }
  return out
}

// ----------------------------------------------------------------- completion

/**
 * Completions valid at an offset.
 *
 * The trigger decides everything, and there are only three that matter: a `.`, an
 * `@`, and ordinary identifier position. Getting the trigger wrong is what makes a
 * completion list feel random, so it is read from the text rather than guessed from
 * the tree - the tree at a half-typed caret is full of error nodes by design.
 */
export function completionsAt(
  files: readonly SourceFileNode[],
  file: string,
  text: string,
  offset: number,
): CompletionResult {
  const { from } = wordAt(text, offset)
  const before = previousMeaningful(text, from)

  // `@State`, `@ViewBuilder`.
  if (before?.ch === '@') {
    return { from, items: attributeItems() }
  }

  if (before?.ch === '.') {
    const receiver = receiverBefore(text, before.at)

    // `Tab.` or `store.` - a name we can resolve to a declared type.
    if (receiver) {
      const direct = membersOfType(files, receiver)
      if (direct) return { from, items: direct }

      const declared = declaredTypeOf(files, file, offset, receiver)
      const members = declared ? membersOfType(files, declared) : null
      if (members) return { from, items: [...members, ...modifierItems()] }
    }

    // Either contextual member syntax - `.largeTitle`, `.home` - or a receiver whose
    // type is not written down. Modifiers are the honest answer: they are valid after
    // any view, and inventing members for an unknown receiver is the one thing this
    // must not do.
    return { from, items: modifierItems() }
  }

  // Ordinary identifier position: everything in scope, then the project's own
  // declarations, then the built-ins. Order matters - the editor filters but keeps
  // the order it was given, and what the user just wrote is likelier than `Capsule`.
  const index = buildSymbolIndex(files)
  const items: SymbolInfo[] = [
    ...scopeAt(files, file, offset).reverse(),
    ...index.declarations.values(),
    ...viewItems(),
    ...typeItems(),
    ...STATEMENT_KEYWORDS.map((name) => ({ name, kind: 'keyword' as const, detail: 'keyword' })),
  ]

  return { from, items: dedupe(items) }
}

function dedupe(items: readonly SymbolInfo[]): SymbolInfo[] {
  const seen = new Set<string>()
  const out: SymbolInfo[] = []
  for (const item of items) {
    const key = `${item.kind}:${item.name}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

// --------------------------------------------------- definition, hover, rename

/**
 * The declaration the name at `offset` refers to.
 *
 * Resolved by name against the scope at that offset, innermost first - which is
 * shadowing, and the reason the scope list is ordered rather than a map.
 */
export function definitionAt(
  files: readonly SourceFileNode[],
  file: string,
  text: string,
  offset: number,
): SymbolInfo | null {
  const name = nameAt(text, offset)
  if (!name) return null

  const scope = scopeAt(files, file, offset)
  for (let i = scope.length - 1; i >= 0; i--) {
    const symbol = scope[i]!
    if (symbol.name === name && symbol.span) return symbol
  }

  const declared = buildSymbolIndex(files).declarations.get(name)
  if (declared?.span) return declared

  // An enum case: `.home` has no receiver, so every enum is a candidate and only an
  // unambiguous match is offered. Jumping to the wrong one is worse than not jumping.
  const matches = enumCasesNamed(files, name)
  return matches.length === 1 ? matches[0]! : null
}

/** What to show when hovering: the same symbol, plus built-ins that have no span. */
export function hoverAt(
  files: readonly SourceFileNode[],
  file: string,
  text: string,
  offset: number,
): SymbolInfo | null {
  const resolved = definitionAt(files, file, text, offset)
  if (resolved) return resolved

  const name = nameAt(text, offset)
  if (!name) return null

  if (SUPPORTED_VIEWS.has(name)) return { name, kind: 'view', detail: 'View' }
  if (UNIMPLEMENTED_VIEWS.has(name)) {
    return {
      name,
      kind: 'view',
      detail: 'View',
      doc: 'Real SwiftUI the preview does not draw. Exports to Xcode unchanged.',
    }
  }
  if (SUPPORTED_MODIFIERS.has(name)) return { name, kind: 'modifier', detail: 'modifier' }
  if (UNIMPLEMENTED_MODIFIERS.has(name)) {
    return {
      name,
      kind: 'modifier',
      detail: 'modifier',
      doc: 'Recognised but not applied by the preview. Exports to Xcode unchanged.',
    }
  }
  if (KNOWN_TYPES.has(name)) return { name, kind: 'type', detail: 'type' }
  return null
}

/**
 * Every occurrence of a name across the project, for rename.
 *
 * Matched on **identifier tokens**, not on text. The lexer already knows what is a
 * name and what is the inside of a string or a comment, so `count` in
 * `// the count so far` and in `"count: 3"` is excluded exactly rather than
 * heuristically - and those are the two places a textual rename quietly corrupts
 * something that does not show up as a compile error afterwards.
 *
 * What it still cannot do is tell two *different* symbols that share a spelling apart;
 * that needs the type checker. So it reports every occurrence and the caller says how
 * many, in how many files, before applying anything. Ambiguity the analyser cannot
 * resolve belongs to the user, and the way to hand it over is to state what will
 * change.
 */
export function referencesOf(
  files: readonly { readonly id: string; readonly text: string }[],
  name: string,
): SourceSpan[] {
  if (!name) return []

  const spans: SourceSpan[] = []

  const scan = (text: string, file: string, baseOffset: number): void => {
    for (const token of Lexer.tokenize(text, file, baseOffset).tokens) {
      // A string interpolation is *code* inside a literal, and the lexer keeps the
      // token stream flat - so the identifiers in `"total: \(count)"` are not in it.
      // Missing them leaves a rename half-applied and the file referring to a name
      // that no longer exists.
      if (token.kind === 'stringLiteral') {
        for (const segment of token.segments ?? []) {
          if (segment.kind === 'interpolation') scan(segment.value, file, segment.span.start)
        }
        continue
      }

      // `keyword` as well as `identifier`: a name may be one in some positions and the
      // other elsewhere - `some`, `any`, and every enum case named after a keyword.
      if (token.kind !== 'identifier' && token.kind !== 'keyword') continue
      if (token.text === name) spans.push(token.span)
    }
  }

  for (const file of files) scan(file.text, file.id, 0)
  return spans.sort((a, b) => a.start - b.start)
}

/** Every occurrence of the name at `offset`, within one file. */
export function referencesAt(text: string, offset: number, file: string): SourceSpan[] {
  const name = nameAt(text, offset)
  return name ? referencesOf([{ id: file, text }], name) : []
}

// ------------------------------------------------------------------- rename

/** The region a rename may touch, and the nested regions where the name means something else. */
interface RenameScope {
  /** Null for "the whole project" - a type, a global, a uniquely named member. */
  readonly within: SourceSpan | null
  /** Sub-scopes that redeclare the name, so the same text is a different symbol there. */
  readonly shadows: readonly SourceSpan[]
  /** True when the declaration is wrapped, so `$name` refers to it too. */
  readonly hasProjection: boolean
}

/** Every scope-bearing declaration containing `offset`, outermost first. */
function enclosingDeclarations(
  files: readonly SourceFileNode[],
  file: string,
  offset: number,
): Decl[] {
  const chain: Decl[] = []

  const walk = (decls: readonly Decl[]): void => {
    for (const decl of decls) {
      if (!contains(decl.span, file, offset)) continue
      chain.push(decl)
      if (
        decl.kind === 'structDecl' ||
        decl.kind === 'enumDecl' ||
        decl.kind === 'protocolDecl' ||
        decl.kind === 'extensionDecl'
      ) {
        walk(decl.members)
      }
      return
    }
  }

  for (const source of files) {
    if (source.file === file) walk(source.declarations)
  }
  return chain
}

/** The names a function, initialiser or accessor body introduces. Bodies, not blocks. */
function bodyDeclares(decl: Decl, name: string): boolean {
  if (decl.kind === 'funcDecl' || decl.kind === 'initDecl') {
    if (decl.params.some((p) => p.internalName === name || p.externalName === name)) return true
    return decl.body ? blockDeclares(decl.body.statements, name) : false
  }
  if (decl.kind === 'varDecl' && decl.accessor) return blockDeclares(decl.accessor.statements, name)
  return false
}

/**
 * Whether a name is bound anywhere inside a body.
 *
 * Deliberately coarse - the whole body, not the sub-block the binding sits in. Swift
 * scopes a `let` to the block that holds it, but a rename that treats the body as one
 * scope can only ever rename too much *within a single function the user is looking
 * at*, which is recoverable. Splitting hairs here risks the opposite error.
 */
function blockDeclares(statements: readonly Stmt[], name: string): boolean {
  for (const statement of statements) {
    switch (statement.kind) {
      case 'declStmt':
        if (statement.declaration.kind === 'varDecl' && statement.declaration.name === name) {
          return true
        }
        if (statement.declaration.kind === 'funcDecl' && statement.declaration.name === name) {
          return true
        }
        break
      case 'ifStmt':
        if (statement.conditions.some((c) => 'name' in c && c.name === name)) return true
        if (blockDeclares(statement.then.statements, name)) return true
        if (statement.else) {
          const otherwise = statement.else.kind === 'block' ? statement.else.statements : [statement.else]
          if (blockDeclares(otherwise, name)) return true
        }
        break
      case 'guardStmt':
        if (statement.conditions.some((c) => 'name' in c && c.name === name)) return true
        break
      case 'whileStmt':
        if (statement.conditions.some((c) => 'name' in c && c.name === name)) return true
        if (blockDeclares(statement.body.statements, name)) return true
        break
      case 'repeatStmt':
        if (blockDeclares(statement.body.statements, name)) return true
        break
      case 'forInStmt':
        if (statement.variable === name) return true
        if (blockDeclares(statement.body.statements, name)) return true
        break
      case 'switchStmt':
        for (const clause of statement.cases) {
          if (blockDeclares(clause.body.statements, name)) return true
        }
        break
      case 'doCatchStmt':
        if (blockDeclares(statement.body.statements, name)) return true
        for (const clause of statement.catches) {
          if (clause.binding === name) return true
          if (blockDeclares(clause.body.statements, name)) return true
        }
        break
      default:
        break
    }
  }
  return false
}

/** Every member name a type declares, across the whole project. */
function typesDeclaringMember(files: readonly SourceFileNode[], name: string): string[] {
  const owners: string[] = []

  const consider = (decl: Decl): void => {
    if (
      decl.kind !== 'structDecl' &&
      decl.kind !== 'enumDecl' &&
      decl.kind !== 'protocolDecl' &&
      decl.kind !== 'extensionDecl'
    ) {
      return
    }
    const declares = decl.members.some(
      (m) =>
        (m.kind === 'varDecl' && m.name === name) || (m.kind === 'funcDecl' && m.name === name),
    )
    if (declares && !owners.includes(decl.name)) owners.push(decl.name)
  }

  for (const file of files) for (const decl of file.declarations) consider(decl)
  return owners
}

/**
 * Where renaming the symbol at `offset` is safe.
 *
 * A textual project-wide sweep is wrong in two directions at once, and both were
 * reachable in a few lines of ordinary code: it renamed unrelated locals that merely
 * shared a name, and it renamed one type's member on every other type that happened
 * to declare the same one. What follows is the smallest thing that is actually true -
 * resolve the name to the declaration it binds to, and search only that declaration's
 * own region.
 */
function renameScope(
  files: readonly SourceFileNode[],
  file: string,
  offset: number,
  name: string,
): RenameScope {
  const chain = enclosingDeclarations(files, file, offset)

  // Innermost first: the nearest declaration that binds the name owns it.
  for (let i = chain.length - 1; i >= 0; i--) {
    const decl = chain[i]!

    if (bodyDeclares(decl, name)) {
      // A local or a parameter. Its scope is this body, minus any nested body that
      // binds the name again.
      const shadows: SourceSpan[] = []
      if (decl.kind === 'funcDecl' || decl.kind === 'initDecl' || decl.kind === 'varDecl') {
        for (let j = i + 1; j < chain.length; j++) {
          const inner = chain[j]!
          if (inner !== decl && bodyDeclares(inner, name)) shadows.push(inner.span)
        }
      }
      return { within: decl.span, shadows, hasProjection: false }
    }

    const isTypeLike =
      decl.kind === 'structDecl' ||
      decl.kind === 'enumDecl' ||
      decl.kind === 'protocolDecl' ||
      decl.kind === 'extensionDecl'

    if (isTypeLike) {
      const member = decl.members.find(
        (m): m is VarDecl | FuncDecl =>
          (m.kind === 'varDecl' && m.name === name) || (m.kind === 'funcDecl' && m.name === name),
      )
      if (!member) continue

      // `@State private var draft` is also reachable as `$draft`, and a rename that
      // leaves the projection behind produces a file that refers to a name which no
      // longer exists - the exact failure a rename is supposed to prevent.
      const hasProjection =
        member.kind === 'varDecl' && member.attributes.some((a) => PROPERTY_WRAPPERS.has(a.name))

      // A member name only one type declares can be followed anywhere. One that
      // several declare cannot be told apart without type information, so the rename
      // stays inside the type that declared this one.
      const owners = typesDeclaringMember(files, name)
      const within = owners.length > 1 ? decl.span : null

      // Members are shadowed by locals of the same name inside the type's own methods.
      const shadows: SourceSpan[] = []
      for (const other of decl.members) {
        if (other !== member && bodyDeclares(other, name)) shadows.push(other.span)
      }

      return { within, shadows, hasProjection }
    }
  }

  // Nothing enclosing binds it: a type, a global function or a global variable, all
  // of which are visible to the whole project.
  return { within: null, shadows: [], hasProjection: false }
}

/**
 * Every occurrence of the symbol at `offset`, scoped to where it actually means that.
 *
 * Returns the empty list when the caret is not on a name, which the caller reads as
 * "nothing to rename".
 */
export function renameSpansAt(
  parsed: readonly SourceFileNode[],
  files: readonly { readonly id: string; readonly text: string }[],
  fileId: string,
  offset: number,
): { readonly name: string; readonly spans: readonly SourceSpan[] } {
  const text = files.find((f) => f.id === fileId)?.text ?? ''
  const raw = nameAt(text, offset)
  if (!raw) return { name: '', spans: [] }

  // Renaming from `$draft` renames `draft`; the projection follows the property.
  const name = raw.startsWith('$') ? raw.slice(1) : raw
  if (!name) return { name: '', spans: [] }

  const scope = renameScope(parsed, fileId, offset, name)
  const inScope = (span: SourceSpan): boolean => {
    if (scope.within && (span.file !== scope.within.file || span.start < scope.within.start || span.end > scope.within.end)) {
      return false
    }
    return !scope.shadows.some(
      (s) => s.file === span.file && span.start >= s.start && span.end <= s.end,
    )
  }

  const spans = referencesOf(files, name).filter(inScope)
  if (!scope.hasProjection) return { name, spans }

  const projections = referencesOf(files, `$${name}`)
    .filter(inScope)
    // The caller replaces the span's text with the new name, so the `$` must stay put.
    .map((span) => ({ ...span, start: span.start + 1 }))

  return { name, spans: [...spans, ...projections].sort((a, b) => a.start - b.start) }
}

/** The whole identifier the caret sits in or beside. */
export function nameAt(text: string, offset: number): string | null {
  let start = offset
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1]!)) start--
  let end = offset
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end]!)) end++
  const word = text.slice(start, end)
  return word.length > 0 && /^[A-Za-z_$]/.test(word) ? word : null
}

function enumCasesNamed(files: readonly SourceFileNode[], name: string): SymbolInfo[] {
  const out: SymbolInfo[] = []
  for (const file of files) {
    for (const decl of file.declarations) {
      if (decl.kind !== 'enumDecl') continue
      for (const enumCase of decl.cases) {
        if (enumCase.name === name) {
          out.push({
            name,
            kind: 'enumCase',
            detail: `${decl.name}.${name}`,
            span: enumCase.nameSpan,
          })
        }
      }
    }
  }
  return out
}

export type { EnumDecl, FuncDecl, StructDecl }
