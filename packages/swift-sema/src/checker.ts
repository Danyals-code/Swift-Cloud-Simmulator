import type { Diagnostic, DiagnosticCode, FixIt, SourceSpan } from '@studio/shared'
import { MASK_PAINTS, MASK_RECEIVER_MODIFIERS, MASK_SHAPES, MASK_SHAPE_MODIFIERS, SYMBOL_MAP, TEXT_STYLES, iosFont, isSymbolRenderingMode, symbolDefinition, symbolDrawsMode, symbolDrawsVariableValue, symbolVariantName, projectFont, type PreviewFontAsset } from '@studio/shared'
import type {
  Block,
  CallExpr,
  ConformanceModel,
  Condition,
  Decl,
  EnumDecl,
  ClosureExpr,
  Expr,
  ExtensionDecl,
  FuncDecl,
  Pattern,
  ProtocolDecl,
  SourceFileNode,
  Stmt,
  StructDecl,
  TypealiasDecl,
  TypeRef,
  VarDecl,
} from '@studio/swift-syntax'
import { argumentLabels, collectConformance, hoistNestedTypes, valueKind, walk, type TypeNames } from '@studio/swift-syntax'
import {
  isAppleCall,
  isKnownGlobal,
  isViewRoot,
  EXTENSIBLE_BUILTIN_TYPES,
  HIDDEN_BARS,
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
  CHART_MARKS,
  DRAWN_CHART_MARKS,
  DRAWN_VIEW_NAMES,
  CHART_MARK_MODIFIERS,
  APPLE_VIEW_MODIFIERS,
  UNIMPLEMENTED_VIEWS,
} from './builtins'
import { Scope, type PropertyInfo, type SemanticModel, type TypeInfo } from './model'
import { literalText, memberChain } from './design-controls'
import { isMesh, meshWarnings, modifierPaintWarning } from './paint-scroll-checks'
import { chartPartWarning, drawnOnChart, drawnOnMark, markWarnings } from './chart-checks'

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
 * - a type alias that names itself, which Xcode refuses (error)
 * - a real SwiftUI view or modifier that the preview cannot draw yet (warning)
 * - a property wrapper outside the slice (warning)
 * - two overloads the preview can't tell apart by their arguments (warning)
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
  /**
   * The callee a statement is rooted at: `RatingView(rating: 3).padding()` on a line of
   * its own. In SwiftUI code only a view stands there, so only there is a capitalised
   * call nothing declares taken for one.
   */
  private viewCallee: Expr | null = null

  /** Method names the project adds in an extension - its own modifiers. */
  private readonly declaredModifiers = new Set<string>()
  /** Method names the project's own types declare, which no warning about SwiftUI's members is for. */
  private readonly declaredMethods = new Set<string>()
  /** Property names the project adds in an extension - `Color.brand` among them. */
  private readonly declaredExtensionProperties = new Set<string>()
  /** Shape calls a `.stroke` or `.strokeBorder` is written on, so a `.trim` among them is a trimmed stroke. */
  private readonly stroked = new WeakSet<Expr>()
  /** The same, for a dashed stroke, which the preview draws untrimmed. */
  private readonly dashStroked = new WeakSet<Expr>()
  /** Each `.symbolRenderingMode` call a `.symbolVariant` is written around, with that variant's members joined, or null for one worked out in Swift. */
  private readonly variantsAround = new WeakMap<Expr, string | null>()
  /** `typealias` names, which resolve as types anywhere the target would. */
  private readonly typeAliases = new Set<string>()
  /** Extension and protocol-default members, merged per type. Shared with the interpreter. */
  private conformance: ConformanceModel = collectConformance([])
  private readonly globalScope = new Scope()
  /** Non-zero inside a closure, where `$0` shorthand is legal. */
  private closureDepth = 0

  /** The project's own font files (Wave 6f), whose names `.custom(…)` finds as iOS's own. */
  private constructor(private readonly fonts?: readonly PreviewFontAsset[]) {}

  static check(files: readonly SourceFileNode[], fonts?: readonly PreviewFontAsset[]): SemanticModel {
    return new Checker(fonts).run(files)
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
    this.reportAliasCycles(files)
    this.reportIndistinctOverloads(files)

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
      if (decl.kind === 'structDecl' || decl.kind === 'enumDecl' || decl.kind === 'extensionDecl') {
        for (const member of decl.members) if (member.kind === 'funcDecl') this.declaredMethods.add(member.name)
      }
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
   * `typealias Count = Total` beside `typealias Total = Count` names no type at all,
   * and Xcode refuses it, however the loop runs: `Total?` or `[Total]` loops as
   * surely. Said once per loop, at the alias declared first, where swiftc says it.
   */
  private reportAliasCycles(files: readonly SourceFileNode[]): void {
    const aliases = files.flatMap((file) => file.declarations.filter((decl): decl is TypealiasDecl => decl.kind === 'typealiasDecl'))
    const declared = new Set(aliases.map((alias) => alias.name))
    const names = new Map(aliases.map((alias) => [alias.name, namedIn(alias.target).filter((name) => declared.has(name))] as const))
    const reaches = (from: string, to: string): boolean => {
      const seen = new Set<string>()
      const next = [...(names.get(from) ?? [])]
      while (next.length) {
        const name = next.pop()!
        if (name === to) return true
        if (seen.has(name)) continue
        seen.add(name)
        next.push(...(names.get(name) ?? []))
      }
      return false
    }
    const looped = new Set<string>()
    for (const alias of aliases) {
      if (looped.has(alias.name) || !reaches(alias.name, alias.name)) continue
      for (const other of aliases) if (reaches(alias.name, other.name) && reaches(other.name, alias.name)) looped.add(other.name)
      this.report(alias.nameSpan, 'error', 'unresolved_identifier', `Type alias '${alias.name}' references itself.`)
    }
  }

  /**
   * Two overloads the preview can't choose between by what they are called with.
   *
   * The preview has values rather than types, so of functions sharing a name and
   * labels it runs the one its arguments suit (`valueKind`, which the interpreter
   * scores by too). Where every parameter takes the same kind of value, as
   * `size(_: Double)` and `size(_: CGFloat)` both take a number, nothing can tell
   * them apart: it runs the first, and this says so at the second, where Xcode
   * chooses by type. At the top level, in each type, and in each function body.
   */
  private reportIndistinctOverloads(files: readonly SourceFileNode[]): void {
    const aliases = new Map(files.flatMap((file) => file.declarations.flatMap((decl) => (decl.kind === 'typealiasDecl' ? [[decl.name, decl.target] as const] : []))))
    const names: TypeNames = {
      alias: (name) => aliases.get(name),
      declared: (name) => (this.types.has(name) || this.enums.has(name) ? 'type' : this.conformance.protocols.has(name) ? 'protocol' : this.typeParameterNames.has(name) ? 'generic' : undefined),
    }
    const scopes: FuncDecl[][] = [files.flatMap((file) => file.declarations.filter((decl): decl is FuncDecl => decl.kind === 'funcDecl'))]
    for (const [name, type] of this.conformance.types) {
      scopes.push(type.members.filter((member): member is FuncDecl => member.kind === 'funcDecl' && type.origin.get(member) === name))
    }
    for (const file of files) {
      walk(file, (node) => {
        if (node.kind !== 'block') return
        scopes.push(node.statements.flatMap((stmt) => (stmt.kind === 'declStmt' && stmt.declaration.kind === 'funcDecl' ? [stmt.declaration] : [])))
      })
    }
    const signature = (fn: FuncDecl) => ({ labels: argumentLabels(fn.params), kinds: fn.params.map((param) => valueKind(param.type, names)) })
    for (const scope of scopes) {
      const named = new Map<string, FuncDecl[]>()
      for (const fn of scope) named.set(fn.name, [...(named.get(fn.name) ?? []), fn])
      for (const group of named.values()) {
        group.forEach((later, index) => {
          const mine = signature(later)
          const same = group.slice(0, index).some((earlier) => {
            const theirs = signature(earlier)
            return theirs.labels.length === mine.labels.length && theirs.labels.every((label, i) => label === mine.labels[i]) && theirs.kinds.every((kind, i) => kind === mine.kinds[i])
          })
          if (!same) return
          const call = `${later.name}(${mine.labels.map((label) => `${label ?? '_'}:`).join('')})`
          this.report(later.nameSpan, 'warning', 'unsupported_language_feature', `The preview can't tell ${call} from the one before it by what it is called with, so it runs that one. Xcode chooses by the argument's type.`, 'overloads told apart by type')
        })
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
          inner.declare({ name: param.internalName, kind: 'parameter', span: param.span, words: holdsWords(param.type) })
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
        scope.declare({ name: member.name, kind: 'property', span: member.nameSpan, words: holdsWords(member.typeAnnotation, member.initializer) })
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
      case 'exprStmt': {
        const outer = this.viewCallee
        this.viewCallee = rootCall(statement.expression)?.callee ?? null
        this.checkExpression(statement.expression, scope)
        this.viewCallee = outer
        return
      }

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
            scope.declare({ name: decl.name, kind: 'local', span: decl.nameSpan, words: holdsWords(decl.typeAnnotation, decl.initializer) })
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
        this.markVariant(expr)
        this.checkCallee(expr.callee, scope)
        this.checkDefaultToolbarItem(expr, scope)
        this.checkOverloadCoverage(expr, scope)
        this.checkFontCoverage(expr, scope)
        // A modifier is always *called*, so the coverage check belongs here rather
        // than on every member access. Doing it there flagged `Color.accentColor` as
        // the `.accentColor` modifier - a warning on correct code, which is the one
        // thing this checker must never produce.
        if (expr.callee.kind === 'memberAccess') {
          // Called on a view's type itself, it is a static member making that view,
          // `ContentUnavailableView.search(text:)`, not a modifier (Wave 4b).
          // The view the chain starts at, found in one walk, which a chart's own modifiers are judged by too (Wave 6e).
          const root = expr.callee.base?.kind !== 'identifier' ? viewRoot(expr.callee.base) : undefined, onAView = root !== undefined
          this.checkModifierCoverage(expr.callee.member, expr.callee.memberSpan, root, expr)
          if (onAView) {
            // A mark's own `.position(by:)` is not a view's `.position(x:y:)` (Wave 6a).
            if (!CHART_MARKS.has(root)) this.checkArgumentLabels(expr.callee.member, expr.args)
            this.checkBlendMode(expr.callee.member, expr.args)
            this.checkCompactAdaptation(expr.callee.member, expr)
            this.checkStyleToken(expr.callee.member, expr.args)
            if (expr.callee.member === 'symbolVariant') this.checkSymbolVariant(expr.callee.base, expr.args[0]?.value)
            if (expr.callee.member === 'symbolRenderingMode') this.checkSymbolRendering(expr)
            // A scale effect draws the symbol larger or smaller while it is active, which the preview doesn't (Wave 6b).
            if (expr.callee.member === 'symbolEffect' && memberChain(expr.args[0]?.value)?.[0] === 'scale' && !expr.args.some(arg => arg.label === 'isActive' && arg.value.kind === 'booleanLiteral' && !arg.value.value)) {
              this.report(expr.args[0]!.span, 'warning', 'unsupported_swiftui_modifier', 'The preview draws this symbol at its own size. The app scales it while the effect is active.', '.symbolEffect')
            }
            // A mesh painted in one colour, a view-aligned limit, a nil margin (Wave 6d).
            const drawn = modifierPaintWarning(expr.callee.member, expr.args, expr.callee.base!)
            if (drawn) this.report(drawn.span, 'warning', 'unsupported_swiftui_modifier', drawn.message, drawn.feature)
          }
          // A colour is a view too, `Color.blue.mask(Circle())`, though its chain starts at no view's name.
          if (expr.callee.member === 'mask' && expr.callee.base) this.checkMask(expr.callee.base, expr.args, expr.trailingClosure)
        }
        // A drawn chart mark's forms the preview leaves out (Wave 6e).
        if (expr.callee.kind === 'identifier' && DRAWN_CHART_MARKS.has(expr.callee.name) && !scope.has(expr.callee.name) && !this.types.has(expr.callee.name)) for (const warning of markWarnings(expr)) this.report(warning.span, 'warning', 'unsupported_swiftui_view', warning.message, warning.feature)
        // A mesh's forms the preview draws nothing for, or leaves part of out (Wave 6d).
        if (isMesh(expr) && !scope.has('MeshGradient') && !this.types.has('MeshGradient')) for (const warning of meshWarnings(expr)) this.report(warning.span, 'warning', 'unsupported_swiftui_view', warning.message, warning.feature)
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
        if (
          expr.callee.kind === 'memberAccess' && expr.callee.base?.kind === 'identifier' && expr.callee.base.name === 'Timer' &&
          !scope.has('Timer') && !this.types.has('Timer') && (expr.callee.member === 'publish' || expr.callee.member === 'scheduledTimer')
        ) {
          this.report(expr.span, 'warning', 'unsupported_language_feature', "The preview doesn't run timers, so this one never fires here. It runs in the app.", 'Timer')
        }
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
          if (segment.kind !== 'interpolation') continue
          this.checkExpression(segment.expression, scope)
          segment.options?.forEach((option) => this.checkExpression(option.value, scope))
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
        // The one attribute of an AttributedString the preview keeps and does not draw (Wave 6a),
        // on words the checker can see are attributed: `words`, `words[range]`, `words.swiftUI`.
        if (expr.target.kind === 'memberAccess' && expr.target.member === 'backgroundColor' && expr.target.base && this.holdsWords(expr.target.base, scope)) {
          this.report(expr.target.span, 'warning', 'unsupported_swiftui_modifier', "An AttributedString's backgroundColor is not drawn in the preview. The app draws it as written.", 'AttributedString.backgroundColor')
        }
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

  /** Whether `expr` is attributed words the checker can type: a name declared as them, a range of them, or their SwiftUI scope. */
  private holdsWords(expr: Expr, scope: Scope): boolean {
    if (expr.kind === 'identifier') return !!scope.lookup(expr.name)?.words
    if (expr.kind === 'subscript') return this.holdsWords(expr.base, scope)
    if (expr.kind !== 'memberAccess' || !expr.base) return false
    return expr.base.kind === 'selfExpr' ? !!scope.lookup(expr.member)?.words : expr.member === 'swiftUI' && this.holdsWords(expr.base, scope)
  }

  /** A known view name does not imply that every SwiftUI overload works. */
  private checkOverloadCoverage(expr: Extract<Expr, { kind: 'call' }>, scope: Scope): void {
    const callee = expr.callee
    const labels = new Set(expr.args.map((arg) => arg.label))
    let feature: string | undefined
    let reason: string | undefined
    if (callee.kind === 'identifier' && !scope.has(callee.name) && !this.types.has(callee.name)) {
      feature = callee.name
      if (callee.name === 'TextField' && (labels.has('value') || labels.has('format') || labels.has('formatter'))) reason = 'value/format/formatter bindings are not implemented; use text: with a String binding'
      if (callee.name === 'TextField' && labels.has('axis')) reason = 'axis-based multiline fields are not implemented; use TextEditor for multiline editing'
      if (callee.name === 'Link' || callee.name === 'ShareLink') reason = 'it is drawn, but tapping it opens nothing; opening URLs and the system share sheet are not implemented'
      if (callee.name === 'ToolbarItem' || callee.name === 'ToolbarItemGroup') {
        const placement = expr.args.find(arg => arg.label === 'placement')?.value
        // The keyboard's bar is up only while a field is typed in, which a preview never is.
        if (placement?.kind === 'memberAccess' && placement.member === 'keyboard') reason = 'the .keyboard placement is not implemented; its controls are omitted'
      }
      if (callee.name === 'TimelineView') reason = 'the timeline runs only once, for the moment it is drawn, and does not advance its schedule'
      if (callee.name === 'ScrollViewReader') reason = 'what it holds is drawn, and scrollTo does not scroll the preview'
      if (callee.name === 'PhaseAnimator') reason = 'its content is drawn at the first phase, and does not animate through the others'
      if (callee.name === 'KeyframeAnimator') reason = 'its content is drawn at the initial value, and the keyframes do not run'
      if (callee.name === 'AsyncImage') reason = 'remote loading and image phases are not implemented; only the placeholder is previewed'
      if ((callee.name === 'LazyVStack' || callee.name === 'LazyHStack') && labels.has('pinnedViews')) reason = 'its section headers and footers scroll with the content, as pinnedViews is not applied by the preview'
    } else if (callee.kind === 'memberAccess' && rootsInAView(callee.base)) {
      feature = `.${callee.member}`
      if (callee.member === 'presentationBackground' && (expr.trailingClosure || labels.has('content'))) reason = 'custom view backgrounds are not implemented; use a Color or Material'
      if (callee.member === 'contextMenu' && labels.has('forSelectionType')) reason = 'selection-based context menus are not implemented; use contextMenu with action buttons'
      if (callee.member === 'contextMenu' && labels.has('preview')) reason = 'custom menu previews are not implemented; menu actions are available'
      if (callee.member === 'background' && labels.has('fillStyle')) reason = 'the fillStyle argument is not applied in the preview'
      // Where a bubble points (Wave 6c); a phone shows a plain popover as a sheet, which has none.
      const pointing = callee.member === 'popover' ? ['attachmentAnchor', 'arrowEdge'].filter(label => labels.has(label)) : []
      if (pointing.length) reason = `${pointing.join(' and ')} ${pointing.length > 1 ? 'are' : 'is'} not applied in the preview, so a popover drawn as one points at the middle of its view's edge`
    }
    // These two are told apart by their arguments, so they need no view at the root:
    // they are as often written on a view of the project's own.
    if (callee.kind === 'memberAccess') {
      const hidden = callee.member === 'toolbar' && expr.args[0]?.label === null && expr.args[0].value.kind === 'memberAccess' && expr.args[0].value.member === 'hidden'
      // The bars the preview hides are hidden (Wave 4b); the others are not.
      const bars = hidden ? expr.args.slice(1).flatMap((arg) => arg.value.kind === 'memberAccess' && !HIDDEN_BARS.includes(arg.value.member) ? [`.${arg.value.member}`] : []) : []
      if (bars.length > 0) {
        feature = `.toolbar(.hidden, for: ${bars.join(', ')})`
        reason = 'it is not applied by the preview, so the bar still shows'
      }
    }
    if (feature && reason) this.report(expr.span, 'warning', callee.kind === 'identifier' ? 'unsupported_swiftui_view' : 'unsupported_swiftui_modifier', `${feature}: ${reason}. The source exports unchanged.`, feature)
  }

  /**
   * A font the preview draws only in part. It still resolves, so the screen draws;
   * these say what is drawn in its place.
   */
  private checkFontCoverage(expr: Extract<Expr, { kind: 'call' }>, scope: Scope): void {
    const callee = expr.callee
    if (callee.kind !== 'memberAccess' || (callee.base?.kind === 'identifier' && scope.has(callee.base.name))) return
    const onFont = isFontExpression(callee.base)
    const feature = `Font.${callee.member}`
    if (callee.member === 'custom' && (callee.base === null || isFontType(callee.base)) && expr.args[0]?.label === null) {
      const family = literalText(expr.args[0].value)
      // A family iOS ships needs no file, and the preview draws it (Wave 6a), as it does a file of the project's (Wave 6f).
      if (family !== undefined && (iosFont(family) || projectFont(family, this.fonts))) return
      const written = family !== undefined ? `'${family}' ` : ''
      this.report(expr.span, 'warning', 'unsupported_swiftui_modifier', `Custom font ${written}is not in this project; the preview draws the system font at the same size.`, feature)
    } else if (onFont && callee.member === 'width') {
      const width = expr.args[0]?.value
      const named = width?.kind === 'memberAccess' ? ` .${width.member}` : ''
      this.report(expr.span, 'warning', 'unsupported_swiftui_modifier', `The font width${named} is drawn at the standard width in the preview. The app draws it as written.`, feature)
    } else if (onFont && callee.member === 'monospacedDigit') {
      this.report(expr.span, 'warning', 'unsupported_swiftui_modifier', "A font's .monospacedDigit() draws proportional digits in the preview; the .monospacedDigit() view modifier draws them fixed width. The app draws both as written.", feature)
    } else if (onFont && callee.member === 'uppercaseSmallCaps') {
      this.report(expr.span, 'warning', 'unsupported_swiftui_modifier', '.uppercaseSmallCaps() is not drawn in the preview: capitals stay full size. The app draws it as written.', feature)
    }
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
          // A chart's part is no box: the chart leaves it out, or keeps its default axis (Wave 6e).
          chartPartWarning(callee.name) ?? `'${callee.name}' isn't drawn in the preview yet, so it shows as a labelled box. Xcode draws it as written.`,
          callee.name,
        )
        return
      }
      // A custom `Layout` is a container whose placement the preview never runs.
      const conforms = this.conformance.types.get(callee.name)?.conformances
      if (conforms?.has('Layout') && !conforms.has('View')) {
        this.report(callee.span, 'warning', 'unsupported_swiftui_view', `'${callee.name}' is a custom Layout. The preview does not run its placement, so what it holds is not drawn here. The app lays it out as written.`, callee.name)
      }
      // A view nothing declares, one the AI forgot to write or real SwiftUI the preview
      // doesn't know, draws a placeholder rather than blanking the screen. A name a
      // letter or two from a type or view is a typo instead, and stays an error.
      const name = callee.name
      if (callee === this.viewCallee && !shadowed && /^[A-Z]/.test(name) && name !== 'Self' && !isKnownGlobal(name) && !this.typeAliases.has(name) && this.inBuiltinExtension === 0 && !this.nearestTypeName(name)) {
        this.report(
          callee.span,
          'warning',
          'unresolved_identifier',
          `Cannot find '${name}' in scope. The preview draws a placeholder for it. If it isn't part of SwiftUI and the project doesn't declare it, Xcode won't build it either.`,
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
    if (this.inViewExtension > 0 && isAppleCall(name)) return

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
        `'${name}' isn't drawn in the preview yet. Xcode draws it as written.`,
        name,
      )
      return
    }

    // A capitalised name is a type's, so a type is offered first: `Countr` is `Counter`, not a `counter`.
    const suggestion = (/^[A-Z]/.test(name) ? this.nearestTypeName(name) : null) ?? this.nearestInScope(name, scope)
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
  private nearestInScope(name: string, scope: Scope): string | null {
    return nearestName(name, [...scope.allNames(), ...this.types.keys(), ...this.enums.keys(), ...DRAWN_VIEW_NAMES])
  }

  /** The nearest type or view name, or null. Not a variable's: `Timer` is no typo of a `timer`. */
  private nearestTypeName(name: string): string | null {
    return nearestName(name, [...this.types.keys(), ...this.enums.keys(), ...this.typeAliases, ...DRAWN_VIEW_NAMES, ...UNIMPLEMENTED_VIEWS, ...KNOWN_TYPES])
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
  private checkModifierCoverage(member: string, span: SourceSpan, root: string | undefined, call: Extract<Expr, { kind: 'call' }>): void {
    if ((member === 'repeatForever' || member === 'repeatCount') && !this.declaredMethods.has(member)) {
      this.report(span, 'warning', 'unsupported_swiftui_modifier', `'.${member}' repeats the animation on iOS. The preview plays it once.`, `.${member}`)
      return
    }
    if (UNIMPLEMENTED_MODIFIERS.has(member)) {
      this.report(span, 'warning', 'unsupported_swiftui_modifier', notApplied(member), `.${member}`)
      return
    }

    if (root === undefined) return
    // A chart and its marks draw the forms Wave 6e draws; anything else on a mark, a view's
    // modifier included, is the mark's and isn't drawn.
    const mark = CHART_MARKS.has(root)
    if (!this.types.has(root) && (mark ? DRAWN_CHART_MARKS.has(root) && drawnOnMark(member, call) : root === 'Chart' && drawnOnChart(member, call))) return
    if (mark && (APPLE_VIEW_MODIFIERS.has(member) || CHART_MARK_MODIFIERS.has(member))) {
      this.report(span, 'warning', 'unsupported_swiftui_modifier', notApplied(member), `.${member}`)
      return
    }
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
    // A real SwiftUI modifier on a view, which the preview does not draw: one Xcode builds. A
    // mark's own is real only on a mark, which is said above (Wave 6a).
    if (APPLE_VIEW_MODIFIERS.has(member)) {
      this.report(span, 'warning', 'unsupported_swiftui_modifier', notApplied(member), `.${member}`)
      return
    }

    this.report(
      span,
      'warning',
      'unsupported_swiftui_modifier',
      // A typo reads exactly like a modifier the preview lacks, and only one of them builds.
      `The preview does not recognise the modifier '.${member}', so it is ignored here. ` +
        "If it isn't a SwiftUI modifier, Xcode won't build the app.",
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
  /**
   * `.mask` is drawn for a gradient or a colour, which fades what it masks; for a shape,
   * which cuts it (Wave 6a); and for text or a symbol over a colour or a gradient, which is
   * that text or symbol in the paint (Wave 6a). Any other mask says so here rather than
   * leaving the content drawn unmasked without a word.
   */
  private checkMask(base: Expr, args: readonly { label: string | null; value: Expr }[], trailing: ClosureExpr | null): void {
    const statement = trailing?.body.statements.length === 1 ? trailing.body.statements[0] : undefined
    const mask = args.find(arg => arg.label === null || arg.label === 'mask')?.value
      ?? (statement?.kind === 'exprStmt' ? statement.expression : statement?.kind === 'returnStmt' ? statement.value ?? undefined : undefined)
    if (!mask) return
    const drawn = chainOf(mask), name = paintName(drawn.root) ?? ''
    if (MASK_PAINTS.has(name)) return
    // A shape cuts in a colour's opacity, never a gradient's (Wave 6a).
    if (MASK_SHAPES.has(name) && drawn.calls.every(call => MASK_SHAPE_MODIFIERS.has(call)) && !drawn.firsts.some(isGradient)) return
    const masked = chainOf(base)
    const words = name === 'Text' || name === 'Image' && drawn.root.kind === 'call' && drawn.root.args.some(arg => arg.label === 'systemName')
    const painted = MASK_PAINTS.has(paintName(masked.root) ?? '') || masked.overlays.some(overlay => MASK_PAINTS.has(paintName(chainOf(overlay).root) ?? ''))
    if (words && painted && masked.calls.every(call => MASK_RECEIVER_MODIFIERS.has(call))) return
    this.report(
      mask.span,
      'warning',
      'unsupported_swiftui_modifier',
      "'.mask' is drawn by the preview for a gradient, a colour or a shape, and for text or a symbol masking a colour or a gradient; this mask is not, so the view is shown unmasked. It is exported to Xcode unchanged.",
      '.mask',
    )
  }

  /** A DefaultToolbarItem is drawn as the bottom bar's search field alone (Wave 6c); iOS 27 draws an empty capsule for search in the top bar. */
  private checkDefaultToolbarItem(expr: CallExpr, scope: Scope): void {
    if (expr.callee.kind !== 'identifier' || expr.callee.name !== 'DefaultToolbarItem' || scope.has('DefaultToolbarItem') || this.types.has('DefaultToolbarItem')) return
    const arg = (label: string) => { const value = expr.args.find(a => a.label === label)?.value; return value?.kind === 'memberAccess' && !value.base ? value.member : undefined }
    if (arg('kind') === 'search' && arg('placement') === 'bottomBar') return
    this.report(expr.callee.span, 'warning', 'unsupported_swiftui_view', "'DefaultToolbarItem' is drawn in the preview as the search field in the bottom bar alone, so this one is not drawn here. Xcode draws it as written.", 'DefaultToolbarItem')
  }

  /**
   * A compact adaptation is drawn as a popover's bubble for `.popover` and `.none`, which keeps
   * it one (Wave 6c), and `.sheet` and `.automatic` are the sheet an iPhone shows anyway; any
   * other is shown as a sheet. Of two, the horizontal one counts: a phone held upright is compact across.
   */
  private checkCompactAdaptation(member: string, expr: CallExpr): void {
    if (member !== 'presentationCompactAdaptation') return
    const value = (expr.args.length === 1 && !expr.args[0]!.label ? expr.args[0] : expr.args.find(a => a.label === 'horizontal'))?.value
    if (value?.kind === 'memberAccess' && !value.base && ['popover', 'none', 'sheet', 'automatic'].includes(value.member)) return
    this.report(expr.callee.kind === 'memberAccess' ? expr.callee.memberSpan : expr.span, 'warning', 'unsupported_swiftui_modifier', "'.presentationCompactAdaptation' is drawn by the preview for .popover and .none, and .sheet and .automatic are the sheet an iPhone shows anyway; this one is shown as a sheet. It is exported to Xcode unchanged.", '.presentationCompactAdaptation')
  }

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
      const literal = arg.value, name = literalText(literal)
      if (name === undefined) continue
      if (symbolDefinition(name)) {
        // A value of 1 or more is the full symbol, as the preview draws every one it doesn't dim (Wave 6b).
        const value = args.find(other => other.label === 'variableValue')?.value
        const full = (value?.kind === 'integerLiteral' || value?.kind === 'floatLiteral') && value.value >= 1
        if (value && !full && !symbolDrawsVariableValue(name)) this.report(value.span, 'warning', 'unsupported_swiftui_modifier', `The preview draws '${name}' in full, whatever its variable value. The app fills it part way where the symbol can be.`, 'variableValue')
        continue
      }
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
   * Notes the variant a `.symbolVariant` gives each `.symbolRenderingMode` it is written
   * around, before the chain inside it is checked, as the preview composes the two in either
   * order (Wave 6b). A nearer variant marks the modes inside it itself.
   */
  private markVariant(call: CallExpr): void {
    if (call.callee.kind !== 'memberAccess' || call.callee.member !== 'symbolVariant' || !call.callee.base) return
    const variant = memberChain(call.args[0]?.value, 'SymbolVariants')?.join('.') ?? null
    walk(call.callee.base, node => {
      if (node.kind !== 'call' || node.callee.kind !== 'memberAccess') return
      if (node.callee.member === 'symbolVariant') return false
      if (node.callee.member === 'symbolRenderingMode') this.variantsAround.set(node, variant)
    })
  }

  /**
   * Warns where `.symbolRenderingMode` asks for layers or colours the preview's drawing of a
   * symbol doesn't have (Wave 6b): Hierarchical and Palette shade a drawing of two layers, an
   * enclosed or badged symbol, and Multicolor colours only the symbols in its table; any other
   * stays one colour. Each symbol is the one its variant draws, `heart.circle` for heart with
   * `.circle`, as the preview draws it. Only a literal mode on literal names and variants, the
   * first such one said; a name the preview has no drawing for is said already.
   */
  private checkSymbolRendering(call: CallExpr): void {
    const base = call.callee.kind === 'memberAccess' ? call.callee.base : null, mode = call.args[0]?.value
    const chain = memberChain(mode, 'SymbolRenderingMode'), asked = chain?.length === 1 ? chain[0] : undefined
    if (!base || !isSymbolRenderingMode(asked) || asked === 'monochrome') return
    let flat: string | undefined
    // `variant` is the members of the nearest literal variant, or null for one worked out in Swift.
    const visit = (root: Expr, variant: string | null | undefined) => walk(root, node => {
      if (flat || node.kind !== 'call') return flat ? false : undefined
      if (node.callee.kind === 'memberAccess' && node.callee.member === 'symbolRenderingMode') return false
      if (node.callee.kind === 'memberAccess' && node.callee.member === 'symbolVariant') {
        if (node.callee.base) visit(node.callee.base, memberChain(node.args[0]?.value, 'SymbolVariants')?.join('.') ?? null)
        return false
      }
      const name = literalText(node.args.find(arg => arg.label === 'systemName' || arg.label === 'systemImage')?.value)
      if (name === undefined || variant === null) return
      // The composed name where the preview has a drawing for it, else the name written.
      const composed = symbolVariantName(name, variant), drawn = symbolDefinition(composed) ? composed : name
      if (symbolDefinition(drawn) && !symbolDrawsMode(drawn, asked)) flat = drawn
    })
    visit(base, this.variantsAround.get(call))
    if (!flat) return
    this.report(mode!.span, 'warning', 'unsupported_swiftui_modifier', asked === 'multicolor'
      ? `The preview has no multicolor drawing for '${flat}', so it draws it in one color. The app draws any colors of its own.`
      : `The preview draws '${flat}' in one color, as its drawing here has one layer. The app draws any layers it has.`, '.symbolRenderingMode')
  }

  /**
   * Warns where `.symbolVariant` asks for a symbol the preview has no drawing for: it draws
   * the base symbol (Wave 6a). Whether iOS has the composed one isn't known here, so nothing
   * is said of what the app draws: `folder` with `.square` draws `folder` there too. Only a
   * literal chain, `.fill.circle`, on literal names, the first such one said.
   */
  private checkSymbolVariant(base: Expr | null, variant: Expr | undefined): void {
    const parts = memberChain(variant, 'SymbolVariants')
    if (!base || !parts) return
    // Each symbol named by a literal in what the variant is written on, an Image or Label or a
    // container of them, short of one with a variant of its own.
    let missing: readonly [asked: string, name: string] | undefined
    walk(base, node => {
      if (missing || node.kind === 'call' && node.callee.kind === 'memberAccess' && node.callee.member === 'symbolVariant') return false
      const name = node.kind === 'call' ? literalText(node.args.find(arg => arg.label === 'systemName' || arg.label === 'systemImage')?.value) : undefined
      if (name === undefined) return
      const asked = symbolVariantName(name, parts.join('.'))
      if (asked !== name && !symbolDefinition(asked) && symbolDefinition(name)) missing = [asked, name]
    })
    if (missing) this.report(variant!.span, 'warning', 'unsupported_swiftui_modifier', `The preview has no drawing for the symbol '${missing[0]}', so it draws '${missing[1]}'.`, '.symbolVariant')
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

/** What the preview says of a real SwiftUI modifier it does not apply, which Xcode builds as written. */
function notApplied(member: string): string {
  return `'.${member}' is recognized but not applied by the preview. It is exported to Xcode unchanged.`
}

/** A gradient written as a shape's paint, which a shape mask doesn't cut with in the preview (Wave 6a). */
const GRADIENTS: ReadonlySet<string> = new Set(['LinearGradient', 'RadialGradient', 'AngularGradient', 'EllipticalGradient', 'Gradient', 'linearGradient', 'radialGradient', 'angularGradient', 'ellipticalGradient'])

/** A chain's root, the names of the calls made on it, the first argument of each, and what each `.overlay` lays over it. */
function chainOf(expr: Expr): { root: Expr; calls: string[]; firsts: Expr[]; overlays: Expr[] } {
  const calls: string[] = [], firsts: Expr[] = [], overlays: Expr[] = []
  let root = expr
  while (root.kind === 'call' && root.callee.kind === 'memberAccess' && root.callee.base) {
    calls.push(root.callee.member)
    const first = root.args[0]?.value, only = root.trailingClosure?.body.statements.length === 1 ? root.trailingClosure.body.statements[0] : undefined
    if (first) firsts.push(first)
    const laid = root.callee.member !== 'overlay' ? undefined : first ?? (only?.kind === 'exprStmt' ? only.expression : undefined)
    if (laid) overlays.push(laid)
    root = root.callee.base
  }
  return { root, calls, firsts, overlays }
}

/** Whether a paint is a gradient: `LinearGradient(…)`, `Gradient(…)` or `.linearGradient(…)`. */
function isGradient(paint: Expr): boolean {
  const callee = rootCall(paint)?.callee
  return callee?.kind === 'identifier' ? GRADIENTS.has(callee.name) : callee?.kind === 'memberAccess' && !callee.base && GRADIENTS.has(callee.member)
}

/** The view or type a chain's root names: `Circle` for `Circle()`, `Color` for `Color.blue` or `.blue`. */
function paintName(root: Expr): string | null {
  return root.kind === 'call' && root.callee.kind === 'identifier' ? root.callee.name
    : root.kind === 'memberAccess' && root.base?.kind === 'identifier' ? root.base.name
      : root.kind === 'memberAccess' && !root.base ? 'Color'
        : null
}

/** Attributed words: `backgroundColor` on these is kept and not drawn (Wave 6a). */
const WORDS_TYPES: ReadonlySet<string> = new Set(['AttributedString', 'AttributeContainer'])
/** Whether a declaration holds attributed words: written as their type, or made by its initialiser. */
function holdsWords(type: TypeRef | null, value: Expr | null = null): boolean {
  const named = type?.kind === 'optionalType' ? type.wrapped : type
  if (named) return named.kind === 'namedType' && WORDS_TYPES.has(named.name)
  while (value?.kind === 'try') value = value.operand
  return value?.kind === 'call' && value.callee.kind === 'identifier' && WORDS_TYPES.has(value.callee.name)
}

/** The call a chain starts at: `Image(…)` for `Image(…).resizable()`. */
function rootCall(expr: Expr): Extract<Expr, { kind: 'call' }> | undefined {
  let current: Expr = expr
  while (current.kind === 'call' && current.callee.kind === 'memberAccess' && current.callee.base) current = current.callee.base
  return current.kind === 'call' ? current : undefined
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

const FONT_TEXT_STYLES: ReadonlySet<string> = new Set(TEXT_STYLES)
/** What a `Font` answers with another `Font`: `.title.bold()`. */
const FONT_MEMBERS: ReadonlySet<string> = new Set([
  'bold', 'italic', 'weight', 'width', 'leading', 'smallCaps', 'lowercaseSmallCaps', 'uppercaseSmallCaps', 'monospaced', 'monospacedDigit',
])

function isFontType(expr: Expr): boolean {
  return expr.kind === 'identifier' && expr.name === 'Font'
}

/** `.body`, `Font.title`, `.system(size: 20)` and any of those changed by a `Font` member. */
function isFontExpression(expr: Expr | null): boolean {
  if (!expr) return false
  if (expr.kind === 'memberAccess') return (expr.base === null || isFontType(expr.base)) && FONT_TEXT_STYLES.has(expr.member)
  if (expr.kind !== 'call' || expr.callee.kind !== 'memberAccess') return false
  const { base, member } = expr.callee
  if (member === 'system' || member === 'custom') return base === null || isFontType(base)
  return FONT_MEMBERS.has(member) && isFontExpression(base)
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
  return viewRoot(expr) !== undefined
}

/** The name of the view a chain starts at, `Text` for `Text("a").bold()`, when it is one `rootsInAView` takes. */
function viewRoot(expr: Expr | null): string | undefined {
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
    return current.kind === 'identifier' && isViewRoot(current.name) ? current.name : undefined
  }

  return undefined
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

/** Every type name a type refers to, through optionals, collections, generics, tuples and functions. */
function namedIn(type: TypeRef | null): string[] {
  if (!type) return []
  switch (type.kind) {
    case 'namedType':
      return [type.name, ...type.generics.flatMap(namedIn)]
    case 'optionalType':
      return namedIn(type.wrapped)
    case 'arrayType':
      return namedIn(type.element)
    case 'dictionaryType':
      return [...namedIn(type.key), ...namedIn(type.value)]
    case 'someType':
      return namedIn(type.constraint)
    case 'functionType':
      return [...type.params.flatMap(namedIn), ...namedIn(type.result)]
    case 'tupleType':
      return type.elements.flatMap(namedIn)
    default:
      return []
  }
}
