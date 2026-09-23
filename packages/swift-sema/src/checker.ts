import type { Diagnostic, DiagnosticCode, FixIt, SourceSpan } from '@studio/shared'
import { SYMBOL_MAP, symbolDefinition } from '@studio/shared'
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
import { collectConformance, hoistNestedTypes } from '@studio/swift-syntax'
import {
  isKnownGlobal,
  isKnownModifier,
  isViewRoot,
  EXTENSIBLE_BUILTIN_TYPES,
  KNOWN_ATTRIBUTES,
  KNOWN_COLOR_NAMES,
  KNOWN_TYPES,
  SWIFTUI_COLOR_NAMES,
  UIKIT_COLOR_NAMES,
  MODIFIER_LABELS,
  NON_MODIFIER_MEMBERS,
  PROPERTY_WRAPPERS,
  SUPPORTED_MODIFIERS,
  SUPPORTED_VIEWS,
  BLEND_MODES,
  STYLE_TOKENS,
  UNIMPLEMENTED_MODIFIERS,
  UNIMPLEMENTED_VIEWS,
} from './builtins'
import { Scope, type PropertyInfo, type SemanticModel, type TypeInfo } from './model'

/**
 * Semantic analysis for the supported subset.
 *
 * Scoped by one rule above all others, from Phase 1 gate 4: **a false positive is
 * worse than a missed error.** A spurious red squiggle on correct code destroys
 * trust in every other diagnostic, while a missed one costs nothing here - the
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
 * Those need the real type checker, which arrives with the interpreter in Phase 2 -
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
   * wrong reports "unknown type 'T'" on correct code - a false positive, which costs
   * more than the missed error of accepting `T` in a function that never declared it.
   */
  private readonly typeParameterNames = new Set<string>()
  /** Non-zero while checking the body of an extension on a type the preview owns. */
  private inViewExtension = 0
  /** Non-zero inside an extension on a built-in type, whose members are not listed here. */
  private inBuiltinExtension = 0

  /** Method names the project adds in an extension - its own modifiers. */
  private readonly declaredModifiers = new Set<string>()
  /** Property names the project adds in an extension - `Color.brand` among them. */
  private readonly declaredExtensionProperties = new Set<string>()
  /** Shape calls a `.stroke` or `.strokeBorder` is written on, so a `.trim` among them is a trimmed stroke. */
  private readonly stroked = new WeakSet<Expr>()
  /** The same, for a dashed stroke, which the preview draws untrimmed. */
  private readonly dashStroked = new WeakSet<Expr>()
  /** `typealias` names, which resolve as types anywhere the target would. */
  private readonly typeAliases = new Set<string>()
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
    // declaration order does not matter - `ContentView()` may appear above its own
    // declaration, as it does in the reference app.
    //
    // The conformance merge runs first because `describeStruct` needs it: after
    // `extension` exists, a declaration no longer knows all of its own members, and
    // the "does this View have a body?" check reads that merged list.
    // A type declared inside another is collected under both names it can be
    // written by - `Item.Status` from outside and `Status` from within - so that
    // neither spelling reads as an unknown. Collection only: pass 2 walks the
    // original files, or a nested body would be checked once per name it was
    // registered under and report everything in it twice.
    const expanded = hoistNestedTypes(files)
    this.conformance = collectConformance(expanded)
    for (const file of expanded) this.collectDeclarations(file)

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
        if (decl.destructured) {
          for (const binding of decl.destructured) {
            this.globalScope.declare({ name: binding.name, kind: 'local', span: binding.span })
          }
        } else {
          this.globalScope.declare({ name: decl.name, kind: 'local', span: decl.nameSpan })
        }
      } else if (decl.kind === 'typealiasDecl') {
        // The alias is a type name wherever the type it stands for would be one.
        this.typeAliases.add(decl.name)
        this.globalScope.declare({ name: decl.name, kind: 'type', span: decl.nameSpan })
      } else if (decl.kind === 'extensionDecl') {
        // `extension View { func card() -> some View { … } }` is the idiom for a
        // reusable modifier, so its methods are modifiers as far as the coverage
        // check is concerned. Collected in pass 1 because a view may be written
        // before the extension that gives it the modifier.
        for (const member of decl.members) {
          if (member.kind === 'funcDecl') this.declaredModifiers.add(member.name)
          if (member.kind === 'varDecl') this.declaredExtensionProperties.add(member.name)
        }
      }
    }
  }

  /**
   * Records `<T>` from a declaration and from every member of it.
   *
   * Walked rather than handled at each declaration site because a generic method on a
   * non-generic type - `func map<U>(…)` inside `struct Box` - is the common case, and
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
      // A `#Preview` is an entry point for our purposes: it names a view to show, and
      // a file with one and no `@main` is exactly what Xcode itself renders. Reporting
      // "no entry point" for it would block evaluation of a file that is complete.
      const preview = files.some((file) =>
        file.declarations.some((d) => d.kind === 'macroDecl' && d.name === 'Preview' && d.body),
      )
      if (preview) return null

      // A `PreviewProvider` names a view to show just as `#Preview` does - it is the
      // spelling every project written before Xcode 15 still carries - and the runtime
      // reads its `previews` body as the root. Not an entry point to complain about.
      const legacyPreview = files
        .flatMap((file) => file.declarations)
        .some(
          (d): d is StructDecl =>
            d.kind === 'structDecl' &&
            d.inherits.some((t) => t.name === 'PreviewProvider') &&
            d.members.some((m) => m.kind === 'varDecl' && m.name === 'previews' && m.accessor),
        )
      if (legacyPreview) return null

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

      case 'macroDecl':
        // `#Preview { … }`'s body is ordinary view code and gets the ordinary checks;
        // a macro the preview does not act on still has its arguments resolved, so a
        // typo inside one is still reported.
        this.checkAttributes(decl.attributes)
        for (const arg of decl.args) this.checkExpression(arg.value, scope)
        if (decl.body) this.checkBlock(decl.body, scope.child())
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
   * extension can call one written in another - which is the whole reason people
   * split a type across extensions. Falling back to the body's own members keeps a
   * protocol body working, since a protocol contributes to conformers rather than
   * having merged members of its own.
   */
  private checkTypeBody(decl: StructDecl | ProtocolDecl | ExtensionDecl): void {
    this.checkAttributes(decl.attributes)

    // `extension View` and `extension Text` extend something the preview owns, so
    // `self` inside is a view rather than a declared type. A protocol the *project*
    // declared is excluded: its members are known, so there is nothing to be lenient
    // about and every unresolved name there is a real one.
    const extendsAView =
      decl.kind === 'extensionDecl' &&
      !this.types.has(decl.name) &&
      !this.enums.has(decl.name) &&
      !this.protocols.has(decl.name)
    // `extension String` extends something whose members the checker has no list of,
    // so an unqualified `uppercased()` inside it is a call on the receiver that
    // nothing here can confirm or deny.
    const extendsABuiltin = decl.kind === 'extensionDecl' && EXTENSIBLE_BUILTIN_TYPES.has(decl.name)

    if (extendsAView) this.inViewExtension++
    if (extendsABuiltin) this.inBuiltinExtension++
    try {
      this.checkTypeMembers(decl)
    } finally {
      if (extendsAView) this.inViewExtension--
      if (extendsABuiltin) this.inBuiltinExtension--
    }
  }

  private checkTypeMembers(decl: StructDecl | ProtocolDecl | ExtensionDecl): void {

    const scope = this.globalScope.child()
    // A protocol's *requirements* are in scope inside an extension of it: that is what
    // `extension Describable { func summary() { title } }` is for, and `title` is
    // declared by the protocol rather than by anything the merge produces.
    const requirements =
      decl.kind === 'extensionDecl' ? (this.protocols.get(decl.name)?.members ?? []) : []
    const visible = this.conformance.types.get(decl.name)?.members ?? decl.members
    const seen = new Set<string>()

    // Every member is visible to every other member, regardless of order.
    for (const member of [...visible, ...requirements, ...decl.members]) {
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

  /**
   * A property wrapper the preview knows and does not implement.
   *
   * Every entry in `PROPERTY_WRAPPERS` is supported as of the data-flow pass, so this
   * currently reports nothing - it is the guard for the next wrapper added to the
   * table ahead of its implementation. A wrapper the table has never heard of is
   * already covered by `checkAttributes`, which is why nothing is duplicated here.
   */
  private checkPropertyWrapper(decl: VarDecl): void {
    const wrapper = propertyWrapperOf(decl)
    if (!wrapper) return

    const info = PROPERTY_WRAPPERS.get(wrapper)
    if (!info || info.supported) return

    this.report(
      decl.attributes.find((a) => a.name === wrapper)?.span ?? decl.nameSpan,
      'warning',
      'unsupported_language_feature',
      `'@${wrapper}' is not applied by the preview: the property behaves as a plain ` +
        'stored property here. It exports to Xcode unchanged.',
      `@${wrapper}`,
    )
  }

  private checkType(type: TypeRef): void {
    switch (type.kind) {
      case 'namedType': {
        const base = type.name.split('.')[0]!
        // Unknown types are reported as *warnings*, never errors. The known-type
        // list is necessarily incomplete, so an error here would eventually fire on
        // valid code - precisely the false positive gate 4 forbids.
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
          // `let (a, b) = pair` declares every name in the list, not just the first.
          if (decl.destructured) {
            for (const binding of decl.destructured) {
              scope.declare({ name: binding.name, kind: 'local', span: binding.span })
            }
          } else {
            scope.declare({ name: decl.name, kind: 'local', span: decl.nameSpan })
          }
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
        // A guard's bindings escape into the enclosing scope - that is its purpose -
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
        if (statement.destructured) {
          for (const binding of statement.destructured) {
            inner.declare({ name: binding.name, kind: 'local', span: binding.span })
          }
        } else if (statement.variable) {
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
   * and guessing would report a false "no such case" on correct code - the one thing
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
        this.checkTrim(expr)
        this.checkCallee(expr.callee, scope)
        this.checkOverloadCoverage(expr, scope)
        // A modifier is always *called*, so the coverage check belongs here rather
        // than on every member access. Doing it there flagged `Color.accentColor` as
        // the `.accentColor` modifier - a warning on correct code, which is the one
        // thing this checker must never produce.
        if (expr.callee.kind === 'memberAccess') {
          const onAView = rootsInAView(expr.callee.base)
          this.checkModifierCoverage(expr.callee.member, expr.callee.memberSpan, onAView)
          if (onAView) {
            this.checkArgumentLabels(expr.callee.member, expr.args)
            this.checkBlendMode(expr.callee.member, expr.args)
            this.checkStyleToken(expr.callee.member, expr.args)
          }
        }
        // `Color(.systemGray6)` and `Color(uiColor: .systemGray6)`, UIKit's colour by name.
        const only = expr.args.length === 1 ? expr.args[0]! : null
        if (
          expr.callee.kind === 'identifier' && expr.callee.name === 'Color' &&
          only && (only.label === null || only.label === 'uiColor') &&
          only.value.kind === 'memberAccess' && only.value.base === null
        ) {
          this.checkColorName(only.value.member, only.value.memberSpan, 'uikit')
        }
        if (expr.callee.kind === 'memberAccess' && STYLE_MODIFIERS.has(expr.callee.member)) this.checkStyleColor(expr.args)
        if (expr.callee.kind === 'identifier' && !scope.has(expr.callee.name) && !this.types.has(expr.callee.name)) this.checkSymbolNames(expr.args)
        for (const arg of expr.args) this.checkExpression(arg.value, scope)
        if (expr.trailingClosure) this.checkExpression(expr.trailingClosure, scope)
        return
      }

      case 'memberAccess':
        // Only the base is resolved. Member existence needs real type information,
        // and guessing produces false positives - see the class comment. Colours are
        // the exception: `Color.name` is a name the preview draws, or it draws clear.
        if (expr.base?.kind === 'identifier' && (expr.base.name === 'Color' || expr.base.name === 'UIColor')) {
          this.checkColorName(expr.member, expr.memberSpan, expr.base.name === 'Color' ? 'swiftui' : 'uikit')
        }
        if (expr.base) this.checkExpression(expr.base, scope)
        return

      case 'closure': {
        const inner = scope.child()
        for (const capture of expr.captures ?? []) {
          this.checkExpression(capture.value, scope)
          inner.declare({ name: capture.name, kind: 'local', span: capture.span })
        }
        for (const param of expr.params) {
          inner.declare({ name: param.name, kind: 'parameter', span: param.span })
          if (/^\$[A-Za-z_]/.test(param.name)) inner.declare({ name: param.name.slice(1), kind: 'parameter', span: param.span })
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

  /** A known view name does not imply that every SwiftUI overload works. */
  private checkOverloadCoverage(expr: Extract<Expr, { kind: 'call' }>, scope: Scope): void {
    const callee = expr.callee
    const labels = new Set(expr.args.map((arg) => arg.label))
    let feature: string | undefined
    let reason: string | undefined
    if (callee.kind === 'identifier' && !scope.has(callee.name) && !this.types.has(callee.name)) {
      feature = callee.name
      if (callee.name === 'NavigationStack' && labels.has('path')) reason = 'bound navigation paths are not synchronized; use NavigationLink destinations in the preview'
      if (callee.name === 'TextField' && (labels.has('value') || labels.has('format') || labels.has('formatter'))) reason = 'value/format/formatter bindings are not implemented; use text: with a String binding'
      if (callee.name === 'TextField' && labels.has('axis')) reason = 'axis-based multiline fields are not implemented; use TextEditor for multiline editing'
      if (callee.name === 'Link' || callee.name === 'ShareLink') reason = 'only the label is drawn; opening URLs and the system share sheet are not implemented'
      if (callee.name === 'ToolbarItem' || callee.name === 'ToolbarItemGroup') {
        const placement = expr.args.find(arg => arg.label === 'placement')?.value
        if (placement?.kind === 'memberAccess' && ['keyboard', 'bottomBar', 'principal'].includes(placement.member)) reason = `the .${placement.member} placement is not implemented; its controls are omitted`
      }
      if (callee.name === 'TimelineView') reason = 'the timeline runs only once and does not supply a context or advance its schedule'
      if (callee.name === 'AsyncImage') reason = 'remote loading and image phases are not implemented; only the placeholder is previewed'
    } else if (callee.kind === 'memberAccess' && rootsInAView(callee.base)) {
      feature = `.${callee.member}`
      if (callee.member === 'navigationDestination' && (labels.has('isPresented') || labels.has('item'))) reason = 'binding-driven destinations are not implemented; use NavigationLink with destination: or value: and navigationDestination(for:)'
      if (callee.member === 'presentationBackground' && (expr.trailingClosure || labels.has('content'))) reason = 'custom view backgrounds are not implemented; use a Color or Material'
      if (callee.member === 'contextMenu' && labels.has('forSelectionType')) reason = 'selection-based context menus are not implemented; use contextMenu with action buttons'
      if (callee.member === 'contextMenu' && labels.has('preview')) reason = 'custom menu previews are not implemented; menu actions are available'
      if (callee.member === 'background' && labels.has('fillStyle')) reason = 'the fillStyle argument is not applied in the preview'
    }
    if (feature && reason) this.report(expr.span, 'warning', callee.kind === 'identifier' ? 'unsupported_swiftui_view' : 'unsupported_swiftui_modifier', `${feature}: ${reason}. The source exports unchanged.`, feature)
  }

  /** A callee gets view-coverage treatment before ordinary resolution. */
  private checkCallee(callee: Expr, scope: Scope): void {
    if (callee.kind === 'identifier') {
      // A type the project declared is the project's, whatever SwiftUI also calls it.
      // `Tab`, `Settings`, `Marker` and `Table` are all real SwiftUI and all plausible
      // names for an app's own type, and warning on `Marker(...)` where the file two
      // lines up says `struct Marker` teaches people to stop reading the panel.
      const shadowed = scope.has(callee.name) || this.types.has(callee.name)
      if (UNIMPLEMENTED_VIEWS.has(callee.name) && !shadowed) {
        this.report(
          callee.span,
          'warning',
          'unsupported_swiftui_view',
          `'${callee.name}' is real SwiftUI that the preview does not draw. ` +
            'It renders as a labelled placeholder and exports to Xcode unchanged.',
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
    // `padding(…)` is a call on it - the idiom the whole extension exists for. The
    // checker has no receiver type to confirm that with, and reporting it would put a
    // red error on the most common way to write a reusable modifier.
    if (this.inViewExtension > 0 && isKnownModifier(name)) return

    // Inside `extension String`, `uppercased()` is `self.uppercased()`. The standard
    // library's member list is not something this checker holds, so the honest answer
    // is that it does not know - and a missed error costs less than a red squiggle on
    // correct code. The interpreter resolves it against the real receiver.
    if (this.inBuiltinExtension > 0) return

    // `$0`-style closure shorthand.
    if (this.closureDepth > 0 && /^\$\d+$/.test(name)) return

    // A projection like `$count` resolves through its backing property.
    if (name.startsWith('$') && scope.has(name.slice(1))) return

    // `_` is the wildcard pattern, never a reference.
    if (name === '_' || name === '') return

    // `Self` is the enclosing type, which the checker always has in scope by
    // construction: it only appears inside one.
    if (name === 'Self') return

    if (this.typeAliases.has(name)) return

    // An operator standing in for a function: the `+` of `reduce(0, +)`.
    if (/^[/=\-+!*%<>&|^~?.]+$/.test(name)) return

    if (UNIMPLEMENTED_VIEWS.has(name)) {
      this.report(
        span,
        'warning',
        'unsupported_swiftui_view',
        `'${name}' is real SwiftUI that the preview does not draw.`,
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

  /** The nearest name that is actually in scope, or null. */
  private closestName(name: string, scope: Scope): string | null {
    return nearestName(name, [...scope.allNames(), ...this.types.keys(), ...this.enums.keys(), ...SUPPORTED_VIEWS])
  }

  /**
   * Warns when a chain uses a modifier the preview does not apply.
   *
   * Two cases, and the second is the one that was missing. A name in the
   * unimplemented map warns wherever it is called, because the name is unambiguous.
   * A name that is *not recognised at all* warns only when the chain it sits on
   * demonstrably starts at a view - `Text("a").shimmer()` - because `Color.red` and
   * `store.add()` are member calls too and there is no type information to tell them
   * apart. Without that second case a misspelled modifier, and the fifty or so real
   * ones the preview silently drops, produce no diagnostic at all: the studio says
   * the code is fine and the preview quietly ignores it, which is exactly what the
   * coverage contract exists to prevent.
   */
  private checkModifierCoverage(member: string, span: SourceSpan, onAView: boolean): void {
    if (UNIMPLEMENTED_MODIFIERS.has(member)) {
      this.report(
        span,
        'warning',
        'unsupported_swiftui_modifier',
        `'.${member}' is recognised but not applied by the preview. ` +
          'It is exported to Xcode unchanged.',
        `.${member}`,
      )
      return
    }

    if (!onAView) return
    if (SUPPORTED_MODIFIERS.has(member)) return
    if (this.declaredModifiers.has(member)) return
    if (member === 'placeholder') {
      this.report(span, 'error', 'unsupported_swiftui_modifier', 'SwiftUI has no .placeholder modifier. Set the TextField initializer title or prompt, or define a custom View extension.', '.placeholder')
      return
    }
    // A modifier's argument is often built by a call on a helper the preview does
    // know - `.frame(width: size.rounded())` - but those sit under an argument, not
    // on the chain, so they never reach here.
    if (NON_MODIFIER_MEMBERS.has(member)) return

    this.report(
      span,
      'warning',
      'unsupported_swiftui_modifier',
      `The preview does not recognise the modifier '.${member}', so it is ignored here. ` +
        'It is exported to Xcode unchanged.',
      `.${member}`,
    )
  }

  /**
   * Warns on a blend mode the preview cannot draw.
   *
   * `.blendMode` is a supported modifier, so without this a mode CSS has no
   * equivalent for would be accepted and silently ignored - the same failure the
   * unimplemented-modifier list prevents for names, arriving one level down at the
   * argument. Drawing the nearest mode instead would put something plausible on
   * screen that the device does not draw.
   *
   * Only a literal `.mode` is checked. A mode held in a variable has no value here,
   * and guessing at one would warn on correct code.
   */
  private checkBlendMode(member: string, args: readonly { label: string | null; value: Expr }[]): void {
    if (member !== 'blendMode') return

    const first = args[0]?.value
    if (first?.kind !== 'memberAccess' || first.base !== null) return
    if (BLEND_MODES.has(first.member)) return

    this.report(
      first.span,
      'warning',
      'unsupported_swiftui_modifier',
      `'.blendMode(.${first.member})' has no equivalent the preview can draw, so it is ` +
        'ignored rather than approximated. It is exported to Xcode unchanged.',
      `.blendMode(.${first.member})`,
    )
  }

  /**
   * Warns on a `.trim` that isn't stroked: a filled shape, which the preview fills whole.
   *
   * The stroke is written after the trim - `.trim(…).offset(…).stroke(…)` - so the
   * outer call marks the shape calls under it before they are checked.
   */
  private checkTrim(call: Expr & { kind: 'call' }): void {
    if (call.callee.kind !== 'memberAccess') return
    if (call.callee.member === 'stroke' || call.callee.member === 'strokeBorder') {
      const marks = isDashed(call) ? this.dashStroked : this.stroked
      for (let base = call.callee.base; base?.kind === 'call' && base.callee.kind === 'memberAccess'; base = base.callee.base) {
        marks.add(base)
      }
    }
    // A Path and a custom shape trim their own path, and `trim()` on anything else is
    // the project's own method: only the shapes the preview draws itself are drawn whole.
    if (call.callee.member !== 'trim' || this.stroked.has(call)) return
    const shape = shapeAtRoot(call.callee.base)
    if (!shape || !BUILT_IN_SHAPES.has(shape) || this.types.has(shape)) return
    const dashed = this.dashStroked.has(call)
    this.report(
      call.callee.memberSpan,
      'warning',
      'unsupported_swiftui_modifier',
      dashed
        ? 'The preview draws this dashed outline whole: it trims only strokes without a dash pattern. Xcode dashes just the trimmed part.'
        : 'The preview fills the whole shape here: it trims only strokes. Xcode fills just the trimmed part, closed by a straight line.',
      dashed ? '.trim on a dashed stroke' : '.trim on a filled shape',
    )
  }

  /**
   * Warns on a colour name the preview doesn't know, which it draws as clear.
   *
   * Narrow on purpose, because a warning on correct code is worse than none: a property
   * or function the project declares in an extension (`Color.brand`, how Tokens.swift
   * writes a colour, or `Color.hex(…)`) is its own, a project type called `Color` is its
   * own, and a capitalised member is a nested type (`Color.Resolved`), not a colour.
   */
  private checkColorName(name: string, span: SourceSpan, namespace: 'swiftui' | 'uikit'): void {
    if (name === 'init' || /^[A-Z]/.test(name)) return
    if (this.declaredExtensionProperties.has(name) || this.declaredModifiers.has(name)) return
    if (this.types.has('Color') || this.types.has('UIColor')) return
    if (namespace === 'uikit' ? UIKIT_COLOR_NAMES.has(name) || KNOWN_COLOR_NAMES.has(name) : SWIFTUI_COLOR_NAMES.has(name)) return
    // `Color.systemGray6` draws here, from the same palette, and doesn't compile in Xcode.
    if (namespace === 'swiftui' && UIKIT_COLOR_NAMES.has(name)) {
      this.report(
        span,
        'warning',
        'may_not_compile_in_xcode',
        `Xcode has no Color.${name}: UIKit's colours are written Color(.${name}).`,
        undefined,
        [{ title: `Use Color(.${name})`, edits: [{ span: { ...span, start: span.start - 'Color.'.length }, newText: `Color(.${name})` }] }],
      )
      return
    }
    if (KNOWN_COLOR_NAMES.has(name)) return
    this.report(
      span,
      'warning',
      'unresolved_member',
      `The preview doesn't know the colour '${name}', so it draws nothing there. ` +
        'Check the spelling: Xcode uses the name as written.',
    )
  }

  /**
   * Warns on a leading-dot colour spelt wrong - `.foregroundStyle(.grey)` - which draws
   * nothing. Only a name a letter or two from a colour is taken for one: the styles these
   * modifiers take are too many to list, and a warning on one would be on correct code.
   */
  private checkStyleColor(args: readonly { label: string | null; value: Expr }[]): void {
    const value = args[0]?.value
    if (value?.kind !== 'memberAccess' || value.base !== null) return
    const name = value.member
    if (KNOWN_COLOR_NAMES.has(name) || this.declaredExtensionProperties.has(name)) return
    const near = nearestName(name, KNOWN_COLOR_NAMES)
    if (!near) return
    this.report(
      value.memberSpan,
      'warning',
      'unresolved_member',
      `The preview doesn't know the colour '${name}', so it draws nothing there. Did you mean '${near}'?`,
      undefined,
      [{ title: `Use .${near}`, edits: [{ span: value.memberSpan, newText: near }] }],
    )
  }

  /**
   * Warns on an SF Symbol name the preview has no drawing for: it draws a question mark
   * there. Only a literal name, given as `systemName:` or `systemImage:` to a call the
   * project doesn't declare. Some real symbols are missing from the preview's set too,
   * so the warning never says the name is wrong unless it is a letter or two from one
   * the preview draws.
   */
  private checkSymbolNames(args: readonly { label: string | null; value: Expr }[]): void {
    for (const arg of args) {
      if (arg.label !== 'systemName' && arg.label !== 'systemImage') continue
      const literal = arg.value
      if (literal.kind !== 'stringLiteral' || literal.segments.some((segment) => segment.kind !== 'text')) continue
      const name = literal.segments.map((segment) => (segment.kind === 'text' ? segment.value : '')).join('')
      if (symbolDefinition(name)) continue
      const near = nearestName(name, Object.keys(SYMBOL_MAP))
      this.report(
        literal.span,
        'warning',
        'unresolved_member',
        `The preview has no drawing for the symbol '${name}' and shows a question mark. ` +
          (near ? `Did you mean '${near}'? If '${name}' is right, it still shows in the app.` : 'If the name is right, it still shows in the app.'),
        undefined,
        near ? [{ title: `Use '${near}'`, edits: [{ span: literal.span, newText: JSON.stringify(near) }] }] : undefined,
      )
    }
  }

  /**
   * Warns on a style token the preview does not apply.
   *
   * The same rule as `checkBlendMode` above, generalised to every style modifier with
   * a closed set of tokens. `.buttonStyle(.glass)` used to compile clean and draw a
   * plain label, which is the worst of the three possible outcomes: not drawn, not
   * reported, and indistinguishable from a style that *is* applied.
   *
   * Only a literal `.token`. A style held in a variable or returned from a function
   * has no value here, and guessing would put a warning on correct code.
   */
  private checkStyleToken(
    member: string,
    args: readonly { label: string | null; value: Expr }[],
  ): void {
    const known = STYLE_TOKENS.get(member)
    if (!known) return

    const first = args[0]?.value
    if (first?.kind !== 'memberAccess' || first.base !== null) return
    if (known.has(first.member)) return

    this.report(
      first.span,
      'warning',
      'unsupported_swiftui_modifier',
      `'.${member}(.${first.member})' is not a style the preview draws, so it is ignored ` +
        'rather than approximated. It is exported to Xcode unchanged.',
      `.${member}(.${first.member})`,
    )
  }

  /**
   * Warns on an argument label a modifier does not take.
   *
   * Restricted to the modifiers in `MODIFIER_LABELS`, whose signatures are small
   * enough to write down in full. Everything else is left alone: the preview has no
   * type information to check a label against, and inventing one would put a warning
   * on correct code.
   */
  private checkArgumentLabels(member: string, args: readonly { label: string | null; value: Expr }[]): void {
    const known = MODIFIER_LABELS.get(member)
    if (!known) return

    for (const arg of args) {
      if (arg.label === null || known.has(arg.label)) continue
      this.report(
        arg.value.span,
        'warning',
        'unsupported_swiftui_modifier',
        `'.${member}' has no argument '${arg.label}:', so the preview ignores it. ` +
          'It is exported to Xcode unchanged, where it will not compile.',
        `.${member}(${arg.label}:)`,
      )
    }
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
    // Coverage warnings repeat constantly - `.padding()` appears six times in the
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
 * The candidate nearest to a misspelt name, or null.
 *
 * Offered only when the edit distance is small relative to the name's length, so a
 * three-letter typo does not suggest an unrelated three-letter name. A fix the user
 * has to undo costs more than no fix, which is the same rule the rest of this file
 * follows.
 */
function nearestName(name: string, candidates: Iterable<string>): string | null {
  const budget = name.length <= 4 ? 1 : 2
  let best: string | null = null
  let bestDistance = budget + 1
  for (const candidate of candidates) {
    if (candidate === name || Math.abs(candidate.length - name.length) > budget) continue
    const distance = editDistance(name.toLowerCase(), candidate.toLowerCase())
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate
    }
  }
  return best
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

/**
 * Whether a member chain demonstrably starts at a SwiftUI view.
 *
 * Walks `Text("a").bold().shimmer()` back to `Text` and asks whether that names a
 * view the preview knows. Deliberately conservative: a chain rooted at a variable,
 * at a gesture, or at one of the project's own views answers false, because there is
 * no type information to say what it is and a coverage warning on someone's own
 * method would be exactly the false positive this checker must not produce.
 */
function rootsInAView(expr: Expr | null): boolean {
  let current = expr

  while (current) {
    if (current.kind === 'call') {
      current = current.callee
      continue
    }
    if (current.kind === 'memberAccess') {
      current = current.base
      continue
    }
    return current.kind === 'identifier' && isViewRoot(current.name)
  }

  return false
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

/** The shapes the preview draws itself, rather than through a path. */
const BUILT_IN_SHAPES: ReadonlySet<string> = new Set(['Circle', 'Ellipse', 'Rectangle', 'RoundedRectangle', 'Capsule'])

/** `Circle` in `Circle().inset(by: 4)`: the call a chain of shape modifiers starts from. */
function shapeAtRoot(expr: Expr | null): string | null {
  let node = expr
  while (node?.kind === 'call' && node.callee.kind === 'memberAccess') node = node.callee.base
  return node?.kind === 'call' && node.callee.kind === 'identifier' ? node.callee.name : null
}

/** A stroke given `StrokeStyle(…, dash: […])` with at least one length. */
function isDashed(stroke: Expr & { kind: 'call' }): boolean {
  const style = stroke.args.find((arg) => arg.label === 'style')?.value
  if (style?.kind !== 'call' || style.callee.kind !== 'identifier' || style.callee.name !== 'StrokeStyle') return false
  const dash = style.args.find((arg) => arg.label === 'dash')?.value
  return dash !== undefined && !(dash.kind === 'arrayLiteral' && dash.elements.length === 0)
}

/** Modifiers whose first argument is a colour or another style, as `.foregroundStyle(.gray)`. */
const STYLE_MODIFIERS: ReadonlySet<string> = new Set(['foregroundStyle', 'foregroundColor', 'fill', 'stroke', 'strokeBorder', 'tint', 'background', 'border'])
