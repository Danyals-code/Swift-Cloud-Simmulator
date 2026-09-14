import type { SourceSpan } from '@studio/shared'
import type {
  Argument,
  Block,
  ClosureExpr,
  Condition,
  Decl,
  EnumDecl,
  Expr,
  FuncDecl,
  InitDecl,
  Pattern,
  SourceFileNode,
  Stmt,
  StructDecl,
  SwitchStmt,
  TypeRef,
  VarDecl,
} from '@studio/swift-syntax'
import { collectConformance, type ConformanceModel } from '@studio/swift-syntax'
import {
  bindingLValue,
  Environment,
  fieldLValue,
  type LValue,
} from './environment'
import {
  BreakSignal,
  ContinueSignal,
  ExecutionBudgetExceeded,
  ReturnSignal,
  SwiftTrap,
  TRAP_MESSAGES,
  UnsupportedAtRuntime,
  type StackFrame,
} from './errors'
import type { CallArgument, HostCall, InterpreterHost } from './host'
import { callBuiltinMember, getBuiltinProperty } from './stdlib'
import {
  array,
  asProjection,
  bool,
  copyValue,
  enumCase,
  describe,
  dictionaryKey,
  double,
  graphemes,
  int,
  keyPath,
  NIL,
  projection,
  str,
  truthy,
  typeNameOf,
  unwrapProjection,
  valuesEqual,
  VOID,
  type ArrayValue,
  type ClosureValue,
  type DictionaryValue,
  type EnumValue,
  type FunctionValue,
  type StructValue,
  type SwiftValue,
} from './values'

export interface InterpreterOptions {
  readonly host?: InterpreterHost
  /**
   * Evaluation steps before execution is abandoned.
   *
   * FR-6.5. A runaway loop in a Web Worker is a preview that never updates, so the
   * budget is not optional. 5 million steps is roughly 100 ms of interpretation —
   * far beyond any legitimate `body` evaluation, far below anything the user waits on.
   */
  readonly stepBudget?: number
}

const DEFAULT_STEP_BUDGET = 5_000_000

/**
 * Maximum interpreter call depth.
 *
 * Each Swift-level call costs roughly ten JS frames (evaluate -> evaluateCall ->
 * callFunction -> runBody -> evaluate -> …), and the default JS stack holds about
 * 11,000. 512 keeps us an order of magnitude clear of a RangeError, which would
 * surface as a crash naming the interpreter's own frames instead of a diagnostic
 * about the user's code. No realistic preview recurses anywhere near this deep.
 */
const MAX_CALL_DEPTH = 512

/** Swift's Int is 64-bit; JS numbers are exact only to 2^53. */
const MAX_SAFE_INT = Number.MAX_SAFE_INTEGER

/**
 * A tree-walking interpreter for the supported Swift subset.
 *
 * Three things it takes seriously, because each is a silent-wrongness risk rather
 * than a crash:
 *
 * - **Value semantics.** Structs and arrays copy at every assignment and argument
 *   boundary. See `values.ts`.
 * - **Traps, not NaN.** Overflow, division by zero and out-of-range indexing raise a
 *   `SwiftTrap` naming the source line, rather than producing a JS `NaN`/`undefined`
 *   that quietly poisons everything downstream.
 * - **A step budget.** Execution is abandoned rather than allowed to hang the worker.
 */
export class Interpreter {
  private steps = 0
  private readonly frames: StackFrame[] = []
  /** Declared result types, innermost last, so `return .case` knows its own type. */
  private readonly returnTypes: (string | null)[] = []
  private readonly host: InterpreterHost
  private readonly stepBudget: number

  readonly globals = new Environment()
  readonly types = new Map<string, StructDecl>()
  readonly enums = new Map<string, EnumDecl>()
  /**
   * Members merged across extensions, protocol defaults and superclasses.
   *
   * Every member lookup goes through this rather than through a declaration's own
   * `members`, because after `extension` exists a declaration no longer knows all of
   * its own members. Built once per load; the merge is syntactic and the files do not
   * change between loads.
   */
  private conformance: ConformanceModel = collectConformance([])

  constructor(options: InterpreterOptions = {}) {
    this.host = options.host ?? {}
    this.stepBudget = options.stepBudget ?? DEFAULT_STEP_BUDGET
  }

  // ------------------------------------------------------------------ loading

  /** Registers top-level declarations. Types and functions first, so order is irrelevant. */
  load(files: readonly SourceFileNode[]): void {
    this.conformance = collectConformance(files)

    for (const file of files) {
      for (const decl of file.declarations) {
        if (decl.kind === 'structDecl') this.types.set(decl.name, decl)
        else if (decl.kind === 'enumDecl') this.enums.set(decl.name, decl)
        else if (decl.kind === 'funcDecl') {
          this.globals.define(
            decl.name,
            { kind: 'function', decl, self: null, env: this.globals },
            true,
            decl.span,
          )
        }
      }
    }

    // Global `var`/`let` initialisers run after types exist so they may reference them.
    for (const file of files) {
      for (const decl of file.declarations) {
        if (decl.kind !== 'varDecl') continue
        const value = decl.initializer ? this.evaluate(decl.initializer, this.globals) : NIL
        this.globals.define(decl.name, copyValue(value), decl.isLet, decl.span)
      }
    }
  }

  /** Every member a named type has, extensions and inherited defaults included. */
  membersOf(typeName: string): readonly Decl[] {
    return this.conformance.types.get(typeName)?.members ?? []
  }

  /** Whether a type conforms to a protocol, directly or through another protocol. */
  conformsTo(typeName: string, protocolName: string): boolean {
    return this.conformance.types.get(typeName)?.conformances.has(protocolName) ?? false
  }

  /**
   * Evaluates an expression as though it appeared inside a type's body.
   *
   * Needed by the SwiftUI runtime to re-run a property's declared initialiser — a
   * `@GestureState` reverting, for instance. Exposed rather than reimplemented
   * because "with `self` bound" is a detail of scoping that belongs here.
   */
  evaluateInScope(expr: Expr, self: StructValue): SwiftValue {
    return this.evaluate(expr, this.globals.child(self))
  }

  resetSteps(): void {
    this.steps = 0
    this.frames.length = 0
  }

  get stepsUsed(): number {
    return this.steps
  }

  // ---------------------------------------------------------------- budgeting

  private tick(span: SourceSpan): void {
    if (++this.steps > this.stepBudget) {
      throw new ExecutionBudgetExceeded(span, this.steps, [...this.frames].reverse())
    }
  }

  private trap(reason: string, span: SourceSpan): never {
    throw new SwiftTrap(reason, span, [...this.frames].reverse())
  }

  // -------------------------------------------------------------- structures

  /**
   * Builds an instance of a user struct.
   *
   * Stored properties initialise in declaration order with `self` already bound, so
   * a later property may reference an earlier one. Computed properties are not
   * stored at all — they re-evaluate on every read, which is what makes `body`
   * reflect current state rather than the state at construction time.
   */
  instantiate(typeName: string, args: readonly CallArgument[], span: SourceSpan): StructValue {
    const decl = this.types.get(typeName)
    if (!decl) throw new UnsupportedAtRuntime(typeName, span)

    const instance: StructValue = {
      kind: 'struct',
      typeName,
      fields: new Map(),
      ...(decl.isReference ? { reference: true } : {}),
    }
    const env = this.globals.child(instance)

    const members = this.membersOf(typeName)
    const stored = members.filter(
      (m): m is VarDecl =>
        m.kind === 'varDecl' && m.accessor === null && m.requirement === null && !isStaticDecl(m),
    )

    // Declared initialiser wins over the memberwise one, which is also Swift's rule:
    // writing an `init` suppresses the synthesised member-wise initialiser for a class
    // entirely, and for a struct once it is in the same file.
    const initialiser = members.find(
      (m): m is InitDecl => m.kind === 'initDecl' && m.body !== null,
    )

    if (initialiser) {
      // Stored properties take their declared defaults first, so the initialiser body
      // can read a property it has not assigned yet without seeing `nil`.
      for (const property of stored) {
        instance.fields.set(
          property.name,
          property.initializer
            ? copyValue(
                this.evaluateExpecting(property.initializer, env, namedTypeOf(property.typeAnnotation)),
              )
            : NIL,
        )
      }

      const scope = this.globals.child(instance)
      this.bindParameters(initialiser.params, args, scope, span)
      this.runBody(`${typeName}.init`, initialiser.body!, scope, span)
      return instance
    }

    // Memberwise initialiser: labelled arguments win over declared defaults.
    const supplied = new Map<string, SwiftValue>()
    args.forEach((arg, index) => {
      const name = arg.label ?? stored[index]?.name
      if (name) supplied.set(name, arg.value)
    })

    for (const property of stored) {
      const expected = namedTypeOf(property.typeAnnotation)
      const provided = supplied.get(property.name)
      const value =
        provided !== undefined
          ? this.coerceToEnum(provided, expected)
          : property.initializer
            ? this.evaluateExpecting(property.initializer, env, expected)
            : NIL
      instance.fields.set(property.name, copyValue(value))
    }

    return instance
  }

  /** Instantiates a user type by name, whether it is a struct, a class or an enum. */
  private instantiateNamed(
    name: string,
    args: readonly CallArgument[],
    span: SourceSpan,
  ): SwiftValue | undefined {
    if (this.types.has(name)) return this.instantiate(name, args, span)

    const enumDecl = this.enums.get(name)
    if (!enumDecl) return undefined

    // `Tab(rawValue: "home")` — the failable initialiser every raw-valued enum has.
    const raw = args.find((a) => a.label === 'rawValue')?.value
    if (raw) {
      const match = enumDecl.cases.find((c) => {
        const value = c.rawValue
          ? this.evaluate(c.rawValue, this.globals)
          : rawValueFor(enumDecl, c.name)
        return value !== null && valuesEqual(value, raw)
      })
      return match ? this.makeEnumCase(enumDecl, match.name, [], span) : NIL
    }

    return undefined
  }

  /**
   * Reads a member from an enum value: `.rawValue`, a computed property, or a method.
   *
   * `self` inside such a member is the case itself, which is how an enum's computed
   * property — `var title: String { switch self { … } }` — is written.
   */
  private memberOfEnum(target: EnumValue, member: string, span: SourceSpan): SwiftValue | undefined {
    if (member === 'rawValue') return target.rawValue ?? NIL

    const decl = this.enums.get(target.typeName)
    if (!decl) return undefined
    const members = this.membersOf(target.typeName)

    const computed = members.find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === member && m.accessor !== null,
    )
    if (computed?.accessor) {
      return this.runBody(
        `${target.typeName}.${member}`,
        computed.accessor,
        this.globals.child(target),
        span,
        namedTypeOf(computed.typeAnnotation),
      )
    }

    const method = members.find(
      (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === member && m.body !== null,
    )
    if (method) return { kind: 'function', decl: method, self: null, env: this.globals.child(target) }

    return undefined
  }

  /** Reads a member from a struct: stored field, computed property, or bound method. */
  private memberOfStruct(target: StructValue, member: string, span: SourceSpan): SwiftValue | undefined {
    const field = target.fields.get(member)
    if (field !== undefined) return field

    const members = this.membersOf(target.typeName)
    if (members.length === 0) return undefined

    const computed = members.find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === member && m.accessor !== null,
    )
    if (computed?.accessor) {
      return this.runBody(
        `${target.typeName}.${member}`,
        computed.accessor,
        this.globals.child(target),
        span,
        namedTypeOf(computed.typeAnnotation),
      )
    }

    const method = members.find(
      (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === member && m.body !== null,
    )
    if (method) return { kind: 'function', decl: method, self: target, env: this.globals }

    return undefined
  }

  // ------------------------------------------------------------------- calls

  /**
   * Runs a block as a function body, translating `return` into a value.
   *
   * Swift's implicit return applies to single-expression bodies — which is how every
   * `var body: some View` works. That expression is evaluated exactly once: running
   * the block for effects and *then* re-evaluating the expression for its value would
   * double every side effect in it.
   *
   * `expected` is the declared result type, and it is the only context a bare `.case`
   * in a `return` has to resolve against — `func next() -> Step { return .two }` says
   * what `.two` means nowhere else. Pushed as a stack rather than passed down because
   * the `return` may be nested arbitrarily deep inside the body.
   */
  private runBody(
    name: string,
    body: Block,
    env: Environment,
    span: SourceSpan,
    expected: string | null = null,
  ): SwiftValue {
    // Runaway *recursion* would exhaust the JS call stack long before the step budget
    // fires, surfacing as a RangeError from inside the interpreter rather than as a
    // diagnostic about the user's code. Capping call depth keeps the failure ours to
    // describe.
    if (this.frames.length >= MAX_CALL_DEPTH) {
      throw new ExecutionBudgetExceeded(
        span,
        this.steps,
        // Only the innermost frames are useful; a 512-deep trace is noise.
        [...this.frames].reverse().slice(0, 12),
        'depth',
      )
    }

    this.frames.push({ name, span })
    this.returnTypes.push(expected)
    try {
      const only = body.statements.length === 1 ? body.statements[0] : undefined
      if (only?.kind === 'exprStmt') return this.evaluateExpecting(only.expression, env, expected)

      this.executeBlock(body, env)
      return VOID
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value as SwiftValue
      throw error
    } finally {
      this.frames.pop()
      this.returnTypes.pop()
    }
  }

  /**
   * Evaluates a block the way `@ViewBuilder` does: as a *list* of results.
   *
   * A result builder does not return the last statement — it collects every
   * expression in the block (`buildBlock`), picks a branch (`buildIf`/`buildEither`),
   * and flattens loops (`buildArray`). Modelling that here rather than in the host
   * keeps the control-flow semantics with the interpreter that owns scoping, while
   * leaving the host free to decide what the collected values *mean*.
   */
  runViewBuilder(closure: ClosureValue, args: readonly SwiftValue[] = []): SwiftValue[] {
    const env = (closure.env as Environment).child()
    if (closure.hasExplicitParams) {
      closure.params.forEach((param, i) => env.define(param.name, copyValue(args[i] ?? NIL), true, param.span))
    } else {
      args.forEach((value, i) => env.define(`$${i}`, copyValue(value), true, closure.span))
    }

    const out: SwiftValue[] = []
    this.frames.push({ name: 'ViewBuilder', span: closure.span })
    try {
      this.collectBuilderValues(closure.body, env, out)
    } catch (error) {
      if (!(error instanceof ReturnSignal)) throw error
      out.push(error.value as SwiftValue)
    } finally {
      this.frames.pop()
    }
    return out
  }

  /** As `runViewBuilder`, for a computed property's accessor block. */
  runViewBuilderBlock(body: Block, env: Environment): SwiftValue[] {
    const out: SwiftValue[] = []
    this.collectBuilderValues(body, env, out)
    return out
  }

  private collectBuilderValues(block: Block, env: Environment, out: SwiftValue[]): void {
    for (const statement of block.statements) {
      this.tick(statement.span)

      switch (statement.kind) {
        case 'exprStmt':
          out.push(this.evaluate(statement.expression, env))
          break

        case 'returnStmt':
          if (statement.value) out.push(this.evaluate(statement.value, env))
          break

        // buildIf / buildEither: only the taken branch contributes content.
        case 'ifStmt': {
          const taken = env.child()
          if (this.bindConditions(statement.conditions, taken)) {
            this.collectBuilderValues(statement.then, taken, out)
          } else if (statement.else?.kind === 'block') {
            this.collectBuilderValues(statement.else, env.child(), out)
          } else if (statement.else) {
            const nested: Block = { kind: 'block', span: statement.else.span, statements: [statement.else] }
            this.collectBuilderValues(nested, env.child(), out)
          }
          break
        }

        // A `switch` in a view builder contributes only the matched case, which is
        // how enum-driven views are written.
        case 'switchStmt': {
          const matched = this.matchSwitch(statement, env)
          if (matched) this.collectBuilderValues(matched.body, matched.scope, out)
          break
        }

        // buildArray: a loop contributes one entry per iteration.
        case 'forInStmt': {
          const sequence = this.evaluate(statement.sequence, env)
          for (const element of this.iterate(sequence, statement.sequence.span)) {
            const inner = env.child()
            inner.define(statement.variable, element, true, statement.variableSpan)
            if (statement.where && !truthy(this.evaluate(statement.where, inner))) continue
            this.collectBuilderValues(statement.body, inner, out)
          }
          break
        }

        // Declarations and everything else run for their effects only.
        default:
          this.execute(statement, env)
      }
    }
  }

  callFunction(fn: FunctionValue, args: readonly CallArgument[], span: SourceSpan): SwiftValue {
    const decl = fn.decl
    const env = (fn.env as Environment).child(fn.self)

    this.bindParameters(decl.params, args, env, span)

    if (!decl.body) return VOID
    const label = fn.self ? `${fn.self.typeName}.${decl.name}` : decl.name
    return this.runBody(label, decl.body, env, span, namedTypeOf(decl.returnType))
  }

  private bindParameters(
    params: readonly {
      externalName: string | null
      internalName: string
      defaultValue: Expr | null
      type?: TypeRef | null
      span: SourceSpan
    }[],
    args: readonly CallArgument[],
    env: Environment,
    span: SourceSpan,
  ): void {
    const positional = args.filter((a) => a.label === null)
    let positionalIndex = 0

    for (const param of params) {
      const byLabel = args.find((a) => a.label !== null && a.label === (param.externalName ?? param.internalName))
      let value: SwiftValue | undefined = byLabel?.value

      if (value === undefined && (param.externalName === '_' || param.externalName === null)) {
        value = positional[positionalIndex++]?.value
      }
      if (value === undefined && param.defaultValue) {
        value = this.evaluate(param.defaultValue, env)
      }
      if (value === undefined) value = positional[positionalIndex++]?.value

      // Arguments are passed by value, so the callee cannot mutate the caller's copy.
      // A declared parameter type is also the context a contextual member resolves
      // against, which is what makes `select(.home)` mean anything.
      const coerced = this.coerceToEnum(value ?? NIL, namedTypeOf(param.type ?? null))
      env.define(param.internalName, copyValue(coerced), true, param.span ?? span)
    }
  }

  callClosure(closure: ClosureValue, args: readonly SwiftValue[], span: SourceSpan): SwiftValue {
    const env = (closure.env as Environment).child()

    if (closure.hasExplicitParams) {
      closure.params.forEach((param, i) => {
        env.define(param.name, copyValue(args[i] ?? NIL), true, param.span)
      })
    } else {
      // `$0`, `$1`, … shorthand.
      args.forEach((value, i) => env.define(`$${i}`, copyValue(value), true, closure.span))
    }

    return this.runBody('closure', closure.body, env, span)
  }

  private hostCall(args: readonly CallArgument[], trailing: ClosureValue | null, span: SourceSpan): HostCall {
    return {
      args,
      trailingClosure: trailing,
      span,
      invoke: (closure, closureArgs = []) => this.callClosure(closure, closureArgs, span),
      invokeBuilder: (closure, closureArgs = []) => this.runViewBuilder(closure, closureArgs),
    }
  }

  // -------------------------------------------------------------- statements

  executeBlock(block: Block, env: Environment): void {
    for (const statement of block.statements) this.execute(statement, env)
  }

  execute(statement: Stmt, env: Environment): void {
    this.tick(statement.span)

    switch (statement.kind) {
      case 'exprStmt':
        this.evaluate(statement.expression, env)
        return

      case 'declStmt':
        this.executeDeclaration(statement.declaration, env)
        return

      case 'ifStmt': {
        const taken = env.child()
        if (this.bindConditions(statement.conditions, taken)) {
          this.executeBlock(statement.then, taken)
        } else if (statement.else) {
          if (statement.else.kind === 'block') this.executeBlock(statement.else, env.child())
          else this.execute(statement.else, env)
        }
        return
      }

      case 'guardStmt': {
        // A `guard`'s bindings escape into the *enclosing* scope — that is the whole
        // point of it — so they are bound into `env` rather than into a child.
        if (this.bindConditions(statement.conditions, env)) return
        this.executeBlock(statement.else, env.child())
        // Swift requires the else block to leave scope. If it did not, falling through
        // would run the rest of the body with the bindings absent, so the guard is
        // honoured by returning here rather than pretending it matched.
        throw new ReturnSignal(VOID)
      }

      case 'switchStmt': {
        const matched = this.matchSwitch(statement, env)
        if (matched) {
          try {
            this.executeBlock(matched.body, matched.scope)
          } catch (error) {
            // `break` inside a switch case leaves the switch, not an enclosing loop.
            if (!(error instanceof BreakSignal)) throw error
          }
        }
        return
      }

      case 'whileStmt': {
        for (;;) {
          this.tick(statement.span)
          const scope = env.child()
          if (!this.bindConditions(statement.conditions, scope)) return
          if (this.runLoopBody(statement.body, scope)) return
        }
      }

      case 'repeatStmt': {
        for (;;) {
          this.tick(statement.span)
          if (this.runLoopBody(statement.body, env.child())) return
          if (!truthy(this.evaluate(statement.condition, env))) return
        }
      }

      case 'breakStmt':
        throw new BreakSignal()

      case 'continueStmt':
        throw new ContinueSignal()

      case 'forInStmt': {
        const sequence = this.evaluate(statement.sequence, env)
        for (const element of this.iterate(sequence, statement.sequence.span)) {
          this.tick(statement.span)
          const inner = env.child()
          inner.define(statement.variable, element, true, statement.variableSpan)
          if (statement.where && !truthy(this.evaluate(statement.where, inner))) continue
          if (this.runLoopBody(statement.body, inner)) return
        }
        return
      }

      case 'returnStmt':
        throw new ReturnSignal(
          statement.value
            ? this.evaluateExpecting(statement.value, env, this.returnTypes[this.returnTypes.length - 1] ?? null)
            : VOID,
        )

      case 'unsupportedStmt':
        throw new UnsupportedAtRuntime(statement.feature, statement.span)

      case 'errorStmt':
        return
    }
  }

  /**
   * Evaluates a condition list, binding anything it unwraps into `scope`.
   *
   * Returns false as soon as a clause fails, *without* evaluating the rest — which is
   * not an optimisation but a requirement: `if let user = user, user.isActive` reads
   * `user` in the second clause only because the first one succeeded.
   */
  private bindConditions(conditions: readonly Condition[], scope: Environment): boolean {
    for (const condition of conditions) {
      if (condition.kind === 'expr') {
        if (!truthy(this.evaluate(condition.expr, scope))) return false
        continue
      }

      if (condition.kind === 'optionalBinding') {
        const value = this.evaluate(condition.value, scope)
        if (value.kind === 'nil') return false
        scope.define(condition.name, copyValue(value), condition.isLet, condition.nameSpan)
        continue
      }

      const subject = this.evaluate(condition.value, scope)
      if (!this.matchPattern(condition.pattern, subject, scope)) return false
    }
    return true
  }

  /**
   * Runs one iteration of a loop body.
   *
   * Returns true when the loop should stop. `continue` is absorbed here, `break`
   * reported upward — which keeps every loop's `for` in `execute` identical.
   */
  private runLoopBody(body: Block, scope: Environment): boolean {
    try {
      this.executeBlock(body, scope)
    } catch (error) {
      if (error instanceof BreakSignal) return true
      if (!(error instanceof ContinueSignal)) throw error
    }
    return false
  }

  /**
   * Finds the case a `switch` takes.
   *
   * Bindings land in a scope of their own, so `case .success(let value)` can name a
   * payload without leaking it into the sibling cases. Returns null when nothing
   * matched — Swift requires exhaustiveness and we do not check it, so the honest
   * behaviour for an unmatched subject is to run nothing rather than to guess.
   */
  private matchSwitch(
    statement: SwitchStmt,
    env: Environment,
  ): { body: Block; scope: Environment } | null {
    const subject = this.evaluate(statement.subject, env)

    for (const branch of statement.cases) {
      const scope = env.child()

      if (branch.isDefault) {
        if (branch.where && !truthy(this.evaluate(branch.where, scope))) continue
        return { body: branch.body, scope }
      }

      for (const pattern of branch.patterns) {
        const attempt = env.child()
        if (!this.matchPattern(pattern, subject, attempt)) continue
        if (branch.where && !truthy(this.evaluate(branch.where, attempt))) continue
        return { body: branch.body, scope: attempt }
      }
    }

    return null
  }

  /** Tests one pattern against a value, binding any names it introduces. */
  private matchPattern(pattern: Pattern, subject: SwiftValue, scope: Environment): boolean {
    switch (pattern.kind) {
      case 'wildcard':
        return true

      case 'binding':
        scope.define(pattern.name, copyValue(subject), pattern.isLet, pattern.span)
        return true

      case 'value':
        return valuesEqual(this.evaluate(pattern.value, scope), subject)

      case 'range': {
        const range = this.evaluate(pattern.value, scope)
        if (range.kind !== 'range' || !isNumericValue(subject)) return false
        const n = subject.value
        return n >= range.lower && (range.closed ? n <= range.upper : n < range.upper)
      }

      case 'enumCase': {
        if (subject.kind !== 'enum') return false
        if (pattern.typeName && pattern.typeName !== subject.typeName) return false
        if (pattern.caseName !== subject.caseName) return false

        pattern.bindings.forEach((binding, index) => {
          if (binding.isWildcard) return
          const payload = subject.associated[index]
          if (payload !== undefined) {
            scope.define(binding.name, copyValue(payload), true, binding.span)
          }
        })
        return true
      }
    }
  }

  /**
   * A `static` member of a type, read without an instance.
   *
   * Evaluated on each access rather than cached. Swift's statics are lazy and stored,
   * so a cache would be more faithful — but it would also outlive an edit to the
   * initialiser, which is the one behaviour a live preview must not have.
   */
  private staticMember(typeName: string, member: string, span: SourceSpan): SwiftValue | undefined {
    const members = this.membersOf(typeName)
    if (members.length === 0) return undefined

    const isStatic = isStaticDecl

    const property = members.find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === member && isStatic(m),
    )
    if (property) {
      if (property.accessor) {
        return this.runBody(
          `${typeName}.${member}`,
          property.accessor,
          this.globals.child(null),
          span,
          namedTypeOf(property.typeAnnotation),
        )
      }
      return property.initializer ? this.evaluate(property.initializer, this.globals) : NIL
    }

    const method = members.find(
      (m): m is FuncDecl =>
        m.kind === 'funcDecl' && m.name === member && isStatic(m) && m.body !== null,
    )
    return method ? { kind: 'function', decl: method, self: null, env: this.globals } : undefined
  }

  // ------------------------------------------------------------------- enums

  /**
   * Resolves a contextual enum member against an expected type.
   *
   * `var tab: Tab = .home` has no base to resolve `.home` against, so the host hands
   * back a bare token. When the declaration says what type is expected, the token can
   * be turned into the case it obviously means. Without this, contextual member
   * syntax — which is how almost every enum is written in view code — would produce a
   * value that compares equal to nothing.
   */
  coerceToEnum(value: SwiftValue, typeName: string | null): SwiftValue {
    if (!typeName) return value

    // `var width: Double` given the literal `3`. Swift converts at the literal, since
    // `3` there is a `Double` literal and never an `Int` — so `Rect(width: 3).width`
    // is 3.0 and prints as such. Without this the value stays an Int and every
    // arithmetic result downstream loses its fractional formatting.
    if (typeName === 'Double' && value.kind === 'int') return double(value.value)

    if (value.kind !== 'opaque') return value

    const decl = this.enums.get(typeName)
    if (!decl) return value

    const name = (value.payload as { name?: string } | null)?.name
    if (typeof name !== 'string') return value
    if (!decl.cases.some((c) => c.name === name)) return value

    return this.makeEnumCase(decl, name, [], { file: '', start: 0, end: 0 })
  }

  /** Builds an enum case value, resolving its raw value if the enum declares one. */
  private makeEnumCase(
    decl: EnumDecl,
    caseName: string,
    args: readonly CallArgument[],
    span: SourceSpan,
  ): SwiftValue {
    const declared = decl.cases.find((c) => c.name === caseName)
    if (!declared) {
      this.trap(`Type '${decl.name}' has no member '${caseName}'`, span)
    }

    const raw = declared.rawValue
      ? this.evaluate(declared.rawValue, this.globals)
      : rawValueFor(decl, declared.name)

    return enumCase(
      decl.name,
      caseName,
      args.map((a) => copyValue(a.value)),
      raw,
    )
  }

  /**
   * Evaluates an expression that is known to be of a particular type.
   *
   * The one thing this buys is contextual member syntax: `.settings` has no base to
   * resolve against, so `let tab: Tab = .settings` can only be understood by knowing
   * what `Tab` is. Deliberately not general type inference — it applies exactly where
   * a declaration or a parameter already stated the type, and falls straight through
   * to ordinary evaluation everywhere else.
   */
  private evaluateExpecting(expr: Expr, env: Environment, expected: string | null): SwiftValue {
    if (expected && expr.kind === 'memberAccess' && expr.base === null) {
      const decl = this.enums.get(expected)
      if (decl?.cases.some((c) => c.name === expr.member)) {
        return this.makeEnumCase(decl, expr.member, [], expr.span)
      }
    }
    return this.coerceToEnum(this.evaluate(expr, env), expected)
  }

  private executeDeclaration(decl: Decl, env: Environment): void {
    switch (decl.kind) {
      case 'varDecl': {
        const expected = namedTypeOf(decl.typeAnnotation)
        const value = decl.initializer
          ? this.evaluateExpecting(decl.initializer, env, expected)
          : NIL
        env.define(decl.name, copyValue(value), decl.isLet, decl.nameSpan)
        return
      }
      case 'funcDecl': {
        const receiver = env.resolveSelf()
        env.define(
          decl.name,
          { kind: 'function', decl, self: receiver?.kind === 'struct' ? receiver : null, env },
          true,
          decl.nameSpan,
        )
        return
      }
      case 'structDecl':
        this.types.set(decl.name, decl)
        return
      case 'enumDecl':
        this.enums.set(decl.name, decl)
        return
      case 'unsupportedDecl':
        throw new UnsupportedAtRuntime(decl.feature, decl.span)
      default:
        return
    }
  }

  private *iterate(value: SwiftValue, span: SourceSpan): Generator<SwiftValue> {
    if (value.kind === 'range') {
      const end = value.closed ? value.upper : value.upper - 1
      for (let i = value.lower; i <= end; i++) yield int(i)
      return
    }
    if (value.kind === 'array') {
      // Snapshot: mutating the array inside the loop must not change the iteration,
      // matching Swift's value semantics for the sequence being iterated.
      for (const element of [...value.elements]) yield element
      return
    }
    if (value.kind === 'string') {
      for (const ch of graphemes(value.value)) yield str(ch)
      return
    }
    if (value.kind === 'dictionary') {
      for (const [k, v] of value.entries) {
        yield { kind: 'struct', typeName: 'Pair', fields: new Map([['key', str(k)], ['value', v]]) }
      }
      return
    }
    this.trap(`Type '${typeNameOf(value)}' does not conform to 'Sequence'`, span)
  }

  // ------------------------------------------------------------- expressions

  evaluate(expr: Expr, env: Environment): SwiftValue {
    this.tick(expr.span)

    switch (expr.kind) {
      case 'integerLiteral':
        return int(expr.value)
      case 'floatLiteral':
        return double(expr.value)
      case 'booleanLiteral':
        return bool(expr.value)
      case 'nilLiteral':
        return NIL

      case 'stringLiteral': {
        let out = ''
        for (const segment of expr.segments) {
          out +=
            segment.kind === 'text'
              ? segment.value
              : describe(this.evaluate(segment.expression, env), false)
        }
        return str(out)
      }

      case 'arrayLiteral':
        return array(expr.elements.map((e) => copyValue(this.evaluate(e, env))))

      case 'dictionaryLiteral': {
        const entries = new Map<string, SwiftValue>()
        for (const entry of expr.entries) {
          entries.set(dictionaryKey(this.evaluate(entry.key, env)), copyValue(this.evaluate(entry.value, env)))
        }
        return { kind: 'dictionary', entries }
      }

      case 'identifier':
        return this.evaluateIdentifier(expr.name, expr.span, env)

      case 'selfExpr': {
        // An enum case is `self` inside its own members, but it is not a struct, so
        // it cannot live in the environment's receiver slot. It is bound by name
        // instead, and looked up first.
        const bound = env.lookup('self')
        if (bound) return bound.value

        const self = env.resolveSelf()
        if (!self) this.trap("Use of 'self' outside a type", expr.span)
        return self
      }

      case 'memberAccess':
        return this.evaluateMemberAccess(expr.base, expr.member, expr.memberSpan, env)

      case 'call':
        return this.evaluateCall(expr.callee, expr.args, expr.trailingClosure, expr.span, env)

      case 'subscript': {
        const base = this.evaluate(expr.base, env)
        const index = expr.args[0] ? this.evaluate(expr.args[0].value, env) : NIL
        return this.subscriptGet(base, index, expr.span)
      }

      case 'closure':
        return this.makeClosure(expr, env)

      case 'unary':
        return this.evaluateUnary(expr.operator, this.evaluate(expr.operand, env), expr.span)

      case 'binary':
        return this.evaluateBinary(expr.operator, expr.left, expr.right, expr.span, env)

      case 'assign':
        return this.evaluateAssign(expr.operator, expr.target, expr.value, expr.span, env)

      case 'ternary':
        return truthy(this.evaluate(expr.condition, env))
          ? this.evaluate(expr.then, env)
          : this.evaluate(expr.else, env)

      case 'tuple':
        return expr.elements.length === 1 && expr.elements[0]
          ? this.evaluate(expr.elements[0], env)
          : array(expr.elements.map((e) => this.evaluate(e, env)))

      case 'forceUnwrap': {
        const value = this.evaluate(expr.operand, env)
        if (value.kind === 'nil') this.trap(TRAP_MESSAGES.forceUnwrapNil, expr.span)
        return value
      }

      case 'keyPath':
        return keyPath(expr.components)

      case 'optionalChain':
        return this.evaluate(expr.operand, env)

      case 'errorExpr':
        throw new UnsupportedAtRuntime('this expression', expr.span)
    }
  }

  private makeClosure(expr: ClosureExpr, env: Environment): ClosureValue {
    return {
      kind: 'closure',
      params: expr.params,
      hasExplicitParams: expr.hasExplicitParams,
      body: expr.body,
      // Captured by reference, so mutations inside the closure reach the enclosing
      // scope. This is what makes `Button { count += 1 }` work.
      env,
      span: expr.span,
    }
  }

  private evaluateIdentifier(name: string, span: SourceSpan, env: Environment): SwiftValue {
    const binding = env.lookup(name)
    if (binding) return unwrapProjection(binding.value)

    // `$count` is a property wrapper's *projection*: a read/write reference to the
    // storage behind `count`, which is what lets `.sheet(isPresented: $showing)`
    // dismiss itself and `Toggle(isOn: $flag)` write back. Projecting something that
    // is already a projection yields the same one — passing `$count` down two views
    // still addresses the original `@State`.
    if (name.startsWith('$')) {
      const projected = this.projectionFor(name.slice(1), env)
      if (projected) return projected
    }

    const self = env.resolveSelf()
    if (self) {
      const bare = name.startsWith('$') ? name.slice(1) : name
      const member =
        self.kind === 'struct'
          ? this.memberOfStruct(self, bare, span)
          : this.memberOfEnum(self, bare, span)
      if (member !== undefined) return unwrapProjection(member)
    }

    // Inside `extension Int`, `self` is a binding rather than a receiver, so a call to
    // a sibling extension method has to find its way back through it.
    const selfBinding = env.lookup('self')?.value
    if (selfBinding) {
      const extended = this.userMember(selfBinding, name, span)
      if (extended !== undefined) return unwrapProjection(extended)
    }

    if (this.types.has(name) || this.enums.has(name)) return { kind: 'type', name }

    const fromHost = this.host.resolveGlobal?.(name)
    if (fromHost !== undefined) return fromHost

    this.trap(`Cannot find '${name}' in scope`, span)
  }

  private evaluateMemberAccess(
    base: Expr | null,
    member: string,
    span: SourceSpan,
    env: Environment,
  ): SwiftValue {
    // Implicit member syntax: `.largeTitle`, `.primary`, `.infinity`.
    if (!base) {
      const resolved = this.host.resolveImplicitMember?.(member, span)
      if (resolved !== undefined) return resolved
      this.trap(`Cannot infer contextual base for '.${member}'`, span)
    }

    const target = this.evaluate(base, env)

    // `Item.self` is a metatype. The slice only ever passes one along — to
    // `navigationDestination(for:)` — so the type value itself is the whole answer.
    if (target.kind === 'type' && member === 'self') return target

    // `Tab.home` — an enum case with no payload.
    if (target.kind === 'type') {
      const enumDecl = this.enums.get(target.name)
      if (enumDecl?.cases.some((c) => c.name === member)) {
        return this.makeEnumCase(enumDecl, member, [], span)
      }
      const statik = this.staticMember(target.name, member, span)
      if (statik !== undefined) return statik
    }

    if (target.kind === 'enum') {
      const value = this.memberOfEnum(target, member, span)
      if (value !== undefined) return unwrapProjection(value)
    }

    if (target.kind === 'struct') {
      const value = this.memberOfStruct(target, member, span)
      if (value !== undefined) return unwrapProjection(value)
    }

    const builtin = getBuiltinProperty(target, member)
    if (builtin !== undefined) return builtin

    const extended = this.userMember(target, member, span)
    if (extended !== undefined) return unwrapProjection(extended)

    const fromHost = this.host.getMember?.(target, member, span)
    if (fromHost !== undefined) return fromHost

    this.trap(`Value of type '${typeNameOf(target)}' has no member '${member}'`, span)
  }

  /**
   * A member a user `extension` added to a value the interpreter otherwise handles
   * entirely through its built-in table — `extension Int`, `extension String`,
   * `extension Array`.
   *
   * Checked *after* the built-in table, so an extension can never shadow a stdlib
   * member and silently change what existing code means.
   *
   * `self` is bound as an ordinary name rather than as a receiver, because a receiver
   * has to be a struct or an enum case. Nothing is lost: a built-in has no stored
   * properties for implicit access to find, and a call to a sibling extension method
   * resolves through the `self` binding instead.
   */
  private userMember(
    target: SwiftValue,
    member: string,
    span: SourceSpan,
  ): SwiftValue | undefined {
    if (target.kind === 'struct' || target.kind === 'enum' || target.kind === 'type') return undefined

    const members = this.membersOf(typeNameOf(target))
    if (members.length === 0) return undefined

    const scope = this.globals.child(null)
    scope.define('self', target, true, span)

    const computed = members.find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === member && m.accessor !== null,
    )
    if (computed?.accessor) {
      return this.runBody(
        `${typeNameOf(target)}.${member}`,
        computed.accessor,
        scope,
        span,
        namedTypeOf(computed.typeAnnotation),
      )
    }

    const method = members.find(
      (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === member && m.body !== null,
    )
    return method ? { kind: 'function', decl: method, self: null, env: scope } : undefined
  }

  private evaluateCall(
    callee: Expr,
    argExprs: readonly Argument[],
    trailing: ClosureExpr | null,
    span: SourceSpan,
    env: Environment,
  ): SwiftValue {
    const args: CallArgument[] = argExprs.map((arg) => ({
      label: arg.label,
      value: this.evaluate(arg.value, env),
      span: arg.span,
    }))
    const trailingClosure = trailing ? this.makeClosure(trailing, env) : null

    /**
     * For everything except the host, a trailing closure is just a final unlabelled
     * argument — `items.map { … }` and `items.map({ … })` mean the same thing. The
     * host gets it separately, because a view needs to distinguish content
     * (`VStack { … }`) from an action (`Button("x") { … }`).
     */
    const allArgs: CallArgument[] =
      trailingClosure && trailing
        ? [...args, { label: null, value: trailingClosure, span: trailing.span }]
        : args

    // `[Int]()` and `[String: Int]()` construct empty collections. The parser sees
    // the bracket form as a literal, so recognise it here rather than complicating
    // the grammar with a type-vs-expression lookahead.
    if (callee.kind === 'arrayLiteral' && allArgs.length === 0) {
      return array([])
    }
    if (callee.kind === 'dictionaryLiteral' && allArgs.length === 0) {
      return { kind: 'dictionary', entries: new Map() }
    }

    // A direct call to a global name: a user function, a user type, or the host's.
    if (callee.kind === 'identifier') {
      const local = env.lookup(callee.name)
      if (local?.value.kind === 'function') return this.callFunction(local.value, allArgs, span)
      if (local?.value.kind === 'closure') {
        return this.callClosure(local.value, allArgs.map((a) => a.value), span)
      }

      // The host claims view names before user types, so a project struct named
      // `Text` would shadow SwiftUI's — matching Swift's own module resolution.
      const fromHost = this.host.callGlobal?.(callee.name, this.hostCall(args, trailingClosure, span))
      if (fromHost !== undefined) return fromHost

      const instance = this.instantiateNamed(callee.name, allArgs, span)
      if (instance !== undefined) return instance

      // `print` and friends.
      const builtin = this.callGlobalBuiltin(callee.name, allArgs, span)
      if (builtin !== undefined) return builtin
    }

    // A method or modifier call: `value.member(args)`.
    if (callee.kind === 'memberAccess') {
      return this.evaluateMemberCall(callee.base, callee.member, callee.memberSpan, args, allArgs, trailingClosure, span, env)
    }

    const value = this.evaluate(callee, env)
    if (value.kind === 'function') return this.callFunction(value, allArgs, span)
    if (value.kind === 'closure') return this.callClosure(value, allArgs.map((a) => a.value), span)

    const fromHost = this.host.callValue?.(value, this.hostCall(args, trailingClosure, span))
    if (fromHost !== undefined) return fromHost
    if (value.kind === 'type') {
      const instance = this.instantiateNamed(value.name, allArgs, span)
      if (instance !== undefined) return instance
      this.trap(`Cannot construct a value of type '${value.name}'`, span)
    }

    this.trap(`Cannot call value of type '${typeNameOf(value)}'`, span)
  }

  private evaluateMemberCall(
    baseExpr: Expr | null,
    member: string,
    memberSpan: SourceSpan,
    /** Explicit arguments only — what the host sees. */
    args: readonly CallArgument[],
    /** Explicit arguments plus the trailing closure — what everything else sees. */
    allArgs: readonly CallArgument[],
    trailingClosure: ClosureValue | null,
    span: SourceSpan,
    env: Environment,
  ): SwiftValue {
    if (!baseExpr) {
      const called = this.host.callImplicitMember?.(
        member,
        this.hostCall(args, trailingClosure, span),
      )
      if (called !== undefined) return called

      const resolved = this.host.resolveImplicitMember?.(member, memberSpan)
      if (resolved !== undefined) return resolved
      this.trap(`Cannot infer contextual base for '.${member}'`, memberSpan)
    }

    // A mutating method needs the *storage*, not a copy, or its writes are lost.
    const lvalue = this.tryResolveLValue(baseExpr, env)
    const target = lvalue ? lvalue.get() : this.evaluate(baseExpr, env)

    // `Status.loaded("x")` — an enum case with a payload.
    if (target.kind === 'type') {
      const enumDecl = this.enums.get(target.name)
      if (enumDecl?.cases.some((c) => c.name === member)) {
        return this.makeEnumCase(enumDecl, member, allArgs, span)
      }
      const statik = this.staticMember(target.name, member, memberSpan)
      if (statik?.kind === 'function') return this.callFunction(statik, allArgs, span)
    }

    if (target.kind === 'enum') {
      const bound = this.memberOfEnum(target, member, memberSpan)
      if (bound?.kind === 'function') return this.callFunction(bound, allArgs, span)
      if (bound?.kind === 'closure') return this.callClosure(bound, allArgs.map((a) => a.value), span)
    }

    if (target.kind === 'struct') {
      const bound = this.memberOfStruct(target, member, memberSpan)
      if (bound?.kind === 'function') {
        const isMutating = bound.decl.modifiers.some((m) => m.name === 'mutating')
        if (isMutating && lvalue && !lvalue.mutable) {
          this.trap(
            `Cannot use mutating member on immutable value: '${lvalue.description}' is a 'let' constant`,
            span,
          )
        }
        return this.callFunction(bound, allArgs, span)
      }
      if (bound?.kind === 'closure') return this.callClosure(bound, allArgs.map((a) => a.value), span)
    }

    const builtin = callBuiltinMember(
      target,
      member,
      allArgs,
      (closure, closureArgs) => this.callClosure(closure, closureArgs, span),
      (reason) => this.trap(reason, span),
    )
    if (builtin !== undefined) {
      if (lvalue?.mutable) lvalue.set(target)
      return builtin
    }

    const extended = this.userMember(target, member, memberSpan)
    if (extended?.kind === 'function') return this.callFunction(extended, allArgs, span)
    if (extended?.kind === 'closure') {
      return this.callClosure(extended, allArgs.map((a) => a.value), span)
    }

    const fromHost = this.host.callMember?.(target, member, this.hostCall(args, trailingClosure, span))
    if (fromHost !== undefined) return fromHost

    this.trap(`Value of type '${typeNameOf(target)}' has no member '${member}'`, memberSpan)
  }

  private callGlobalBuiltin(
    name: string,
    args: readonly CallArgument[],
    span: SourceSpan,
  ): SwiftValue | undefined {
    switch (name) {
      case 'print': {
        const message = args.map((a) => describe(a.value, false)).join(' ')
        this.host.log?.(message, span)
        return VOID
      }
      case 'min':
      case 'max': {
        const numbers = args.map((a) => this.requireNumber(a.value, span))
        const result = name === 'min' ? Math.min(...numbers) : Math.max(...numbers)
        return args.every((a) => a.value.kind === 'int') ? int(result) : double(result)
      }
      case 'abs': {
        const first = args[0]?.value
        if (!first) return undefined
        const magnitude = Math.abs(this.requireNumber(first, span))
        return first.kind === 'int' ? int(magnitude) : double(magnitude)
      }
      case 'Int': {
        const first = args[0]?.value
        if (!first) return undefined
        return int(Math.trunc(this.requireNumber(first, span)))
      }
      case 'Double': {
        const first = args[0]?.value
        if (!first) return undefined
        return double(this.requireNumber(first, span))
      }
      case 'String': {
        const first = args[0]?.value
        return first ? str(describe(first, false)) : str('')
      }
      default:
        return undefined
    }
  }

  private requireNumber(value: SwiftValue, span: SourceSpan): number {
    if (value.kind === 'int' || value.kind === 'double') return value.value
    this.trap(`Expected a number, found '${typeNameOf(value)}'`, span)
  }

  // ---------------------------------------------------------------- lvalues

  /**
   * Builds `$name` — a projection onto the storage `name` refers to.
   *
   * Returns null when there is no such storage, so the caller can fall through to
   * its normal "cannot find in scope" reporting rather than handing back a binding
   * onto nothing.
   */
  private projectionFor(name: string, env: Environment): SwiftValue | null {
    const binding = env.lookup(name)
    if (binding) {
      // Re-projecting a binding gives back the same binding, not one wrapping it.
      return asProjection(binding.value) ? binding.value : projection(bindingLValue(binding, name))
    }

    const self = env.resolveSelf()
    if (self?.kind === 'struct' && self.fields.has(name)) {
      const current = self.fields.get(name)
      if (asProjection(current)) return current!
      return projection(fieldLValue(self, name, `self.${name}`))
    }

    return null
  }

  /** Resolves an assignable location, or null when the expression is not one. */
  private tryResolveLValue(expr: Expr, env: Environment): LValue | null {
    switch (expr.kind) {
      case 'identifier': {
        const binding = env.lookup(expr.name)
        if (binding) return throughProjection(bindingLValue(binding, expr.name))

        const self = env.resolveSelf()
        if (self?.kind === 'struct' && self.fields.has(expr.name)) {
          return throughProjection(fieldLValue(self, expr.name, expr.name))
        }
        return null
      }

      case 'memberAccess': {
        if (!expr.base) return null
        const owner = this.tryResolveLValue(expr.base, env)
        const target = owner ? owner.get() : this.evaluate(expr.base, env)
        if (target.kind !== 'struct') return null
        return throughProjection(
          fieldLValue(target, expr.member, `${describe(target, true)}.${expr.member}`),
        )
      }

      case 'selfExpr': {
        const self = env.resolveSelf()
        if (!self) return null
        return { get: () => self, set: () => {}, description: 'self', mutable: true }
      }

      case 'subscript': {
        const base = this.evaluate(expr.base, env)
        const indexExpr = expr.args[0]
        if (!indexExpr) return null
        const index = this.evaluate(indexExpr.value, env)
        return this.subscriptLValue(base, index, expr.span)
      }

      default:
        return null
    }
  }

  private subscriptLValue(base: SwiftValue, index: SwiftValue, span: SourceSpan): LValue | null {
    if (base.kind === 'array') {
      const i = this.requireNumber(index, span)
      return {
        get: () => this.subscriptGet(base, index, span),
        set: (value) => {
          if (i < 0 || i >= base.elements.length) this.trap(TRAP_MESSAGES.indexOutOfRange, span)
          base.elements[i] = value
        },
        description: `[${describe(index, true)}]`,
        mutable: true,
      }
    }
    if (base.kind === 'dictionary') {
      const key = dictionaryKey(index)
      return {
        get: () => base.entries.get(key) ?? NIL,
        set: (value) => {
          if (value.kind === 'nil') base.entries.delete(key)
          else base.entries.set(key, value)
        },
        description: `[${describe(index, true)}]`,
        mutable: true,
      }
    }
    return null
  }

  private subscriptGet(base: SwiftValue, index: SwiftValue, span: SourceSpan): SwiftValue {
    if (base.kind === 'array') {
      const i = this.requireNumber(index, span)
      if (!Number.isInteger(i) || i < 0 || i >= base.elements.length) {
        this.trap(TRAP_MESSAGES.indexOutOfRange, span)
      }
      return base.elements[i]!
    }
    if (base.kind === 'dictionary') return base.entries.get(dictionaryKey(index)) ?? NIL
    if (base.kind === 'string') {
      const i = this.requireNumber(index, span)
      const chars = graphemes(base.value)
      if (i < 0 || i >= chars.length) this.trap(TRAP_MESSAGES.indexOutOfRange, span)
      return str(chars[i]!)
    }
    this.trap(`Value of type '${typeNameOf(base)}' has no subscripts`, span)
  }

  // -------------------------------------------------------------- operators

  private evaluateAssign(
    operator: string,
    targetExpr: Expr,
    valueExpr: Expr,
    span: SourceSpan,
    env: Environment,
  ): SwiftValue {
    const lvalue = this.tryResolveLValue(targetExpr, env)
    if (!lvalue) this.trap('Cannot assign to this expression', span)
    if (!lvalue.mutable) {
      this.trap(`Cannot assign to value: '${lvalue.description}' is a 'let' constant`, span)
    }

    // `tab = .settings` — the target's current value says which enum `.settings`
    // belongs to, which is the only context available at an assignment.
    const current = lvalue.get()
    const rhs = this.coerceToEnum(
      this.evaluateExpecting(valueExpr, env, current.kind === 'enum' ? current.typeName : null),
      current.kind === 'enum' ? current.typeName : null,
    )

    if (operator === '=') {
      lvalue.set(copyValue(rhs))
      return VOID
    }

    // `+=` and friends: read, apply the base operator, write back.
    const combined = this.applyBinary(operator.slice(0, -1), lvalue.get(), rhs, span)
    lvalue.set(copyValue(combined))
    return VOID
  }

  private evaluateBinary(
    operator: string,
    leftExpr: Expr,
    rightExpr: Expr,
    span: SourceSpan,
    env: Environment,
  ): SwiftValue {
    // Short-circuiting must happen before the right side is evaluated, or
    // `index < items.count && items[index] > 0` traps on an empty array.
    if (operator === '&&') {
      return truthy(this.evaluate(leftExpr, env))
        ? bool(truthy(this.evaluate(rightExpr, env)))
        : bool(false)
    }
    if (operator === '||') {
      return truthy(this.evaluate(leftExpr, env))
        ? bool(true)
        : bool(truthy(this.evaluate(rightExpr, env)))
    }
    if (operator === '??') {
      const left = this.evaluate(leftExpr, env)
      return left.kind === 'nil' ? this.evaluate(rightExpr, env) : left
    }

    return this.applyBinary(operator, this.evaluate(leftExpr, env), this.evaluate(rightExpr, env), span)
  }

  private applyBinary(operator: string, left: SwiftValue, right: SwiftValue, span: SourceSpan): SwiftValue {
    switch (operator) {
      case '==':
      case '!=': {
        // `step == .one` — the other operand is the context a contextual member
        // resolves against, and a comparison is the only place that context exists.
        // Without this the token and the enum case never compare equal, so every
        // `if tab == .home` is silently false.
        const lhs = left.kind === 'enum' ? left : this.coerceToEnum(left, enumTypeOf(right))
        const rhs = right.kind === 'enum' ? right : this.coerceToEnum(right, enumTypeOf(left))
        const equal = valuesEqual(lhs, rhs)
        return bool(operator === '==' ? equal : !equal)
      }
      case '..<':
      case '...':
        return {
          kind: 'range',
          lower: this.requireNumber(left, span),
          upper: this.requireNumber(right, span),
          closed: operator === '...',
        }
      default:
        break
    }

    // String concatenation and comparison.
    if (left.kind === 'string' && right.kind === 'string') {
      switch (operator) {
        case '+':
          return str(left.value + right.value)
        case '<':
          return bool(left.value < right.value)
        case '<=':
          return bool(left.value <= right.value)
        case '>':
          return bool(left.value > right.value)
        case '>=':
          return bool(left.value >= right.value)
        default:
          this.trap(`Binary operator '${operator}' cannot be applied to two String operands`, span)
      }
    }

    if (left.kind === 'array' && right.kind === 'array' && operator === '+') {
      return array([...left.elements, ...right.elements].map(copyValue))
    }

    const a = this.requireNumber(left, span)
    const b = this.requireNumber(right, span)
    // Int arithmetic only stays Int when both operands are.
    const isInt = left.kind === 'int' && right.kind === 'int'

    switch (operator) {
      case '<':
        return bool(a < b)
      case '<=':
        return bool(a <= b)
      case '>':
        return bool(a > b)
      case '>=':
        return bool(a >= b)
      case '+':
        return this.numeric(a + b, isInt, span)
      case '-':
        return this.numeric(a - b, isInt, span)
      case '*':
        return this.numeric(a * b, isInt, span)
      case '/':
        if (b === 0 && isInt) this.trap(TRAP_MESSAGES.divisionByZero, span)
        // Swift's Int division truncates: 5 / 2 == 2, not 2.5.
        return isInt ? int(Math.trunc(a / b)) : double(a / b)
      case '%':
        if (b === 0) this.trap(TRAP_MESSAGES.moduloByZero, span)
        return isInt ? int(a % b) : double(a % b)
      default:
        this.trap(`Binary operator '${operator}' is not supported`, span)
    }
  }

  /** Wraps a numeric result, trapping on overflow rather than losing precision. */
  private numeric(result: number, isInt: boolean, span: SourceSpan): SwiftValue {
    if (isInt && !Number.isSafeInteger(result)) {
      // Real Swift traps at 2^63; JS numbers are exact only to 2^53. Trapping at the
      // lower bound reports slightly early, but never returns a silently wrong value —
      // which is the failure mode that actually costs the user time.
      this.trap(`${TRAP_MESSAGES.overflow} (values beyond ${MAX_SAFE_INT} are not representable)`, span)
    }
    return isInt ? int(result) : double(result)
  }

  private evaluateUnary(operator: string, operand: SwiftValue, span: SourceSpan): SwiftValue {
    switch (operator) {
      case '-': {
        const n = this.requireNumber(operand, span)
        return operand.kind === 'int' ? int(-n) : double(-n)
      }
      case '+':
        return operand
      case '!':
        return bool(!truthy(operand))
      default:
        this.trap(`Unary operator '${operator}' is not supported`, span)
    }
  }
}

/**
 * `static` — or `class`, which means static-and-overridable on a class.
 *
 * Matters more than it looks: a `static let` is not a stored property, so counting it
 * as one would shift every memberwise-initialiser argument by a position.
 */
function isStaticDecl(decl: { modifiers: readonly { name: string }[] }): boolean {
  return decl.modifiers.some((m) => m.name === 'static' || m.name === 'class')
}

/**
 * Redirects an lvalue through a projection when the storage holds one.
 *
 * `@Binding var count` stores a projection, so assigning to `count` must write to
 * whatever `$count` was made from rather than replacing the binding itself. Wrapping
 * every lvalue means assignment, compound assignment and `mutating` methods all get
 * this for free instead of each needing to know about bindings.
 */
function throughProjection(lvalue: LValue): LValue {
  const projected = asProjection(lvalue.get())
  if (!projected) return lvalue

  return {
    get: () => projected.get(),
    set: (value) => projected.set(value),
    description: projected.description,
    mutable: true,
  }
}

export type { ArrayValue, DictionaryValue, StructValue, SwiftValue }

/**
 * A `String`-raw-valued enum's implicit raw value is the case name; an `Int`-raw
 * one's is its position. Anything else has no implicit raw value.
 */
function rawValueFor(decl: EnumDecl, caseName: string): SwiftValue | null {
  const raw = decl.inherits[0]?.name
  if (raw === 'String') return str(caseName)
  if (raw === 'Int') {
    const index = decl.cases.findIndex((c) => c.name === caseName)
    return index === -1 ? null : int(index)
  }
  return null
}

function isNumericValue(value: SwiftValue): value is SwiftValue & { value: number } {
  return value.kind === 'int' || value.kind === 'double'
}

/** The plain name of a type annotation, or null for anything structural. */
function namedTypeOf(type: { kind: string; name?: string } | null): string | null {
  if (!type) return null
  if (type.kind === 'namedType') return type.name ?? null
  if (type.kind === 'optionalType') {
    return namedTypeOf((type as unknown as { wrapped: { kind: string; name?: string } }).wrapped)
  }
  return null
}

/** The enum a value belongs to, or null when it is not an enum case. */
function enumTypeOf(value: SwiftValue): string | null {
  return value.kind === 'enum' ? value.typeName : null
}
