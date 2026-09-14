import type { SourceSpan } from '@studio/shared'
import type { EnumValue, StructValue, SwiftValue } from './values'

/** What `self` may be inside a member body: an instance, or an enum case. */
export type SelfValue = StructValue | EnumValue

export interface Binding {
  value: SwiftValue
  readonly isLet: boolean
  readonly span: SourceSpan
}

/**
 * A lexical scope at runtime.
 *
 * Closures capture the `Environment` they were created in, by reference — which is
 * what makes `Button("Plus") { count += 1 }` mutate the enclosing `@State` rather
 * than a copy of it. Swift captures variables by reference too (unless a capture
 * list says otherwise), so sharing the scope object is the faithful behaviour, not
 * a shortcut.
 */
export class Environment {
  private readonly bindings = new Map<string, Binding>()

  constructor(
    readonly parent: Environment | null = null,
    /**
     * The receiver for implicit member access inside a method or computed property.
     *
     * An enum case is a receiver too: `var title: String { rawValue }` inside an enum
     * reads a member of `self` exactly as a struct's computed property does, and
     * restricting this to structs is what used to make that particular — and very
     * ordinary — line fail to resolve.
     */
    readonly self: SelfValue | null = null,
  ) {}

  define(name: string, value: SwiftValue, isLet: boolean, span: SourceSpan): void {
    this.bindings.set(name, { value, isLet, span })
  }

  /** The binding for `name`, searching outward. */
  lookup(name: string): Binding | undefined {
    return this.bindings.get(name) ?? this.parent?.lookup(name)
  }

  has(name: string): boolean {
    return this.lookup(name) !== undefined
  }

  /** Nearest enclosing `self`, for implicit property access. */
  resolveSelf(): SelfValue | null {
    return this.self ?? this.parent?.resolveSelf() ?? null
  }

  child(self: SelfValue | null = null): Environment {
    return new Environment(this, self)
  }

  /** Own bindings only. Used by tests and the inspector. */
  localNames(): string[] {
    return [...this.bindings.keys()]
  }
}

/**
 * An assignable location.
 *
 * Assignment, compound assignment, `inout` write-back and `mutating` methods all
 * need the same thing: a way to read a storage location and write it back. Modelling
 * that once here means `count += 1`, `point.x = 3` and `items[0] = v` all work
 * through one path rather than three special cases that drift apart.
 */
export interface LValue {
  get(): SwiftValue
  set(value: SwiftValue): void
  /** For diagnostics: `count`, `point.x`, `items[0]`. */
  readonly description: string
  /** False for `let` bindings and other immutable storage. */
  readonly mutable: boolean
}

export function bindingLValue(binding: Binding, name: string): LValue {
  return {
    get: () => binding.value,
    set: (value) => {
      binding.value = value
    },
    description: name,
    mutable: !binding.isLet,
  }
}

export function fieldLValue(owner: StructValue, field: string, description: string): LValue {
  return {
    get: () => owner.fields.get(field) ?? { kind: 'nil' },
    set: (value) => {
      owner.fields.set(field, value)
    },
    description,
    mutable: true,
  }
}
