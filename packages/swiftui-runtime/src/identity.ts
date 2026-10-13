import type { SwiftValue } from '@studio/swift-runtime'

/**
 * View identity and state storage.
 *
 * SwiftUI view structs are values: they are recreated from scratch on every render,
 * and `@State` does *not* live in them. It lives in boxes the framework keys by the
 * view's identity - its structural position in the tree. That indirection is the
 * whole reason a counter survives a re-render.
 *
 * Phase 2 approximated this with one long-lived root instance, which worked only
 * because the slice has one stateful view. This is the real thing: every view gets
 * an identity, every `@State` property gets a box, and instances are disposable.
 */

/**
 * Builds identities as evaluation descends the tree.
 *
 * The identity of a view is its parent's identity plus its own type name and the
 * number of same-typed siblings already seen. That makes it stable across renders
 * whenever the tree shape is unchanged - which is exactly when state should survive -
 * and different when it is not.
 */
export class IdentityPath {
  private readonly stack: string[] = ['#']
  private readonly counters: Map<string, number>[] = [new Map()]

  get current(): string {
    return this.stack[this.stack.length - 1]!
  }

  push(typeName: string): string {
    const siblings = this.counters[this.counters.length - 1]!
    const ordinal = siblings.get(typeName) ?? 0
    siblings.set(typeName, ordinal + 1)

    const identity = `${this.current}/${typeName}${ordinal > 0 ? `[${ordinal}]` : ''}`
    this.stack.push(identity)
    this.counters.push(new Map())
    return identity
  }

  pop(): void {
    if (this.stack.length > 1) {
      this.stack.pop()
      this.counters.pop()
    }
  }

  /**
   * Runs `fn` inside an explicitly keyed scope.
   *
   * `ForEach` uses this so each row's identity is derived from its element's `id`
   * rather than from its position. The difference shows the moment a list is
   * reordered or an item is deleted: keyed by identity, each row's `@State` travels
   * with its data; keyed by position, the second row's expansion state stays on the
   * second row no matter what is now in it.
   */
  scope<T>(key: string, fn: () => T): T {
    const identity = `${this.current}/#${key}`
    this.stack.push(identity)
    this.counters.push(new Map())
    try {
      return fn()
    } finally {
      this.pop()
    }
  }
}

export interface StateBox {
  value: SwiftValue
  /** Structure of the declared initialiser, so an edit to it can be detected. */
  readonly initializer: string
}

/**
 * `@State` storage, keyed by view identity and property name.
 *
 * Boxes for views that left the tree are dropped after each pass. That is not just
 * housekeeping - it is SwiftUI's actual semantics: a view removed by an `if` loses
 * its state, and gets fresh state if it comes back.
 */
export class StateStore {
  private boxes = new Map<string, StateBox>()
  private touched = new Set<string>()

  private static key(identity: string, property: string): string {
    return `${identity}.${property}`
  }

  /**
   * Reads the stored value for a property, or records and returns the initial one.
   *
   * A stored value is only reused when the initialiser that declared it is unchanged.
   * Otherwise the user edited `= 0` to `= 10` and is waiting to see `10`; keeping the
   * old value reads as the preview being stuck.
   */
  resolve(
    identity: string,
    property: string,
    initialValue: SwiftValue,
    initializer: string,
  ): SwiftValue {
    const key = StateStore.key(identity, property)
    this.touched.add(key)

    const existing = this.boxes.get(key)
    if (existing && existing.initializer === initializer) return existing.value

    this.boxes.set(key, { value: initialValue, initializer })
    return initialValue
  }

  /** Writes back a value mutated during evaluation or by an action. */
  store(identity: string, property: string, value: SwiftValue, initializer: string): void {
    const key = StateStore.key(identity, property)
    this.boxes.set(key, { value, initializer })
    this.touched.add(key)
  }

  /** Drops every box whose value `stale` answers for, so its view seeds it afresh. */
  prune(stale: (value: SwiftValue) => boolean): void {
    for (const [key, box] of this.boxes) if (stale(box.value)) this.boxes.delete(key)
  }

  beginPass(): void {
    this.touched = new Set()
  }

  /** Drops boxes for views that were not reached - they left the tree. */
  endPass(): void {
    for (const key of [...this.boxes.keys()]) {
      if (!this.touched.has(key)) this.boxes.delete(key)
    }
  }

  clear(): void {
    this.boxes.clear()
    this.touched.clear()
  }

  get size(): number {
    return this.boxes.size
  }

  /** Seed a separate runtime; the caller supplies detached values. */
  restore(boxes: ReadonlyMap<string, StateBox>): void {
    this.boxes = new Map(boxes)
    this.touched.clear()
  }

  /** For tests and the inspector. */
  snapshot(): ReadonlyMap<string, StateBox> {
    return new Map(this.boxes)
  }
}

/**
 * A span-free structural summary of an expression.
 *
 * Spans shift whenever anything above a declaration changes, so comparing them would
 * report every edit as an initialiser change. Comparing structure and literal values
 * detects only the edit that actually matters. Every span is a `span` or a key ending in
 * `Span`, such as a `for` loop's `variableSpan`.
 */
export function fingerprint(node: unknown): string {
  if (node === null || node === undefined) return 'nil'
  if (typeof node !== 'object') return String(node)
  if (Array.isArray(node)) return `[${node.map(fingerprint).join(',')}]`

  const entries = Object.entries(node as Record<string, unknown>)
    .filter(([key]) => key !== 'span' && !key.endsWith('Span'))
    .map(([key, value]) => `${key}=${fingerprint(value)}`)
  return `{${entries.join(',')}}`
}
