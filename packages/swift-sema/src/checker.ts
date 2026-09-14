import type { Diagnostic, DiagnosticCode, FixIt, SourceSpan } from '@studio/shared'
import type {
  Block,
  ConformanceModel,
  Condition,
  Decl,
  EnumDecl,
  Expr,
  ExtensionDecl,
  Pattern,
  ProtocolDecl,
  SourceFileNode,
  Stmt,
  StructDecl,
  TypeRef,
  VarDecl,
} from '@studio/swift-syntax'
import { collectConformance } from '@studio/swift-syntax'
import {
  isKnownGlobal,
  isKnownModifier,
  KNOWN_ATTRIBUTES,
  KNOWN_TYPES,
  PROPERTY_WRAPPERS,
  SUPPORTED_VIEWS,
  UNIMPLEMENTED_MODIFIERS,
  UNIMPLEMENTED_VIEWS,
} from './builtins'
import { Scope, type PropertyInfo, type SemanticModel, type TypeInfo } from './model'

/**
 * Semantic analysis for the supported subset.
 *
 * Scoped by one rule above all others, from Phase 1 gate 4: **a false positive is
 * worse than a missed error.** A spurious red squiggle on correct code destroys
 * trust in every other diagnostic, while a missed one costs nothing here — the
 * export still carries the user's exact source to a real compiler that will catch it.
 *
 * In practice that means this checker reports only what it is certain about:
 *
 * - an identifier that resolves nowhere at all (error)
 * - a real SwiftUI view or modifier that the preview cannot draw yet (warning)
 * - a property wrapper outside the slice (warning)
 * - entry-point problems (error)
 *
 * It deliberately does *not* check member existence, argument types, or arity.
 * Those need the real type checker, which arrives with the interpreter in Phase 2 —
 * guessing at them now would produce exactly the false positives the gate forbids.
 */
export class Checker {
  private readonly diagnostics: Diagnostic[] = []
  private readonly types = new Map<string, TypeInfo>()
  /** Enum declarations, kept apart from types because they have cases rather than properties. */
  private readonly enums = new Map<string, EnumDecl>()
  private readonly protocols = new Map<string, ProtocolDecl>()
  /**
   * Every type-parameter name declared anywhere: generic parameters and associated
   * types alike.
   *
   * Not scoped to the declaration that introduced it, deliberately. Scoping it
   * properly needs to know which declaration a use site belongs to, and getting that
   * wrong reports "unknown type 'T'" on correct code — a false positive, which costs
   * more than the missed error of accepting `T` in a function that never declared it.
   */
  private readonly typeParameterNames = new Set<string>()
  /** Non-zero while checking the body of an extension on a type the preview owns. */
  private inViewExtension = 0
  /** Extension and protocol-default members, merged per type. Shared with the interpreter. */
  private conformance: ConformanceModel = collectConformance([])
  private readonly globalScope = new Scope()
  /** Non-zero inside a closure, where `$0` shorthand is legal. */
  private closureDepth = 0

  static check(files: readonly SourceFileNode[]): SemanticModel {
    return new Checker().run(files)
  }

  private run(files: readonly SourceFileNode[]): SemanticModel {
    // Pass 1: collect every module-level type before checking any body, so that
    // declaration order does not matter — `ContentView()` may appear above its own
    // declaration, as it does in the reference app.
    //
    // The conformance merge runs first because `describeStruct` needs it: after
    // `extension` exists, a declaration no longer knows all of its own members, and
    // the "does this View have a body?" check reads that merged list.
    this.conformance = collectConformance(files)
    for (const file of files) this.collectDeclarations(file)

    const entryPoint = this.resolveEntryPoint(files)

    // Pass 2: resolve bodies.
    for (const file of files) {
      for (const decl of file.declarations) this.checkDeclaration(decl, this.globalScope)
    }

    return { types: this.types, entryPoint, diagnostics: this.diagnostics }
  }

  // ------------------------------------------------------------- collection

  private collectDeclarations(file: SourceFileNode): void {
    for (const decl of file.declarations) {
      this.collectTypeParameters(decl)
      if (decl.kind === 'structDecl') {
        const info = this.describeStruct(decl)
        if (this.types.has(info.name)) {
          this.report(
            decl.nameSpan,
            'error',
            'unresolved_identifier',
            `Invalid redeclaration of '${info.name}'.`,
          )
        }
        this.types.set(info.name, info)
        this.globalScope.declare({ name: info.name, kind: 'type', span: decl.nameSpan })
      } else if (decl.kind === 'enumDecl') {
        if (this.types.has(decl.name) || this.enums.has(decl.name)) {
          this.report(
            decl.nameSpan,
            'error',
            'unresolved_identifier',
            `Invalid redeclaration of '${decl.name}'.`,
          )
        }
        this.enums.set(decl.name, decl)
        this.globalScope.declare({ name: decl.name, kind: 'type', span: decl.nameSpan })
      } else if (decl.kind === 'protocolDecl') {
        this.protocols.set(decl.name, decl)
        this.globalScope.declare({ name: decl.name, kind: 'type', span: decl.nameSpan })
        // Collected in pass 1, not while checking the protocol's own body: a type
        // annotation naming `Item` may be checked before the protocol that declares
        // it is reached, and order must not decide whether a name resolves.
        for (const associated of decl.associatedTypes) {
          this.typeParameterNames.add(associated.name)
        }
      } else if (decl.kind === 'funcDecl') {
        this.globalScope.declare({ name: decl.name, kind: 'function', span: decl.nameSpan })
      } else if (decl.kind === 'varDecl') {
        this.globalScope.declare({ name: decl.name, kind: 'local', span: decl.nameSpan })
      }
    }
  }

  /**
   * Records `<T>` from a declaration and from every member of it.
   *
   * Walked rather than handled at each declaration site because a generic method on a
   * non-generic type — `func map<U>(…)` inside `struct Box` — is the common case, and
   * its `U` must resolve just as the type's own parameters do.
   */
  private collectTypeParameters(decl: Decl): void {
    if (decl.kind === 'structDecl' || decl.kind === 'enumDecl' || decl.kind === 'funcDecl') {
      for (const generic of decl.generics) this.typeParameterNames.add(generic.name)
    }

    if (
      decl.kind === 'structDecl' ||
      decl.kind === 'enumDecl' ||
      decl.kind === 'protocolDecl' ||
      decl.kind === 'extensionDecl'
    ) {
      for (const member of decl.members) this.collectTypeParameters(member)
    }
  }

  private describeStruct(decl: StructDecl): TypeInfo {
    // The merged list, not `decl.members`: `var body` may be supplied by an extension
    // or inherited from a protocol default, and reporting "add a body" for a View that
    // has one in an extension is exactly the false positive gate 4 forbids.
    const members = this.conformance.types.get(decl.name)?.members ?? decl.members
    const properties: PropertyInfo[] = []
    const methods = members.filter(
      (m): m is Extract<Decl, { kind: 'funcDecl' }> => m.kind === 'funcDecl',
    )

    for (const member of members) {
      if (member.kind !== 'varDecl') continue
      properties.push({
        name: member.name,
        decl: member,
        propertyWrapper: propertyWrapperOf(member),
        isComputed: member.accessor !== null,
        isLet: member.isLet,
      })
    }

    const merged = this.conformance.types.get(decl.name)?.conformances
    const conformances = merged ? [...merged] : decl.inherits.map((t) => t.name)
    return {
      name: decl.name,
      decl,
      properties,
      methods,
      conformances,
      isView: conformances.includes('View'),
      isApp: conformances.includes('App'),
    }
  }

  private resolveEntryPoint(files: readonly SourceFileNode[]): TypeInfo | null {
    const mains: StructDecl[] = []
    for (const file of files) {
      for (const decl of file.declarations) {
        if (decl.kind === 'structDecl' && decl.attributes.some((a) => a.name === 'main')) {
          mains.push(decl)
        }
      }
    }

    if (mains.length === 0) {
      const anchor = files[0]
      if (anchor) {
        this.report(
          { file: anchor.file, start: 0, end: 0 },
          'error',
          'no_entry_point',
          "This project has no entry point. Add '@main' to a struct that conforms to 'App'.",
        )
      }
      return null
    }

    if (mains.length > 1) {
      for (const extra of mains.slice(1)) {
        this.report(
          extra.nameSpan,
          'error',
          'duplicate_entry_point',
          `'@main' attribute cannot be used in a module that contains more than one entry point. ` +
            `'${mains[0]!.name}' is already the entry point.`,
        )
      }
    }

    const main = mains[0]!
    const info = this.types.get(main.name) ?? null

    if (info && !info.isApp) {
      this.report(
        main.nameSpan,
        'error',
        'not_conformant',
        `'@main' type '${main.name}' must conform to 'App'.`,
      )
    }

    return info
  }

  // ------------------------------------------------------------ declarations

  private checkDeclaration(decl: Decl, scope: Scope): void {
    switch (decl.kind) {
      case 'structDecl':
        this.checkStruct(decl)
        return

      case 'protocolDecl':
      case 'extensionDecl':
        this.checkTypeBody(decl)
        return

      case 'funcDecl': {
        this.checkAttributes(decl.attributes)
        const inner = scope.child()
        for (const param of decl.params) {
          inner.declare({ name: param.internalName, kind: 'parameter', span: param.span })
          if (param.type) this.checkType(param.type)
          if (param.defaultValue) this.checkExpression(param.defaultValue, scope)
        }
        if (decl.returnType) this.checkType(decl.returnType)
        if (decl.body) this.checkBlock(decl.body, inner)
        return
      }

      case 'initDecl': {
        const inner = scope.child()
        for (const param of decl.params) {
          inner.declare({ name: param.internalName, kind: 'parameter', span: param.span })
          if (param.type) this.checkType(param.type)
        }
        if (decl.body) this.checkBlock(decl.body, inner)
        return
      }

      case 'varDecl':
        this.checkAttributes(decl.attributes)
        this.checkPropertyWrapper(decl)
        if (decl.typeAnnotation) this.checkType(decl.typeAnnotation)
        if (decl.initializer) this.checkExpression(decl.initializer, scope)
        if (decl.accessor) this.checkBlock(decl.accessor, scope.child())
        return

      case 'importDecl':
      case 'unsupportedDecl':
      case 'errorDecl':
        return
    }
  }

  private checkStruct(decl: StructDecl): void {
    const info = this.types.get(decl.name)

    if (info?.isView && !info.properties.some((p) => p.name === 'body')) {
      // Inserted just before the type's closing brace. Anchoring to the *end* of the
      // span needs no source text and cannot land inside another declaration, which
      // anchoring to the first `{` would risk when the body is written on one line.
      const close = decl.span.end - 1
      this.report(
        decl.nameSpan,
        'error',
        'not_conformant',
        `Type '${decl.name}' does not conform to protocol 'View'. Add a 'body' property.`,
        undefined,
        [
          {
            title: "Add a 'body' property",
            edits: [
              {
                span: { file: decl.span.file, start: close, end: close },
                newText:
                  '\n    var body: some View {\n        Text("Hello")\n    }\n',
              },
            ],
          },
        ],
      )
    }

    this.checkTypeBody(decl)
  }

  /**
   * Checks the members of a type, protocol or extension body.
   *
   * The scope is seeded from the *merged* member list, so a method written in one
   * extension can call one written in another — which is the whole reason people
   * split a type across extensions. Falling back to the body's own members keeps a
   * protocol body working, since a protocol contributes to conformers rather than
   * having merged members of its own.
   */
  private checkTypeBody(decl: StructDecl | ProtocolDecl | ExtensionDecl): void {
    this.checkAttributes(decl.attributes)

    // `extension View` and `extension Text` extend something the preview owns, so
    // `self` inside is a view rather than a declared type.
    const extendsAView =
      decl.kind === 'extensionDecl' && !this.types.has(decl.name) && !this.enums.has(decl.name)
    if (extendsAView) this.inViewExtension++
    try {
      this.checkTypeMembers(decl)
    } finally {
      if (extendsAView) this.inViewExtension--
    }
  }

  private checkTypeMembers(decl: StructDecl | ProtocolDecl | ExtensionDecl): void {

    const scope = this.globalScope.child()
    const visible = this.conformance.types.get(decl.name)?.members ?? decl.members
    const seen = new Set<string>()

    // Every member is visible to every other member, regardless of order.
    for (const member of [...visible, ...decl.members]) {
      if (member.kind === 'varDecl') {
        if (seen.has(member.name)) continue
        seen.add(member.name)
        scope.declare({ name: member.name, kind: 'property', span: member.nameSpan })
        // `@State var count` also exposes the projection `$count`.
        if (propertyWrapperOf(member)) {
          scope.declare({ name: `$${member.name}`, kind: 'property', span: member.nameSpan })
        }
      } else if (member.kind === 'funcDecl') {
        scope.declare({ name: member.name, kind: 'function', span: member.nameSpan })
      }
    }

    // An associated type is a name that only exists inside the protocol body.
    if (decl.kind === 'protocolDecl') {
      for (const associated of decl.associatedTypes) {
        scope.declare({ name: associated.name, kind: 'type', span: associated.nameSpan })
      }
    }

    for (const member of decl.members) this.checkDeclaration(member, scope)
  }

  private checkAttributes(attributes: readonly { name: string; span: SourceSpan }[]): void {
    for (const attribute of attributes) {
      if (KNOWN_ATTRIBUTES.has(attribute.name) || PROPERTY_WRAPPERS.has(attribute.name)) continue
      this.report(
        attribute.span,
        'warning',
        'unsupported_language_feature',
        `The preview does not recognise the attribute '@${attribute.name}'. It is ignored here and exported unchanged.`,
        `@${attribute.name}`,
      )
    }
  }

  private checkPropertyWrapper(decl: VarDecl): void {
    const wrapper = propertyWrapperOf(decl)
    if (!wrapper) return

    const info = PROPERTY_WRAPPERS.get(wrapper)
    if (!info || info.supported) return

    this.report(
      decl.attributes.find((a) => a.name === wrapper)?.span ?? decl.nameSpan,
      'warning',
      'unsupported_language_feature',
      `'@${wrapper}' is not supported in the preview yet (arriving in Phase ${info.phase}). ` +
        'The property still exports to Xcode unchanged.',
      `@${wrapper}`,
    )
  }

  private checkType(type: TypeRef): void {
    switch (type.kind) {
      case 'namedType': {
        const base = type.name.split('.')[0]!
        // Unknown types are reported as *warnings*, never errors. The known-type
        // list is necessarily incomplete, so an error here would eventually fire on
        // valid code — precisely the false positive gate 4 forbids.
        if (
          !KNOWN_TYPES.has(base) &&
          !this.types.has(base) &&
          !this.enums.has(base) &&
          !this.protocols.has(base) &&
          !this.typeParameterNames.has(base) &&
          !isKnownGlobal(base)
        ) {
          this.report(
            type.span,
            'warning',
            'unresolved_identifier',
            `The preview does not know the type '${type.name}'. It is exported unchanged.`,
          )
        }
        type.generics.forEach((g) => this.checkType(g))
        return
      }
      case 'optionalType':
        this.checkType(type.wrapped)
        return
      case 'arrayType':
        this.checkType(type.element)
        return
      case 'dictionaryType':
        this.checkType(type.key)
        this.checkType(type.value)
        return
      case 'someType':
        this.checkType(type.constraint)
        return
      case 'functionType':
        type.params.forEach((p) => this.checkType(p))
        this.checkType(type.result)
        return
      case 'tupleType':
        type.elements.forEach((e) => this.checkType(e))
        return
      case 'errorType':
        return
    }
  }

  // -------------------------------------------------------------- statements

  private checkBlock(block: Block, scope: Scope): void {
    // A fresh scope per block, and declarations land in it as they are reached, so
    // a `let` is not visible above its own declaration.
    for (const statement of block.statements) this.checkStatement(statement, scope)
  }

  private checkStatement(statement: Stmt, scope: Scope): void {
    switch (statement.kind) {
      case 'exprStmt':
        this.checkExpression(statement.expression, scope)
        return

      case 'declStmt': {
        const decl = statement.declaration
        this.checkDeclaration(decl, scope)
        if (decl.kind === 'varDecl') {
          scope.declare({ name: decl.name, kind: 'local', span: decl.nameSpan })
        } else if (decl.kind === 'funcDecl') {
          scope.declare({ name: decl.name, kind: 'function', span: decl.nameSpan })
        } else if (decl.kind === 'structDecl' || decl.kind === 'enumDecl') {
          scope.declare({ name: decl.name, kind: 'type', span: decl.nameSpan })
        }
        return
      }

      case 'ifStmt': {
        // Bindings introduced by the conditions are visible in the body and nowhere
        // else, which is exactly what a child scope expresses.
        const taken = scope.child()
        this.checkConditions(statement.conditions, taken)
        this.checkBlock(statement.then, taken)
        if (statement.else) {
          if (statement.else.kind === 'block') this.checkBlock(statement.else, scope.child())
          else this.checkStatement(statement.else, scope)
        }
        return
      }

      case 'guardStmt':
        // A guard's bindings escape into the enclosing scope — that is its purpose —
        // so they are declared in `scope` rather than in a child of it.
        this.checkConditions(statement.conditions, scope)
        this.checkBlock(statement.else, scope.child())
        return

      case 'whileStmt': {
        const inner = scope.child()
        this.checkConditions(statement.conditions, inner)
        this.checkBlock(statement.body, inner)
        return
      }

      case 'repeatStmt':
        this.checkBlock(statement.body, scope.child())
        this.checkExpression(statement.condition, scope)
        return

      case 'switchStmt': {
        this.checkExpression(statement.subject, scope)
        for (const branch of statement.cases) {
          const inner = scope.child()
          for (const pattern of branch.patterns) this.checkPattern(pattern, inner)
          if (branch.where) this.checkExpression(branch.where, inner)
          this.checkBlock(branch.body, inner)
        }
        return
      }

      case 'forInStmt': {
        this.checkExpression(statement.sequence, scope)
        const inner = scope.child()
        if (statement.variable) {
          inner.declare({ name: statement.variable, kind: 'local', span: statement.variableSpan })
        }
        if (statement.where) this.checkExpression(statement.where, inner)
        this.checkBlock(statement.body, inner)
        return
      }

      case 'returnStmt':
        if (statement.value) this.checkExpression(statement.value, scope)
        return

      case 'breakStmt':
      case 'continueStmt':
      case 'unsupportedStmt':
      case 'errorStmt':
        return
    }
  }

  /** Checks a condition list, declaring whatever it binds into `scope`. */
  private checkConditions(conditions: readonly Condition[], scope: Scope): void {
    for (const condition of conditions) {
      if (condition.kind === 'expr') {
        this.checkExpression(condition.expr, scope)
        continue
      }
      if (condition.kind === 'optionalBinding') {
        this.checkExpression(condition.value, scope)
        scope.declare({ name: condition.name, kind: 'local', span: condition.nameSpan })
        continue
      }
      this.checkExpression(condition.value, scope)
      this.checkPattern(condition.pattern, scope)
    }
  }

  /**
   * Declares the names a pattern binds.
   *
   * Case *names* are deliberately not resolved: doing so needs the subject's type,
   * and guessing would report a false "no such case" on correct code — the one thing
   * this checker must never do.
   */
  private checkPattern(pattern: Pattern, scope: Scope): void {
    switch (pattern.kind) {
      case 'binding':
        scope.declare({ name: pattern.name, kind: 'local', span: pattern.span })
        return
      case 'enumCase':
        for (const binding of pattern.bindings) {
          if (!binding.isWildcard) {
            scope.declare({ name: binding.name, kind: 'local', span: binding.span })
          }
        }
        return
      case 'value':
      case 'range':
        this.checkExpression(pattern.value, scope)
        return
      case 'wildcard':
        return
    }
  }

  // ------------------------------------------------------------- expressions

  private checkExpression(expr: Expr, scope: Scope): void {
    switch (expr.kind) {
      case 'identifier':
        this.checkIdentifier(expr.name, expr.span, scope)
        return

      case 'call': {
        this.checkCallee(expr.callee, scope)
        // A modifier is always *called*, so the coverage check belongs here rather
        // than on every member access. Doing it there flagged `Color.accentColor` as
        // the `.accentColor` modifier — a warning on correct code, which is the one
        // thing this checker must never produce.
        if (expr.callee.kind === 'memberAccess') {
          this.checkModifierCoverage(expr.callee.member, expr.callee.memberSpan)
        }
        for (const arg of expr.args) this.checkExpression(arg.value, scope)
        if (expr.trailingClosure) this.checkExpression(expr.trailingClosure, scope)
        return
      }

      case 'memberAccess':
        // Only the base is resolved. Member existence needs real type information,
        // and guessing produces false positives — see the class comment.
        if (expr.base) this.checkExpression(expr.base, scope)
        return

      case 'closure': {
        const inner = scope.child()
        for (const param of expr.params) {
          inner.declare({ name: param.name, kind: 'parameter', span: param.span })
          if (param.type) this.checkType(param.type)
        }
        this.closureDepth++
        this.checkBlock(expr.body, inner)
        this.closureDepth--
        return
      }

      case 'stringLiteral':
        for (const segment of expr.segments) {
          if (segment.kind === 'interpolation') this.checkExpression(segment.expression, scope)
        }
        return

      case 'arrayLiteral':
        expr.elements.forEach((e) => this.checkExpression(e, scope))
        return

      case 'dictionaryLiteral':
        expr.entries.forEach((e) => {
          this.checkExpression(e.key, scope)
          this.checkExpression(e.value, scope)
        })
        return

      case 'binary':
        this.checkExpression(expr.left, scope)
        // The right side of `is`/`as` is a type name synthesised as an identifier.
        if (expr.operator !== 'is' && expr.operator !== 'as') {
          this.checkExpression(expr.right, scope)
        }
        return

      case 'assign':
        this.checkExpression(expr.target, scope)
        this.checkExpression(expr.value, scope)
        return

      case 'ternary':
        this.checkExpression(expr.condition, scope)
        this.checkExpression(expr.then, scope)
        this.checkExpression(expr.else, scope)
        return

      case 'unary':
      case 'forceUnwrap':
      case 'optionalChain':
        this.checkExpression(expr.operand, scope)
        return

      case 'subscript':
        this.checkExpression(expr.base, scope)
        expr.args.forEach((a) => this.checkExpression(a.value, scope))
        return

      case 'tuple':
        expr.elements.forEach((e) => this.checkExpression(e, scope))
        return

      case 'integerLiteral':
      case 'floatLiteral':
      case 'booleanLiteral':
      case 'nilLiteral':
      case 'selfExpr':
      case 'errorExpr':
        return
    }
  }

  /** A callee gets view-coverage treatment before ordinary resolution. */
  private checkCallee(callee: Expr, scope: Scope): void {
    if (callee.kind === 'identifier') {
      const phase = UNIMPLEMENTED_VIEWS.get(callee.name)
      if (phase !== undefined && !scope.has(callee.name)) {
        this.report(
          callee.span,
          'warning',
          'unsupported_swiftui_view',
          `'${callee.name}' is not drawn by the preview yet (arriving in Phase ${phase}). ` +
            'It is exported to Xcode unchanged.',
          callee.name,
        )
        return
      }
    }
    this.checkExpression(callee, scope)
  }

  private checkIdentifier(name: string, span: SourceSpan, scope: Scope): void {
    if (scope.has(name)) return
    if (isKnownGlobal(name)) return
    if (this.types.has(name)) return

    // Inside `extension View`, `self` is a view, so an unqualified `modifier(…)` or
    // `padding(…)` is a call on it — the idiom the whole extension exists for. The
    // checker has no receiver type to confirm that with, and reporting it would put a
    // red error on the most common way to write a reusable modifier.
    if (this.inViewExtension > 0 && isKnownModifier(name)) return

    // `$0`-style closure shorthand.
    if (this.closureDepth > 0 && /^\$\d+$/.test(name)) return

    // A projection like `$count` resolves through its backing property.
    if (name.startsWith('$') && scope.has(name.slice(1))) return

    // `_` is the wildcard pattern, never a reference.
    if (name === '_' || name === '') return

    const phase = UNIMPLEMENTED_VIEWS.get(name)
    if (phase !== undefined) {
      this.report(
        span,
        'warning',
        'unsupported_swiftui_view',
        `'${name}' is not drawn by the preview yet (arriving in Phase ${phase}).`,
        name,
      )
      return
    }

    const suggestion = this.closestName(name, scope)
    this.report(
      span,
      'error',
      'unresolved_identifier',
      suggestion ? `Cannot find '${name}' in scope. Did you mean '${suggestion}'?` : `Cannot find '${name}' in scope.`,
      undefined,
      suggestion ? [{ title: `Replace with '${suggestion}'`, edits: [{ span, newText: suggestion }] }] : undefined,
    )
  }

  /**
   * The nearest name that is actually in scope, or null.
   *
   * Offered only when the edit distance is small relative to the name's length, so a
   * three-letter typo does not suggest an unrelated three-letter name. A fix the user
   * has to undo costs more than no fix, which is the same rule the rest of this file
   * follows.
   */
  private closestName(name: string, scope: Scope): string | null {
    const budget = name.length <= 4 ? 1 : 2
    let best: string | null = null
    let bestDistance = budget + 1

    const consider = (candidate: string): void => {
      if (candidate === name || Math.abs(candidate.length - name.length) > budget) return
      const distance = editDistance(name.toLowerCase(), candidate.toLowerCase())
      if (distance < bestDistance) {
        bestDistance = distance
        best = candidate
      }
    }

    for (const candidate of scope.allNames()) consider(candidate)
    for (const candidate of this.types.keys()) consider(candidate)
    for (const candidate of this.enums.keys()) consider(candidate)
    for (const candidate of SUPPORTED_VIEWS) consider(candidate)

    return bestDistance <= budget ? best : null
  }

  /**
   * Warns when a chain uses a real SwiftUI modifier the preview does not apply.
   *
   * Only names in the unimplemented map produce a warning, and only where the member
   * was called. An unrecognised member is passed over in silence, because `Color.red`
   * and `.largeTitle` are member accesses too and there is no type information yet to
   * tell them apart from a modifier.
   */
  private checkModifierCoverage(member: string, span: SourceSpan): void {
    const phase = UNIMPLEMENTED_MODIFIERS.get(member)
    if (phase === undefined) return

    this.report(
      span,
      'warning',
      'unsupported_swiftui_modifier',
      `'.${member}' is not applied by the preview yet (arriving in Phase ${phase}). ` +
        'It is exported to Xcode unchanged.',
      `.${member}`,
    )
  }

  // ------------------------------------------------------------------ output

  private report(
    span: SourceSpan,
    severity: Diagnostic['severity'],
    code: DiagnosticCode,
    message: string,
    feature?: string,
    fixIts?: readonly FixIt[],
  ): void {
    // Coverage warnings repeat constantly — `.padding()` appears six times in the
    // reference app. Report each feature once per span so the panel stays readable.
    const duplicate = this.diagnostics.some(
      (d) => d.span.start === span.start && d.span.end === span.end && d.code === code,
    )
    if (duplicate) return
    this.diagnostics.push({
      span,
      severity,
      code,
      message,
      ...(feature ? { feature } : {}),
      ...(fixIts && fixIts.length > 0 ? { fixIts } : {}),
    })
  }
}

/**
 * Levenshtein distance, bounded by the lengths involved.
 *
 * Used only to decide whether a typo is close enough to suggest a replacement, so the
 * classic two-row implementation is more than fast enough: the candidate list is a
 * scope, not a dictionary.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)

  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j]! + 1,
        current[j - 1]! + 1,
        previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      )
    }
    previous = current
  }

  return previous[b.length]!
}

function propertyWrapperOf(decl: VarDecl): string | null {
  for (const attribute of decl.attributes) {
    if (PROPERTY_WRAPPERS.has(attribute.name)) return attribute.name
  }
  return null
}

/** Convenience for the common single-file case. */
export function checkSourceFiles(files: readonly SourceFileNode[]): SemanticModel {
  return Checker.check(files)
}

export { SUPPORTED_VIEWS }
