import type { Diagnostic, FixIt, SourceSpan } from '@studio/shared'
import type {
  Block,
  Condition,
  Decl,
  Expr,
  FuncDecl,
  InitDecl,
  Param,
  Pattern,
  SourceFileNode,
  Stmt,
  StructDecl,
  TypeRef,
  VarDecl,
} from '@studio/swift-syntax'
import type { SemanticModel } from './model'

/**
 * The strictness pass - risk R5.
 *
 * The interpreter is deliberately forgiving: it has no full type system, so it will
 * happily run code that `swiftc` refuses to compile. That forgiveness is what makes
 * the preview responsive while you type, and it is also the product's single most
 * dangerous failure mode - code that works here and fails the moment it reaches
 * Xcode makes the export worthless.
 *
 * This pass closes the gap from the other side: rather than making the interpreter
 * strict, it looks for the specific constructs known to diverge and says so.
 *
 * **The governing rule is the same one Phase 1's gate 4 set: a false positive is
 * worse than a missed error.** Every check here only fires when the type involved is
 * known with certainty - from a literal, or from an explicit annotation. Anything
 * inferred through a chain of assumptions is left alone, because a warning on
 * correct code teaches people to ignore the panel, and then the real ones go unread
 * too.
 *
 * Severity is always `warning`, never `error`: the preview must keep running. What
 * the user gets is a heads-up that Xcode will disagree, with a fix-it where the
 * correction is unambiguous.
 */

const CODE = 'may_not_compile_in_xcode'

/** What Xcode says of `specifier:` or `format:` in an interpolation that makes a String, and what to write. */
const TITLE_ONLY: Readonly<Record<string, string>> = {
  specifier: "Incorrect argument label in call (have '_:specifier:', expected '_:default:'). Xcode takes `specifier:` only in a title, such as `Text(\"…\")`, and this is a String; the preview applies it. Use `String(format:)` here instead.",
  format: "Extra argument 'format' in call. Xcode takes `format:` only in a title, such as `Text(\"…\")`, and this is a String; the preview applies it. Use the value's `formatted(_:)` here instead.",
}

/** The types this pass is willing to claim it knows. */
type Known = 'Int' | 'Double' | 'String' | 'Bool' | 'unknown'

interface Binding {
  readonly type: Known
  readonly isLet: boolean
  readonly span: SourceSpan
  /** The element type, when this is an array of a user struct. */
  readonly elementType: string | null
}

export function lintStrictness(
  files: readonly SourceFileNode[],
  model: SemanticModel,
): Diagnostic[] {
  return new StrictnessLinter(model).run(files)
}

class StrictnessLinter {
  private readonly diagnostics: Diagnostic[] = []
  /** Names in scope, innermost last. */
  private readonly scopes: Map<string, Binding>[] = [new Map()]
  /** Struct and class declarations by name, so an extension knows what it extends. */
  private readonly owners = new Map<string, StructDecl>()
  /** Whether the statements being walked are a view builder's, where Xcode takes views and not code. */
  private inBuilder = false

  constructor(private readonly model: SemanticModel) {}

  run(files: readonly SourceFileNode[]): Diagnostic[] {
    // Struct and class declarations are indexed first so that an extension can be
    // linted against the type it extends. Without the owner, an extension method on a
    // *class* would be told to declare itself `mutating` - a warning on correct Swift,
    // which is the one thing this pass must never do.
    for (const file of files) {
      for (const decl of file.declarations) {
        if (decl.kind === 'structDecl') this.owners.set(decl.name, decl)
      }
    }

    for (const file of files) {
      for (const decl of file.declarations) this.declaration(decl)
    }
    return this.diagnostics
  }

  // ------------------------------------------------------------- declarations

  private declaration(decl: Decl): void {
    switch (decl.kind) {
      case 'structDecl':
        this.struct(decl)
        return
      case 'extensionDecl':
        this.members(decl.members, this.owners.get(decl.name) ?? null)
        return
      case 'protocolDecl':
        // A protocol's defaults have no concrete `self`, so `mutating` cannot be
        // judged. Only the bodies are walked.
        this.members(decl.members, null)
        return
      case 'funcDecl':
        this.func(decl)
        return
      case 'varDecl':
        this.variable(decl, null)
        return
      default:
        return
    }
  }

  private struct(decl: StructDecl): void {
    this.members(decl.members, decl)
  }

  private members(members: readonly Decl[], owner: StructDecl | null): void {
    this.push()
    try {
      // Properties are visible to every member, so they are declared before any
      // body is walked rather than as each is reached.
      for (const member of members) {
        if (member.kind === 'varDecl') this.declare(member.name, this.bindingFor(member))
      }
      for (const member of owner?.members ?? []) {
        if (member.kind === 'varDecl') this.declare(member.name, this.bindingFor(member))
      }

      for (const member of members) {
        if (member.kind === 'varDecl') {
          this.propertyWrapperOnLet(member)
          this.declaredStrings(member)
          if (member.initializer) this.withBuilder(false, () => this.expression(member.initializer!))
          const accessor = member.accessor
          if (accessor) this.withBuilder(isViewBody(member, owner) && !containsReturn(accessor), () => this.block(accessor))
        } else if (member.kind === 'funcDecl') {
          this.func(member, owner)
        }
      }
    } finally {
      this.pop()
    }
  }

  private func(decl: FuncDecl, owner: StructDecl | null = null): void {
    this.push()
    try {
      for (const param of decl.params) {
        this.declare(param.internalName, {
          type: knownOf(param.type),
          // A parameter is a constant - except an `inout` one, which is a reference
          // to the caller's storage and exists precisely to be written. Declaring it
          // a `let` made `func bump(_ x: inout Int) { x += 1 }`, the whole point of
          // the feature, report that `x` is a constant.
          isLet: !param.isInout,
          span: param.span,
          elementType: elementTypeOf(param.type),
        })
      }
      const body = decl.body
      if (body) {
        this.missingReturn(decl)
        this.mutatingSelf(decl, owner)
        if (knownOf(decl.returnType) === 'String') resultsOf(body).forEach((result) => this.titleOnlyOptions(result))
        this.withBuilder(decl.attributes.some((a) => a.name === 'ViewBuilder') && !containsReturn(body), () => this.block(body))
      }
    } finally {
      this.pop()
    }
  }

  private variable(decl: VarDecl, _owner: StructDecl | null): void {
    this.declaredStrings(decl)
    if (decl.initializer) this.expression(decl.initializer)
    if (decl.accessor) this.block(decl.accessor)
    this.declare(decl.name, this.bindingFor(decl))
  }

  // --------------------------------------------------------------- statements

  private block(block: Block): void {
    this.push()
    try {
      for (const statement of block.statements) this.statement(statement)
    } finally {
      this.pop()
    }
  }

  private statement(statement: Stmt): void {
    if (this.inBuilder) {
      const rejected = rejectedInBuilder(statement)
      if (rejected) {
        this.report(statement.span, rejected)
        // Once, as Xcode reports it: what the rejected statement holds is code, not
        // views, and the other checks still read it as such.
        this.withBuilder(false, () => this.statement(statement))
        return
      }
    }
    switch (statement.kind) {
      case 'exprStmt':
        this.expression(statement.expression)
        return
      case 'declStmt':
        this.declaration(statement.declaration)
        return
      case 'returnStmt':
        if (statement.value) this.expression(statement.value)
        return
      case 'ifStmt':
        // What `if let` binds is in scope in its own branch only. Declared in the
        // enclosing scope, the name reached the `else` branch and every line after the
        // `if`, and assigning there to the property it shadows was reported as
        // assigning to a constant: a warning on Swift that Xcode builds.
        this.push()
        try {
          this.conditions(statement.conditions)
          this.block(statement.then)
        } finally {
          this.pop()
        }
        if (statement.else?.kind === 'block') this.block(statement.else)
        else if (statement.else) this.statement(statement.else)
        return

      case 'guardStmt':
        this.conditions(statement.conditions)
        this.block(statement.else)
        return

      case 'whileStmt':
        this.push()
        try {
          this.conditions(statement.conditions)
          this.block(statement.body)
        } finally {
          this.pop()
        }
        return

      case 'repeatStmt':
        this.block(statement.body)
        this.expression(statement.condition)
        return

      case 'switchStmt':
        this.expression(statement.subject)
        for (const branch of statement.cases) {
          this.push()
          try {
            for (const pattern of branch.patterns) this.bindPattern(pattern)
            if (branch.where) this.expression(branch.where)
            for (const inner of branch.body.statements) this.statement(inner)
          } finally {
            this.pop()
          }
        }
        return
      case 'forInStmt': {
        this.expression(statement.sequence)
        this.push()
        try {
          this.declare(statement.variable, {
            type: 'unknown',
            isLet: true,
            span: statement.variableSpan,
            elementType: null,
          })
          for (const inner of statement.body.statements) this.statement(inner)
        } finally {
          this.pop()
        }
        return
      }
      default:
        return
    }
  }

  /**
   * Walks a condition list, declaring anything it binds.
   *
   * The bound type is left unknown: an optional binding unwraps something whose type
   * this pass cannot see through, and claiming one would be a guess. Every check here
   * stays silent on `unknown`, so that is the correct answer rather than a gap.
   */
  private conditions(conditions: readonly Condition[]): void {
    for (const condition of conditions) {
      if (condition.kind === 'expr') {
        this.expression(condition.expr)
        continue
      }
      if (condition.kind === 'optionalBinding') {
        this.expression(condition.value)
        this.declare(condition.name, {
          type: 'unknown',
          isLet: condition.isLet,
          span: condition.nameSpan,
          elementType: null,
        })
        continue
      }
      this.expression(condition.value)
      this.bindPattern(condition.pattern)
    }
  }

  private bindPattern(pattern: Pattern): void {
    if (pattern.kind === 'binding') {
      this.declare(pattern.name, {
        type: 'unknown',
        isLet: pattern.isLet,
        span: pattern.span,
        elementType: null,
      })
      return
    }
    if (pattern.kind === 'enumCase') {
      for (const binding of pattern.bindings) {
        if (binding.isWildcard) continue
        this.declare(binding.name, {
          type: 'unknown',
          isLet: true,
          span: binding.span,
          elementType: null,
        })
      }
      return
    }
    if (pattern.kind === 'value' || pattern.kind === 'range') this.expression(pattern.value)
  }

  // -------------------------------------------------------------- expressions

  private expression(expr: Expr): void {
    switch (expr.kind) {
      case 'binary':
        this.expression(expr.left)
        this.expression(expr.right)
        this.mixedOperands(expr.operator, expr.left, expr.right, expr.span)
        if (expr.operator === '+') [expr.left, expr.right].forEach((operand) => this.titleOnlyOptions(operand))
        return

      case 'assign':
        this.expression(expr.value)
        this.assignmentToLet(expr.target, expr.span)
        if ((expr.operator === '=' || expr.operator === '+=') && this.typeOf(expr.target) === 'String') this.titleOnlyOptions(expr.value)
        return

      case 'call':
        this.call(expr)
        return

      case 'memberAccess':
        if (expr.base) this.expression(expr.base)
        return

      case 'unary':
        this.expression(expr.operand)
        return

      case 'ternary':
        this.expression(expr.condition)
        this.expression(expr.then)
        this.expression(expr.else)
        return

      case 'closure':
        expr.captures?.forEach(capture => this.expression(capture.value))
        this.withBuilder(false, () => this.block(expr.body))
        return

      case 'arrayLiteral':
        for (const element of expr.elements) this.expression(element)
        return

      case 'stringLiteral':
        for (const segment of expr.segments) {
          if (segment.kind !== 'interpolation') continue
          this.expression(segment.expression)
          segment.options?.forEach((option) => this.expression(option.value))
        }
        return

      case 'subscript':
        this.expression(expr.base)
        for (const arg of expr.args) this.expression(arg.value)
        return

      case 'forceUnwrap':
      case 'optionalChain':
        this.expression(expr.operand)
        return

      default:
        return
    }
  }

  private call(expr: Expr & { kind: 'call' }): void {
    // A view's content closure is a view builder, as the body is: `VStack { … }`,
    // `ForEach(items) { … }`, `.sheet { … }`. A button's action or an `onAppear` is
    // ordinary code, and so is any closure this pass cannot be sure of.
    const content = (label: string | null, body: Block) => this.withBuilder(buildsViews(expr, label) && !containsReturn(body), () => this.block(body))
    for (const arg of expr.args) {
      if (arg.value.kind === 'closure') {
        const closure = arg.value
        closure.captures?.forEach(capture => this.expression(capture.value))
        content(arg.label, closure.body)
      } else {
        this.withBuilder(false, () => this.expression(arg.value))
        if (expr.callee.kind === 'identifier' && this.takesString(expr.callee.name, arg.label)) this.titleOnlyOptions(arg.value)
      }
    }
    if (expr.trailingClosure) content(null, expr.trailingClosure.body)
    if (expr.callee.kind === 'memberAccess' && expr.callee.base) this.expression(expr.callee.base)

    if (expr.callee.kind !== 'identifier') return

    switch (expr.callee.name) {
      case 'Text':
        this.textTakesAString(expr)
        return
      case 'ForEach':
        this.forEachNeedsIdentity(expr)
        return
      default:
        this.argumentLabels(expr, expr.callee.name)
    }
  }

  // ------------------------------------------------------------------- checks

  /**
   * Swift will not mix `Int` and `Double` in arithmetic - there is no implicit
   * numeric conversion, in either direction.
   *
   * By far the most common "but it worked in the preview" report, because the
   * interpreter promotes freely. An *integer* literal is exempt: it adopts whatever
   * type the other side has, which is why `someDouble * 2` is fine while
   * `someInt * 2.0` is not.
   */
  private mixedOperands(operator: string, left: Expr, right: Expr, span: SourceSpan): void {
    if (!ARITHMETIC.has(operator) && !COMPARISON.has(operator)) return

    const lhs = this.typeOf(left)
    const rhs = this.typeOf(right)
    if (lhs === 'unknown' || rhs === 'unknown' || lhs === rhs) return

    // An integer literal takes its type from context, so it never mismatches.
    if (isIntegerLiteral(left) && rhs === 'Double') return
    if (isIntegerLiteral(right) && lhs === 'Double') return

    this.report(
      span,
      `Binary operator '${operator}' cannot be applied to operands of type '${lhs}' and '${rhs}'. ` +
        `Swift does not convert between numeric types implicitly; the preview does, so this runs here and fails to build.`,
      numericFixIt(operator, left, right, lhs, rhs),
    )
  }

  /**
   * `Text` takes a string.
   *
   * `Text(count)` is the single most common Xcode-only failure in SwiftUI code,
   * because the preview renders the number quite happily. The fix-it is exact, which
   * is the main reason this check earns its place.
   */
  private textTakesAString(expr: Expr & { kind: 'call' }): void {
    const first = expr.args.find((a) => a.label === null)
    if (!first || expr.args.length !== 1) return

    const type = this.typeOf(first.value)
    if (type !== 'Int' && type !== 'Double' && type !== 'Bool') return

    const source = sourceOf(first.value)
    this.report(
      first.value.span,
      `'Text' cannot be initialised with a value of type '${type}'. The preview converts it; Xcode will not.`,
      source
        ? {
            title: `Interpolate into a string`,
            edits: [{ span: first.value.span, newText: `"\\(${source})"` }],
          }
        : undefined,
    )
  }

  /**
   * `specifier:` and `format:` in an interpolation belong to a title, which is a
   * `LocalizedStringKey`: `Text("\(km, specifier: "%.1f") km")`. A String refuses them,
   * and the preview applies them either way. Only a literal that is a String for certain
   * is checked: a declaration's value with no other type written, what a `String`
   * property or function gives back, an assignment to a String, `Text(verbatim:)`, a
   * `String` parameter of the project's own type or function, and one side of a `+`,
   * where what Xcode says depends on what is around it.
   */
  private titleOnlyOptions(expr: Expr): void {
    if (expr.kind !== 'stringLiteral') return
    for (const segment of expr.segments) {
      if (segment.kind !== 'interpolation') continue
      for (const option of segment.options ?? []) {
        const message = option.label ? TITLE_ONLY[option.label] : undefined
        if (message) this.report(option.span, message)
      }
    }
  }

  /** A declaration's literals that are Strings: its value, with no other type written, and what a `String` getter gives back. */
  private declaredStrings(decl: VarDecl): void {
    const type = decl.typeAnnotation
    if (decl.initializer && (!type || knownOf(type) === 'String')) this.titleOnlyOptions(decl.initializer)
    if (decl.accessor && knownOf(type) === 'String') resultsOf(decl.accessor).forEach((result) => this.titleOnlyOptions(result))
  }

  /** Whether `name(label: …)` takes a String there: `Text(verbatim:)`, or a `String` parameter of the project's own type or function. */
  private takesString(name: string, label: string | null): boolean {
    if (name === 'Text') return label === 'verbatim'
    const owner = this.owners.get(name)
    const inits = owner?.members.filter((member): member is InitDecl => member.kind === 'initDecl') ?? []
    // A struct with no init written has the memberwise one: a label for each stored property.
    if (owner && !owner.isReference && !inits.length) {
      return owner.members.some((member) => member.kind === 'varDecl' && member.name === label && !member.accessor && !member.attributes.length && knownOf(member.typeAnnotation) === 'String')
    }
    const params = owner ? (inits.length === 1 ? inits[0]!.params : []) : this.findFunction(name)?.params ?? []
    return params.some((param) => labelOf(param) === label && knownOf(param.type) === 'String')
  }

  /**
   * `ForEach` over a collection needs identity.
   *
   * Either the element conforms to `Identifiable`, or an `id:` key path is supplied.
   * The preview falls back to the element's position, which is both wrong on reorder
   * and accepted where Xcode reports a missing conformance.
   */
  private forEachNeedsIdentity(expr: Expr & { kind: 'call' }): void {
    if (expr.args.some((a) => a.label === 'id')) return

    const first = expr.args.find((a) => a.label === null)
    if (!first) return

    // A range is `Identifiable` enough: `ForEach(0..<n)` is the documented form.
    if (first.value.kind === 'binary' && RANGE_OPERATORS.has(first.value.operator)) return

    const element = this.elementTypeOf(first.value)
    if (!element) return

    const type = this.model.types.get(element)
    if (!type) return
    if (type.conformances.includes('Identifiable')) return
    if (type.properties.some((p) => p.name === 'id')) return

    this.report(
      first.value.span,
      `'${element}' does not conform to 'Identifiable', so this 'ForEach' needs an 'id:' argument. ` +
        `The preview falls back to position; Xcode reports a missing conformance.`,
      {
        title: `Identify each element by itself`,
        edits: [{ span: { ...first.value.span, start: first.value.span.end }, newText: ', id: \\.self' }],
      },
    )
  }

  /**
   * Argument labels are part of a function's name in Swift.
   *
   * The interpreter matches positionally, so it accepts a call that omits them.
   * Only user-declared functions are checked - the built-in surface has too many
   * overloads to be confident about.
   */
  private argumentLabels(expr: Expr & { kind: 'call' }, name: string): void {
    const fn = this.findFunction(name)
    if (!fn) return

    const positional = expr.args.filter((a) => a.label === null)
    if (positional.length === 0) return

    // Only the simple, unambiguous case: every argument given positionally.
    if (expr.args.length !== positional.length) return
    if (fn.params.length !== expr.args.length) return

    const missing = fn.params
      .map((param, index) => ({ param, arg: expr.args[index]! }))
      .filter(({ param }) => param.externalName !== '_')

    if (missing.length === 0) return

    const edits = missing.map(({ param, arg }) => ({
      span: { ...arg.value.span, end: arg.value.span.start },
      newText: `${param.externalName ?? param.internalName}: `,
    }))

    this.report(
      expr.span,
      `Missing argument label${missing.length === 1 ? '' : 's'} ` +
        `${missing.map((m) => `'${m.param.externalName ?? m.param.internalName}:'`).join(', ')} in call to '${name}'. ` +
        `Labels are part of a function's name in Swift; the preview matches by position.`,
      { title: 'Add the argument labels', edits },
    )
  }

  /** `@State` and the other property wrappers require `var`, never `let`. */
  private propertyWrapperOnLet(decl: VarDecl): void {
    if (!decl.isLet) return
    const wrapper = decl.attributes.find((a) => WRAPPERS.has(a.name))
    if (!wrapper) return

    this.report(
      decl.span,
      `Property wrapper '@${wrapper.name}' can only be applied to a 'var'. The preview treats it as one.`,
      { title: `Change 'let' to 'var'`, edits: [{ span: letSpan(decl), newText: 'var' }] },
    )
  }

  /** Assigning to a `let` is a compile error, not a runtime trap. */
  private assignmentToLet(target: Expr, span: SourceSpan): void {
    if (target.kind !== 'identifier') return
    const binding = this.lookup(target.name)
    if (!binding?.isLet) return

    this.report(
      span,
      `Cannot assign to value: '${target.name}' is a 'let' constant. ` +
        `Xcode rejects this at compile time; the preview only fails when the line runs.`,
      { title: `Change 'let' to 'var'`, edits: [{ span: binding.span, newText: 'var' }] },
    )
  }

  /**
   * A method that writes to `self` must be declared `mutating`.
   *
   * Except through a property wrapper, which is the case this used to get exactly
   * backwards. `@State`, `@Binding` and every other SwiftUI wrapper has a
   * **nonmutating** setter - that is precisely what lets `body`, which is a
   * non-mutating computed property, write to them at all. So `func bump() { count
   * += 1 }` next to `@State private var count` is not just legal, it is the single
   * most common shape in SwiftUI, and this fired on it and offered to insert
   * `mutating` - after which `body` can no longer call the method and Xcode rejects
   * the file. A warning that is wrong is bad; a fix-it that breaks working code is
   * worse, and this was both.
   *
   * The test is "carries any attribute at all" rather than a list of the wrappers
   * SwiftUI ships, because a wrapper the project declared itself is on no list, and
   * whether its setter is mutating cannot be known from here. The cost of the wider
   * test is a missed warning on `@available var n = 0`, which is the direction the
   * house rule asks to err in.
   */
  private mutatingSelf(decl: FuncDecl, owner: StructDecl | null): void {
    if (!owner || !decl.body) return
    // Only value types need `mutating`. A class method writing a property is
    // ordinary, correct Swift - flagging it would be a warning on working code.
    if (owner.isReference) return
    if (decl.modifiers.some((m) => m.name === 'mutating' || m.name === 'static')) return

    const stored = new Set(
      owner.members
        .filter(
          (m): m is VarDecl =>
            m.kind === 'varDecl' &&
            m.accessor === null &&
            !m.isLet &&
            m.attributes.length === 0,
        )
        .map((m) => m.name),
    )
    if (stored.size === 0) return

    const written = findAssignedNames(decl.body).find((n) => stored.has(n))
    if (!written) return

    this.report(
      decl.nameSpan,
      `'${decl.name}' assigns to '${written}' but is not declared 'mutating'. ` +
        `A struct method that changes a property must be; the preview allows it.`,
      {
        title: `Mark '${decl.name}' as mutating`,
        edits: [{ span: { ...decl.span, end: decl.span.start }, newText: 'mutating ' }],
      },
    )
  }

  /**
   * A function with a return type must return on every path.
   *
   * Restricted to plain `func`s with a multi-statement body and no `return` anywhere:
   * a result builder (`var body: some View`) legitimately has neither, so computed
   * properties and `@ViewBuilder` functions are excluded rather than special-cased.
   */
  private missingReturn(decl: FuncDecl): void {
    if (!decl.returnType || !decl.body) return
    if (decl.attributes.some((a) => a.name === 'ViewBuilder')) return
    if (decl.body.statements.length <= 1) return
    if (containsReturn(decl.body)) return

    this.report(
      decl.nameSpan,
      `Missing return in a function expected to return a value. ` +
        `Swift's implicit return applies only to a single-expression body.`,
    )
  }

  // ------------------------------------------------------------------ scopes

  /** Walks `walk` with the builder flag set to `on`, and puts it back. */
  private withBuilder(on: boolean, walk: () => void): void {
    const outer = this.inBuilder
    this.inBuilder = on
    try {
      walk()
    } finally {
      this.inBuilder = outer
    }
  }

  private push(): void {
    this.scopes.push(new Map())
  }

  private pop(): void {
    if (this.scopes.length > 1) this.scopes.pop()
  }

  private declare(name: string, binding: Binding): void {
    this.scopes[this.scopes.length - 1]!.set(name, binding)
  }

  private lookup(name: string): Binding | undefined {
    for (let i = this.scopes.length - 1; i >= 0; i--) {
      const found = this.scopes[i]!.get(name)
      if (found) return found
    }
    return undefined
  }

  private bindingFor(decl: VarDecl): Binding {
    const annotated = knownOf(decl.typeAnnotation)
    return {
      type: annotated !== 'unknown' ? annotated : this.typeOf(decl.initializer),
      isLet: decl.isLet,
      span: letSpan(decl),
      elementType:
        elementTypeOf(decl.typeAnnotation) ?? this.elementOfLiteral(decl.initializer),
    }
  }

  private findFunction(name: string): FuncDecl | null {
    for (const type of this.model.types.values()) {
      const found = type.methods.find((m) => m.name === name)
      if (found) return found
    }
    return null
  }

  // ------------------------------------------------------------- inference

  /**
   * The type of an expression, or `unknown`.
   *
   * Deliberately shallow. Everything it reports is derived from a literal or an
   * explicit annotation, so a wrong answer needs a wrong annotation - which is the
   * only way to keep the false-positive rate at the zero this pass needs.
   */
  private typeOf(expr: Expr | null): Known {
    if (!expr) return 'unknown'

    switch (expr.kind) {
      case 'integerLiteral':
        return 'Int'
      case 'floatLiteral':
        return 'Double'
      case 'stringLiteral':
        return 'String'
      case 'booleanLiteral':
        return 'Bool'

      case 'identifier':
        return this.lookup(expr.name)?.type ?? 'unknown'

      case 'binary': {
        if (COMPARISON.has(expr.operator) || LOGICAL.has(expr.operator)) return 'Bool'
        if (!ARITHMETIC.has(expr.operator)) return 'unknown'
        const lhs = this.typeOf(expr.left)
        const rhs = this.typeOf(expr.right)
        if (lhs === rhs) return lhs
        // A mismatch is reported elsewhere; claiming a type for it here would make
        // the error cascade into every expression that uses it.
        return 'unknown'
      }

      case 'unary':
        return expr.operator === '!' ? 'Bool' : this.typeOf(expr.operand)

      case 'ternary': {
        const then = this.typeOf(expr.then)
        return then === this.typeOf(expr.else) ? then : 'unknown'
      }

      case 'call':
        // `Int(x)` and `Double(x)` are conversions, and their names are their types.
        if (expr.callee.kind === 'identifier') {
          const name = expr.callee.name
          if (name === 'Int' || name === 'Double' || name === 'String' || name === 'Bool') {
            return name
          }
        }
        return 'unknown'

      default:
        return 'unknown'
    }
  }

  /** The user type an expression's elements have, when that is knowable. */
  private elementTypeOf(expr: Expr): string | null {
    if (expr.kind === 'identifier') {
      const binding = this.lookup(expr.name)
      if (binding?.elementType) return binding.elementType
    }
    if (expr.kind === 'memberAccess') return null
    return this.elementOfLiteral(expr)
  }

  private elementOfLiteral(expr: Expr | null): string | null {
    if (expr?.kind !== 'arrayLiteral') return null

    const names = expr.elements.map((element) =>
      element.kind === 'call' && element.callee.kind === 'identifier' ? element.callee.name : null,
    )
    const first = names[0]
    return first && names.every((n) => n === first) ? first : null
  }

  private report(span: SourceSpan, message: string, fixIt?: FixIt): void {
    this.diagnostics.push({
      span,
      severity: 'warning',
      code: CODE,
      message,
      ...(fixIt ? { fixIts: [fixIt] } : {}),
    })
  }
}

// -------------------------------------------------------------------- helpers

const ARITHMETIC: ReadonlySet<string> = new Set(['+', '-', '*', '/', '%'])
const COMPARISON: ReadonlySet<string> = new Set(['<', '<=', '>', '>=', '==', '!='])
const LOGICAL: ReadonlySet<string> = new Set(['&&', '||'])
const RANGE_OPERATORS: ReadonlySet<string> = new Set(['..<', '...'])

const WRAPPERS: ReadonlySet<string> = new Set([
  'State', 'StateObject', 'ObservedObject', 'EnvironmentObject', 'Environment',
  'Published', 'AppStorage', 'SceneStorage', 'FocusState', 'GestureState', 'Binding',
])

function isIntegerLiteral(expr: Expr): boolean {
  if (expr.kind === 'integerLiteral') return true
  // `-1` is a negated literal and adapts the same way.
  return expr.kind === 'unary' && expr.operator === '-' && expr.operand.kind === 'integerLiteral'
}

/**
 * A fix-it for a numeric mismatch.
 *
 * Only offered where the correction is unambiguous: wrapping the `Int` side in
 * `Double(…)`. Converting the other way loses the fraction, so that one is left for
 * the user to decide.
 */
function numericFixIt(
  operator: string,
  left: Expr,
  right: Expr,
  lhs: Known,
  rhs: Known,
): FixIt | undefined {
  if (lhs !== 'Int' && rhs !== 'Int') return undefined
  if (lhs !== 'Double' && rhs !== 'Double') return undefined

  const intSide = lhs === 'Int' ? left : right
  const source = sourceOf(intSide)
  if (!source) return undefined

  void operator
  return {
    title: `Convert to Double`,
    edits: [{ span: intSide.span, newText: `Double(${source})` }],
  }
}

/**
 * The source text of a simple expression, for building a fix-it.
 *
 * Only names and member chains, because those are the cases where splicing the text
 * back in is certainly correct. Anything else returns null and the fix-it is omitted
 * rather than guessed at.
 */
function sourceOf(expr: Expr): string | null {
  if (expr.kind === 'identifier') return expr.name
  if (expr.kind === 'selfExpr') return 'self'
  if (expr.kind === 'memberAccess') {
    if (!expr.base) return `.${expr.member}`
    const base = sourceOf(expr.base)
    return base ? `${base}.${expr.member}` : null
  }
  return null
}

function knownOf(type: TypeRef | null): Known {
  if (!type) return 'unknown'
  if (type.kind !== 'namedType') return 'unknown'
  switch (type.name) {
    case 'Int':
    case 'Double':
    case 'String':
    case 'Bool':
      return type.name
    case 'CGFloat':
    case 'Float':
      return 'Double'
    default:
      return 'unknown'
  }
}

function elementTypeOf(type: TypeRef | null): string | null {
  if (!type) return null
  if (type.kind === 'arrayType' && type.element.kind === 'namedType') return type.element.name
  if (type.kind === 'namedType' && type.name === 'Array' && type.generics[0]?.kind === 'namedType') {
    return (type.generics[0] as { name: string }).name
  }
  return null
}

/** The span of a declaration's `let`/`var` keyword, for a fix-it that swaps it. */
function letSpan(decl: VarDecl): SourceSpan {
  return { ...decl.span, end: decl.span.start + (decl.isLet ? 3 : 3) }
}

/**
 * Whether a body returns, outside the closures in it. Swift builds views only from a
 * body that does not: a `return` anywhere makes it ordinary code, loops and all.
 */
function containsReturn(block: Block): boolean {
  let found = false
  walkStatements(block, (statement) => {
    if (statement.kind === 'returnStmt') found = true
  })
  return found
}

/** What a body gives back: its one expression, or the value of each `return` in it. */
function resultsOf(body: Block): Expr[] {
  const only = body.statements.length === 1 ? body.statements[0] : undefined
  if (only?.kind === 'exprStmt') return [only.expression]
  const results: Expr[] = []
  walkStatements(body, (statement) => {
    if (statement.kind === 'returnStmt' && statement.value) results.push(statement.value)
  })
  return results
}

/** The label a call gives a parameter, null for one written `_`. */
function labelOf(param: Param): string | null {
  return param.externalName === '_' ? null : param.externalName ?? param.internalName
}

/** Every name assigned to anywhere in a body, including nested closures. */
function findAssignedNames(block: Block): string[] {
  const names: string[] = []

  const visitExpr = (expr: Expr): void => {
    if (expr.kind === 'assign') {
      if (expr.target.kind === 'identifier') names.push(expr.target.name)
      if (expr.target.kind === 'memberAccess' && expr.target.base?.kind === 'selfExpr') {
        names.push(expr.target.member)
      }
      visitExpr(expr.value)
      return
    }
    if (expr.kind === 'closure') walkStatements(expr.body, (s) => visitStatement(s))
    if (expr.kind === 'binary') {
      visitExpr(expr.left)
      visitExpr(expr.right)
    }
    if (expr.kind === 'call') {
      for (const arg of expr.args) visitExpr(arg.value)
      if (expr.trailingClosure) walkStatements(expr.trailingClosure.body, visitStatement)
    }
  }

  const visitStatement = (statement: Stmt): void => {
    if (statement.kind === 'exprStmt') visitExpr(statement.expression)
    if (statement.kind === 'returnStmt' && statement.value) visitExpr(statement.value)
  }

  walkStatements(block, visitStatement)
  return names
}

function walkStatements(block: Block, visit: (statement: Stmt) => void): void {
  for (const statement of block.statements) walkStatement(statement, visit)
}

/**
 * Every statement in a body, nested ones included.
 *
 * This walked only into `if` and `for`, which made two different checks wrong in
 * opposite directions. `missingReturn` asks whether a body contains a `return`
 * anywhere, so a function whose returns were all inside a `switch`, a `while`, a
 * `repeat` or a `do` was told it had none - a warning on correct code. And
 * `findAssignedNames` asks what a method writes to, so a struct method assigning a
 * property inside a `switch` was not told it needed `mutating` - a real error
 * missed. One incomplete walk, one false positive and one false negative.
 *
 * `else if` is the other half of it: the `else` of an `if` is either a block or
 * *another `if`*, and only the block branch was followed, so an `else if` chain
 * hid everything below its first rung.
 */
function walkStatement(statement: Stmt, visit: (statement: Stmt) => void): void {
  visit(statement)

  switch (statement.kind) {
    case 'ifStmt':
      walkStatements(statement.then, visit)
      if (statement.else?.kind === 'block') walkStatements(statement.else, visit)
      else if (statement.else) walkStatement(statement.else, visit)
      return
    case 'switchStmt':
      for (const branch of statement.cases) walkStatements(branch.body, visit)
      return
    case 'doCatchStmt':
      walkStatements(statement.body, visit)
      for (const clause of statement.catches) walkStatements(clause.body, visit)
      return
    case 'guardStmt':
      walkStatements(statement.else, visit)
      return
    case 'forInStmt':
    case 'whileStmt':
    case 'repeatStmt':
    case 'deferStmt':
      walkStatements(statement.body, visit)
      return
    default:
      return
  }
}

/** Views whose content closures are view builders. A project's own view is not: its closure may be anything. */
const BUILDER_VIEWS = new Set([
  'VStack', 'HStack', 'ZStack', 'LazyVStack', 'LazyHStack', 'LazyVGrid', 'LazyHGrid', 'Grid', 'GridRow',
  'List', 'Form', 'Section', 'Group', 'ScrollView', 'ScrollViewReader', 'NavigationStack', 'NavigationView',
  'NavigationSplitView', 'NavigationLink', 'TabView', 'Tab', 'ForEach', 'GeometryReader', 'ViewThatFits',
  'ToolbarItem', 'ToolbarItemGroup', 'DisclosureGroup', 'ControlGroup', 'GroupBox', 'LabeledContent', 'Menu', 'Picker',
  'Label', 'Link',
])

/** Modifiers whose closure is a view builder, as against `.onAppear { }` or `.task { }`. */
const BUILDER_MODIFIERS = new Set([
  'overlay', 'background', 'mask', 'toolbar', 'sheet', 'fullScreenCover', 'popover', 'safeAreaInset', 'contextMenu',
  'swipeActions', 'navigationDestination', 'alert', 'confirmationDialog', 'searchSuggestions',
])

/**
 * The labels those views and modifiers give a closure that builds views. Any other,
 * such as `onDismiss:`, `primaryAction:` or `action:`, is ordinary code.
 */
const BUILDER_LABELS = new Set([
  'content', 'label', 'title', 'icon', 'header', 'footer', 'actions', 'message', 'destination', 'menuItems', 'menu',
  'preview', 'sidebar', 'detail', 'root', 'rowContent',
])

/** Whether the closure passed to `call` as `label` (null for the trailing one) builds views. */
function buildsViews(call: Expr & { kind: 'call' }, label: string | null): boolean {
  if (label !== null && !BUILDER_LABELS.has(label)) return false
  if (call.callee.kind === 'identifier') {
    const name = call.callee.name
    // A button's trailing closure is its action; its label is the one that builds.
    if (name === 'Button') return label === 'label'
    return BUILDER_VIEWS.has(name)
  }
  return call.callee.kind === 'memberAccess' && BUILDER_MODIFIERS.has(call.callee.member)
}

/** `var body` of a view, or a `@ViewBuilder` property: the bodies Swift builds views from. */
function isViewBody(decl: VarDecl, owner: StructDecl | null): boolean {
  if (decl.attributes.some((a) => a.name === 'ViewBuilder')) return true
  return decl.name === 'body' && !!owner?.inherits.some((t) => t.name === 'View' || t.name === 'SwiftUI.View')
}

const FIX = 'Work it out in a property or a function, beside `body`.'

/** What Xcode says about `statement` in a view builder, or null when it takes it. Measured with swiftc. */
function rejectedInBuilder(statement: Stmt): string | null {
  const control = (what: string) =>
    `Closure containing control flow statement cannot be used with result builder 'ViewBuilder'. Xcode rejects ${what} in a view's body; the preview runs it. ${FIX}`
  switch (statement.kind) {
    case 'forInStmt':
      return control("a 'for' loop")
    case 'whileStmt':
      return control("a 'while' loop")
    case 'repeatStmt':
      return control("a 'repeat' loop")
    case 'breakStmt':
      return control("'break'")
    case 'continueStmt':
      return control("'continue'")
    case 'deferStmt':
      return control("'defer'")
    case 'doCatchStmt':
      return statement.catches.length > 0 ? control("'do' with 'catch'") : null
    case 'exprStmt':
      return statement.expression.kind === 'assign'
        ? `Type '()' cannot conform to 'View'. Xcode rejects an assignment in a view's body; the preview runs it. ${FIX}`
        : null
    case 'declStmt':
      return statement.declaration.kind === 'funcDecl'
        ? "Closure containing a declaration cannot be used with result builder 'ViewBuilder'. Xcode rejects a function declared in a view's body; the preview runs it. Declare it beside `body`."
        : null
    default:
      return null
  }
}
