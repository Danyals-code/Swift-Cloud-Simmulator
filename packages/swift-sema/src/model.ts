import type { Diagnostic, SourceSpan } from '@studio/shared'
import type { FuncDecl, StructDecl, VarDecl } from '@studio/swift-syntax'

export interface PropertyInfo {
  readonly name: string
  readonly decl: VarDecl
  /** `State` for `@State var count`, else null. */
  readonly propertyWrapper: string | null
  readonly isComputed: boolean
  readonly isLet: boolean
}

export interface TypeInfo {
  readonly name: string
  readonly decl: StructDecl
  readonly properties: readonly PropertyInfo[]
  readonly methods: readonly FuncDecl[]
  readonly conformances: readonly string[]
  readonly isView: boolean
  readonly isApp: boolean
}

/**
 * The output of semantic analysis.
 *
 * More than a diagnostic list: it is the symbol table Phase 2's interpreter and
 * Phase 3's view graph both consume, which is why types, properties and the entry
 * point are resolved here once rather than re-derived from the AST downstream.
 */
export interface SemanticModel {
  readonly types: ReadonlyMap<string, TypeInfo>
  /** The single `@main` type, when there is exactly one. */
  readonly entryPoint: TypeInfo | null
  readonly diagnostics: readonly Diagnostic[]
}

export interface Symbol {
  readonly name: string
  readonly kind: 'local' | 'parameter' | 'property' | 'type' | 'function' | 'closureShorthand'
  readonly span: SourceSpan
}

/**
 * Lexical scope chain.
 *
 * Shadowing is permitted and silent, matching Swift: an inner declaration simply
 * hides an outer one.
 */
export class Scope {
  private readonly symbols = new Map<string, Symbol>()

  constructor(readonly parent: Scope | null = null) {}

  declare(symbol: Symbol): void {
    this.symbols.set(symbol.name, symbol)
  }

  lookup(name: string): Symbol | undefined {
    return this.symbols.get(name) ?? this.parent?.lookup(name)
  }

  has(name: string): boolean {
    return this.lookup(name) !== undefined
  }

  /** Every name visible here, innermost first - the candidate list for "did you mean". */
  allNames(): string[] {
    const names = [...this.symbols.keys()]
    return this.parent ? [...names, ...this.parent.allNames()] : names
  }

  child(): Scope {
    return new Scope(this)
  }
}
