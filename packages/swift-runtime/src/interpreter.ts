import type { SourceSpan } from '@studio/shared'
import type {
  Argument,
  Block,
  ClosureExpr,
  Decl,
  Expr,
  FuncDecl,
  SourceFileNode,
  Stmt,
  StructDecl,
  VarDecl,
} from '@studio/swift-syntax'
import {
  bindingLValue,
  Environment,
  fieldLValue,
  type LValue,
} from './environment'
import {
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
  bool,
  copyValue,
  describe,
  dictionaryKey,
  double,
  graphemes,
  int,
  NIL,
  str,
  truthy,
  typeNameOf,
  valuesEqual,
  VOID,
  type ArrayValue,
  type ClosureValue,
  type DictionaryValue,
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
  private readonly host: InterpreterHost
  private readonly stepBudget: number

  readonly globals = new Environment()
  readonly types = new Map<string, StructDecl>()

  constructor(options: InterpreterOptions = {}) {
    this.host = options.host ?? {}
    this.stepBudget = options.stepBudget ?? DEFAULT_STEP_BUDGET
  }

  // ------------------------------------------------------------------ loading

  /** Registers top-level declarations. Types and functions first, so order is irrelevant. */
  load(files: readonly SourceFileNode[]): void {
    for (const file of files) {
      for (const decl of file.declarations) {
        if (decl.kind === 'structDecl') this.types.set(decl.name, decl)
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

    const instance: StructValue = { kind: 'struct', typeName, fields: new Map() }
    const env = this.globals.child(instance)

    // Memberwise initialiser: labelled arguments win over declared defaults.
    const supplied = new Map<string, SwiftValue>()
    const stored = decl.members.filter(
      (m): m is VarDecl => m.kind === 'varDecl' && m.accessor === null,
    )
    args.forEach((arg, index) => {
      const name = arg.label ?? stored[index]?.name
      if (name) supplied.set(name, arg.value)
    })

    for (const property of stored) {
      const provided = supplied.get(property.name)
      const value = provided ?? (property.initializer ? this.evaluate(property.initializer, env) : NIL)
      instance.fields.set(property.name, copyValue(value))
    }

    return instance
  }

  /** Reads a member from a struct: stored field, computed property, or bound method. */
  private memberOfStruct(target: StructValue, member: string, span: SourceSpan): SwiftValue | undefined {
    const field = target.fields.get(member)
    if (field !== undefined) return field

    const decl = this.types.get(target.typeName)
    if (!decl) return undefined

    const computed = decl.members.find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === member && m.accessor !== null,
    )
    if (computed?.accessor) {
      return this.runBody(`${target.typeName}.${member}`, computed.accessor, this.globals.child(target), span)
    }

    const method = decl.members.find(
      (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === member,
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
   */
  private runBody(name: string, body: Block, env: Environment, span: SourceSpan): SwiftValue {
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
    try {
      const only = body.statements.length === 1 ? body.statements[0] : undefined
      if (only?.kind === 'exprStmt') return this.evaluate(only.expression, env)

      this.executeBlock(body, env)
      return VOID
    } catch (error) {
      if (error instanceof ReturnSignal) return error.value as SwiftValue
      throw error
    } finally {
      this.frames.pop()
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
          if (truthy(this.evaluate(statement.condition, env))) {
            this.collectBuilderValues(statement.then, env.child(), out)
          } else if (statement.else?.kind === 'block') {
            this.collectBuilderValues(statement.else, env.child(), out)
          } else if (statement.else) {
            const nested: Block = { kind: 'block', span: statement.else.span, statements: [statement.else] }
            this.collectBuilderValues(nested, env.child(), out)
          }
          break
        }

        // buildArray: a loop contributes one entry per iteration.
        case 'forInStmt': {
          const sequence = this.evaluate(statement.sequence, env)
          for (const element of this.iterate(sequence, statement.sequence.span)) {
            const inner = env.child()
            inner.define(statement.variable, element, true, statement.variableSpan)
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
    return this.runBody(label, decl.body, env, span)
  }

  private bindParameters(
    params: readonly { externalName: string | null; internalName: string; defaultValue: Expr | null; span: SourceSpan }[],
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
      env.define(param.internalName, copyValue(value ?? NIL), true, param.span ?? span)
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
        if (truthy(this.evaluate(statement.condition, env))) {
          this.executeBlock(statement.then, env.child())
        } else if (statement.else) {
          if (statement.else.kind === 'block') this.executeBlock(statement.else, env.child())
          else this.execute(statement.else, env)
        }
        return
      }

      case 'forInStmt': {
        const sequence = this.evaluate(statement.sequence, env)
        for (const element of this.iterate(sequence, statement.sequence.span)) {
          this.tick(statement.span)
          const inner = env.child()
          inner.define(statement.variable, element, true, statement.variableSpan)
          this.executeBlock(statement.body, inner)
        }
        return
      }

      case 'returnStmt':
        throw new ReturnSignal(statement.value ? this.evaluate(statement.value, env) : VOID)

      case 'unsupportedStmt':
        throw new UnsupportedAtRuntime(statement.feature, statement.span)

      case 'errorStmt':
        return
    }
  }

  private executeDeclaration(decl: Decl, env: Environment): void {
    switch (decl.kind) {
      case 'varDecl': {
        const value = decl.initializer ? this.evaluate(decl.initializer, env) : NIL
        env.define(decl.name, copyValue(value), decl.isLet, decl.nameSpan)
        return
      }
      case 'funcDecl':
        env.define(decl.name, { kind: 'function', decl, self: env.resolveSelf(), env }, true, decl.nameSpan)
        return
      case 'structDecl':
        this.types.set(decl.name, decl)
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
    if (binding) return binding.value

    // `$count` is the projection of a property wrapper; the slice treats it as the
    // wrapped value, which is enough for `@State` until Phase 3 adds real bindings.
    if (name.startsWith('$')) {
      const backing = env.lookup(name.slice(1))
      if (backing) return backing.value
    }

    const self = env.resolveSelf()
    if (self) {
      const member = this.memberOfStruct(self, name.startsWith('$') ? name.slice(1) : name, span)
      if (member !== undefined) return member
    }

    if (this.types.has(name)) return { kind: 'type', name }

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

    if (target.kind === 'struct') {
      const value = this.memberOfStruct(target, member, span)
      if (value !== undefined) return value
    }

    const builtin = getBuiltinProperty(target, member)
    if (builtin !== undefined) return builtin

    const fromHost = this.host.getMember?.(target, member, span)
    if (fromHost !== undefined) return fromHost

    this.trap(`Value of type '${typeNameOf(target)}' has no member '${member}'`, span)
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

      if (this.types.has(callee.name)) return this.instantiate(callee.name, allArgs, span)

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
    if (value.kind === 'type') return this.instantiate(value.name, allArgs, span)

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
      const resolved = this.host.resolveImplicitMember?.(member, memberSpan)
      if (resolved !== undefined) return resolved
      this.trap(`Cannot infer contextual base for '.${member}'`, memberSpan)
    }

    // A mutating method needs the *storage*, not a copy, or its writes are lost.
    const lvalue = this.tryResolveLValue(baseExpr, env)
    const target = lvalue ? lvalue.get() : this.evaluate(baseExpr, env)

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

  /** Resolves an assignable location, or null when the expression is not one. */
  private tryResolveLValue(expr: Expr, env: Environment): LValue | null {
    switch (expr.kind) {
      case 'identifier': {
        const binding = env.lookup(expr.name)
        if (binding) return bindingLValue(binding, expr.name)

        const self = env.resolveSelf()
        if (self?.fields.has(expr.name)) return fieldLValue(self, expr.name, expr.name)
        return null
      }

      case 'memberAccess': {
        if (!expr.base) return null
        const owner = this.tryResolveLValue(expr.base, env)
        const target = owner ? owner.get() : this.evaluate(expr.base, env)
        if (target.kind !== 'struct') return null
        return fieldLValue(target, expr.member, `${describe(target, true)}.${expr.member}`)
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

    const rhs = this.evaluate(valueExpr, env)

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
        return bool(valuesEqual(left, right))
      case '!=':
        return bool(!valuesEqual(left, right))
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

export type { ArrayValue, DictionaryValue, StructValue, SwiftValue }
