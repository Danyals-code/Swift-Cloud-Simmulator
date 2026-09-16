# 07 - Defect register

What a systematic sweep of the studio found, in the order worth fixing.

Roughly 870 checks driven straight through the compile pipeline, the language service,
the project model and the exporter. **231 came back wrong.** The repo's own gates were
all green while that was true, because the eighteen templates use none of the
constructs that fail - so the corpus, not the interpreter, was what "18 / 18 templates
with zero placeholders" measured.

Phases run by severity first, then by how much real code each one unlocks. The order is
a dependency order as well as a severity one: the parser gaps in Phase 4 sit above the
library gaps in Phase 5, because code that does not parse never reaches the library.

Status: ✅ closed · 🟡 partly closed (what remains is stated) · ⬜ open

| Phase | | Items | State |
| --- | --- | ---: | --- |
| 1 | Stop losing the user's work | 8 | ✅ |
| 2 | Make the preview stop lying | 14 | ✅ |
| 3 | Report failures where the user can see them | 8 | ✅ |
| 4 | Close the parser gaps | 12 | ✅ |
| 5 | Fill in the standard library | 19 | ✅ |
| 6 | Fix the strictness pass where it is wrong | 4 | ✅ |
| 7 | Finish the editor intelligence | 3 | ✅ |
| 8 | Validate what a share link carries | 4 | ✅ |
| 9 | Draw what is honestly not drawn yet | 9 | 🟡 3 of 9 |
| 10 | Make the documentation match the code | 7 | 🟡 4 of 7 |

## What was swept

Probes ran against the real pipeline and were then deleted; what survives is the
regression coverage named under each closed phase.

| Area | Checks | Wrong |
| --- | ---: | ---: |
| Swift language constructs | 153 | 47 |
| Standard library and Foundation | 125 | 55 |
| SwiftUI views | 151 | 25 |
| SwiftUI modifiers | 204 | 66 |
| Layout arithmetic | 27 | 0 |
| State, bindings and interaction | 22 | 5 |
| Button actions and mutation | 32 | 17 |
| Editor intelligence | 21 | 5 |
| Project model and export | 106 | 4 |
| Robustness, encoding, multi-file | 29 | 7 |
| **Total** | **870** | **231** |

Two areas came out strong and are listed for the record: the **layout engine** (spacing,
alignment, `Spacer`, `Grid` columns, safe areas, `layoutPriority`, `fixedSize`, nested
frames all correct) and **SF Symbols** (67 of 68 common names drawn as real shapes).

## The measure

Fourteen snippets written the way SwiftUI actually gets written, as a standing check on
whether any of this reaches real code.

| | Passing |
| --- | --- |
| Before Phase 1 | 2 of 14 |
| After Phase 4 | 9 of 14 |
| After Phase 5 | 13 of 14 |

The one that remains is `GroupBox`, which is an honest placeholder rather than a hard
error, and is Phase 9's to draw.

The measure itself is now a test rather than a note: `tests/stdlib-breadth.test.ts`
ends with a file written the way a first file gets written - a `UUID` id, a
`CaseIterable` filter, a computed and sorted list, `Int(_:)` on a text field - and
asserts the exact strings it draws. Every one of those five pieces failed on its own
before this phase, and a file containing all of them failed at the first.

---

## Phase 1 - Stop losing the user's work ✅

Four of these destroyed or corrupted data with no error shown. Nothing else mattered
while they were live. Closed; covered by `tests/honesty.test.ts`.

| # | Was | Now |
| --- | --- | --- |
| 1.1 | Rename matched identifier text project-wide, so two unrelated `let x` were renamed together, as were the same member name on two different types | Scope-resolved: the name is bound to a declaration and only that declaration's region is searched. A member is followed project-wide only when no other type declares it |
| 1.2 | Renaming a `@State` property left `$draft` behind, pointing at a name that no longer existed | The projection renames with the property |
| 1.3 | `removeAll(where:)` ignored the predicate and truncated the array, silently | Keeps what the predicate rejects |
| 1.4 | `append(contentsOf:)` appended the whole array as one element | Flattens |
| 1.5 | One IndexedDB failure disabled saving for the session, with nothing on screen to say so | `openDB` no longer caches its rejection; failures surface as "Not saving" in the toolbar |
| 1.6 | `let s: Set<Int> = [1, 2, 2]` had three elements | The annotation drops duplicates, via a `unique` flag on the array value |
| 1.7 | `["a": 1]["b", default: 9]` answered nil | Answers 9 |
| 1.8 | `[[1], [2]].joined()` returned a string, so `.count` was the character count | Flattens and stays a collection |

## Phase 2 - Make the preview stop lying ✅

The design principle is that the preview may be imperfect and never dishonest. These
were the places it reported success and showed something untrue. Closed.

| # | Was | Now |
| --- | --- | --- |
| 2.1 | A misspelled or unknown modifier produced no diagnostic, no placeholder and no telemetry count | Reported, but only where the chain demonstrably starts at a known view, so a warning never lands on the project's own methods |
| 2.2 | Fifty-three real modifiers were accepted with no warning and no effect | All moved into `UNIMPLEMENTED_MODIFIERS` and warn honestly. Drawing them is Phase 9 |
| 2.3 | `String(format: "%.2f", 1.5)` rendered `%.2f` | A real `printf` subset, in `values.ts` |
| 2.4 | `String(repeating: "ab", count: 3)` rendered `ab` | Repeats |
| 2.5 | `Text(total, format: .currency(code:))` rendered the bare number | Formatted through `Intl`, so the separators and symbols are the platform's real ones |
| 2.6 | `contains { … }` was always false: only a `where:`-labelled argument counted, and a trailing closure fell into the value branch | A trailing closure is the predicate |
| 2.7 | `firstIndex { … }` was always nil | Same fix |
| 2.8 | A misspelled argument label was silently ignored | Checked for thirteen modifiers whose full signature is small enough to write down. Deliberately not more |
| 2.9 | An untitled `NavigationStack` rendered a title saying "Home" | No title, as in SwiftUI |
| 2.10 | `zIndex` was listed as supported and was a no-op | Warns |
| 2.11 | `safeAreaInset` and `containerRelativeFrame` likewise | Warn |
| 2.12 | `font(.custom(_:size:))` silently kept the 17pt body size | Takes the size. The face itself cannot be honoured in a browser |
| 2.13 | `monospaced()` warned that it was unimplemented, and it was implemented | It was in both tables; removed from the wrong one |
| 2.14 | Coverage telemetry counted only names already on the hardcoded list, so it could never discover anything | 2.1 gives it a diagnostic to count. The panel now separates "known gap" from "unrecognised" |

## Phase 3 - Report failures where the user can see them ✅

A tap that crashes is the most ordinary bug there is, and it was invisible. Three of
these took the whole worker down. Closed.

| # | Was | Now |
| --- | --- | --- |
| 3.1 | Every failure inside a Button action was a `level: 'log'` console line, styled exactly like a `print()`. The console's red branch was dead code | Logs carry a real level; a failed action is an error |
| 3.2 | A trap in a top-level initialiser escaped `compile()`, so the studio reported that the compiler stopped and never marked the line | Held on the runtime and returned as an ordinary runtime failure |
| 3.3 | A self-recursive view exhausted the JavaScript stack, uncaught | View expansion has its own depth budget, as Swift-level recursion already did |
| 3.4 | `as?`, `as!` and `is` parsed and were never implemented, trapping with `Expected a number, found 'S'` | Implemented, including the declared superclass chain and protocol conformances |
| 3.5 | An unknown view name was a blocking error with no preview at all | Real SwiftUI the preview does not draw renders as a labelled placeholder |
| 3.6 | A UTF-8 byte-order mark failed the file on character one | Skipped as trivia, with the other invisible spaces |
| 3.7 | `getDevice` returned undefined for an unknown key and the studio crashed on it | Falls back to the default device |
| 3.8 | `PreviewProvider` reported "this project has no entry point" | Says the form is unread, and points at `#Preview` |

## Phase 4 - Close the parser gaps ✅

Each of these was ordinary modern Swift that stopped the preview dead, before any of
Phase 5 could be reached. Closed; covered by `tests/swift-syntax-breadth.test.ts`.

| # | Was | Now |
| --- | --- | --- |
| 4.1 | Only one trailing closure was attached to a call, so `Button { } label: { }`, `Section { } header: { } footer: { }`, `Menu`, `Label`, `AsyncImage`, `Stepper`, `.alert` and `.confirmationDialog` were all syntax errors | Every closure after the first joins `args` as the labelled argument it is. The host and layout read them |
| 4.2 | An accessor block with bodies was parsed as statements, so it evaluated the identifier `get`. It also made a custom `EnvironmentValues` key impossible | Parsed properly; assigning to a computed property runs its setter with `newValue` bound |
| 4.3 | An attribute in a parameter list was a syntax error, so every custom container view was unwritable | `@ViewBuilder` and `@escaping` parse. An attribute's arguments now have to touch its name, which is how `@escaping () -> Void` reads |
| 4.4 | A function name had to be an identifier, so `static func ==`, `static func <`, `prefix func` and `infix operator` all failed | Parsed and dispatched, ahead of the built-in table only for operands the built-ins do not define |
| 4.5 | A tuple literal evaluated to an array, so `.0` and labels failed; `let (a, b) =` and `for (k, v) in` were syntax errors | Its own value kind. Positions, labels, destructuring, tuple patterns in `switch`, equality |
| 4.6 | The parser meant to report `willSet` / `didSet` as unsupported, but the initialiser swallowed the block as a trailing closure first | Parsed and run |
| 4.7 | `func f(_ xs: Int...)` did not parse | Binds the remaining positional arguments as an array |
| 4.8 | `reduce(0, +)` and `sorted(by: >)` were syntax errors | An operator in argument position is the closure it is shorthand for, `{ $0 + $1 }` |
| 4.9 | `Self.name` could not be resolved | Resolves to the type the code is written in |
| 4.10 | `indirect enum`, `actor`, `async let` and labelled `break` were four separate parse errors | All parse. `actor` is a class and `async let` a `let`, which is what one thread running in order means |
| 4.11 | A property called `open`, `some` or `any` failed to parse | Contextual keywords are names where a name is expected |
| 4.12 | `defer`, `fallthrough`, `typealias`, `subscript` and `deinit` each reported honestly and each stopped the preview | Implemented. `defer` runs on every exit; `fallthrough` continues without re-testing; an alias substitutes; a subscript is a method named `subscript`; a `deinit` never runs |

---

## Phase 5 - Fill in the standard library ✅

Fifty-five of 125 library checks failed. These are not exotic calls; the first four
appear in almost every SwiftUI project's first file, and they are what stood between
the realistic sample and 13 of 14.

Closed; covered by `tests/stdlib-breadth.test.ts`. The assertions there are on the
*answer* rather than on the absence of an error, because a member that exists and
returns the wrong thing is the failure this phase was written to remove, and a test
that only checks for a clean compile would pass on one.

| # | Was | Now |
| --- | --- | --- |
| 5.1 | `UUID`, `Date` and `URL` did not exist at runtime. All three were in the checker's known types, so nothing warned and then the interpreter could not find them. `let id = UUID()` is the standard `Identifiable` idiom; no `URL` meant `Link` and `AsyncImage` could not be constructed | All three are values the interpreter owns, alongside `IndexSet`. A `UUID` is random and prints as itself, a `Date` does intervals and comparison, a `URL` parses, keeps the string as written and reads apart. `Text(date, style:)` draws a date rather than nothing |
| 5.2 | `CaseIterable.allCases`. `ForEach(Tab.allCases)` is the commonest enum-driven pattern in SwiftUI | Synthesised from the cases, in declaration order, only where the enum declares the conformance and no case has a payload - which is exactly when Swift synthesises it. A hand-written `allCases` still wins |
| 5.3 | `Int("42")` and `Double("1.5")` trapped instead of returning an optional, so text-field input could not be parsed | Parsed against the grammar Swift accepts rather than the one `Number` accepts: `" 42"`, `"4_2"` and `"0x10"` are nil here as they are there. A preview more permissive than the compiler is the dishonest direction |
| 5.4 | `Bool.toggle()` | Flips through the storage the receiver came from. A scalar has nothing to mutate in place, so the built-in table can now replace its receiver - which is what `String.append` needed too |
| 5.5 | Missing mutating array methods: `removeFirst`, `popLast`, `sort(by:)`, `reverse`, `swapAt`, `replaceSubrange`, `removeSubrange` | All present, with the bounds checks Swift has: `removeFirst` traps on empty where `popLast` answers nil, and an index outside the collection traps rather than answering quietly |
| 5.6 | Maths: `sqrt`, `pow`, `round`, `floor`, `ceil`, `truncatingRemainder` | Present, and rounding halves away from zero as Swift does. `Math.round(-1.5)` is -1 and Swift's answer is -2; `Double.rounded()` had the same error and now takes a rounding rule as well |
| 5.7 | Free functions and statics: `Set(_:)`, `Array(_:)`, `Optional`, `zip`, `stride`, `type(of:)`, `fatalError`, `assert`, `precondition`, `Int.max`, `Int.min`, `Int.random(in:)`. The global builtin table had seven entries in total | All present. `Int.max` is 2^53 - 1 rather than Swift's 2^63 - 1, because that is the largest the interpreter can do arithmetic on without losing precision, and a number that prints plausibly and traps on first use is worse than a smaller true one. Stated in the coverage matrix |
| 5.8 | String members: `capitalized`, `prefix`, `suffix`, `dropFirst`, `dropLast`, `reversed`, `components`, `padding`, `unicodeScalars`, `append` | All present, counting by grapheme so `"a👋🏽b".reversed()` keeps the emoji whole - except `unicodeScalars`, which counts code points, that being the whole difference between it and `count` |
| 5.9 | Array members: `allSatisfy`, `flatMap`, `dropFirst`, `randomElement`, `shuffled`, `first(where:)` | All present, plus `last(where:)`, `lastIndex` and `dropLast`. `shuffled` is Fisher-Yates: the one-line `sort` shuffle is biased, and a preview that keeps starting with the same element looks broken |
| 5.10 | Dictionary members: `sorted`, `mapValues`, `filter` | Present, over `(key: , value: )` pairs. `filter` answers a dictionary and `sorted` an array, which is what each of them does in Swift |
| 5.11 | A key path where a closure is expected: `map(\.name)` was rejected | A key path is a one-argument function wherever one is wanted: `map`, `filter`, `compactMap`, `flatMap`, `forEach`, `allSatisfy`, `contains(where:)` and `first(where:)` |
| 5.12 | Nested types: `S.Inner()` could not be reached through its parent | Lifted to the top level under a qualified name before anything looks at the program, so the checker, the conformance merge and instantiation all agree. Registered under the bare name too when nothing else claims it, which is how it is written from inside |
| 5.13 | Implicit `self` inside an extension on a built-in type: `extension String { var shout: String { uppercased() } }` could not see its own receiver | The receiver's own members are in scope unqualified, built-in ones included. The checker stops reporting unresolved names inside such an extension, because the standard library's member list is not something it holds |
| 5.14 | Small framework values: `GeometryProxy.frame(in:)`, `AnyTransition.combined(with:)`, `.red.gradient`, `EdgeInsets`, `StrokeStyle`, `Material.ultraThin` | All constructible. `EdgeInsets` reaches `.padding`, `StrokeStyle`'s line width reaches the stroke, `.gradient` shades the colour it came from, `Material.ultraThin` is the same value as `.ultraThinMaterial`. Two are partial and say so in the matrix: a stroke's dash pattern and the second half of a combined transition both need a render-tree field that does not exist |
| 5.15 | Bitwise operators `&`, `\|`, `^`, `<<`, `>>` | Computed in `BigInt`, so `1 << 40` is 1099511627776 rather than JavaScript's 256. Two Doubles are refused, as Swift refuses them |
| 5.16 | `_` in a tuple pattern | ✅ closed by 4.5 |

### Found while closing this phase

Each was reproduced against the pipeline before it was fixed, and each is covered by
the same suite.

| # | Was | Now |
| --- | --- | --- |
| 5.17 | `_ = items.popLast()` reported "cannot assign to this expression". The discard is how Swift is told a result is deliberately unused, so it appears wherever a mutating method answers something the caller does not want | Evaluates the right-hand side for its effects and throws the answer away |
| 5.18 | A `let` collection could be mutated: `let items = [1]` then `items.append(2)` ran, changed the array and reported nothing, while Xcode refuses to build it. The same held for `scores["b"] = 2` on a `let` dictionary | Both refused, with the message the struct path already used. Found while adding 5.5's seven methods, each of which would have been another way to do it. One case of the same shape is still open and is Phase 6's: a collection *inside* a `let` struct - `let bag = Bag(); bag.items.append(1)` - is still allowed, because the constancy has to travel through a member access rather than sit on the binding |
| 5.19 | `Text(verbatim:)` drew an empty string, and once 5.1 landed so did `Text(someDate)` - a blank where the app shows a date | Both draw their content. `Text(date, style:)` takes `.time`, `.date`, `.relative`, `.offset` and `.timer` |

## Phase 6 - Fix the strictness pass where it is wrong ✅

This pass exists to say "this runs here and will not build in Xcode". Where it was wrong
it said the opposite of the truth, and one of its quick fixes caused the failure it
warned about.

Closed; covered by `packages/swift-sema/src/strictness.test.ts`, whose own preamble says
the half that must produce *nothing* is the more important one. Every fix here went in
that half.

Two of the four items read differently once reproduced, and the corrected description is
what is written below: the register said what the symptom looked like, and the fix has to
answer to what the code actually did.

| # | Was | Now |
| --- | --- | --- |
| 6.1 | A non-mutating method writing a `@State`, `@Binding` or `@Published` property was flagged as needing `mutating`. All of those have a nonmutating setter - which is precisely what lets `body`, itself non-mutating, write to them - so this fired on the most standard shape in SwiftUI, and the offered fix inserted `mutating`, after which `body` cannot call the method and Xcode rejects the file | A property carrying any attribute is excluded from the check. The test is "any attribute" rather than a list of SwiftUI's wrappers, because a wrapper the project declared is on no list and its setter cannot be judged from here; the cost is a missed warning on `@available var n = 0` |
| 6.2 | Reported as being about the *call site* - `&n` where `n` is a `var`. It is not: the call site is fine, and the warning lands inside the function, on `func bump(_ x: inout Int) { x += 1 }`. An `inout` parameter was declared as a `let` binding, so writing it - the whole point of the feature - reported that `x` is a constant | A parameter is a constant unless it is `inout`, in which case it is a reference to the caller's storage |
| 6.3 | Reported as being about a `switch` over an Optional. The cause is broader and duller: the statement walk behind the check followed only `if` and `for`, so a `return` inside a `switch`, a `while`, a `repeat`, a `do`/`catch` or below the first rung of an `else if` chain was invisible | The walk visits every statement that has a body. One incomplete walk was behind a false positive *and* a false negative: the same function feeds `findAssignedNames`, so a struct method assigning a property inside a `switch` was never told it needed `mutating`. Both are now right |
| 6.4 | A collection inside a `let` struct could be mutated: `let bag = Bag()` then `bag.items.append(1)` ran. 5.18 closed the direct case; this one needed the constancy to travel through a member access | A member of a `let` *struct* is constant, because the constant holds the value. A member of a `let` *class* stays writable, because the constant holds a reference - which is what `let store = Store()` depends on. A projection stays writable through either, which is what `@Binding` is. A computed property is left alone: its setter may be `nonmutating` and the parser does not record that, so refusing would stop the preview running code Xcode accepts |

### Two bugs cancelling, which is why the corpus stayed green

The eighteen templates produced **zero** strictness warnings before this phase, and that
number was not evidence of anything. The `Loader` template carries 6.1 exactly: a
`@State private var status` written by `func load()`. It never warned, because the
assignments sit inside a `do` / `catch` - and 6.3's incomplete walk could not see into
one. The wrong rule and the blind walk cancelled.

Measured rather than reasoned about, by putting the old file back and running the corpus
through it: with the walk fixed and the rule left alone, the templates produce one
warning, on `Loader`. With both fixed, none. So the two had to land together - fixing
6.3 alone would have *introduced* a false positive into a shipped template, along with a
fix-it that breaks it.

The gate that would have caught that is `tests/templates.test.ts`, which asserts no
diagnostic of any severity on any template, and it has teeth here precisely because
`Loader` carries the shape. What it could not do was catch the two bugs while they were
cancelling, which is the general case: a corpus tests the constructs it happens to
contain, in the combinations it happens to put them in.

## Phase 7 - Finish the editor intelligence ✅

Completion, hover and the quick fixes were good. Three holes remained once rename was
safe, and all three came down to the same missing step: the editor could name what a
*declaration* was and could not say what a *value* was.

Closed; covered by `packages/swift-sema/src/symbols.test.ts` and
`tests/editor.test.ts`.

| # | Was | Now |
| --- | --- | --- |
| 7.1 | Go to definition did nothing on a struct member. In a project of any size that is most of the names worth jumping to, since almost everything in a view body is reached through a receiver | Resolved through the receiver where its type is written down, and otherwise by the member name alone - but only when exactly one type declares it, which is the rule the enum-case fallback already used. A member beats a local of the same name: `item.count` is the property even with a `count` in scope |
| 7.2 | No hover for framework symbols. Views and modifiers were described; the standard library, the free functions and the property wrappers were not, and between them that is most of the words in a SwiftUI file | `text.uppercased()`, `sqrt` and `@State` all answer, with a signature and a line of quick help. A member is described through its receiver where the type is known, and otherwise only when every built-in that has the name describes it identically - `count` means the same everywhere and is described, `first` does not and is left alone |
| 7.3 | Completion offered all 159 view modifiers after a dot on anything at all. After a String that is 159 wrong answers and none of the right ones | The receiver's type decides: a built-in gets its own members, a model struct gets its members and no modifiers, a view gets both. Where the type is not written down the modifier fallback stands, because that is the honest answer rather than a guess |

### The table that describes the library, and the test that keeps it true

7.2 and 7.3 are the same question asked twice - what does this value have? - so they
share one answer: `packages/swift-sema/src/stdlib-symbols.ts`, which names every
standard library member with its signature and a line of help.

That file is a *description*, and the implementation is in `swift-runtime`, which
`swift-sema` cannot import. Two tables describing one thing drift, and the drift that
matters is one-way: a member the editor offers and the runtime does not have is a
name suggested to the user that does nothing when they use it. So `tests/editor.test.ts`
runs every entry through the real pipeline as real Swift, and asserts the two lists
cover each other in both directions - a member described but not exercised fails as
loudly as one that does not resolve.

Writing it caught two claims that were wrong before anyone could rely on them. A `Set`
was listed with `Array`'s members, because the runtime represents one as an array that
refuses duplicates - so `set.append(…)` would have been offered, and Xcode rejects it.
And `Character` was listed with `String`'s, for the same reason: the runtime carries a
Character as a String, so `someCharacter.hasPrefix(…)` runs here and does not compile
there. The Set has its own list now and the Character has none, which costs a
completion and avoids a false one.

## Phase 8 - Validate what a share link carries ✅

A share link is a stranger's bytes: anyone can write one and the studio opens it on
sight. Decoding validated types and not values, and two of those values reached file
paths in the exported archive.

Closed; covered by `packages/project-model/src/share.test.ts` and
`packages/exporter/src/bundle.test.ts`.

| # | Was | Now |
| --- | --- | --- |
| 8.1 | A file id containing `..` became a zip entry above the project folder: `MyApp/MyApp/../../../evil.swift`, from a link 142 bytes long | Refused at the boundary, and refused again by the exporter |
| 8.2 | The project name was used unsanitised as both the root and the target folder, so it escaped twice - `../../evil/../../evil.xcodeproj/…` - and every entry in the archive carried it. A 136-byte link set it | `normalizeProjectName` rejects a separator, a `..`, a control character, a name that is only dots, and anything past 64 characters. Its own function rather than a reuse of the path cleaner, because a project name is one directory name and `Models/Item` is a fine file name and a terrible project name |
| 8.3 | `decodeProject` cast the payload's device string to `DeviceKey` without checking it | Checked against `DEVICES`, and **falls back rather than rejecting**. The device is a preview setting: getting it wrong costs a frame size, and Phase 3.7 already decided such a link opens on the default. Throwing away someone's code over the size of the phone it is drawn in would be the wrong trade |
| 8.4 | File ids were not checked at all | Every id and folder must be *idempotent* under the normaliser the rest of the app already uses - safe exactly when normalising it changes nothing. Stricter than a second set of rules written at the boundary, and it cannot drift from the first set, which is what a second set would eventually do |

### What the probe found that the register had not listed

- **Folders escape too.** The payload carries empty groups in `g`, and `['../../evil']`
  survived decoding untouched. Same gate, same fix.
- **An absolute id, a Windows path and a doubled separator** all passed through:
  `/etc/passwd`, `C:\Windows\evil.swift`, `..\..\evil.swift`, `Sources/a//b.swift`.
  The `..` case was the one written down; it was not the only one.
- **A link may claim any number of files.** The length limit bounds the payload
  *compressed*, and repeated names compress to almost nothing - four thousand entries
  fit comfortably inside it, and each becomes a file in the export. Capped at 256,
  against a largest template of eight.
- **`bundleId` and `deploymentTarget` cannot inject anything**, and that is worth
  recording as a thing that came out right: the pbxproj writer quotes and escapes what
  it writes, so `com.a";\n\t\tEVIL = "yes` lands inside a quoted string rather than as
  a second build setting. They are validated anyway, because a link that opens into a
  project Xcode will not build is still a broken link.

### Two places, on purpose

The boundary is the fix; the exporter is the invariant. `decodeProject` is where
untrusted bytes become a project, so that is where they are refused - and it was the
only untrusted route in. But `buildExportBundle` is the function whose guarantee this
*is*: every entry in the archive is inside its own root. It now resolves each path and
refuses anything that leaves, so the guarantee survives the next input route someone
adds - a file import, the GitHub export in the roadmap's Phase 7.

Writing that guard taught something the register had not anticipated. All four export
formats build paths the same way, and they do not nest to the same depth: three `..`
escape the two-deep `.xcodeproj` layout and land at the *top* of the three-deep
`.swiftpm` one. A guard that counted `..` would have been right for two formats and
wrong for the other two, so it resolves the path and asks whether the result is still
inside the root. All four formats now write through one guarded map rather than four
copies of the same path arithmetic, which is what let the difference hide in the first
place.

## Phase 9 - Draw what is honestly not drawn yet 🟡

Real feature work, and the right place for it is after the preview reports these
accurately - which Phase 2 did. Each line is a body of work rather than a bug, and
this pass took the two that are not: the controls that were drawn and answered to
nothing, and the symbol alias. **9.2 to 9.7 are untouched**, and the sizes below say
what each still needs.

| # | State | |
| --- | --- | --- |
| 9.1 | 🟡 4 of 6 | `Stepper`, `DisclosureGroup`, `Picker` and `Menu` are operable. `DatePicker` and `ColorPicker` still draw and do not open |
| 9.2 | ⬜ | Text attributes. Starts with a render-tree change, and the measurement half (`minimumScaleFactor`, `allowsTightening`, `truncationMode`) needs the line breaker |
| 9.3 | ⬜ | Control styles that all draw the same |
| 9.4 | ⬜ | Layout: `safeAreaInset`, `alignmentGuide`, the `Layout` protocol, lazy-stack virtualisation |
| 9.5 | ⬜ | Effects and animation, including exit transitions |
| 9.6 | ⬜ | The remaining views. `GroupBox` is the one still failing the fourteen-snippet measure |
| 9.7 | ⬜ | Data flow: `@AppStorage`, `@FocusState`, `PreferenceKey`, Combine |
| 9.8 | ✅ | **Not reproducible.** See below |
| 9.9 | ✅ | `gear` is drawn |

### 9.1 - controls that were drawn and answered to nothing

A preview that looks interactive and is not is a worse lie than one that looks
static, because the user blames their own code. These four now work, and are covered
by `tests/controls.test.ts`.

| | Was | Now |
| --- | --- | --- |
| `Stepper` | Drawn with both halves and no hit target at all | Each half is its own target. `step:` is honoured, and `in:` is a bound the press may not leave - a control that counts past its own range shows a number the app could never show |
| `DisclosureGroup` | Rendered permanently expanded, with no way to collapse it | Starts closed, opens and closes, and the chevron turns. Where the user wrote `isExpanded:` that binding is the truth; where they did not, the framework keeps the state, exactly as it does for a navigation stack |
| `Picker` | Had a hit target whose intent was to write its own selection back over itself | Opens onto the options the user wrote, ticks the one currently chosen, and choosing writes the binding and closes in one press |
| `Menu` | No hit target | Opens onto its buttons; pressing one runs its action and closes |

The menu is drawn as a panel at the bottom of the screen. iOS anchors it to the
control it came from, and the resolver does not know where that ended up on screen -
so this is an approximation of *position*, never of content, and it is recorded as
one in the coverage matrix.

### The dimmed area behind a sheet never worked

Found while giving the menu a way to dismiss itself. The coverage matrix offers
"tap outside it" as *the* way to close a sheet in a preview, and the pipeline builds
a dim layer with a hit target on it for exactly that - but the render conversion
attached hit targets only to the invisible `hit` boxes, and the dim layer is a
*fill*. Every tap outside a sheet, alert or dialog has been landing on nothing.

The mapping now happens once, for every node, rather than in one branch of a switch
over paint kinds - which is the shape of the fix that stops the next paint kind
losing it too.

### 9.8 was already closed

The register says the back button carries no accessible label and cannot be found by
name. It can: it is labelled with the title of the screen it returns to, which is
what iOS does, and `tests/phase6.test.ts` has been finding it that way since Phase 6.
Measured by putting the pre-Phase-9 file back and asking for the label rather than by
reading the code.

Left as a finding rather than quietly dropped: the sweep produced this item, later
work closed it, and nothing noticed. It is the one entry in 84 that did not
reproduce.

### Found while working here, not fixed

- **A property named `open` cannot be read at the start of an expression.**
  `var n: Int { open }` reports "Expected an expression, found 'open'", while
  `"\(open)"` and `$open` are both fine, and `some`, `any` and `each` work
  everywhere. Phase 4.11 made contextual keywords work as *declaration* names; this
  is the same word in statement-start expression position, where the parser is still
  looking for a declaration modifier. Narrow, real, and not Phase 9's.

---

### What remains, in full

The list the sweep produced, minus what this pass closed. Each is a body of work
rather than a bug, and the phase stays open until they are done or declined.

| # | Item |
| --- | --- |
| 9.1 | `DatePicker` and `ColorPicker` are drawn and cannot open. Both need an editor of their own - a calendar and a colour surface - rather than a list of the options the user wrote, which is what made the other four cheap |
| 9.2 | Text rendering beyond size, weight and colour: `underline`, `strikethrough`, `lineSpacing`, `kerning`, `tracking`, `baselineOffset`, `minimumScaleFactor`, `truncationMode`, `lineLimit(_: Range)`, `monospacedDigit`, `allowsTightening`. `TextRun` has no field for any of them, so this starts with a render-tree change. The first six are whole-Text attributes and need no line-breaker work; the rest need measurement to answer back |
| 9.3 | Control styles that all draw the same: `toggleStyle`, `pickerStyle`, `labelStyle`, `progressViewStyle`, `gaugeStyle`, `controlSize`, `buttonBorderShape`, and custom `ToggleStyle` / `LabelStyle` |
| 9.4 | Layout: `safeAreaInset`, `alignmentGuide`, `containerRelativeFrame`, the `Layout` protocol, `AnyLayout`, virtualisation for the lazy stacks |
| 9.5 | Effects and animation: `mask`, `blendMode`, `hueRotation`, `colorMultiply`, `rotation3DEffect`, `redacted`, `visualEffect`, `matchedGeometryEffect`, `phaseAnimator`, `keyframeAnimator`, `Animatable`, the `value:` gate on `.animation`, and exit transitions |
| 9.6 | Views: `GroupBox`, `LabeledContent`, `ControlGroup`, `ScrollViewReader`, `NavigationSplitView`, `Table`, `OutlineGroup`, `TimelineView`, `Chart`, `.popover`, `Image("asset")`, `tabViewStyle(.page)`, `ToolbarItemGroup` placements, `Section` footers, the sidebar list style, and `Text` + `Text` - which is a *runtime error* today rather than a placeholder, and so the worst-behaved row in the table |
| 9.7 | Data flow: `@AppStorage`, `@SceneStorage`, `@FocusState`, `PreferenceKey`, `onReceive` and Combine, `openURL`, `scenePhase`, `PreviewProvider`, `Binding(get:set:)`, and `.navigationDestination(for:)` with a built-in type |

## Phase 10 - Make the documentation match the code 🟡

The coverage matrix calls itself the public contract and says a partial row with nothing
said is indistinguishable from a bug. These are the rows where that was true.

| # | Item | State |
| --- | --- | --- |
| 10.1 | Rows marked done that were not: `Text` concatenation, `Date` and number formatting, key paths, `GeometryReader` as its own coordinate space, `Link` and `AsyncImage` (neither constructible without `URL`), `.navigationDestination` for built-in types | 🟡 the first three corrected; the rest wait on 5.1 and 9.7 |
| 10.2 | The matrix contradicts itself on materials: the `.background` row says they are not drawn, the `Material` row says they are. The second is true | ⬜ |
| 10.3 | `monospaced` appeared in both the supported and the unimplemented table | ✅ |
| 10.4 | Eight duplicated keys in the unimplemented modifier map | ✅ |
| 10.5 | Every unimplemented diagnostic promised Phase 7, after Phase 10 shipped and after the matrix stopped promising phases | ✅ |
| 10.6 | The eighteen templates contain no `UUID`, no `Date()`, no `allCases`, no `Button { } label: { }` and no `get {`; `Identifiable` models use `let id: Int`. A handful of templates written the way people actually write would turn most of this document into failing tests | ⬜ |
| 10.7 | Gaps the matrix did not mention at all: type casts, tuples, accessors, property observers, operator declarations, multiple trailing closures, `@ViewBuilder` parameters, `Self`, variadics, bitwise operators, `Binding(get:set:)` | 🟡 all but bitwise operators and `Binding(get:set:)` now have rows |

---

## Method

Every finding was reproduced against the real pipeline before it was written down, and
every closed item is covered by a test that fails against the old behaviour. The probe
suites themselves were deliberately not kept: they were a net, and a net that stays in
the repo becomes a second, worse test suite. What survives is the regression coverage
named under each phase, plus this document.

Where a new test asserts that something is *not* wrong any more, it was run against a
deliberately broken version first. A test that cannot fail is not evidence, and two of
the ones written for these phases only looked like evidence until that was checked.

### The end-to-end suite can pass against code that is not there

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, and `npm run build`
is cached by Turborepo. Both are right for the inner loop and together they make a
local `npm run e2e` capable of reporting 52 / 52 against a server started before the
change under test. That happened in Phase 9: the suite was green locally and CI failed
on the first push, because making the dimmed backdrop pressable gave the screen two
controls named "Dismiss" - the backdrop and the fixture's own `Button("Dismiss")`.

Before trusting a local run, force both: `npm run build -- --force`, then
`CI=1 npx playwright test`, which also matches CI's single worker and retry count.

The fix was the product's, not the test's. The backdrop is named for what it closes -
"Close sheet", "Close menu" - because a user's button can be called anything and the
backdrop is the one of the two that can be renamed unilaterally. `tests/controls.test.ts`
now asserts that no two controls on a screen share a name.

### One flaky gate, stated rather than re-run until green

`e2e/smoke.spec.ts` - "the Swift Playgrounds export carries the edited source" - failed
once during Phase 7 in a full run, and passed on its own and on the next full run. No
error text was captured, so there is nothing to diagnose from and nothing is claimed
about the cause; it is the slowest test in the suite at around ten seconds against
under two for most, and it waits on a download.

Written down because a gate that fails one run in three teaches people to re-run it,
and after that it is not a gate. It needs a run with the report kept before anything is
concluded, which is work this phase did not do.
