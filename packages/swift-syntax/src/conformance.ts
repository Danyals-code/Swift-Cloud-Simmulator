import type {
  Decl,
  EnumDecl,
  ExtensionDecl,
  FuncDecl,
  ProtocolDecl,
  SourceFileNode,
  StructDecl,
  VarDecl,
} from './ast'

/**
 * Merging extensions, protocol defaults and superclasses into the members a type
 * actually has.
 *
 * Swift lets a type's members be written in four places — the declaration itself, any
 * number of `extension`s, the `protocol`s it conforms to, and its superclass — and
 * every consumer downstream wants one list. Doing the merge once, here, is what stops
 * the checker and the interpreter from disagreeing about what `Card` has; they are
 * sibling packages, so anything either derived privately would drift.
 *
 * This is a *syntactic* merge and nothing more. It does not verify that a conformer
 * satisfies its requirements and it does not resolve overloads — both need a real type
 * checker, and the house rule is that a false positive is worse than a missed error.
 * The user's exact source reaches a real compiler on export, which is where those
 * checks belong.
 */

/** A member's identity for override purposes: kind plus name. */
type MemberKey = string

export interface TypeMembers {
  readonly name: string
  /** The declaration, or null for an extension of a built-in like `Int`. */
  readonly decl: StructDecl | EnumDecl | null
  /**
   * Every member the type has, in declaration order.
   *
   * Ordering is load-bearing: stored properties initialise in this order, so a
   * superclass's properties must appear before the subclass's own, and a property
   * must appear before an extension's computed property that reads it.
   */
  readonly members: readonly Decl[]
  /**
   * Which type each member was written in.
   *
   * `super` needs this and nothing else can supply it: `super.speak()` means "start
   * above the type that *declared* the method now running", which is a fact about
   * where the code was written, not about what the instance turned out to be. Keying
   * on the declaration node rather than the name keeps it exact when a name is
   * overridden at several levels.
   */
  readonly origin: ReadonlyMap<Decl, string>
  /** Protocols named directly, through another protocol, or through a superclass. */
  readonly conformances: ReadonlySet<string>
  /** The superclass name, for a `class` that names one. */
  readonly superclass: string | null
}

export interface ConformanceModel {
  readonly types: ReadonlyMap<string, TypeMembers>
  readonly protocols: ReadonlyMap<string, ProtocolDecl>
  /** Extensions keyed by the name they extend, protocols included. */
  readonly extensions: ReadonlyMap<string, readonly ExtensionDecl[]>
}

function memberKey(decl: Decl): MemberKey | null {
  if (decl.kind === 'funcDecl') return `func:${decl.name}`
  if (decl.kind === 'varDecl') return `var:${decl.name}`
  if (decl.kind === 'initDecl') return `init:${decl.params.length}`
  return null
}

/** A protocol member with no body is a requirement — it says what, not how. */
function isRequirement(decl: Decl): boolean {
  if (decl.kind === 'funcDecl') return decl.body === null
  if (decl.kind === 'varDecl') return decl.requirement !== null
  return false
}

export function collectConformance(files: readonly SourceFileNode[]): ConformanceModel {
  const declarations = new Map<string, StructDecl | EnumDecl>()
  const protocols = new Map<string, ProtocolDecl>()
  const extensions = new Map<string, ExtensionDecl[]>()

  for (const file of files) {
    for (const decl of file.declarations) {
      if (decl.kind === 'structDecl' || decl.kind === 'enumDecl') {
        if (!declarations.has(decl.name)) declarations.set(decl.name, decl)
      } else if (decl.kind === 'protocolDecl') {
        if (!protocols.has(decl.name)) protocols.set(decl.name, decl)
      } else if (decl.kind === 'extensionDecl' && decl.name) {
        const list = extensions.get(decl.name)
        if (list) list.push(decl)
        else extensions.set(decl.name, [decl])
      }
    }
  }

  const types = new Map<string, TypeMembers>()
  // Names currently being built, so a cycle — `class A: B` with `class B: A` — stops
  // rather than recursing forever. Swift rejects that outright; we simply stop
  // climbing and keep whatever was resolved.
  const building = new Set<string>()

  const build = (name: string): TypeMembers => {
    const cached = types.get(name)
    if (cached) return cached

    const decl = declarations.get(name) ?? null
    const own = extensions.get(name) ?? []

    if (building.has(name)) {
      return {
        name,
        decl,
        members: [],
        origin: new Map(),
        conformances: new Set(),
        superclass: null,
      }
    }
    building.add(name)

    // Every name after a colon, from the declaration and from each extension that
    // adds a conformance. A name that is itself a declared type is a superclass:
    // `class Sub: Base` and `struct Card: Identifiable` are written identically, and
    // only the resolved name tells them apart.
    const inherited: string[] = [
      ...(decl?.inherits ?? []).map((t) => t.name),
      ...own.flatMap((e) => e.inherits.map((t) => t.name)),
    ]

    let superclass: string | null = null
    const conformances = new Set<string>()
    const addProtocol = (protocolName: string): void => {
      if (conformances.has(protocolName)) return
      conformances.add(protocolName)
      for (const parent of protocols.get(protocolName)?.inherits ?? []) addProtocol(parent.name)
    }

    const isClass = decl?.kind === 'structDecl' && decl.isReference
    for (const inheritedName of inherited) {
      if (isClass && superclass === null && declarations.has(inheritedName)) {
        superclass = inheritedName
      } else {
        addProtocol(inheritedName)
      }
    }

    const base = superclass ? build(superclass) : null
    for (const inheritedProtocol of base?.conformances ?? []) conformances.add(inheritedProtocol)

    // A protocol's defaults live in two places: a member with a body inside the
    // `protocol` block, and — far more commonly, because it is the only place Swift
    // allows a body for a requirement — a member of `extension P`.
    const protocolDefaults: Decl[] = []
    const origin = new Map<Decl, string>(base?.origin ?? [])

    for (const protocolName of conformances) {
      for (const member of protocols.get(protocolName)?.members ?? []) {
        if (isRequirement(member)) continue
        protocolDefaults.push(member)
        origin.set(member, protocolName)
      }
      for (const ext of extensions.get(protocolName) ?? []) {
        for (const member of ext.members) {
          if (isRequirement(member)) continue
          protocolDefaults.push(member)
          origin.set(member, protocolName)
        }
      }
    }

    const baseMembers = [...(base?.members ?? [])]
    const extensionMembers = own.flatMap((e) => [...e.members])
    const ownMembers = [...(decl?.members ?? [])]
    for (const member of [...extensionMembers, ...ownMembers]) origin.set(member, name)

    // Precedence: least specific first, so the last layer to claim a key wins. That is
    // Swift's rule exactly — own beats extension, extension beats protocol default,
    // protocol default beats inherited.
    const precedence: Decl[][] = [baseMembers, protocolDefaults, extensionMembers, ownMembers]

    const winner = new Map<MemberKey, Decl>()
    for (const layer of precedence) {
      for (const member of layer) {
        const key = memberKey(member)
        if (key) winner.set(key, member)
      }
    }

    // Emission order is a different question from precedence, and conflating the two
    // put a body written in an extension ahead of the stored property it reads.
    // Declaration order is what a reader expects and what stored properties need:
    // superclass, then the type's own body, then whatever was added around it.
    const order: Decl[][] = [baseMembers, ownMembers, extensionMembers, protocolDefaults]

    const members: Decl[] = []
    const emitted = new Set<MemberKey>()
    for (const layer of order) {
      for (const member of layer) {
        const key = memberKey(member)
        if (key === null) {
          members.push(member)
          continue
        }
        if (emitted.has(key) || winner.get(key) !== member) continue
        emitted.add(key)
        members.push(member)
      }
    }

    const result: TypeMembers = { name, decl, members, origin, conformances, superclass }
    building.delete(name)
    types.set(name, result)
    return result
  }

  for (const name of declarations.keys()) build(name)
  // An extension of a type that was never declared here — `extension Int`, `extension
  // String` — still contributes members, and users write those constantly.
  for (const name of extensions.keys()) {
    if (!types.has(name) && !protocols.has(name)) build(name)
  }

  return { types, protocols, extensions }
}

/** Stored properties, in initialisation order. */
export function storedProperties(members: readonly Decl[]): readonly VarDecl[] {
  return members.filter(
    (m): m is VarDecl => m.kind === 'varDecl' && m.accessor === null && m.requirement === null,
  )
}

/** Methods with bodies — a bare requirement is not callable. */
export function methodsOf(members: readonly Decl[]): readonly FuncDecl[] {
  return members.filter((m): m is FuncDecl => m.kind === 'funcDecl' && m.body !== null)
}
