# 04 - Swift language subset

The contract for what the interpreter understands. Anything marked ✗ must produce a diagnostic that
names the feature - never a silent wrong answer (FR-3.9).

Legend: **T1** = Phase 1-2 must-have · **T2** = Phase 3-4 · **T3** = Phase 6 · **✗** = out of scope.

**Status after Phase 8.** The vertical slice deliberately shipped a narrow language - structs,
functions, closures, `if` and `for`. Phase 7 reopened it, because `ObservableObject` needs reference
semantics and half of real view-model code will not parse without `guard` and `switch`. Phase 8
finished the job: protocols and extensions, generics, error handling, `inout`, `super`, and
`async`/`await`. What now runs, and what still does not, is listed in the
[coverage matrix's language section](05-SWIFTUI-COVERAGE.md#swift-language) - that table is the
current truth; the tiers below are the original plan.

Three of the T1/T2 rows below now read differently in practice, and the matrix says so rather than
this table pretending otherwise:

- **Generics are erased**, not merely erased at runtime: constraints are recorded and never checked.
  The row below says "constraints checked for conformance only"; nothing checks them. A dynamically
  typed interpreter has nothing to check against, and the export hands the user's exact source to a
  real compiler that does.
- **Protocols have no witness tables.** Conformance is a syntactic merge - a conformer inherits
  every default its protocols declare, and nothing verifies it satisfies the requirements.
- **`async` does not suspend.** Everything concurrent runs immediately and in order.

## Declarations

| Feature | Tier | Notes |
| --- | --- | --- |
| `struct`, stored + computed properties | T1 | Value semantics, memberwise init synthesised |
| `class`, inheritance, `override`, `super` | T1 | Single inheritance; reference semantics |
| `enum` with raw values and associated values | T1 | `CaseIterable`, `RawRepresentable` synthesised |
| `protocol`, default implementations via `extension` | T1 | Witness tables built at bind time |
| `extension` on any type, including stdlib types | T1 | |
| `func`, argument labels, default values, variadics | T1 | |
| `init`, `deinit`, failable `init?`, convenience init | T1 | `deinit` fires on scope exit heuristically |
| `subscript` | T2 | |
| `typealias` | T1 | |
| `lazy var`, `willSet` / `didSet` | T2 | |
| `static` / `class` members | T1 | |
| Access control (`private`, `fileprivate`, `internal`, `public`) | T2 | Parsed T1, enforced T2 |
| Generics with type parameters and `where` clauses | T2 | Erased at runtime; constraints checked for conformance only |
| Associated types | T3 | Limited: no associated-type inference |
| Property wrappers (user-defined) | T2 | Built-ins are T1 |
| Result builders (user-defined) | T2 | `@ViewBuilder` is T1 |
| `actor`, `distributed actor` | ✗ | Diagnostic: "actors are not supported in preview" |
| Macros (user-defined) | ✗ | Built-ins `@Observable`, `#Preview` are special-cased in T2 |
| Operator overloading, custom operators | T3 | |
| `@objc`, `@NSManaged`, bridging | ✗ | |

## Statements and expressions

| Feature | Tier |
| --- | --- |
| `let` / `var`, type annotations, tuple destructuring | T1 |
| `if` / `else if` / `else`, ternary | T1 |
| `guard` with `else` | T1 |
| `switch` with value, range, tuple, enum-case, `where` patterns | T1 |
| `for-in` over ranges, arrays, dictionaries, `enumerated()`, `zip()` | T1 |
| `while`, `repeat-while`, `break`, `continue`, labelled loops | T1 |
| Optionals: `?`, `!`, `if let`, `guard let`, `??`, optional chaining | T1 |
| `is`, `as`, `as?`, `as!` | T1 |
| Closures: trailing, shorthand `$0`, capture lists, `@escaping` | T1 |
| String interpolation, multiline `"""`, raw `#"..."#` | T1 |
| Array / dictionary / set literals, ranges (`..<`, `...`) | T1 |
| `throws` / `try` / `try?` / `try!` / `do-catch` / `rethrows` | T1 |
| `defer` | T2 |
| `async` / `await`, `Task`, `async let`, `TaskGroup` | T2 |
| Key paths (`\.property`) | T2 | Needed for `ForEach(id:)`, `sorted(by:)` |
| `#if DEBUG` and other compile-time conditions | T3 |
| `unsafe*`, pointers, `withUnsafeBytes` | ✗ |

## Standard library shims

| Type | Coverage | Tier |
| --- | --- | --- |
| `Int`, `Double`, `Float` | Arithmetic with overflow traps, conversion, `random(in:)`, formatting | T1 |
| `Bool`, `String`, `Character` | Grapheme-correct via `Intl.Segmenter`; `count`, slicing, `split`, `replacingOccurrences`, `hasPrefix`, `uppercased`, `trimmingCharacters` | T1 |
| `Array` | Full mutation + functional surface (`map filter reduce sorted first last contains firstIndex compactMap flatMap enumerated reversed prefix suffix`), COW | T1 |
| `Dictionary`, `Set` | Subscript, `keys`, `values`, `merge`, set algebra | T1 |
| `Optional`, `Result` | `map`, `flatMap`, `get()` | T1 |
| `Range`, `ClosedRange`, `Stride` | | T1 |
| `Date`, `DateFormatter`, `Calendar` | Common paths only; `.formatted()` styles | T2 |
| `UUID` | | T1 |
| `Codable`, `JSONEncoder` / `JSONDecoder` | Synthesised conformance over JSON | T2 |
| `Comparable`, `Equatable`, `Hashable`, `Identifiable` | Synthesised conformance | T1 |
| `URL`, `URLSession` | `fetch`-backed, allowlisted proxy, mock mode | T3 |
| `Combine` (`Publisher`, `@Published`, `sink`) | `@Published` only; full Combine is ✗ | T2 |
| `FileManager`, `UserDefaults` | `UserDefaults` via `@AppStorage` → localStorage; `FileManager` is ✗ | T2 |
| `Foundation` beyond the above | ✗ | Diagnostic names the missing symbol |

## Property wrappers (built-in)

| Wrapper | Tier | Implementation note |
| --- | --- | --- |
| `@State` | T1 | Box keyed by `ViewIdentity`; survives hot reload |
| `@Binding` | T1 | Getter/setter pair; `$value` projection |
| `@StateObject` | T1 | Box created once per identity |
| `@ObservedObject` | T1 | Subscribes to `objectWillChange` |
| `@Published` | T1 | Fires `objectWillChange` on `willSet` |
| `@EnvironmentObject` | T1 | Environment lookup by type; missing value is a runtime trap, matching SwiftUI |
| `@Environment` | T1 | Key path into the environment (colour scheme, dynamic type, dismiss, locale) |
| `@AppStorage` | T2 | localStorage-backed |
| `@SceneStorage` | T3 | sessionStorage-backed |
| `@FocusState` | T2 | Drives the simulated keyboard |
| `@GestureState` | T2 | Resets on gesture end |
| `@Observable` macro | T2 | Treated as a class with per-property observation |

## Deliberate permissiveness

The type checker is allowed to accept things swiftc rejects (see R5 in
[01-REQUIREMENTS.md](01-REQUIREMENTS.md)). Known, accepted gaps:

- No exhaustiveness proof for `switch` over non-enum types.
- No definite-initialisation analysis (`let` read before assignment is not caught).
- No exclusivity enforcement on overlapping `inout` accesses.
- Integer overflow traps at runtime rather than being caught in constant expressions.
- Generic constraints checked for conformance membership only, not associated-type satisfaction.

The **strictness lint pass** (Phase 6) exists to close the feedback gap: it flags each of these as a
warning saying "this compiles here but may fail in Xcode", so the user is never surprised at export.
