import type { SourceSpan } from '@studio/shared'
import type {
  Argument,
  Block,
  ClosureExpr,
  Condition,
  Decl,
  DoCatchStmt,
  EnumDecl,
  Expr,
  ForInStmt,
  FuncDecl,
  InitDecl,
  OptionalChainEnd,
  Param,
  Pattern,
  SourceFileNode,
  Stmt,
  StructDecl,
  SwitchStmt,
  TryExpr,
  TypeRef,
  VarDecl,
} from '@studio/swift-syntax'
import {
  argumentLabels,
  collectConformance,
  hoistNestedTypes,
  valueKind,
  type ConformanceModel,
  type TypeNames,
  type ValueKind,
} from '@studio/swift-syntax'
import {
  bindingLValue,
  Environment,
  fieldLValue,
  type Binding,
  type LValue,
} from './environment'
import {
  BreakSignal,
  ContinueSignal,
  ExecutionBudgetExceeded,
  FallthroughSignal,
  NilChainSignal,
  ReturnSignal,
  SwiftThrow,
  SwiftTrap,
  TRAP_MESSAGES,
  UnsupportedAtRuntime,
  type StackFrame,
} from './errors'
import type { CallArgument, HostCall, InterpreterHost } from './host'
import { checkPreviewSize, checkRepeatedValue, PREVIEW_LIMITS } from './limits'
import {
  BUILTIN_TYPE_NAMES,
  callBuiltinMember,
  callStaticBuiltin,
  getBuiltinProperty,
  isMutatingMember,
  staticBuiltinProperty,
} from './stdlib'
import {
  array,
  asDate,
  asProjection,
  bool,
  copyValue,
  dateValue,
  enumCase,
  describe,
  dictionaryKey,
  double,
  formatString,
  graphemes,
  int,
  keyPath,
  NIL,
  projection,
  randomUUIDString,
  str,
  truthy,
  tuple,
  tupleElement,
  typeNameOf,
  uniqueArray,
  unwrapProjection,
  urlValue,
  uuidValue,
  valuesEqual,
  VOID,
  type ArrayValue,
  type ClosureValue,
  type DictionaryValue,
  type EnumValue,
  type FunctionValue,
  type DeclaredType,
  type ProjectionPayload,
  type StructValue,
  type SwiftValue,
} from './values'

/** A span for a value the source never wrote down - a synthesised enum case. */
const NOWHERE: SourceSpan = { file: '', start: 0, end: 0 }

export interface InterpreterOptions {
  readonly host?: InterpreterHost
  /**
   * Evaluation steps before execution is abandoned.
   *
   * FR-6.5. A runaway loop in a Web Worker is a preview that never updates, so the
   * budget is not optional. 5 million steps is roughly 100 ms of interpretation -
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
  /** The last place a step was taken, for a failure that carries no place of its own. */
  private reached: SourceSpan = { file: '', start: 0, end: 0 }
  private readonly frames: StackFrame[] = []
  /** Declared result types, innermost last, so `return .case` knows its own type. */
  private readonly returnTypes: (string | null)[] = []
  /** Declaring types, innermost last, so `super` steps above the right one. */
  private readonly owners: (string | null)[] = []
  private readonly host: InterpreterHost
  private readonly stepBudget: number

  readonly globals = new Environment()
  readonly types = new Map<string, StructDecl>()
  readonly enums = new Map<string, EnumDecl>()
  /** `typealias Num = Int` - the name each alias stands for. */
  private readonly typeAliases = new Map<string, string>()
  /** The type each alias stands for, as written. */
  private readonly aliasTypes = new Map<string, TypeRef>()
  private readonly memberNameCache = new Map<string, ReadonlySet<string>>()
  /** What a type name in a parameter means here, for telling overloads apart. */
  private readonly typeNames: TypeNames = {
    alias: (name) => this.aliasTypes.get(name),
    declared: (name) => (this.types.has(name) || this.enums.has(name) ? 'type' : this.conformance.protocols.has(name) ? 'protocol' : undefined),
  }
  /** `defer` blocks awaiting the exit of each lexical block. */
  private readonly deferred: { block: Block; scope: Environment }[][] = []
  private readonly staticStorage = new Map<VarDecl, SwiftValue>()
  private readonly initializingStatics = new Set<VarDecl>()
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
    this.staticStorage.clear()
    this.initializingStatics.clear()
    // A type declared inside another one is lifted to the top level under a
    // qualified name before anything else looks at the program, so the conformance
    // model, the member tables and instantiation all see it the same way.
    const expanded = hoistNestedTypes(files)
    this.conformance = collectConformance(expanded)
    this.memberNameCache.clear()

    for (const file of expanded) {
      for (const decl of file.declarations) {
        if (decl.kind === 'structDecl') this.types.set(decl.name, decl)
        else if (decl.kind === 'enumDecl') this.enums.set(decl.name, decl)
        else if (decl.kind === 'typealiasDecl') {
          this.typeAliases.set(decl.name, namedTypeOf(decl.target) ?? decl.name)
          this.aliasTypes.set(decl.name, decl.target)
        }
        else if (decl.kind === 'funcDecl') {
          this.globals.define(decl.name, withOverload(this.globals.own(decl.name)?.value, { kind: 'function', decl, self: null, env: this.globals }), true, decl.span)
        }
      }
    }

    // Global `var`/`let` initialisers run after types exist so they may reference them.
    for (const file of files) {
      for (const decl of file.declarations) {
        if (decl.kind !== 'varDecl') continue
        const value = decl.initializer
          ? this.evaluateExpecting(decl.initializer, this.globals, namedTypeOf(decl.typeAnnotation))
          : NIL

        if (decl.destructured) {
          for (const [index, binding] of decl.destructured.entries()) {
            if (binding.name === '_') continue
            const part = value.kind === 'tuple' ? value.elements[index] : undefined
            this.globals.define(binding.name, copyValue(part ?? NIL), decl.isLet, binding.span)
          }
          continue
        }

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
   * Whether the project declared a type by this name.
   *
   * For the host, which answers for a great many names it does not own the only claim
   * to - `Tab`, `Settings`, `Marker`, `Table` are all SwiftUI *and* all plausible
   * things to write in an app. A name the project declared is the project's.
   */
  declaresType(typeName: string): boolean {
    // An `extension Color` adds to the framework's type; it does not make `Color` the
    // project's. Counting it as a declaration used to hand every `Color.blue` in such
    // a project back to the interpreter, which has no `blue` to give.
    return !!this.conformance.types.get(typeName)?.decl
  }

  /** The superclass of a class, for `super`. */
  superclassOf(typeName: string): string | null {
    return this.conformance.types.get(typeName)?.superclass ?? null
  }

  // ----------------------------------------------------------- overloads

  /** How well arguments suit parameters: each one's fit added up, or -Infinity when one can't be its parameter's type. */
  private suitability(params: readonly Param[], args: readonly CallArgument[]): number {
    const declared = argumentLabels(params)
    let next = 0
    let total = 0
    for (const arg of args) {
      // A labelled argument skips the parameters it leaves to their defaults.
      while (arg.label !== null && next < params.length && declared[next] !== arg.label && params[next]!.defaultValue) next++
      const param = params[next++]
      if (!param) break
      const fit = this.fit(arg.value, param.type)
      if (fit === 0) return -Infinity
      total += fit
    }
    return total
  }

  /**
   * How well a value suits a declared type: 3 when it is that type, 2 when it converts
   * or conforms to it, 1 when the type says nothing a value can be checked against (a
   * generic, `Any`, a framework type), and 0 when it can't be that type. The kinds are
   * `valueKind`'s, which the checker's warning about overloads reads too.
   */
  private fit(value: SwiftValue, type: TypeRef | null): number {
    return this.fitKind(value, valueKind(type, this.typeNames))
  }

  private fitKind(value: SwiftValue, kind: ValueKind): number {
    if (kind === 'any') return 1
    // A value given where an Optional is taken fits, a little less than where it isn't.
    if (kind.startsWith('optional:')) return value.kind === 'nil' ? 3 : Math.max(0, this.fitKind(value, kind.slice('optional:'.length)) - 0.5)
    if (value.kind === 'nil') return 0
    switch (kind) {
      case 'int':
        return value.kind === 'int' ? 3 : 0
      // A whole number is a Double where one is taken, as a literal is.
      case 'decimal':
        return value.kind === 'double' ? 3 : value.kind === 'int' ? 2 : 0
      case 'string':
        return value.kind === 'string' ? 3 : 0
      case 'character':
        return value.kind === 'string' ? 2 : 0
      case 'bool':
        return value.kind === 'bool' ? 3 : 0
      case 'array':
        return value.kind === 'array' ? 3 : 0
      case 'dictionary':
        return value.kind === 'dictionary' ? 3 : 0
      case 'range':
        return value.kind === 'range' ? 3 : 0
      case 'function':
        return value.kind === 'closure' || value.kind === 'function' ? 3 : 0
    }
    const name = kind.slice(kind.indexOf(':') + 1)
    if (kind.startsWith('tuple:')) return value.kind === 'tuple' && value.elements.length === Number(name) ? 3 : 0
    if (kind.startsWith('type:')) {
      if (value.kind !== 'struct' && value.kind !== 'enum') return 0
      if (value.typeName === name) return 3
      for (let above = this.superclassOf(value.typeName); above; above = this.superclassOf(above)) if (above === name) return 2
      return 0
    }
    // `extension Int: Displayable {}` makes a whole number one too.
    if (kind.startsWith('protocol:')) return this.conformsTo(typeNameOf(value), name) ? 2 : 0
    return value.kind === 'opaque' && value.typeName === name ? 3 : 1
  }

  /**
   * The binding a bare name refers to, unless a member of the type it is written in
   * shadows it.
   *
   * Swift looks in the scopes around a name first, then among the members of the
   * type the code is written in, and only then at the top level. So inside a type,
   * `title()` is its own method and `count` its own property even where a top-level
   * `func title()` or `var count` exists: a top-level binding that a member shadows
   * answers undefined here, and the caller goes on to the members. Reads, calls,
   * writes and `$` projections all ask here, so they agree about which it is.
   */
  private unshadowedBinding(name: string, env: Environment): Binding | undefined {
    const binding = env.lookup(name)
    if (!binding || binding !== this.globals.lookup(name)) return binding
    const self = env.resolveSelf()
    if (!self) return binding
    const own = (self.kind === 'struct' && self.fields.has(name)) || this.memberNames(self.typeName).has(name)
    return own ? undefined : binding
  }

  /** The names of a type's properties and methods, kept per type: the members don't change between loads. */
  private memberNames(typeName: string): ReadonlySet<string> {
    let names = this.memberNameCache.get(typeName)
    if (!names) {
      names = new Set(this.membersOf(typeName).flatMap((m) => (m.kind === 'funcDecl' || m.kind === 'varDecl' ? [m.name] : [])))
      this.memberNameCache.set(typeName, names)
    }
    return names
  }

  /**
   * The type a member was written in, which is what `super` steps above: the type
   * it was looked up in, or one that type inherits it from.
   */
  private declaringTypeOf(lookupIn: string, member: Decl): string {
    for (let type: string | null = lookupIn; type; type = this.superclassOf(type)) {
      const found = this.conformance.types.get(type)?.origin.get(member)
      if (found) return found
    }
    return lookupIn
  }

  /**
   * Evaluates an expression as though it appeared inside a type's body.
   *
   * Needed by the SwiftUI runtime to re-run a property's declared initialiser - a
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

  /**
   * Where execution last was.
   *
   * What an engine error - the JavaScript stack running out on recursion - is
   * reported at: it is raised by the interpreter itself, not by the user's code, so
   * it has no span of its own, and this is the line that was running.
   */
  get position(): SourceSpan {
    return this.reached
  }

  // ---------------------------------------------------------------- budgeting

  private tick(span: SourceSpan): void {
    this.reached = span
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
   * stored at all - they re-evaluate on every read, which is what makes `body`
   * reflect current state rather than the state at construction time.
   */
  instantiate(typeName: string, args: readonly CallArgument[], span: SourceSpan): StructValue {
    const decl = this.types.get(typeName)
    if (!decl) throw new UnsupportedAtRuntime(typeName, span)

    const instance: StructValue = {
      kind: 'struct',
      typeName,
      fields: new Map(),
      ...(this.conformsTo(typeName, 'View') || this.conformsTo(typeName, 'Shape') ? { viewSource: span } : {}),
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
    const initialiser = pickOverload(
      members.filter((m): m is InitDecl => m.kind === 'initDecl' && m.body !== null),
      labelsOf(args),
      (candidate) => this.suitability(candidate.params, args),
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

    // `Tab(rawValue: "home")` - the failable initialiser every raw-valued enum has.
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
   * property - `var title: String { switch self { … } }` - is written.
   */
  private memberOfEnum(
    target: EnumValue,
    member: string,
    span: SourceSpan,
    labels?: readonly (string | null)[],
  ): SwiftValue | undefined {
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
        computed.attributes.some((a) => a.name === 'ViewBuilder'),
      )
    }

    return withCandidates(methodsNamed(members, member), labels, (decl) => ({ kind: 'function', decl, self: null, env: this.globals.child(target) }))
  }

  /**
   * A *method* on the receiver, ignoring any property that shares its name.
   *
   * Swift lets a type declare `var spent: Double` and `func spent(on:) -> Double`
   * and they are two different members; only one of them can be called. The general
   * lookup answers properties first, which is right for a read and wrong for a call -
   * `spent(on: .food)` found the `Double` and then tried to call it.
   */
  private methodOn(
    self: SwiftValue,
    name: string,
    labels: readonly (string | null)[],
    lookupIn?: string,
  ): FunctionValue | undefined {
    if (self.kind !== 'struct' && self.kind !== 'enum') return undefined
    const owner = lookupIn ?? self.typeName
    return withCandidates(methodsNamed(this.membersOf(owner), name), labels, (decl) => self.kind === 'struct'
      ? { kind: 'function', decl, self, env: this.globals, owner: this.declaringTypeOf(owner, decl) }
      : { kind: 'function', decl, self: null, env: this.globals.child(self) })
  }

  /** Reads a member from a struct: stored field, computed property, or bound method. */
  private memberOfStruct(
    target: StructValue,
    member: string,
    span: SourceSpan,
    /**
     * Where to begin looking, for `super`. The receiver is still the same instance -
     * only the member list changes, which is the whole of what `super` means.
     */
    lookupIn: string = target.typeName,
    /**
     * The labels the call site wrote, where there is a call site. Two methods may
     * share a name and differ only in these, and picking the wrong one runs a body
     * with an unbound parameter rather than failing.
     */
    labels?: readonly (string | null)[],
  ): SwiftValue | undefined {
    if (lookupIn === target.typeName) {
      const field = target.fields.get(member)
      if (field !== undefined) return field
    }

    const members = this.membersOf(lookupIn)
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
        computed.attributes.some((a) => a.name === 'ViewBuilder'),
      )
    }

    return withCandidates(methodsNamed(members, member), labels, (decl) => ({ kind: 'function', decl, self: target, env: this.globals, owner: this.declaringTypeOf(lookupIn, decl) }))
  }

  // ------------------------------------------------------------------- calls

  /**
   * Runs a block as a function body, translating `return` into a value.
   *
   * Swift's implicit return applies to single-expression bodies - which is how every
   * `var body: some View` works. That expression is evaluated exactly once: running
   * the block for effects and *then* re-evaluating the expression for its value would
   * double every side effect in it.
   *
   * `expected` is the declared result type, and it is the only context a bare `.case`
   * in a `return` has to resolve against - `func next() -> Step { return .two }` says
   * what `.two` means nowhere else. Pushed as a stack rather than passed down because
   * the `return` may be nested arbitrarily deep inside the body.
   */
  private runBody(
    name: string,
    body: Block,
    env: Environment,
    span: SourceSpan,
    expected: string | null = null,
    /**
     * `@ViewBuilder`: the body is a *list of views*, not statements with a value.
     *
     * Without this a helper of more than one statement returned nothing at all -
     * `@ViewBuilder func row(_ b: Bool) -> some View { if b { Text("y") } else {
     * Text("n") } }` drew an empty screen and reported no problem, because the
     * implicit return below only covers a single expression and a builder body is
     * almost never one. Splitting a long body into `@ViewBuilder` helpers is one of
     * the first things anybody does to a real view.
     */
    isViewBuilder = false,
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
      if (isViewBuilder) {
        const built: SwiftValue[] = []
        this.collectBuilderValues(body, env, built)
        if (built.length === 1) return built[0]!
        // More than one, which is a `TupleView` in Swift. The host owns what that is
        // here, because the interpreter has no idea what a view is.
        return this.host.groupValues?.(built, span) ?? built[0] ?? VOID
      }

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
   * A result builder does not return the last statement - it collects every
   * expression in the block (`buildBlock`), picks a branch (`buildIf`/`buildEither`),
   * and flattens loops (`buildArray`). Modelling that here rather than in the host
   * keeps the control-flow semantics with the interpreter that owns scoping, while
   * leaving the host free to decide what the collected values *mean*.
   */
  runViewBuilder(closure: ClosureValue, args: readonly SwiftValue[] = []): SwiftValue[] {
    const env = (closure.env as Environment).child()
    if (closure.hasExplicitParams) {
      const given = spreadTuple(closure, args)
      closure.params.forEach((param, i) => {
        const value = given[i] ?? NIL
        const name = param.name.startsWith('$') && asProjection(value) ? param.name.slice(1) : param.name
        env.define(name, copyValue(value), true, param.span)
      })
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
    this.withDeferScope(() => this.collectBuilderStatements(block, env, out))
  }

  private collectBuilderStatements(block: Block, env: Environment, out: SwiftValue[]): void {
    for (const [index, statement] of block.statements.entries()) {
      this.tick(statement.span)
      const branch = (name: string, build: (values: SwiftValue[]) => void) => {
        const evaluate = () => { const values: SwiftValue[] = []; build(values); return values }
        out.push(...(this.host.withBuilderScope?.(`${statement.kind}:${index}`, name, evaluate) ?? evaluate()))
      }

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
            branch('then', values => this.collectBuilderValues(statement.then, taken, values))
          } else if (statement.else?.kind === 'block') {
            const otherwise = statement.else
            branch('else', values => this.collectBuilderValues(otherwise, env.child(), values))
          } else if (statement.else) {
            const nested: Block = { kind: 'block', span: statement.else.span, statements: [statement.else] }
            branch('else', values => this.collectBuilderValues(nested, env.child(), values))
          } else branch('empty', () => {})
          break
        }

        // A `switch` in a view builder contributes only the matched case, which is
        // how enum-driven views are written.
        case 'switchStmt': {
          const matched = this.matchSwitch(statement, env)
          branch(String(matched?.index ?? 'empty'), values => { if (matched) this.collectBuilderValues(matched.body, matched.scope, values) })
          break
        }

        // buildArray: a loop contributes one entry per iteration.
        case 'forInStmt': {
          const sequence = this.evaluate(statement.sequence, env)
          for (const element of this.iterate(sequence, statement.sequence.span)) {
            const inner = env.child()
            this.bindLoopVariable(statement, element, inner)
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
    const decl = fn.overloads ? pickOverload(fn.overloads, labelsOf(args), (candidate) => this.suitability(candidate.params, args)) ?? fn.decl : fn.decl
    const owner = decl === fn.decl || !fn.self ? fn.owner : this.declaringTypeOf(fn.self.typeName, decl)
    const env = (fn.env as Environment).child(fn.self)

    this.bindParameters(decl.params, args, env, span)

    if (!decl.body) return VOID
    const label = fn.self ? `${fn.self.typeName}.${decl.name}` : decl.name
    this.owners.push(owner ?? null)
    try {
      return this.runBody(
        label,
        decl.body,
        env,
        span,
        namedTypeOf(decl.returnType),
        decl.attributes.some((a) => a.name === 'ViewBuilder'),
      )
    } finally {
      this.owners.pop()
    }
  }

  private bindParameters(
    params: readonly {
      externalName: string | null
      internalName: string
      defaultValue: Expr | null
      type?: TypeRef | null
      isInout?: boolean
      isVariadic?: boolean
      span: SourceSpan
    }[],
    args: readonly CallArgument[],
    env: Environment,
    span: SourceSpan,
  ): void {
    const positional = args.filter((a) => a.label === null)
    let positionalIndex = 0

    for (const param of params) {
      // `func f(_ xs: Int...)` takes every remaining positional argument as one array.
      if (param.isVariadic) {
        const rest = positional.slice(positionalIndex).map((a) => copyValue(a.value))
        positionalIndex = positional.length
        env.define(param.internalName, array(rest), true, param.span ?? span)
        continue
      }

      const byLabel = args.find((a) => a.label !== null && a.label === (param.externalName ?? param.internalName))
      let value: SwiftValue | undefined = byLabel?.value

      if (value === undefined && (param.externalName === '_' || param.externalName === null)) {
        value = positional[positionalIndex++]?.value
      }
      if (value === undefined && param.defaultValue) {
        value = this.evaluate(param.defaultValue, env)
      }
      if (value === undefined) value = positional[positionalIndex++]?.value

      // An `inout` parameter is bound to the caller's storage rather than to a copy,
      // so writes reach back out. The projection `&x` produced is the same thing
      // `$x` produces for `@Binding`, and every read and write already goes through
      // one - so there is nothing further to do here but decline to copy.
      if (param.isInout && value !== undefined && asProjection(value)) {
        env.define(param.internalName, value, false, param.span ?? span)
        continue
      }

      // Otherwise arguments are passed by value, so the callee cannot mutate the
      // caller's copy. A declared parameter type is also the context a contextual
      // member resolves against, which is what makes `select(.home)` mean anything.
      const coerced = this.coerceToEnum(value ?? NIL, namedTypeOf(param.type ?? null))
      env.define(param.internalName, copyValue(coerced), true, param.span ?? span)
    }
  }

  callClosure(closure: ClosureValue, args: readonly SwiftValue[], span: SourceSpan): SwiftValue {
    const env = (closure.env as Environment).child()

    if (closure.hasExplicitParams) {
      const given = spreadTuple(closure, args)
      closure.params.forEach((param, i) => {
        const value = given[i] ?? NIL
        const name = param.name.startsWith('$') && asProjection(value) ? param.name.slice(1) : param.name
        env.define(name, copyValue(value), true, param.span)
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
      member: (value, name) => this.readMember(value, name, span),
    }
  }

  /** What a type's stored property was declared as, where the declaration wrote a type. */
  private declaredTypeOf(typeName: string, property: string): DeclaredType | undefined {
    const annotation = this.membersOf(typeName).find((m): m is VarDecl => m.kind === 'varDecl' && m.name === property)?.typeAnnotation
    if (!annotation) return undefined
    const optional = annotation.kind === 'optionalType'
    const named = optional ? annotation.wrapped : annotation
    return { optional, ...(named.kind === 'namedType' ? { name: named.name } : {}) }
  }

  /**
   * `value.name` for a value already in hand: a tuple's element, a property, stored or
   * computed, an enum's `rawValue`, or a built-in one. Member access asks this before
   * the host, and a key path or a `ForEach` id reads through it too.
   */
  private readMember(target: SwiftValue, member: string, span: SourceSpan): SwiftValue | undefined {
    if (member === 'self') return target
    if (target.kind === 'tuple') return tupleElement(target, member)
    const own = target.kind === 'enum' ? this.memberOfEnum(target, member, span) : target.kind === 'struct' ? this.memberOfStruct(target, member, span) : undefined
    if (own !== undefined) return unwrapProjection(own)
    const builtin = getBuiltinProperty(target, member)
    if (builtin !== undefined) return builtin
    const extended = this.userMember(target, member, span)
    return extended === undefined ? undefined : unwrapProjection(extended)
  }

  // -------------------------------------------------------------- statements

  private withDeferScope<T>(body: () => T): T {
    this.deferred.push([])
    try { return body() }
    finally {
      const pending = this.deferred.pop()!
      for (const { block, scope } of pending.reverse()) this.executeBlock(block, scope)
    }
  }

  executeBlock(block: Block, env: Environment): void {
    this.withDeferScope(() => {
      for (const statement of block.statements) this.execute(statement, env)
    })
  }

  execute(statement: Stmt, env: Environment): void {
    if ((statement.kind === 'ifStmt' || statement.kind === 'doCatchStmt') && statement.label) {
      try { this.execute({ ...statement, label: undefined }, env) }
      catch (error) { if (!(error instanceof BreakSignal) || error.label !== statement.label) throw error }
      return
    }
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
        // A `guard`'s bindings escape into the *enclosing* scope - that is the whole
        // point of it - so they are bound into `env` rather than into a child.
        if (this.bindConditions(statement.conditions, env)) return
        this.executeBlock(statement.else, env.child())
        // Swift requires the else block to leave scope. If it did not, falling through
        // would run the rest of the body with the bindings absent, so the guard is
        // honoured by returning here rather than pretending it matched.
        throw new ReturnSignal(VOID)
      }

      case 'switchStmt': {
        let matched = this.matchSwitch(statement, env)
        while (matched) {
          try {
            this.executeBlock(matched.body, matched.scope)
          } catch (error) {
            // `break` inside a switch case leaves the switch, not an enclosing loop.
            if (error instanceof BreakSignal && (!error.label || error.label === statement.label)) return
            // `fallthrough` runs the *next* case's body, without testing its pattern -
            // which is why it continues the loop rather than re-matching.
            if (error instanceof FallthroughSignal) {
              matched = this.caseAfter(statement, matched.index, env)
              continue
            }
            throw error
          }
          return
        }
        return
      }

      case 'whileStmt': {
        for (;;) {
          this.tick(statement.span)
          const scope = env.child()
          if (!this.bindConditions(statement.conditions, scope)) return
          if (this.runLoopBody(statement.body, scope, statement.label)) return
        }
      }

      case 'repeatStmt': {
        for (;;) {
          this.tick(statement.span)
          if (this.runLoopBody(statement.body, env.child(), statement.label)) return
          if (!truthy(this.evaluate(statement.condition, env))) return
        }
      }

      case 'breakStmt':
        throw new BreakSignal(statement.label)

      case 'continueStmt':
        throw new ContinueSignal(statement.label)

      case 'forInStmt': {
        const sequence = this.evaluate(statement.sequence, env)
        for (const element of this.iterate(sequence, statement.sequence.span)) {
          this.tick(statement.span)
          const inner = env.child()
          this.bindLoopVariable(statement, element, inner)
          if (statement.where && !truthy(this.evaluate(statement.where, inner))) continue
          if (this.runLoopBody(statement.body, inner, statement.label)) return
        }
        return
      }

      case 'throwStmt':
        throw new SwiftThrow(this.evaluate(statement.value, env), statement.span)

      case 'doCatchStmt':
        this.runDoCatch(statement, env)
        return

      case 'returnStmt':
        throw new ReturnSignal(
          statement.value
            ? this.evaluateExpecting(statement.value, env, this.returnTypes[this.returnTypes.length - 1] ?? null)
            : VOID,
        )

      case 'deferStmt': {
        const pending = this.deferred[this.deferred.length - 1]
        if (pending) pending.push({ block: statement.body, scope: env.child() })
        return
      }

      case 'fallthroughStmt':
        throw new FallthroughSignal()

      case 'unsupportedStmt':
        throw new UnsupportedAtRuntime(statement.feature, statement.span)

      case 'errorStmt':
        return
    }
  }

  /**
   * Evaluates a condition list, binding anything it unwraps into `scope`.
   *
   * Returns false as soon as a clause fails, *without* evaluating the rest - which is
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
   * reported upward - which keeps every loop's `for` in `execute` identical.
   */
  private runLoopBody(body: Block, scope: Environment, label?: string): boolean {
    try {
      this.executeBlock(body, scope)
    } catch (error) {
      if (error instanceof BreakSignal && (!error.label || error.label === label)) return true
      if (!(error instanceof ContinueSignal) || error.label && error.label !== label) throw error
    }
    return false
  }

  /**
   * Finds the case a `switch` takes.
   *
   * Bindings land in a scope of their own, so `case .success(let value)` can name a
   * payload without leaking it into the sibling cases. Returns null when nothing
   * matched - Swift requires exhaustiveness and we do not check it, so the honest
   * behaviour for an unmatched subject is to run nothing rather than to guess.
   */
  private matchSwitch(
    statement: SwitchStmt,
    env: Environment,
  ): { body: Block; scope: Environment; index: number } | null {
    const subject = this.evaluate(statement.subject, env)

    for (const [index, branch] of statement.cases.entries()) {
      const scope = env.child()

      if (branch.isDefault) {
        if (branch.where && !truthy(this.evaluate(branch.where, scope))) continue
        return { body: branch.body, scope, index }
      }

      for (const pattern of branch.patterns) {
        const attempt = env.child()
        if (!this.matchPattern(pattern, subject, attempt)) continue
        if (branch.where && !truthy(this.evaluate(branch.where, attempt))) continue
        return { body: branch.body, scope: attempt, index }
      }
    }

    return null
  }

  /**
   * The case after `index`, for `fallthrough`.
   *
   * Its pattern is deliberately not tested - that is what `fallthrough` means - so
   * any names the pattern would have bound are not in scope, exactly as in Swift,
   * which refuses a fallthrough into a case that binds.
   */
  private caseAfter(
    statement: SwitchStmt,
    index: number,
    env: Environment,
  ): { body: Block; scope: Environment; index: number } | null {
    const next = statement.cases[index + 1]
    return next ? { body: next.body, scope: env.child(), index: index + 1 } : null
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

      case 'tuplePattern': {
        if (subject.kind !== 'tuple') return false
        if (subject.elements.length !== pattern.elements.length) return false
        return pattern.elements.every((element, index) =>
          this.matchPattern(element, subject.elements[index]!, scope),
        )
      }

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
   * Stored values initialize once per loaded program. Reloading clears the storage,
   * so edited initializers are visible without changing singleton identity on reads.
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
      if (this.staticStorage.has(property)) return this.staticStorage.get(property)!
      if (this.initializingStatics.has(property)) this.trap(`Recursive initialization of '${typeName}.${member}'`, span)
      this.initializingStatics.add(property)
      try {
        const value = property.initializer ? this.evaluate(property.initializer, this.globals) : NIL
        this.staticStorage.set(property, value)
        return value
      } finally { this.initializingStatics.delete(property) }
    }

    const method = members.find(
      (m): m is FuncDecl =>
        m.kind === 'funcDecl' && m.name === member && isStatic(m) && m.body !== null,
    )
    return method ? { kind: 'function', decl: method, self: null, env: this.globals } : undefined
  }

  /**
   * `.accent`, `.space16`, `.sectionTitle` - a static member a project `extension`
   * added to one of the framework's value types, written with contextual syntax.
   *
   * Swift resolves these against the expected type, which the interpreter does not
   * track. The host answers the framework's own names by name alone; a name the
   * project added to `Color`, `Font` or `CGFloat` is looked up here first, in that
   * order, so `.foregroundStyle(.accent)` draws the accent it declares rather than a
   * colour token with no meaning. SwiftUI's own contextual names are never
   * answered here - `.small` means a control size wherever it is written, even in a
   * project that also has a `CGFloat.small`.
   */
  private extensionStatic(member: string, span: SourceSpan): SwiftValue | undefined {
    if (FRAMEWORK_CONTEXTUAL.has(member)) return undefined
    for (const typeName of TOKEN_HOSTS) {
      const type = this.conformance.types.get(typeName)
      if (!type || type.decl) continue
      if (!type.members.some(m => (m.kind === 'varDecl' || m.kind === 'funcDecl') && m.name === member && isStaticDecl(m))) continue
      return this.staticMember(typeName, member, span)
    }
    return undefined
  }

  /**
   * `CaseIterable`'s synthesised `allCases`.
   *
   * `ForEach(Tab.allCases, id: \.self)` is the commonest enum-driven pattern there
   * is, and the conformance is what makes it legal: an enum that does not declare
   * `CaseIterable` has no `allCases` in Xcode either, so answering one here would be
   * the preview accepting code the compiler rejects.
   *
   * Swift synthesises it only when no case has associated values, for the obvious
   * reason that it could not know what to put in them.
   */
  private synthesizedAllCases(typeName: string, span: SourceSpan): SwiftValue | undefined {
    const decl = this.enums.get(typeName)
    if (!decl || !this.conformsTo(typeName, 'CaseIterable')) return undefined
    if (decl.cases.some((c) => c.associated.length > 0)) return undefined

    return array(decl.cases.map((c) => this.makeEnumCase(decl, c.name, [], span)))
  }

  /**
   * The registered name of a type declared inside another one.
   *
   * Nested types are stored under their qualified name - `S.Inner` - so that two
   * outer types may each declare an `Inner` without colliding. They are *also*
   * registered under the bare name when nothing else claims it, which is what makes
   * an unqualified `Inner()` work inside `S`. That second registration is wider than
   * Swift's scoping: a sibling type can reach `Inner` unqualified here and could not
   * in Xcode. It errs towards accepting code rather than rejecting it, which is the
   * direction this checker has taken since Phase 1.
   */
  private nestedTypeName(outer: string, member: string): string | null {
    const qualified = `${outer}.${member}`
    return this.types.has(qualified) || this.enums.has(qualified) ? qualified : null
  }

  // ------------------------------------------------------------------- enums


  /**
   * Resolves a contextual enum member against an expected type.
   *
   * `var tab: Tab = .home` has no base to resolve `.home` against, so the host hands
   * back a bare token. When the declaration says what type is expected, the token can
   * be turned into the case it obviously means. Without this, contextual member
   * syntax - which is how almost every enum is written in view code - would produce a
   * value that compares equal to nothing.
   */
  coerceToEnum(value: SwiftValue, typeName: string | null): SwiftValue {
    if (!typeName) return value

    // `var width: Double` given the literal `3`. Swift converts at the literal, since
    // `3` there is a `Double` literal and never an `Int` - so `Rect(width: 3).width`
    // is 3.0 and prints as such. Without this the value stays an Int and every
    // arithmetic result downstream loses its fractional formatting.
    if (typeName === 'Double' && value.kind === 'int') return double(value.value)

    if (value.kind !== 'opaque') return value

    const decl = this.enums.get(typeName)
    if (!decl) {
      // `.low` where a `ShadowToken` is expected: a static member of the expected type,
      // which the declaration names even though the call site does not.
      const statik = this.contextualStatic(value, typeName)
      if (statik !== undefined) return statik
      // Not an enum this project declared. `Color`, `Font` and the rest belong to the
      // host, and only the host can turn `.blue` into one.
      return this.host.coerceToType?.(value, typeName) ?? value
    }

    const payload = value.payload as { name?: string; args?: readonly SwiftValue[] } | null
    const name = payload?.name
    if (typeof name !== 'string') return value
    if (!decl.cases.some((c) => c.name === name)) return value

    // `.done("hi")` carries its payload here, because the contextual form is the one
    // real code writes and a case built without its associated values matches the
    // pattern and binds nothing.
    const args = (payload?.args ?? []).map((argument) => ({
      label: null,
      value: argument,
      span: NOWHERE,
    }))
    return this.makeEnumCase(decl, name, args, NOWHERE)
  }

  /** A contextual token resolved as a static member of the type a declaration expects. */
  private contextualStatic(value: SwiftValue, typeName: string): SwiftValue | undefined {
    if (value.kind !== 'opaque' || value.typeName !== 'Token') return undefined
    const payload = value.payload as { name?: string; args?: readonly SwiftValue[] } | null
    const name = payload?.name
    if (typeof name !== 'string' || !this.conformance.types.has(typeName)) return undefined
    const statik = this.staticMember(typeName, name, NOWHERE)
    if (statik === undefined) return undefined
    if (statik.kind !== 'function') return payload?.args?.length ? undefined : statik
    return this.callFunction(statik, (payload?.args ?? []).map(argument => ({ label: null, value: argument, span: NOWHERE })), NOWHERE)
  }

  // ------------------------------------------------------------------ errors

  /**
   * `do { … } catch … { … }`.
   *
   * Clauses are tried in order and the first that matches wins - Swift's rule, and the
   * reason a bare `catch` has to be written last. A throw with no matching clause keeps
   * travelling, because swallowing it here would turn a real failure into silence.
   */
  private runDoCatch(statement: DoCatchStmt, env: Environment): void {
    try {
      this.executeBlock(statement.body, env.child())
    } catch (error) {
      if (!(error instanceof SwiftThrow)) throw error

      const thrown = error.value as SwiftValue
      for (const clause of statement.catches) {
        const scope = env.child()
        if (clause.pattern && !this.matchPattern(clause.pattern, thrown, scope)) continue
        scope.define(clause.binding, thrown, true, clause.span)
        this.executeBlock(clause.body, scope)
        return
      }

      throw error
    }
  }

  /**
   * `try`, `try?` and `try!`.
   *
   * Bare `try` is a marker and nothing more: it makes the call visibly fallible at the
   * call site, and the throw propagates on its own. The other two are where the work
   * is - `try?` turns a throw into nil, `try!` into a trap that names what was thrown.
   */
  private runTry(expr: TryExpr, env: Environment): SwiftValue {
    if (expr.mode === 'propagate') return this.evaluate(expr.operand, env)

    try {
      return this.evaluate(expr.operand, env)
    } catch (error) {
      if (!(error instanceof SwiftThrow)) throw error
      if (expr.mode === 'optional') return NIL
      this.trap(
        `Unexpectedly found an error: ${describe(error.value as SwiftValue, false)}`,
        expr.span,
      )
    }
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
   * what `Tab` is. Deliberately not general type inference - it applies exactly where
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

    const value = this.coerceToEnum(this.evaluate(expr, env), expected)

    // `let tags: Set<String> = ["a", "a"]` - the literal is an array literal either
    // way, so the annotation is the only thing that says the duplicates go.
    if (expected === 'Set' && value.kind === 'array') return uniqueArray(value.elements)

    return value
  }

  private executeDeclaration(decl: Decl, env: Environment): void {
    switch (decl.kind) {
      case 'varDecl': {
        const expected = namedTypeOf(decl.typeAnnotation)
        const value = decl.initializer
          ? this.evaluateExpecting(decl.initializer, env, expected)
          : NIL

        // `let (a, b) = pair` spreads one tuple across several names.
        if (decl.destructured) {
          for (const [index, binding] of decl.destructured.entries()) {
            if (binding.name === '_') continue
            const part = value.kind === 'tuple' ? value.elements[index] : undefined
            env.define(binding.name, copyValue(part ?? NIL), decl.isLet, binding.span)
          }
          return
        }

        env.define(decl.name, copyValue(value), decl.isLet, decl.nameSpan)
        return
      }
      case 'funcDecl': {
        const receiver = env.resolveSelf()
        const fn: FunctionValue = { kind: 'function', decl, self: receiver?.kind === 'struct' ? receiver : null, env }
        env.define(decl.name, withOverload(env.own(decl.name)?.value, fn), true, decl.nameSpan)
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

  /**
   * Binds one iteration's element to the loop's variable, or variables.
   *
   * `for (key, value) in dictionary` spreads a tuple across names; the single-name
   * form takes the whole element. A name of `_` is a deliberate discard and binds
   * nothing.
   */
  private bindLoopVariable(statement: ForInStmt, element: SwiftValue, env: Environment): void {
    if (!statement.destructured) {
      if (statement.variable !== '_') {
        env.define(statement.variable, element, true, statement.variableSpan)
      }
      return
    }

    for (const [index, binding] of statement.destructured.entries()) {
      if (binding.name === '_') continue
      const part = element.kind === 'tuple' ? element.elements[index] : undefined
      env.define(binding.name, copyValue(part ?? NIL), true, binding.span)
    }
  }

  private *iterate(value: SwiftValue, span: SourceSpan, materializing = false): Generator<SwiftValue> {
    if (value.kind === 'range') {
      if (value.boundType === 'Date' || !Number.isFinite(value.lower) || !Number.isFinite(value.upper)) this.trap('This range is not an iterable integer sequence', span)
      const end = value.closed ? value.upper : value.upper - 1
      if (materializing) checkPreviewSize(Math.max(0, end - value.lower + 1), PREVIEW_LIMITS.collectionElements, 'Range element count', span)
      for (let i = value.lower; i <= end; i++) { this.tick(span); yield int(i) }
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
      // `(key: , value: )` - a labelled tuple, which is what Swift yields. It reads
      // as `$0.key` in a closure and destructures as `for (k, v) in`.
      for (const [k, v] of value.entries) yield tuple([str(k), v], ['key', 'value'])
      return
    }
    if (value.kind === 'tuple') {
      for (const element of [...value.elements]) yield element
      return
    }
    this.trap(`Type '${typeNameOf(value)}' does not conform to 'Sequence'`, span)
  }

  // ------------------------------------------------------------- expressions

  evaluate(expr: Expr, env: Environment): SwiftValue {
    return (expr as OptionalChainEnd).endsOptionalChain
      ? this.throughChain(() => this.evaluateNode(expr, env), NIL)
      : this.evaluateNode(expr, env)
  }

  /** Runs a whole optional chain: a `?` that meets nil anywhere inside gives `stopped` instead. */
  private throughChain(run: () => SwiftValue, stopped: SwiftValue): SwiftValue {
    try {
      return run()
    } catch (error) {
      if (error instanceof NilChainSignal) return stopped
      throw error
    }
  }

  private evaluateNode(expr: Expr, env: Environment): SwiftValue {
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
        const parts = expr.segments.map((segment) => segment.kind === 'text' ? segment.value : this.evaluate(segment.expression, env))
        const hosted = parts.some((part) => typeof part !== 'string' && part.kind !== 'string') ? this.host.interpolate?.(parts, expr.span) : undefined
        if (hosted !== undefined) return { kind: 'string', value: hosted.text, styled: hosted.styled }
        return str(parts.map((part) => typeof part === 'string' ? part : describe(part, false)).join(''))
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

        // `counts[key, default: 0]` is not a second index - it is the value the
        // lookup takes when the key is absent, and dropping it turns the whole
        // expression into nil. Evaluated lazily, as Swift's autoclosure does.
        const fallback = expr.args.find((a) => a.label === 'default')
        if (fallback && base.kind === 'dictionary') {
          const found = base.entries.get(dictionaryKey(index))
          return found ?? this.evaluate(fallback.value, env)
        }

        return this.subscriptGet(base, index, expr.span)
      }

      case 'closure':
        return this.makeClosure(expr, env)

      case 'unary':
        return this.evaluateUnary(expr.operator, this.evaluate(expr.operand, env), expr.span)

      case 'binary':
        return this.evaluateBinary(expr.operator, expr.left, expr.right, expr.span, env)

      case 'assign':
        // `selected?.done = true` writes nothing when `selected` is nil. The target is
        // resolved as storage rather than evaluated, so it ends its chain here.
        return (expr.target as OptionalChainEnd).endsOptionalChain
          ? this.throughChain(() => this.evaluateAssign(expr.operator, expr.target, expr.value, expr.span, env), VOID)
          : this.evaluateAssign(expr.operator, expr.target, expr.value, expr.span, env)

      case 'ternary':
        return truthy(this.evaluate(expr.condition, env))
          ? this.evaluate(expr.then, env)
          : this.evaluate(expr.else, env)

      case 'tuple':
        return tuple(
          expr.elements.map((e) => this.evaluate(e, env)),
          expr.labels,
        )

      case 'forceUnwrap': {
        const value = this.evaluate(expr.operand, env)
        if (value.kind === 'nil') this.trap(TRAP_MESSAGES.forceUnwrapNil, expr.span)
        return value
      }

      case 'try':
        return this.runTry(expr, env)

      case 'inout': {
        // `&count` hands the callee the *storage*, not the value. That is exactly what
        // `$count` already produces for `@Binding`, so `inout` needs no mechanism of
        // its own - the two are the same idea written differently.
        const lvalue = this.tryResolveLValue(expr.operand, env)
        if (!lvalue) this.trap('Cannot pass this expression as an inout argument', expr.span)
        if (!lvalue.mutable) {
          this.trap(`Cannot pass immutable value '${lvalue.description}' as an inout argument`, expr.span)
        }
        return projection(lvalue)
      }

      case 'superExpr': {
        // `super` is the same instance; what differs is where member lookup starts.
        // The marker is read by `evaluateMemberAccess` and `evaluateMemberCall`, which
        // are the only places the distinction can matter.
        const self = env.resolveSelf()
        if (!self || self.kind !== 'struct') this.trap("'super' is only available inside a class", expr.span)
        return self
      }

      case 'keyPath':
        return keyPath(expr.components)

      case 'optionalChain': {
        // `a?.b` asks nothing of a nil `a`: the rest of the chain is skipped.
        const value = this.evaluate(expr.operand, env)
        if (value.kind === 'nil') throw new NilChainSignal()
        return value
      }

      case 'errorExpr':
        throw new UnsupportedAtRuntime('this expression', expr.span)
    }
  }

  private makeClosure(expr: ClosureExpr, env: Environment): ClosureValue {
    let captured = env
    if (expr.captures?.length) {
      const values = expr.captures.map(capture => {
        if (capture.ownership) throw new UnsupportedAtRuntime(`${capture.ownership} closure captures`, capture.span)
        return { capture, value: copyValue(this.evaluate(capture.value, env)) }
      })
      const self = values.find(item => item.capture.name === 'self')?.value
      captured = env.child(self?.kind === 'struct' || self?.kind === 'enum' ? self : null)
      for (const { capture, value } of values) captured.define(capture.name, value, true, capture.span)
    }
    return {
      kind: 'closure',
      params: expr.params,
      hasExplicitParams: expr.hasExplicitParams,
      body: expr.body,
      // Unlisted variables still reach the original environment by reference.
      env: captured,
      span: expr.span,
    }
  }

  private evaluateIdentifier(name: string, span: SourceSpan, env: Environment): SwiftValue {
    const binding = this.unshadowedBinding(name, env)
    if (binding) return unwrapProjection(binding.value)

    // `Self.shared` - the type the code is written in, as a value. Resolved from the
    // receiver rather than from a declaration, because that is what `Self` means.
    if (name === 'Self') {
      const receiver = env.resolveSelf() ?? env.lookup('self')?.value
      if (receiver) return { kind: 'type', name: typeNameOf(receiver) }
      const owner = this.owners[this.owners.length - 1]
      if (owner) return { kind: 'type', name: owner }
    }

    // `typealias Num = Int` - a name that stands for another one everywhere.
    const aliased = this.typeAliases.get(name)
    if (aliased) return this.evaluateIdentifier(aliased, span, env)

    // `reduce(0, +)` - an operator passed as a function. It becomes the closure it
    // is shorthand for, `{ $0 + $1 }`, which needs no new machinery: every caller
    // that takes a closure already knows how to invoke one.
    if (OPERATOR_NAME.test(name)) {
      const overload = this.globals.lookup(name)?.value
      if (overload?.kind === 'function') return overload
      return operatorClosure(name, span, env)
    }

    // `$count` is a property wrapper's *projection*: a read/write reference to the
    // storage behind `count`, which is what lets `.sheet(isPresented: $showing)`
    // dismiss itself and `Toggle(isOn: $flag)` write back. Projecting something that
    // is already a projection yields the same one - passing `$count` down two views
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
      // `extension String { var shout: String { uppercased() } }` - the receiver's
      // own members are in scope unqualified, and the built-in ones are members too.
      // Checked before the user's, which is the same order `evaluateMemberAccess`
      // uses: an extension may add to a built-in type and may not redefine it.
      const builtin = getBuiltinProperty(selfBinding, name)
      if (builtin !== undefined) return builtin

      const extended = this.userMember(selfBinding, name, span)
      if (extended !== undefined) return unwrapProjection(extended)
    }

    if (this.types.has(name) || this.enums.has(name)) return { kind: 'type', name }

    const fromHost = this.host.resolveGlobal?.(name)
    if (fromHost !== undefined) return fromHost

    // `Int.max`, `Date.now` - a built-in type used as a value. Asked after the host,
    // so a type the host owns (`CGFloat`, `Color`) keeps its own answer.
    if (BUILTIN_TYPE_NAMES.has(name)) return { kind: 'type', name }

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
      const extended = this.extensionStatic(member, span)
      if (extended !== undefined) return extended
      const resolved = this.host.resolveImplicitMember?.(member, span)
      if (resolved !== undefined) return resolved
      this.trap(`Cannot infer contextual base for '.${member}'`, span)
    }

    const target = this.evaluate(base, env)

    if (base.kind === 'superExpr' && target.kind === 'struct') {
      const above = this.superclassOf(this.owners[this.owners.length - 1] ?? target.typeName)
      const value = above ? this.memberOfStruct(target, member, span, above) : undefined
      if (value !== undefined) return unwrapProjection(value)
    }

    // A tuple element, by position (`pair.0`) or by label (`point.x`).
    if (target.kind === 'tuple') {
      const element = tupleElement(target, member)
      if (element !== undefined) return element
      this.trap(`Tuple has no element '${member}'`, span)
    }

    // `Item.self` is a metatype. The slice only ever passes one along - to
    // `navigationDestination(for:)` - so the type value itself is the whole answer.
    if (target.kind === 'type' && member === 'self') return target

    // `Tab.home` - an enum case with no payload.
    if (target.kind === 'type') {
      const enumDecl = this.enums.get(target.name)
      if (enumDecl?.cases.some((c) => c.name === member)) {
        return this.makeEnumCase(enumDecl, member, [], span)
      }
      const statik = this.staticMember(target.name, member, span)
      if (statik !== undefined) return statik

      // `S.Inner` - a type declared inside another one.
      const nested = this.nestedTypeName(target.name, member)
      if (nested) return { kind: 'type', name: nested }

      // `Tab.allCases`, after a hand-written `static let allCases` has had its
      // chance: a manual `CaseIterable` conformance is ordinary Swift and the
      // synthesised one must not shadow it.
      if (member === 'allCases') {
        const cases = this.synthesizedAllCases(target.name, span)
        if (cases) return cases
      }

      const builtinStatic = staticBuiltinProperty(target.name, member)
      if (builtinStatic !== undefined) return builtinStatic
    }

    const read = this.readMember(target, member, span)
    if (read !== undefined) return read

    const fromHost = this.host.getMember?.(target, member, span)
    if (fromHost !== undefined) return fromHost

    /**
     * `$store.volume` - a member of a projection is a projection onto that member.
     *
     * SwiftUI writes this as `@dynamicMemberLookup` on `Binding` and on the wrapper
     * an `@ObservedObject` projects, and it is how half the bindings in real code are
     * spelled: `Slider(value: $settings.volume)`, `TextField(text: $draft.title)`,
     * `Toggle(isOn: $store.notify)`. Without it the only way to hand a control a
     * binding into a model was to mirror the value into a `@State` and copy it back.
     *
     * Last, after the host and the built-ins have had their chance, so
     * `$count.wrappedValue` still means what it has always meant.
     */
    const projected = asProjection(target)
    if (projected) {
      const owner = projected.get()
      if (owner.kind === 'struct' && owner.fields.has(member)) {
        return memberProjection(projected, member, this.declaredTypeOf(owner.typeName, member))
      }
    }

    this.trap(`Value of type '${typeNameOf(target)}' has no member '${member}'`, span)
  }

  /**
   * A member a user `extension` added to a value the interpreter otherwise handles
   * entirely through its built-in table - `extension Int`, `extension String`,
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
    /** The call's labels, when there is a call: a method they cannot match is not it. */
    labels?: readonly (string | null)[],
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

    return withCandidates(methodsNamed(members, member), labels, (decl) => ({ kind: 'function', decl, self: null, env: scope }))
  }

  /** The declaration of a computed property, when the member is one. */
  private accessorsFor(target: SwiftValue, member: string): VarDecl | undefined {
    return this.membersOf(typeNameOf(target)).find(
      (m): m is VarDecl => m.kind === 'varDecl' && m.name === member && m.setter !== null,
    )
  }

  /**
   * An assignable location backed by a property's own `get` and `set`.
   *
   * The setter runs against the same instance the assignment named, so a struct's
   * `set { n = newValue }` writes its own stored property and the change is visible
   * to the caller - which is the whole difference between a computed property and a
   * field that happens to share its name.
   */
  private accessorLValue(
    target: StructValue,
    member: string,
    decl: VarDecl,
    span: SourceSpan,
  ): LValue {
    return {
      description: `${typeNameOf(target)}.${member}`,
      mutable: true,
      get: () => {
        if (!decl.accessor) return target.fields.get(member) ?? NIL
        const scope = this.globals.child(target)
        return this.runBody(
          `${typeNameOf(target)}.${member}`,
          decl.accessor,
          scope,
          span,
          namedTypeOf(decl.typeAnnotation),
        )
      },
      set: (value) => {
        if (!decl.setter) return
        const scope = this.globals.child(target)
        scope.define(decl.setter.parameter, value, true, span)
        this.runBody(`${typeNameOf(target)}.${member}`, decl.setter.body, scope, span, null)
      },
    }
  }

  private evaluateCall(
    callee: Expr,
    argExprs: readonly Argument[],
    trailing: ClosureExpr | null,
    span: SourceSpan,
    env: Environment,
  ): SwiftValue {
    // `typealias Num = Int` makes `Num(3)` a call to `Int`. Rewriting the callee is
    // the whole of what the alias means - there is nothing else to substitute.
    if (callee.kind === 'identifier' && this.typeAliases.has(callee.name) && !env.lookup(callee.name)) {
      const target = this.typeAliases.get(callee.name)!
      return this.evaluateCall({ ...callee, name: target }, argExprs, trailing, span, env)
    }

    // `a?.f(x)` and `onPick?(x)` never evaluate `x` when the chain is nil, so a call
    // inside an optional chain settles what it calls first. Other calls keep their order.
    const chained = insideOptionalChain(callee)
    const receiver =
      chained && callee.kind === 'memberAccess' && callee.base ? this.resolveReceiver(callee.base, env) : undefined
    const calledValue = chained && callee.kind !== 'memberAccess' ? this.evaluate(callee, env) : undefined

    const args: CallArgument[] = argExprs.map((arg) => ({
      label: arg.label,
      value: this.evaluate(arg.value, env),
      span: arg.span,
    }))
    const trailingClosure = trailing ? this.makeClosure(trailing, env) : null

    /**
     * For everything except the host, a trailing closure is just a final unlabelled
     * argument - `items.map { … }` and `items.map({ … })` mean the same thing. The
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
      const local = this.unshadowedBinding(callee.name, env)
      if (local?.value.kind === 'function') return this.callFunction(local.value, allArgs, span)
      if (local?.value.kind === 'closure') {
        return this.callClosure(local.value, allArgs.map((a) => a.value), span)
      }

      // `spent(on: .food)` written inside the type it belongs to. The member wins
      // over anything global, which is Swift's scoping, and a *method* wins over a
      // property of the same name, which is the half `evaluateIdentifier` cannot know
      // because it is not told that a call is being made.
      const onSelf = env.resolveSelf()
      if (onSelf) {
        const method = this.methodOn(onSelf, callee.name, labelsOf(allArgs))
        if (method) return this.callFunction(method, allArgs, span)
      }

      // A declaration in the project wins over anything the host offers, which is
      // Swift's own rule: a local type shadows the module's. It matters more than it
      // looks - `Task` is a perfectly ordinary name for a to-do app's model type, and
      // so are `Image`, `Label` and `Menu`.
      const declared = this.types.has(callee.name) || this.enums.has(callee.name)

      if (!declared) {
        const fromHost = this.host.callGlobal?.(callee.name, this.hostCall(args, trailingClosure, span))
        if (fromHost !== undefined) return fromHost
      }

      const instance = this.instantiateNamed(callee.name, allArgs, span)
      if (instance !== undefined) return instance

      // `print` and friends.
      const builtin = this.callGlobalBuiltin(callee.name, allArgs, span)
      if (builtin !== undefined) return builtin

      // An unqualified call inside a member body means `self.name(…)`. It matters for
      // any receiver the environment cannot hold - `extension Int`, and a method
      // written in `extension View`, where `self` is a view value rather than a
      // struct. `evaluateIdentifier` already resolves bare *names* this way; a call
      // had no equivalent, so `modifier(Boxed())` inside such a method resolved
      // nowhere.
      // `self` may be a binding - `extension Int`, or a method on `extension View`
      // called on a view value - or the environment's receiver, which is how a view
      // written as a struct reaches its `extension View` methods: the merge hands
      // them to every conformer as protocol defaults.
      //
      // The receiver case is deliberately narrow. Offering *any* unresolved call in
      // *any* method to the host means a mistyped function name comes back as an
      // unrecognised-but-harmless modifier, which is the worst kind of wrong: the code
      // looks honoured and is not. So it applies only inside a method declared in an
      // extension of something the project did not declare, which is exactly where
      // `self` is a view and `padding(8)` means `self.padding(8)`.
      const owner = this.owners[this.owners.length - 1]
      const inForeignExtension =
        typeof owner === 'string' && !this.types.has(owner) && !this.enums.has(owner)
      const receiver =
        env.lookup('self')?.value ?? (inForeignExtension ? (env.resolveSelf() ?? undefined) : undefined)
      if (receiver) {
        // `uppercased()` inside `extension String` is `self.uppercased()`, and the
        // receiver is a plain String the standard library owns rather than anything
        // the host knows about.
        const onBuiltin = callBuiltinMember(
          receiver,
          callee.name,
          allArgs,
          (closure, closureArgs) => this.callClosure(closure, closureArgs, span),
          (reason) => this.trap(reason, span),
          () =>
            this.trap(
              `Cannot use mutating member on immutable value: 'self' is a 'let' constant`,
              span,
            ),
          (value, name) => this.readMember(value, name, span),
        )
        if (onBuiltin !== undefined) return onBuiltin

        const onSelf = this.host.callMember?.(
          receiver,
          callee.name,
          this.hostCall(args, trailingClosure, span),
        )
        if (onSelf !== undefined) return onSelf
      }
    }

    // A method or modifier call: `value.member(args)`.
    if (callee.kind === 'memberAccess') {
      const evaluate = () => this.evaluateMemberCall(callee.base, callee.member, callee.memberSpan, args, allArgs, trailingClosure, span, env, receiver)
      return callee.base && this.host.withMemberScope
        ? this.host.withMemberScope(callee.member, args, evaluate)
        : evaluate()
    }

    const value = calledValue ?? this.evaluate(callee, env)
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

  /** A mutating method needs the *storage*, not a copy, or its writes are lost. */
  private resolveReceiver(baseExpr: Expr, env: Environment): Receiver {
    const lvalue = this.tryResolveLValue(baseExpr, env)
    return { lvalue, target: lvalue ? lvalue.get() : this.evaluate(baseExpr, env) }
  }

  private evaluateMemberCall(
    baseExpr: Expr | null,
    member: string,
    memberSpan: SourceSpan,
    /** Explicit arguments only - what the host sees. */
    args: readonly CallArgument[],
    /** Explicit arguments plus the trailing closure - what everything else sees. */
    allArgs: readonly CallArgument[],
    trailingClosure: ClosureValue | null,
    span: SourceSpan,
    env: Environment,
    /** Already resolved by a call inside an optional chain, which needed it first. */
    receiver?: Receiver,
  ): SwiftValue {
    if (!baseExpr) {
      const extended = this.extensionStatic(member, memberSpan)
      if (extended?.kind === 'function') return this.callFunction(extended, allArgs, span)
      const called = this.host.callImplicitMember?.(
        member,
        this.hostCall(args, trailingClosure, span),
      )
      if (called !== undefined) return called

      const resolved = this.host.resolveImplicitMember?.(member, memberSpan)
      if (resolved !== undefined) return resolved
      this.trap(`Cannot infer contextual base for '.${member}'`, memberSpan)
    }

    const { lvalue, target } = receiver ?? this.resolveReceiver(baseExpr, env)

    // `super.speak()` - same receiver, lookup starting one level up, so an override
    // can call the thing it overrode instead of itself.
    if (baseExpr.kind === 'superExpr' && target.kind === 'struct') {
      const above = this.superclassOf(this.owners[this.owners.length - 1] ?? target.typeName)
      // A method wins over a property of the same name here too - `super.spent()`
      // is a call, whatever `spent` also happens to be.
      const bound = above
        ? (this.methodOn(target, member, labelsOf(allArgs), above) ??
          this.memberOfStruct(target, member, memberSpan, above, labelsOf(allArgs)))
        : undefined
      if (bound?.kind === 'function') return this.callFunction(bound, allArgs, span)
    }

    // `Status.loaded("x")` - an enum case with a payload.
    if (target.kind === 'type') {
      const enumDecl = this.enums.get(target.name)
      if (enumDecl?.cases.some((c) => c.name === member)) {
        return this.makeEnumCase(enumDecl, member, allArgs, span)
      }
      const statik = this.staticMember(target.name, member, memberSpan)
      if (statik?.kind === 'function') return this.callFunction(statik, allArgs, span)

      // `S.Inner()` - constructing a type declared inside another one.
      const nested = this.nestedTypeName(target.name, member)
      if (nested) {
        const instance = this.instantiateNamed(nested, allArgs, span)
        if (instance !== undefined) return instance
      }

      // `Int.random(in: 1...6)`, `Bool.random()`.
      const builtinStatic = callStaticBuiltin(target.name, member, allArgs, (reason) =>
        this.trap(reason, span),
      )
      if (builtinStatic !== undefined) return builtinStatic
    }

    if (target.kind === 'enum') {
      const bound =
        this.methodOn(target, member, labelsOf(allArgs)) ??
        this.memberOfEnum(target, member, memberSpan, labelsOf(allArgs))
      if (bound?.kind === 'function') return this.callFunction(bound, allArgs, span)
      if (bound?.kind === 'closure') return this.callClosure(bound, allArgs.map((a) => a.value), span)
    }

    if (target.kind === 'struct') {
      const bound =
        this.methodOn(target, member, labelsOf(allArgs)) ??
        this.memberOfStruct(target, member, memberSpan, undefined, labelsOf(allArgs))
      if (bound?.kind === 'function') {
        const isMutating = bound.decl.modifiers.some((m) => m.name === 'mutating')
        if (isMutating && lvalue && !lvalue.mutable) {
          this.trap(
            `Cannot use mutating member on immutable value: '${lvalue.description}' is a 'let' constant`,
            span,
          )
        }
        try { return this.callFunction(bound, allArgs, span) }
        finally {
          if (isMutating && lvalue?.mutable && !target.reference) lvalue.set(target)
        }
      }
      if (bound?.kind === 'closure') return this.callClosure(bound, allArgs.map((a) => a.value), span)
    }

    // A built-in mutating method on a `let` is a compile error in Swift, and the
    // preview used to run it: `let items = [1]` then `items.append(2)` changed the
    // array and said nothing. Checked before dispatch, where the storage is still in
    // hand - and only when there *is* storage, so a method on a temporary is left to
    // the reporting it already had.
    const isBuiltinReceiver =
      target.kind === 'array' ||
      target.kind === 'dictionary' ||
      target.kind === 'string' ||
      target.kind === 'bool'

    if (isBuiltinReceiver && lvalue && !lvalue.mutable && isMutatingMember(member)) {
      this.trap(
        `Cannot use mutating member on immutable value: '${lvalue.description}' is a 'let' constant`,
        span,
      )
    }

    // `flag.toggle()` and `text.append("x")` *replace* the receiver rather than
    // mutating it in place, so they hand back what the storage should now hold.
    // Recorded rather than written immediately, because the write-back below would
    // otherwise put the original value straight back over the top of it.
    let replacement: SwiftValue | null = null

    const builtin = callBuiltinMember(
      target,
      member,
      allArgs,
      (closure, closureArgs) => this.callClosure(closure, closureArgs, span),
      (reason) => this.trap(reason, span),
      (value) => {
        // Refusing where there is no assignable storage is the same rule a
        // `mutating` method on a struct already follows.
        if (!lvalue?.mutable) {
          this.trap(
            lvalue
              ? `Cannot use mutating member on immutable value: '${lvalue.description}' is a 'let' constant`
              : 'Cannot use mutating member on immutable value',
            span,
          )
        }
        replacement = value
      },
      (value, name) => this.readMember(value, name, span),
    )
    if (builtin !== undefined) {
      if (lvalue?.mutable && (replacement !== null || isMutatingMember(member))) lvalue.set(replacement ?? target)
      return builtin
    }

    const extended = this.userMember(target, member, memberSpan, labelsOf(allArgs))
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
      /**
       * `Dictionary(grouping:by:)` - the one-liner that turns a flat list into
       * sections, and the reason `Set` and `Array` had constructors here and this did
       * not: nothing in the corpus grouped anything.
       */
      case 'Dictionary': {
        const grouping = args.find((a) => a.label === 'grouping')?.value
        const by = args.find((a) => a.label === 'by')?.value
        if (grouping?.kind === 'array' && by?.kind === 'closure') {
          // Insertion order, so a sectioned list comes out in the order the groups
          // were met. Swift's own hash order promises nothing either way.
          const buckets = new Map<string, SwiftValue[]>()
          for (const element of grouping.elements) {
            const slot = dictionaryKey(this.callClosure(by, [element], span))
            const bucket = buckets.get(slot)
            if (bucket) bucket.push(copyValue(element))
            else buckets.set(slot, [copyValue(element)])
          }

          const out = new Map<string, SwiftValue>()
          for (const [slot, bucket] of buckets) out.set(slot, array(bucket))
          return { kind: 'dictionary', entries: out }
        }

        // `Dictionary(uniqueKeysWithValues:)` over an array of pairs.
        const pairs = args.find((a) => a.label === 'uniqueKeysWithValues')?.value
        if (pairs?.kind === 'array') {
          const out = new Map<string, SwiftValue>()
          for (const pair of pairs.elements) {
            if (pair.kind !== 'tuple') continue
            const key = pair.elements[0]
            const value = pair.elements[1]
            if (key && value) out.set(dictionaryKey(key), copyValue(value))
          }
          return { kind: 'dictionary', entries: out }
        }

        return undefined
      }
      case 'Int':
      case 'Double': {
        const first = args[0]?.value
        if (!first) return undefined

        // `Int("42")` is *failable* - it answers `Int?`, and nil for anything that is
        // not a whole number written out. Trapping instead made the ordinary way of
        // reading a text field ("how many?") stop the preview, and the `??` the code
        // already had for the nil case never ran.
        if (first.kind === 'string') {
          // Matched against what Swift accepts rather than what `Number` accepts:
          // `Int(" 42")`, `Int("4_2")` and `Int("0x10")` are all nil in Swift, and
          // JavaScript answers 42, NaN and 16. A preview that is *more* permissive
          // than the compiler is the dishonest direction - the value shows here and
          // the app gets nil.
          const text = first.value
          const grammar = name === 'Int' ? /^[+-]?\d+$/ : /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/
          if (!grammar.test(text)) return NIL
          const parsed = Number(text)
          if (!Number.isFinite(parsed)) return NIL
          if (name === 'Double') return double(parsed)
          return Number.isSafeInteger(parsed) ? int(parsed) : NIL
        }

        // A `Character` is a String here, so `Int(someCharacter)` lands above. A
        // Bool does not convert in Swift either; requireNumber reports it.
        const n = this.requireNumber(first, span)
        return name === 'Int' ? int(Math.trunc(n)) : double(n)
      }
      case 'String': {
        // `String` has several initialisers and they read different arguments.
        // Describing the first one and ignoring the labels answers `String(format:
        // "%.2f", 1.5)` with the literal string `%.2f` - a confident wrong answer in
        // the middle of the preview, which is worse than not supporting it at all.
        const formatIndex = args.findIndex((a) => a.label === 'format')
        const format = args[formatIndex]?.value
        if (format?.kind === 'string') {
          const values = args.slice(formatIndex + 1).map((a) => a.value)
          return str(formatString(format.value, values))
        }

        const repeating = args.find((a) => a.label === 'repeating')?.value
        if (repeating !== undefined) {
          const count = args.find((a) => a.label === 'count')?.value
          const times = count ? this.requireNumber(count, span) : 0
          if (times < 0) this.trap("Can't construct String with count < 0", span)
          const text = describe(repeating, false)
          checkPreviewSize(times, PREVIEW_LIMITS.stringLength, 'String repeat count', span)
          checkPreviewSize(text.length * times, PREVIEW_LIMITS.stringLength, 'String length', span)
          return str(text.repeat(times))
        }

        const first = args[0]?.value
        if (!first) return str('')

        // `String(text.reversed())` - a collection of Characters put back together.
        // Describing it instead renders `[c, b, a]`, brackets and all.
        if (first.kind === 'array' && first.elements.every((e) => e.kind === 'string')) {
          return str(first.elements.map((e) => (e.kind === 'string' ? e.value : '')).join(''))
        }

        const describing = args.find((a) => a.label === 'describing')?.value
        return str(describe(describing ?? first, false))
      }

      // -------------------------------------------------------- constructors

      case 'UUID':
        return uuidValue(randomUUIDString())
      case 'Date': {
        // `Date()` is now; `Date(timeIntervalSince1970:)` and
        // `Date(timeIntervalSinceNow:)` are the two forms that need no calendar.
        const since1970 = args.find((a) => a.label === 'timeIntervalSince1970')?.value
        if (since1970) return dateValue(this.requireNumber(since1970, span))

        const sinceNow = args.find((a) => a.label === 'timeIntervalSinceNow')?.value
        if (sinceNow) return dateValue(Date.now() / 1000 + this.requireNumber(sinceNow, span))

        return dateValue(Date.now() / 1000)
      }
      case 'URL': {
        // Failable, and the failure is the point: `URL(string: "not a url")` is nil,
        // which is why every example writes `URL(string:)!`.
        const string = args.find((a) => a.label === 'string')?.value ?? args[0]?.value
        if (string?.kind !== 'string') return undefined
        try {
          // Parsed only to decide whether it is a URL at all. The string is kept
          // exactly as written, because the browser's parser normalises - it makes
          // "https://a.co" into "https://a.co/" - and `absoluteString` answering
          // something the user did not type is the kind of small lie that is
          // hardest to track down.
          new URL(string.value)
          return urlValue(string.value)
        } catch {
          return NIL
        }
      }
      case 'Set': {
        const first = args[0]?.value
        if (first === undefined) return uniqueArray([])
        if (first.kind === 'array') return uniqueArray(first.elements.map(copyValue))
        if (first.kind === 'string') return uniqueArray(graphemes(first.value).map(str))
        if (first.kind === 'range') return uniqueArray([...this.iterate(first, span, true)])
        return undefined
      }
      case 'Array': {
        // `Array(repeating:count:)` builds one; `Array(_:)` copies a sequence into
        // one, which is how a range, a string or `dictionary.keys` becomes indexable.
        const repeating = args.find((a) => a.label === 'repeating')?.value
        if (repeating !== undefined) {
          const count = args.find((a) => a.label === 'count')?.value
          const times = count ? this.requireNumber(count, span) : 0
          if (times < 0) this.trap(TRAP_MESSAGES.negativeArrayCount, span)
          checkPreviewSize(times, PREVIEW_LIMITS.collectionElements, 'Array count', span)
          checkRepeatedValue(repeating, times, span)
          return array(Array.from({ length: times }, () => copyValue(repeating)))
        }

        const first = args[0]?.value
        if (first === undefined) return array([])
        if (first.kind === 'array') return array(first.elements.map(copyValue))
        return array([...this.iterate(first, span, true)].map(copyValue))
      }

      // ------------------------------------------------------ free functions

      case 'sqrt':
      case 'floor':
      case 'ceil':
      case 'round': {
        const first = args[0]?.value
        if (!first) return undefined
        const n = this.requireNumber(first, span)
        switch (name) {
          case 'sqrt':
            return double(Math.sqrt(n))
          case 'floor':
            return double(Math.floor(n))
          case 'ceil':
            return double(Math.ceil(n))
          // Swift rounds halves away from zero; `Math.round` rounds them up, so it
          // answers -1 for -1.5 where Swift answers -2.
          default:
            return double(n < 0 ? -Math.round(-n) : Math.round(n))
        }
      }
      case 'pow': {
        const base = args[0]?.value
        const exponent = args[1]?.value
        if (!base || !exponent) return undefined
        return double(
          Math.pow(this.requireNumber(base, span), this.requireNumber(exponent, span)),
        )
      }
      case 'zip': {
        const first = args[0]?.value
        const second = args[1]?.value
        if (!first || !second) return undefined
        const left = [...this.iterate(first, span, true)]
        const right = [...this.iterate(second, span, true)]
        // Stops at the shorter one, as Swift's does.
        const pairs = left.slice(0, Math.min(left.length, right.length))
        return array(pairs.map((value, i) => tuple([copyValue(value), copyValue(right[i]!)])))
      }
      case 'stride': {
        const from = args.find((a) => a.label === 'from')?.value
        const to = args.find((a) => a.label === 'to')?.value
        const through = args.find((a) => a.label === 'through')?.value
        const by = args.find((a) => a.label === 'by')?.value
        if (!from || !by || (!to && !through)) return undefined

        const start = this.requireNumber(from, span)
        const step = this.requireNumber(by, span)
        const limit = this.requireNumber((to ?? through)!, span)
        if (step === 0) this.trap('Stride size must not be zero', span)

        // An array rather than a lazy sequence, for the same reason `indices` is one:
        // everything downstream iterates, and a sequence with no elements to show is
        // harder to print than a list.
        const isInt = from.kind === 'int' && by.kind === 'int'
        const values: SwiftValue[] = []
        const done = (value: number): boolean =>
          through ? (step > 0 ? value > limit : value < limit) : step > 0 ? value >= limit : value <= limit
        for (let value = start; !done(value); value += step) {
          values.push(isInt ? int(value) : double(value))
          if (values.length > 100_000) this.trap('Stride produced too many values', span)
        }
        return array(values)
      }
      case 'type': {
        // `type(of: value)`, whose only use here is printing it.
        const of = args.find((a) => a.label === 'of')?.value ?? args[0]?.value
        return of ? { kind: 'type', name: typeNameOf(of) } : undefined
      }
      case 'fatalError': {
        const message = args[0]?.value
        return this.trap(
          message?.kind === 'string' && message.value !== ''
            ? `Fatal error: ${message.value}`
            : 'Fatal error',
          span,
        )
      }
      case 'assert':
      case 'precondition': {
        // A passing assertion is the whole point of these: they have to be callable
        // and silent, or the code that guards an invariant cannot run at all.
        const condition = args[0]?.value
        if (condition === undefined || truthy(condition)) return VOID
        const message = args[1]?.value
        const label = name === 'assert' ? 'Assertion failed' : 'Precondition failed'
        return this.trap(
          message?.kind === 'string' && message.value !== '' ? `${label}: ${message.value}` : label,
          span,
        )
      }
      case 'assertionFailure':
      case 'preconditionFailure': {
        const message = args[0]?.value
        const label = name === 'assertionFailure' ? 'Assertion failed' : 'Precondition failed'
        return this.trap(
          message?.kind === 'string' && message.value !== '' ? `${label}: ${message.value}` : label,
          span,
        )
      }
      case 'Optional': {
        // The value model has no wrapper: `nil` is its own kind and everything else
        // is itself, so `Optional(x)` is x. Stated here rather than left to fail,
        // because the erasure is deliberate - see the coverage matrix.
        const first = args[0]?.value
        return first ?? NIL
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
   * Builds `$name` - a projection onto the storage `name` refers to.
   *
   * Returns null when there is no such storage, so the caller can fall through to
   * its normal "cannot find in scope" reporting rather than handing back a binding
   * onto nothing.
   */
  private projectionFor(name: string, env: Environment): SwiftValue | null {
    const binding = this.unshadowedBinding(name, env)
    if (binding) {
      // Re-projecting a binding gives back the same binding, not one wrapping it.
      return asProjection(binding.value) ? binding.value : projection(bindingLValue(binding, name))
    }

    const self = env.resolveSelf()
    if (self?.kind === 'struct' && self.fields.has(name)) {
      const current = self.fields.get(name)
      if (asProjection(current)) return current!
      const field = fieldLValue(self, name, `self.${name}`)
      const declared = this.declaredTypeOf(self.typeName, name)
      return projection(declared ? { get: field.get, set: field.set, description: field.description, declared } : field)
    }

    return null
  }

  /** Resolves an assignable location, or null when the expression is not one. */
  private tryResolveLValue(expr: Expr, env: Environment): LValue | null {
    switch (expr.kind) {
      case 'identifier': {
        const binding = this.unshadowedBinding(expr.name, env)
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

        // A property written with an explicit `set { … }` is not storage: assigning
        // to it runs the setter with `newValue` bound, and whatever that writes is
        // the real change. Without this the assignment landed on a field of the same
        // name that nothing reads.
        //
        // Left mutable even on a constant, deliberately: a setter may be declared
        // `nonmutating`, which the parser does not record, so refusing here would
        // stop the preview running code Xcode accepts.
        const accessors = this.accessorsFor(target, expr.member)
        if (accessors?.setter) {
          return this.accessorLValue(target, expr.member, accessors, expr.span)
        }

        // Named by the path the user wrote - `bag.items` - rather than by the
        // receiver's value, which rendered a whole struct literal into the middle of
        // a sentence about a constant.
        const base = owner ? owner.description : describe(target, true)
        const field = fieldLValue(target, expr.member, `${base}.${expr.member}`)
        const projected = throughProjection(field)

        // A projection is storage somewhere else reached through a nonmutating
        // setter - that is what `@Binding` is - so it stays writable through a
        // constant, exactly as it does in Swift.
        if (projected !== field) return projected

        // A member of a `let` *struct* is itself constant: the constant holds the
        // value, so writing a field of it is writing to the constant. A `let`
        // holding a class instance is the opposite - the constant holds a
        // reference, and the object's own properties stay writable, which is why
        // `let store = Store()` can still `store.items.append(…)`.
        const constant = owner !== null && !owner.mutable && !target.reference
        return constant ? { ...field, mutable: false } : field
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
        const element = this.subscriptLValue(base, index, expr.span)
        if (!element) return null

        /**
         * `counts[key, default: 0] += 1`, which is how every tally in Swift is written.
         *
         * A compound assignment reads through the lvalue before it writes, and the
         * plain getter answers nil for a key that is not there yet - so the read
         * failed with "Expected a number, found 'Optional'" on the first occurrence
         * of every key. The default belongs to the *read* half, and only there.
         */
        const fallback = expr.args.find((a) => a.label === 'default')
        const withDefault =
          fallback && base.kind === 'dictionary'
            ? {
                ...element,
                get: () => {
                  const found = base.entries.get(dictionaryKey(index))
                  return found ?? this.evaluate(fallback.value, env)
                },
              }
            : element

        // `let scores = ["a": 1]` then `scores["b"] = 2` is a compile error in Swift,
        // and the element of a constant collection has to inherit the constancy: the
        // storage is the collection, and writing through a position is still writing
        // to it.
        const container = this.tryResolveLValue(expr.base, env)
        return container && !container.mutable
          ? {
              ...withDefault,
              mutable: false,
              description: `${container.description}${element.description}`,
            }
          : withDefault
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
    if (base.kind === 'tuple') {
      const i = this.requireNumber(index, span)
      if (!Number.isInteger(i) || i < 0 || i >= base.elements.length) {
        this.trap(TRAP_MESSAGES.indexOutOfRange, span)
      }
      return base.elements[i]!
    }

    // `subscript(index: Int) -> Element` declared on the user's own type. It is
    // parsed as a method called `subscript`, so this is an ordinary call.
    const declared = this.membersOf(typeNameOf(base)).find(
      (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === 'subscript' && m.body !== null,
    )
    if (declared && base.kind === 'struct') {
      return this.callFunction(
        { kind: 'function', decl: declared, self: base, env: this.globals },
        [{ label: null, value: index, span }],
        span,
      )
    }

    const fromHost = this.host.subscript?.(base, index, span)
    if (fromHost !== undefined) return fromHost

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
    // `_ = items.popLast()` - the discard. It is how Swift is told that a result is
    // deliberately unused, so it appears wherever a method returns something the
    // caller does not want, and it has to evaluate the right-hand side for its
    // effects before throwing the answer away.
    if (targetExpr.kind === 'identifier' && targetExpr.name === '_' && operator === '=') {
      this.evaluate(valueExpr, env)
      return VOID
    }

    const lvalue = this.tryResolveLValue(targetExpr, env)
    if (!lvalue) this.trap('Cannot assign to this expression', span)
    if (!lvalue.mutable) {
      this.trap(`Cannot assign to value: '${lvalue.description}' is a 'let' constant`, span)
    }

    // `tab = .settings` - the target's current value says which enum `.settings`
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

    // `is` and the three `as` forms. The right operand is a *type name* the parser
    // stored as an identifier, so it must never be evaluated - doing so is what made
    // `v as? String` report "Expected a number, found 'String'".
    if (operator === 'is' || operator.startsWith('as')) {
      const value = this.evaluate(leftExpr, env)
      const name = rightExpr.kind === 'identifier' ? rightExpr.name : null
      if (!name) this.trap('A cast needs a type name on the right', span)

      if (operator === 'is') return bool(this.valueIsType(value, name))

      // A plain `as` is a compile-time coercion that cannot fail, so the only work
      // is the numeric widening `Int` -> `Double` that Swift performs implicitly.
      if (operator === 'as') {
        if (name === 'Double' || name === 'CGFloat' || name === 'Float') {
          return value.kind === 'int' ? double(value.value) : value
        }
        return value
      }

      if (this.valueIsType(value, name)) return value
      if (operator === 'as?') return NIL
      this.trap(`Could not cast value of type '${typeNameOf(value)}' to '${name}'`, span)
    }

    const left = this.evaluate(leftExpr, env)
    const right = this.evaluate(rightExpr, env)

    // A project-declared operator - `static func == (a: P, b: P)`, or a top-level
    // `func ** (a: Int, b: Int)`. Consulted before the built-in table only for
    // operands the built-ins cannot handle, so `1 + 2` never pays for the lookup and
    // a user overload of an operator on their own type still wins where it applies.
    const overload = this.operatorOverload(operator, left, right)
    if (overload) {
      return this.callFunction(
        overload,
        [
          { label: null, value: left, span },
          { label: null, value: right, span },
        ],
        span,
      )
    }

    return this.applyBinary(operator, left, right, span)
  }

  /**
   * A user-declared implementation of an operator, when one applies.
   *
   * Looked up on either operand's type as a static member, then among the file's own
   * functions. Skipped entirely for two numbers, two strings and two booleans, where
   * the built-in meaning is the one Swift gives and a project cannot redefine it.
   */
  private operatorOverload(
    operator: string,
    left: SwiftValue,
    right: SwiftValue,
  ): FunctionValue | null {
    // Two numbers, two strings or two booleans mean what Swift says they mean, and a
    // project cannot redefine that - unless the operator is one the project itself
    // declared, which by definition has no built-in meaning to protect.
    if (BUILTIN_OPERATORS.has(operator) && isBuiltinOperand(left) && isBuiltinOperand(right)) {
      return null
    }

    for (const value of [left, right]) {
      const members = this.membersOf(typeNameOf(value))
      const found = members.find(
        (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === operator && m.body !== null,
      )
      if (found) return { kind: 'function', decl: found, self: null, env: this.globals }
    }

    const global = this.globals.lookup(operator)?.value
    return global?.kind === 'function' ? global : null
  }

  /**
   * Whether a value would satisfy `is Name`.
   *
   * Generics are erased here, so only the base name is compared - `[Item]` and
   * `[String]` are both `Array`. Everything the interpreter can actually check is
   * checked: the runtime kind, the declared superclass chain, and the protocols a
   * type conforms to.
   */
  private valueIsType(value: SwiftValue, name: string): boolean {
    if (name === 'Any' || name === 'AnyObject') return true

    const actual = typeNameOf(value)
    if (actual === name) return true

    // `Int` is not a `Double` in Swift, but the numeric aliases are the same type.
    if (actual === 'Double' && (name === 'CGFloat' || name === 'Float')) return true
    if (actual === 'Int' && name === 'Int') return true

    const seen = new Set<string>()
    const inherits = (typeName: string): boolean => {
      if (seen.has(typeName)) return false
      seen.add(typeName)

      const decl = this.conformance.types.get(typeName)?.decl
      if (!decl || decl.kind !== 'structDecl') return false
      return decl.inherits.some((parent) => parent.name === name || inherits(parent.name))
    }

    return inherits(actual)
  }

  private applyBinary(operator: string, left: SwiftValue, right: SwiftValue, span: SourceSpan): SwiftValue {
    switch (operator) {
      case '==':
      case '!=': {
        // `step == .one` - the other operand is the context a contextual member
        // resolves against, and a comparison is the only place that context exists.
        // Without this the token and the enum case never compare equal, so every
        // `if tab == .home` is silently false.
        const lhs = left.kind === 'enum' ? left : this.coerceToEnum(left, enumTypeOf(right))
        const rhs = right.kind === 'enum' ? right : this.coerceToEnum(right, enumTypeOf(left))
        const equal = valuesEqual(lhs, rhs)
        return bool(operator === '==' ? equal : !equal)
      }
      case '..<':
      case '...': {
        const start = asDate(left), end = asDate(right)
        if (!!start !== !!end) this.trap('Range endpoints must have the same comparable type', span)
        const lower = start?.epochSeconds ?? this.requireNumber(left, span)
        const upper = end?.epochSeconds ?? this.requireNumber(right, span)
        if (lower > upper) this.trap('Range lower bound must not exceed upper bound', span)
        return { kind: 'range', lower, upper, closed: operator === '...', ...(start ? { boundType: 'Date' as const } : {}) }
      }
      default:
        break
    }

    // String concatenation and comparison.
    if (left.kind === 'string' && right.kind === 'string') {
      switch (operator) {
        case '+':
          checkPreviewSize(left.value.length + right.value.length, PREVIEW_LIMITS.stringLength, 'String length', span)
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
      checkPreviewSize(left.elements.length + right.elements.length, PREVIEW_LIMITS.collectionElements, 'Array count', span)
      return array([...left.elements, ...right.elements].map(copyValue))
    }

    // `Date` is `Comparable`, which is how a list of anything dated gets sorted.
    // Equality is already structural, so only the orderings are needed here.
    const leftDate = asDate(left)
    const rightDate = asDate(right)
    if (leftDate && rightDate) {
      switch (operator) {
        case '<':
          return bool(leftDate.epochSeconds < rightDate.epochSeconds)
        case '<=':
          return bool(leftDate.epochSeconds <= rightDate.epochSeconds)
        case '>':
          return bool(leftDate.epochSeconds > rightDate.epochSeconds)
        case '>=':
          return bool(leftDate.epochSeconds >= rightDate.epochSeconds)
        default:
          this.trap(`Binary operator '${operator}' cannot be applied to two Date operands`, span)
      }
    }

    if (BITWISE_OPERATORS.has(operator)) {
      return this.applyBitwise(operator, left, right, span)
    }

    // A value the interpreter does not own - a view, a colour, a font. Every branch
    // below wants a number, so without this the operator traps and the whole preview
    // stops rather than the one expression failing.
    if (left.kind === 'opaque' || right.kind === 'opaque') {
      const fromHost = this.host.applyOperator?.(operator, left, right, span)
      if (fromHost !== undefined) return fromHost
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

  /**
   * `&`, `|`, `^`, `<<` and `>>`.
   *
   * Computed in `BigInt` rather than with JavaScript's own bitwise operators, which
   * truncate to 32 bits: `1 << 40` answers 256 there and 1099511627776 in Swift,
   * and a wrong number that looks like a number is the failure mode this whole pass
   * exists to remove. The result then goes through `numeric`, so anything past the
   * precision the interpreter can represent traps instead of rounding.
   *
   * Swift's shifts are "smart": a shift wider than the type gives zero and a negative
   * shift goes the other way, rather than being undefined.
   */
  private applyBitwise(
    operator: string,
    left: SwiftValue,
    right: SwiftValue,
    span: SourceSpan,
  ): SwiftValue {
    if (left.kind !== 'int' || right.kind !== 'int') {
      this.trap(
        `Binary operator '${operator}' requires two Int operands, ` +
          `found '${typeNameOf(left)}' and '${typeNameOf(right)}'`,
        span,
      )
    }

    const a = BigInt(left.value)
    const b = BigInt(right.value)

    const shift = (value: bigint, by: bigint, leftwards: boolean): bigint => {
      if (by < 0n) return shift(value, -by, !leftwards)
      if (by >= 64n) return leftwards ? 0n : value < 0n ? -1n : 0n
      return leftwards ? value << by : value >> by
    }

    switch (operator) {
      case '&':
        return this.numeric(Number(a & b), true, span)
      case '|':
        return this.numeric(Number(a | b), true, span)
      case '^':
        return this.numeric(Number(a ^ b), true, span)
      case '<<':
        return this.numeric(Number(shift(a, b, true)), true, span)
      default:
        return this.numeric(Number(shift(a, b, false)), true, span)
    }
  }

  /** Wraps a numeric result, trapping on overflow rather than losing precision. */
  private numeric(result: number, isInt: boolean, span: SourceSpan): SwiftValue {
    if (isInt && !Number.isSafeInteger(result)) {
      // Real Swift traps at 2^63; JS numbers are exact only to 2^53. Trapping at the
      // lower bound reports slightly early, but never returns a silently wrong value -
      // which is the failure mode that actually costs the user time.
      this.trap(`${TRAP_MESSAGES.overflow} (values beyond ${MAX_SAFE_INT} are not representable)`, span)
    }
    return isInt ? int(result) : double(result)
  }

  private evaluateUnary(operator: string, operand: SwiftValue, span: SourceSpan): SwiftValue {
    switch (operator) {
      case '...':
      case '..<':
      case 'partialFrom': {
        const date = asDate(operand)
        const bound = date?.epochSeconds ?? this.requireNumber(operand, span)
        return { kind: 'range', lower: operator === 'partialFrom' ? bound : -Infinity, upper: operator === 'partialFrom' ? Infinity : bound, closed: operator !== '..<', ...(date ? { boundType: 'Date' as const } : {}) }
      }
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
 * `static` - or `class`, which means static-and-overridable on a class.
 *
 * Matters more than it looks: a `static let` is not a stored property, so counting it
 * as one would shift every memberwise-initialiser argument by a position.
 */
/**
 * The framework value types a project extends with named values - design tokens.
 * Searched in this order, so the colour an `extension Color` declares wins over the
 * `ShapeStyle` spelling Xcode generates beside it for the same name.
 */
const TOKEN_HOSTS = ['Color', 'Font', 'CGFloat', 'Double', 'ShapeStyle'] as const

/**
 * SwiftUI's own contextual member names, which always keep their framework meaning.
 *
 * Swift resolves a contextual member against the expected type, so `.small` is a
 * `ControlSize` in `.controlSize(.small)` even when the project also declares a
 * `CGFloat.small`. Without the expected type, the only safe rule is that a name the
 * framework spells this way is the framework's.
 */
const FRAMEWORK_CONTEXTUAL: ReadonlySet<string> = new Set([
  'leading', 'trailing', 'center', 'top', 'bottom', 'topLeading', 'topTrailing', 'bottomLeading', 'bottomTrailing',
  'firstTextBaseline', 'lastTextBaseline', 'all', 'horizontal', 'vertical',
  'mini', 'small', 'regular', 'large', 'extraLarge', 'medium', 'automatic', 'compact', 'inline', 'navigation',
  'largeTitle', 'title', 'title2', 'title3', 'headline', 'subheadline', 'body', 'callout', 'footnote', 'caption', 'caption2',
  'ultraLight', 'thin', 'light', 'semibold', 'bold', 'heavy', 'black', 'default', 'serif', 'rounded', 'monospaced', 'italic',
  'primary', 'secondary', 'tertiary', 'quaternary', 'white', 'gray', 'red', 'orange', 'yellow', 'green', 'mint', 'teal',
  'cyan', 'blue', 'indigo', 'purple', 'pink', 'brown', 'clear', 'accentColor', 'tint', 'background', 'foreground', 'dark',
  'plain', 'bordered', 'borderedProminent', 'borderless', 'grouped', 'insetGrouped', 'inset', 'sidebar', 'page', 'capsule',
  'circle', 'rect', 'roundedRectangle', 'continuous', 'circular', 'fill', 'fit', 'infinity', 'zero', 'identity', 'linear',
  'easeIn', 'easeOut', 'easeInOut', 'spring', 'bouncy', 'snappy', 'smooth', 'opacity', 'slide', 'scale', 'move', 'push',
  'hidden', 'visible', 'never', 'always', 'destructive', 'cancel', 'sheet', 'popover', 'none', 'some', 'shared', 'main',
])

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
/**
 * A projection onto one field of whatever another projection refers to.
 *
 * The write-back is the part that has to be right. A class is a reference, so
 * setting the field has already changed the object everyone else is holding; a
 * struct is a value, so the whole thing has to be pushed back through the outer
 * projection or the change lands on a copy and disappears. Reading the owner afresh
 * on every access rather than capturing it keeps a computed `Binding(get:set:)`
 * behaving like the storage it stands for.
 */
function memberProjection(outer: ProjectionPayload, field: string, declared: DeclaredType | undefined): SwiftValue {
  return projection({
    ...(declared ? { declared } : {}),
    get: () => {
      const owner = outer.get()
      return owner.kind === 'struct' ? (owner.fields.get(field) ?? { kind: 'nil' }) : { kind: 'nil' }
    },
    set: (value) => {
      const owner = outer.get()
      if (owner.kind !== 'struct') return
      owner.fields.set(field, value)
      if (!owner.reference) outer.set(owner)
    },
    description: `${outer.description}.${field}`,
  })
}

/**
 * A method, as its labels pick it, carrying the others of its name for the call to
 * choose from by what it is given: two may share their labels and differ in type.
 */
function withCandidates(candidates: readonly FuncDecl[], labels: readonly (string | null)[] | undefined, value: (decl: FuncDecl) => FunctionValue): FunctionValue | undefined {
  const decl = pickOverload(candidates, labels)
  if (!decl) return undefined
  const fn = value(decl)
  return candidates.length > 1 ? { ...fn, overloads: candidates } : fn
}

/**
 * A function declared under a name that may already stand for others.
 *
 * Swift overloads by labels and types, so a second `func label(_:)` beside the first is
 * another function, not a replacement: the name comes to stand for both, and a call
 * chooses between them.
 */
function withOverload(existing: SwiftValue | undefined, fn: FunctionValue): FunctionValue {
  if (existing?.kind !== 'function') return fn
  return { ...existing, overloads: [...(existing.overloads ?? [existing.decl]), fn.decl] }
}

/**
 * Overload resolution, by argument label and then by argument.
 *
 * Swift identifies a function by its name *and* its labels, so `minutes(on:)` and
 * `minutes(of:)` are two functions. Where a call wrote its labels, they choose;
 * where they are not known - a method reached as a value, a `super` lookup with no
 * arguments - the first declared wins, which is what every lookup here did before
 * overloads were kept apart at all.
 *
 * Where the labels leave several, `suitability` ranks them by the call's arguments,
 * as `label(_: Int)` and `label(_: String)` are told apart by what they are given; a
 * tie goes to the one written first.
 *
 * Deliberately falls back rather than failing. A trailing closure arrives unlabelled
 * even when its parameter has a label, so a strict match would reject
 * `sheet(isPresented:)` written the way everybody writes it; the fallback makes an
 * unmatched call behave exactly as it used to.
 */
export function pickOverload<T extends { readonly params: readonly Param[] }>(
  candidates: readonly T[],
  labels: readonly (string | null)[] | undefined,
  suitability?: (candidate: T) => number,
): T | undefined {
  // A declaration that cannot take these labels at all is never the one being called:
  // `shadow(color:radius:)` inside `func shadow(_ token:)` is SwiftUI's modifier, not
  // a recursive call with every parameter unbound. And with none left, nothing
  // declared is: `Item(name:count:)` is then the memberwise initialiser.
  const possible = labels ? candidates.filter((decl) => labelsPossible(decl.params, labels)) : candidates
  if (possible.length <= 1 || !labels) return possible[0]
  const matching = possible.filter((decl) => labelsMatch(decl.params, labels))
  const pool = matching.length > 0 ? matching : possible
  if (!suitability) return pool[0]
  let chosen = pool[0]!
  let best = suitability(chosen)
  for (const decl of pool.slice(1)) {
    const score = suitability(decl)
    if (score > best) {
      chosen = decl
      best = score
    }
  }
  return chosen
}

/**
 * Whether a call could be this declaration at all, leniently.
 *
 * Every label the call writes has to be one the declaration has, and there cannot be
 * more arguments than parameters. Unlabelled arguments are always possible, because a
 * trailing closure arrives unlabelled whatever its parameter is called.
 */
function labelsPossible(params: readonly Param[], written: readonly (string | null)[]): boolean {
  if (written.length > params.length) return false
  const declared = argumentLabels(params)
  return written.every((label) => label === null || declared.includes(label))
}

/**
 * Whether a call writing these labels could be this declaration.
 *
 * A parameter with a default may be left out, so the written labels have to appear in
 * order among the declared ones and every parameter they skip has to have a default.
 */
function labelsMatch(params: readonly Param[], written: readonly (string | null)[]): boolean {
  const declared = argumentLabels(params)
  if (written.length > declared.length) return false

  let next = 0
  for (let i = 0; i < declared.length; i++) {
    if (next < written.length && written[next] === declared[i]) {
      next++
      continue
    }
    if (!params[i]!.defaultValue) return false
  }
  return next === written.length
}

/**
 * `{ index, item in }` given one `(offset, element)` tuple, as `enumerated()` and `zip`
 * hand their elements over: Swift spreads a lone tuple across a closure's parameters.
 */
function spreadTuple(closure: ClosureValue, args: readonly SwiftValue[]): readonly SwiftValue[] {
  const only = args.length === 1 ? args[0] : undefined
  return closure.params.length > 1 && only?.kind === 'tuple' && only.elements.length === closure.params.length ? only.elements : args
}

/** A method call's receiver: its storage when it has one, and its value. */
interface Receiver {
  readonly lvalue: LValue | null
  readonly target: SwiftValue
}

/** Whether `expr` is inside an optional chain that has not ended yet: `a?.b` in `a?.b.f()`. */
function insideOptionalChain(expr: Expr): boolean {
  let node: Expr | null = expr
  while (node) {
    if (node.kind === 'optionalChain') return true
    if ((node as OptionalChainEnd).endsOptionalChain) return false
    node =
      node.kind === 'memberAccess' ? node.base
      : node.kind === 'call' ? node.callee
      : node.kind === 'subscript' ? node.base
      : node.kind === 'forceUnwrap' ? node.operand
      : null
  }
  return false
}

function labelsOf(args: readonly CallArgument[]): readonly (string | null)[] {
  return args.map((arg) => arg.label ?? null)
}

function methodsNamed(members: readonly Decl[], name: string): readonly FuncDecl[] {
  return members.filter(
    (m): m is FuncDecl => m.kind === 'funcDecl' && m.name === name && m.body !== null,
  )
}

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

/** A name made entirely of operator characters. */
const OPERATOR_NAME = /^[/=\-+!*%<>&|^~?.]+$/

/**
 * The closure an operator is shorthand for: `+` is `{ $0 + $1 }`.
 *
 * Built as a real closure over a synthesised body rather than as a new kind of value,
 * because every caller that accepts a closure - `reduce`, `sorted(by:)`, `filter` -
 * already knows how to invoke one, and a new kind would have to be taught to each.
 */
function operatorClosure(operator: string, span: SourceSpan, env: Environment): ClosureValue {
  const left: Expr = { kind: 'identifier', span, name: '$0' }
  const right: Expr = { kind: 'identifier', span, name: '$1' }
  const expression: Expr = { kind: 'binary', span, operator, left, right }

  return {
    kind: 'closure',
    params: [],
    hasExplicitParams: false,
    body: { kind: 'block', span, statements: [{ kind: 'exprStmt', span, expression }] },
    env,
    span,
  }
}

/** The operators `applyBinary` implements, and which a project may not redefine. */
/** The five Swift spells with the same characters and integer meaning. */
const BITWISE_OPERATORS: ReadonlySet<string> = new Set(['&', '|', '^', '<<', '>>'])

const BUILTIN_OPERATORS: ReadonlySet<string> = new Set([
  '+', '-', '*', '/', '%', '==', '!=', '<', '<=', '>', '>=', '..<', '...',
])

/** A value whose operators the built-in table already defines correctly. */
function isBuiltinOperand(value: SwiftValue): boolean {
  return (
    value.kind === 'int' ||
    value.kind === 'double' ||
    value.kind === 'string' ||
    value.kind === 'bool' ||
    value.kind === 'nil'
  )
}

/** The enum a value belongs to, or null when it is not an enum case. */
function enumTypeOf(value: SwiftValue): string | null {
  return value.kind === 'enum' ? value.typeName : null
}
