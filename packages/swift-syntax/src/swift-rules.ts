import type { CallExpr, Decl, Expr, Param, TypeRef, VarDecl } from './ast'

/**
 * Rules Swift applies that the syntax alone decides. The interpreter, which runs the code,
 * and Design, which reads it, both follow them here, so the two can't disagree about which
 * parameter a closure goes to or which member draws views.
 */

/** Whether a declaration belongs to its type rather than to an instance: `static`, or a class's `class`. */
export function isStatic(decl: { readonly modifiers: readonly { readonly name: string }[] }): boolean {
  return decl.modifiers.some(modifier => modifier.name === 'static' || modifier.name === 'class')
}

/** `some View`, as `body` and a view's helpers are typed. */
export function isSomeView(type: TypeRef | null): boolean {
  return type?.kind === 'someType' && type.constraint.kind === 'namedType' && (type.constraint.name === 'View' || type.constraint.name === 'SwiftUI.View')
}

/** Whether a parameter can take a trailing closure: a function, an optional one, or views built by `@ViewBuilder`. */
export function takesClosure(type: TypeRef | null, attributes: readonly { readonly name: string }[]): boolean {
  const bare = type?.kind === 'optionalType' ? type.wrapped : type
  return bare?.kind === 'functionType' || attributes.some(attribute => attribute.name === 'ViewBuilder')
}

/** A parameter, as a call's arguments are bound to it. */
export interface CallParameter {
  /** The label a call writes it with; null for one declared `_`. */
  readonly label: string | null
  readonly closure: boolean
  /** It has a value of its own, so a call may leave it out. */
  readonly defaulted: boolean
}

/** A function's or an initialiser's parameter. */
export function callParameter(param: Param): CallParameter {
  return { label: param.externalName === '_' ? null : param.externalName ?? param.internalName, closure: takesClosure(param.type, param.attributes), defaulted: !!param.defaultValue }
}

/** The stored properties a struct's memberwise initialiser takes, in order: all but a `let` that has its value already. */
export function memberwiseProperties(members: readonly Decl[]): VarDecl[] {
  return members.filter((member): member is VarDecl => member.kind === 'varDecl' && !member.accessor && !member.requirement && !isStatic(member) && !(member.isLet && member.initializer))
}

/** A memberwise initialiser's parameter: a property with a value, or an optional `var`, may be left out. */
export function memberwiseParameter(property: VarDecl): CallParameter {
  return { label: property.name, closure: takesClosure(property.typeAnnotation, property.attributes), defaulted: !!property.initializer || !property.isLet && property.typeAnnotation?.kind === 'optionalType' }
}

/** An argument as a call writes it: its label, and whether it is the closure after the parentheses. */
export interface WrittenArgument {
  readonly label: string | null
  readonly trailing: boolean
}

/**
 * The parameter an argument binds to, the first from `next` on: the one of its label, and
 * for a trailing closure the first that takes a closure. One with a default is passed over
 * when a later one needs the closure, as SE-0286's forward scan does. -1 when none takes it.
 */
export function boundParameter(params: readonly CallParameter[], next: number, arg: WrittenArgument): number {
  for (let index = next; index < params.length; index++) {
    const param = params[index]!
    if (!arg.trailing) {
      if (param.label === arg.label) return index
      continue
    }
    if (!param.closure || param.defaulted && params.slice(index + 1).some(later => later.closure && !later.defaulted)) continue
    return index
  }
  return -1
}

/** The arguments of a call, in order, the closure after its parentheses last. */
export function writtenArguments(call: CallExpr): (WrittenArgument & { readonly value: Expr })[] {
  return [...call.args.map(arg => ({ label: arg.label, trailing: false, value: arg.value })), ...call.trailingClosure ? [{ label: null, trailing: true, value: call.trailingClosure }] : []]
}

/** Each argument's parameter, in order, as Swift binds a call; -1 for one no parameter takes. */
export function bindArguments(params: readonly CallParameter[], args: readonly WrittenArgument[]): number[] {
  let next = 0
  return args.map(arg => {
    const at = boundParameter(params, next, arg)
    if (at >= 0) next = at + 1
    return at
  })
}

/** Whether a call's arguments are all bound, and every parameter left out has a value of its own. */
export function fitsParameters(params: readonly CallParameter[], call: CallExpr): boolean {
  const bound = bindArguments(params, writtenArguments(call))
  return !bound.includes(-1) && params.every((param, index) => param.defaulted || bound.includes(index))
}

/**
 * Where a chain of modifiers starts: the call or value they are made on, `Text("A")` in
 * `Text("A").bold().italic()`. A member of `self` is where it stops, `self.title()`, as
 * that is a call of the type's own.
 */
export function chainBase(expr: Expr): Expr {
  let base = expr
  while (base.kind === 'call' && base.callee.kind === 'memberAccess' && base.callee.base && base.callee.base.kind !== 'selfExpr') base = base.callee.base
  return base
}
