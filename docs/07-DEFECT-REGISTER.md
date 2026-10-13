# 07 - Defect register

What a systematic sweep of the studio found, in the order worth fixing.

Roughly 870 checks driven straight through the compile pipeline, the language service,
the project model and the exporter. **231 came back wrong.** The repo's own gates were
all green while that was true, because the eighteen templates used none of the
constructs that fail - so the corpus, not the interpreter, was what "18 / 18 templates
with zero placeholders" measured.

**Phases 1-10 are closed.** The corpus was the last of them, and the most
load-bearing: the gallery is written the way people write, and two tests name the
idioms it must keep containing. Everything still not built is listed here with the
reason, and carries the same reason in the coverage matrix.

**Phases 11 and 12 exist because 10 worked, and both are closed.** Four multi-screen
templates were written against the real pipeline, and writing ordinary Swift against it
found eighteen defects the whole of phases 1-10 had not - including two where the
interpreter returned a *wrong answer* with a clean Problems pane, and several where an
entire screen drew nothing and said nothing.

That is the argument for the corpus rule, made one level up. A sweep tests the claims in
the matrix; almost every one of these lived in the space *between* two claims that were
each true on their own. The fastest way to find what a preview gets wrong is to write
the app you would have written anyway.

**Phase 13 is open, and its first eight items are closed.** Seven sample screens were
written against the running studio and then measured in the DOM, which is the same rule
turned on the *chrome*: seventeen defects, three of which blank the preview from
ordinary Swift, and four of which are a single missing tint showing up on every screen
at once. Nothing in it is a name the coverage matrix gets wrong. Everything in it is a
detail shared by every screen that draws the name.

Fourteen of the seventeen are closed: the traps, the four colour bugs, and the chrome
apart from one. What is left is 13.11, which turned out to need a change to how a
screen composes rather than a change to a colour; 13.16, which is open by degree
rather than by kind; and 13.17, which is a decision rather than a defect.

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
| 9 | Draw what is honestly not drawn yet | 9 | ✅ |
| 10 | Make the documentation match the code | 7 | ✅ |
| 11 | What writing three new app templates found | 10 | ✅ |
| 12 | What writing an app, rather than reading the matrix, found | 8 | ✅ |
| 13 | What writing seven sample screens found | 17 | 🟡 |

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

## Phase 9 - Draw what is honestly not drawn yet ✅

Real feature work rather than bugs, and the right place for it was after the preview
reported these accurately - which Phase 2 did. Each line below is closed by building
it, or by declining it with a reason that is also in the coverage matrix.

| # | State | |
| --- | --- | --- |
| 9.1 | ✅ | `DatePicker` opens onto a calendar and `ColorPicker` onto a palette |
| 9.2 | ✅ | Text attributes, both the paint half and the measurement half |
| 9.3 | ✅ | Every built-in control style draws differently; the two custom ones are declined |
| 9.4 | ✅ | `safeAreaInset`, `alignmentGuide`, `containerRelativeFrame`; the `Layout` protocol declined |
| 9.5 | ✅ | The colour and transform effects, and the `value:` gate on `.animation` |
| 9.6 | ✅ | Ten views drawn, four left with reasons |
| 9.7 | ✅ | `@AppStorage`, `@FocusState`, `PreviewProvider`, `Binding(get:set:)`, `scenePhase`, `openURL` |
| 9.8 | ✅ | **Not reproducible.** See below |
| 9.9 | ✅ | `gear` is drawn |

### 9.1 - the two controls that could not open

These were what the first controls pass left behind, because neither can be a list of
the options the user wrote - the thing that made `Stepper`, `DisclosureGroup`, `Picker`
and `Menu` cheap. They share the menu's *mechanism* - open, choose, close - and none of
its content.

A date picker opens onto the month its value falls in. Choosing a day writes the
binding and keeps the time of day; the arrows page the month without touching the
value, because the user has not chosen yet. Which month is on show is framework state,
beside the navigation stack and the open menu, for the same reason those are.

A colour picker offers SwiftUI's named colours rather than a continuous surface: those
are the colours the exported Swift can *name*, and letting someone land on one their
code cannot express is a worse answer than a smaller choice.

The closed date row also showed `2025-06-15 15:06:40 +0000` where iOS shows a formatted
date. It is formatted now, and `displayedComponents:` picks date, time or both.

### 9.2 - text, which was two items pretending to be one

`TextRun` carried text, font and colour, so `.underline()` had nowhere to land; and the
painter read `runs[0]` and dropped the rest, so even the runs that did exist could not
all be drawn. `Text + Text` needed both of those fixed, which is why the register's
9.2 and its `Text + Text` row under 9.6 were one piece of work.

Five of the attributes are measurement rather than paint, and that is what made them
the hard half: `.tracking` widens every cluster, `.lineSpacing` grows the box,
`.minimumScaleFactor` re-measures at smaller sizes until the text fits,
`.allowsTightening` condenses before breaking, and `.monospacedDigit` gives every digit
the widest one's advance. Each changes the frame the engine reports, which is the whole
reason they could not be handed to CSS.

`.truncationMode` is decided against everything still to come rather than the last
visible line - `.head` keeps the end of the text and `.middle` keeps both ends, and
neither means anything once the text past the break has been thrown away.

Covered by `tests/text-attributes.test.ts` and `packages/swiftui-layout/src/metrics.test.ts`.

### 9.3 - the styles that were "recognised" and inert

`.toggleStyle`, `.pickerStyle` and `.labelStyle` sat in the branch marked "recognised,
and either read elsewhere or deliberately inert". Nothing read them, so they were the
quietest kind of wrong: no warning, and a control that draws the default whatever was
asked for.

Each changes the drawing now, and styles are inherited, because that is where people
write them - `.pickerStyle` goes on the `Form`, not on each picker. An inline picker
stays operable: the resolver registers a choose intent per option whatever the style,
and the layout decides which targets it draws.

Custom `ToggleStyle` and `LabelStyle` are **declined**, with the reason the roadmap
already gave: the same mechanism as `ButtonStyle`, except a Toggle's configuration
carries a *binding* the style writes through, and half of that is worse than none.

Found here: a bordered button had been drawing square corners since the style was
added. The radius was applied inside the background rather than around it, and a fill
only takes a radius from the inherited environment.

### 9.4 - layout, which needed the engine changed rather than extended

A stack was offsetting each child by the stack's alignment. That is the *answer* for
the default case rather than the rule: SwiftUI lines up each child's alignment
**guide**, and where the default guides sit is what makes `.leading` and `.center`
behave as they do. Written the other way round, `.alignmentGuide` had nothing to
replace.

The guide closure is the user's and takes the view's measured dimensions, so it is
passed to the layout pass as a function: `swiftui-layout` calls it and does not know
what is on the other side, which keeps the dependency pointing one way.

`.safeAreaInset` insets rather than overlays - the child is offered the space that is
left, so a bar drawn this way does not cover the last row.

The `Layout` protocol and `AnyLayout` are **declined**: they need a `Subviews` proxy
and callbacks from the engine into the interpreter for sizing as well as placement,
which is a real seam, and custom conformances are rare in app code. Lazy-stack
virtualisation is **accepted as measured rather than fixed**: 200 rows lay out in
7.6 ms against a 120 ms budget, so the cost is real and not worth the identity
complexity.

### 9.5 - effects, most of which CSS already agrees with

A hue rotation is a hue rotation and a blend mode is a blend mode: for most of this the
work was a field on the render tree rather than an approximation. Two are not.
`.colorMultiply` is an overlay in multiply mode because no CSS filter multiplies by an
arbitrary colour, and `.rotation3DEffect` needs a perspective or the browser draws a
flat squash.

`.blendMode` takes the sixteen modes both vocabularies share; the rest warn rather than
being drawn as the nearest one. The table lives in `swift-sema` because the *checker*
needs it: `.blendMode` is a supported modifier now, so without a rule at the argument an
undrawable mode would be accepted in silence.

`.animation(_:value:)` honours its gate. That needs the previous render's value, which
only the resolver has, so it is decided there and stamped on the modifier - the same
shape as a `DisclosureGroup`'s open-ness.

**Declined**, each for the reason the roadmap gave: `matchedGeometryEffect`,
`.phaseAnimator`, `.keyframeAnimator`, `Animatable`, and exit transitions. All four of
the first need the renderer to own frames or trees it does not own.

### 9.6 - the views

Drawn: `GroupBox`, `LabeledContent`, `ControlGroup`, `Section` footers,
`NavigationSplitView` (collapsed to a stack, which is what a phone does), `TimelineView`
(once, because there is no clock), `.popover` (as a sheet, which is what iOS does at
this width), `.tabViewStyle(.page)` (dots that are also the way through), the sidebar
list style, and `Text + Text`.

`ToolbarItemGroup` placements already worked; the matrix said they did not.

Left, with reasons rather than dates:

| | Why |
| --- | --- |
| `Image("asset")` | **Declined.** A project file here is text. There is no asset catalogue for a name to resolve against, so there is nothing to draw and no work in the renderer changes that |
| `Chart` | Needs a mark model and a plottable-value protocol - a package rather than a view |
| `Table` / `OutlineGroup` | Both are real work and both draw a labelled placeholder meanwhile |
| `ScrollViewReader` | `scrollTo` is an *imperative* command travelling worker to renderer, which is a direction the protocol does not have |

### 9.7 - data flow

`@AppStorage` is not `@State` with a different spelling: it is keyed by a string, so
two views naming one key share a value and the value outlives the view that wrote it.
It has a store of its own, which the end-of-pass sweep that prunes `@State` never
touches, and harvest writes back only what changed - otherwise a sibling's stale copy
overwrites the new value.

`PreviewProvider` is read as a root. It is what every project written before Xcode 15
carries, and reporting "no entry point" for one sent the user to fix what was not
wrong.

`Binding(get:set:)` and `.constant(…)` build a projection, so a computed binding is
indistinguishable downstream from a projected one.

`scenePhase` reads `.active` and `openURL` is callable and logs. Neither can do
anything else honestly.

**Declined:** `PreferenceKey` - a value travelling *up* needs a second pass and a
re-render when a handler writes state, and `GeometryReader` covers what people reach
for it for. **Left open:** `onReceive` and Combine, which need publishers and a
scheduler the preview does not have.

### 9.8 was already closed

The register says the back button carries no accessible label and cannot be found by
name. It can: it is labelled with the title of the screen it returns to, which is what
iOS does, and `tests/phase6.test.ts` has been finding it that way since Phase 6.
Measured by putting the pre-Phase-9 file back and asking for the label rather than by
reading the code.

Left as a finding rather than quietly dropped: the sweep produced this item, later work
closed it, and nothing noticed. It is the one entry in 84 that did not reproduce.

### Found while closing this phase

Each of these was a defect the sweep did not produce, turned up by writing the tests
for something next to it. They are listed because the *way* they were found is the
argument for the corpus rewrite in 10.6.

- **A view listed as unimplemented stopped the whole preview.** `Table(rows) {
  TableColumn("Name") { row in Text(row.name) } }` had its content closure run with
  nothing to pass, so `row` was nil and reading a property of it trapped. An
  unimplemented view's closure is not run at all now: its children are discarded in
  favour of the placeholder anyway.
- **`var body: some View { Color.blue }` drew nothing.** Three view builders each had
  their own copy of "keep the values that are already views", and a `Color` is a view
  without being one - so it was dropped at the root while the same colour inside a
  `VStack` drew fine.
- **`.safeAreaInset` was claimed and unimplemented at once.** It sat in the branch
  marked "read by the pipeline, which owns the device's edges" *and* in the
  unimplemented-modifier list. Nothing read it.
- **`Picker { ForEach(options) { … } }` left its options a level down**, so the
  segmented drawing rendered a placeholder for a container and the popup had nothing to
  tick. That is how a picker over a collection is written.
- **`AsyncImage` drew a grey box** while the matrix said it drew its `placeholder:`.
  The placeholder arrives as a labelled closure argument and the code looked for a
  *modifier* of that name.
- **A contextual keyword could be declared and never read.** `var open = 1` parsed
  because every position that asks for a name consults the contextual-keyword list, and
  expression position did not. Seventeen of them read now; `get` and `set` are names
  everywhere except at the start of a computed property's body, where `{ get` begins an
  accessor block in Swift too.

## Phase 10 - Make the documentation match the code ✅

The coverage matrix calls itself the public contract and says a partial row with
nothing said is indistinguishable from a bug. These were the rows where that was true.

| # | Item | State |
| --- | --- | --- |
| 10.1 | Rows marked done that were not | ✅ |
| 10.2 | The matrix contradicted itself on materials | ✅ |
| 10.3 | `monospaced` appeared in both the supported and the unimplemented table | ✅ |
| 10.4 | Eight duplicated keys in the unimplemented modifier map | ✅ |
| 10.5 | Every unimplemented diagnostic promised Phase 7 | ✅ |
| 10.6 | The templates used none of the constructs that fail | ✅ |
| 10.7 | Gaps the matrix did not mention at all | ✅ |

### 10.1 - three were already true, one was not

The seven rows split three ways. `Text` concatenation, `Date` and number formatting and
key paths were corrected in earlier passes. `.navigationDestination(for:)` with a
built-in type, `Link`, and `GeometryReader` as its own coordinate space turned out to
be true already - they had been waiting on `URL` and on the data-flow work, and nobody
re-checked once those landed.

`AsyncImage` was not true, and had not been since Phase 7. It is pinned now, along with
the other three, by tests in `tests/matrix-claims.test.ts` that assert what is *drawn* -
the only kind of test that can catch "marked done and not done".

### 10.5 - closed for views and modifiers, and missed for wrappers

The property-wrapper diagnostic still said "arriving in Phase 7" after Phase 7 shipped,
in the one table the earlier close did not reach. All of those wrappers are supported
now, so the message is gone rather than corrected - and a test asserts that *no*
diagnostic contains a phase number at all, which is what stops it coming back a third
time.

### 10.6 - the corpus was measuring itself

"Eighteen templates render with zero placeholders" was measuring the corpus rather than
the interpreter. Two hundred and thirty-one defects lived behind that number because
the gallery used none of the constructs that fail: every `Identifiable` carried `let
id: Int` with hand-written numbers - the one identity scheme no real app uses - and
nothing called `UUID()`, `Date()` or `allCases`, nobody wrote `Button { } label: { }`,
and no property had an explicit `get {`.

The inbox, the settings form, the task list and both navigation corpora are rewritten
around what people type. A nineteenth template, Typesetting, exercises what Phase 9
built: concatenation with a face per half, underline and strikethrough, tracking, line
spacing, truncation in the middle, shrink-to-fit, redaction with a button that lifts
it, and a `.safeAreaInset` footer.

Two tests keep it that way. One lists the idioms the corpus must contain and names each
in its failure message; the other refuses `let id: Int` outright. Without them the
gallery drifts back to the safe subset, which is how the number came to mean nothing
the first time.

## Phase 11 - What writing three new app templates found

Three multi-screen templates were written against the real pipeline rather than against
the matrix, which is the only way to find out what the matrix is wrong about. Every
defect below was hit by ordinary Swift on the way to a screen that renders, not by
probing for it.

| # | Item | State |
| --- | --- | --- |
| 11.1 | Overloads collapsed to whichever was written last | ✅ |
| 11.2 | A method and a property sharing a name could not coexist | ✅ |
| 11.3 | `$store.property` was not a binding | ✅ |
| 11.4 | Trailhead does not compile in Xcode | ✅ |
| 11.5 | Custom `Shape` conformances, unsupported and unlisted | ✅ |
| 11.6 | The corpus is 7% of the client JS budget | ✅ |
| 11.7 | The share limit, not the matrix, is what caps the gallery | ✅ |
| 11.8 | The template gate only ever renders the first screen | ✅ |
| 11.9 | Open cannot read what Export writes | ✅ |
| 11.10 | One project slot, named after the counter | ✅ |

### 11.1 - the worst kind of wrong

`Ledger` wanted `spent` and `spent(on:)`; `Pulse` wanted `minutes(on:)` and
`minutes(of:)`. Both are ordinary Swift and neither worked, because `memberKey` in
`conformance.ts` keyed a function on its bare name. Two overloads collided, the later
layer overwrote the earlier, and the survivor was then called with the labels of the
one that had been dropped - so its parameter bound to nothing.

`box.value(of: 1)` returned `"from:nil"`. Not a trap, not a diagnostic: an answer.
Pulse drew a week of bars reading 0, 0, 0, 0, 0, 0, 0 and reported no problems.

That is the one failure mode this product cannot have. Everything else rests on the
preview being an honest rehearsal of what Xcode will compile, and a wrong number with a
clean Problems pane is indistinguishable from a right one until it reaches a Mac.

A member key carries its argument labels now, and the call site picks the overload
whose labels it wrote. Where they match nothing the first declaration still wins, which
is what the lookup did before and what a trailing closure needs - `sheet(isPresented:)`
written the way everybody writes it arrives with no label at all.

Parameter *types* are the other half of Swift's rule, and since the study build they are
modelled too. The key carries them, so `f(_ x: Int)` and `f(_ x: String)` are both
kept, and top-level and local functions are kept as a set rather than the last one
written. A call runs the declaration its arguments' values suit best: a whole number an
`Int`, text a `String`, a project type its own, anything a generic. Where values can't
tell two apart, such as `Double` and `CGFloat`, the first runs and the checker warns at
the second. A type's own method is also found before a top-level function of the same
name, which used to shadow it.

Pinned by `packages/swift-runtime/src/overloads.test.ts` and the overload tests in
`tests/study-regressions.test.ts`.

### 11.2 - properties answered a call

`var spent: Double` and `func spent(on: Category) -> Double` are two members in Swift.
Here the general lookup answered properties before methods, which is right for a read
and wrong for a call: `spent(on: .food)` found the `Double` and tried to call it, and
the unqualified form inside the type failed the same way one level deeper.

Calls ask for a method specifically now, before the property lookup runs. Reads are
untouched.

### 11.3 - the binding half of `@ObservedObject`

`Slider(value: $ledger.monthlyBudget)` trapped with "Value of type 'Binding' has no
member 'monthlyBudget'". SwiftUI spells this as `@dynamicMemberLookup` on `Binding` and
on the wrapper an observed object projects, and it is how a large share of real bindings
are written - a control writing into a model without mirroring the value into a `@State`
and copying it back.

The mechanism was already there: a projection is a reference to storage, so a member of
one is a reference to a field of that storage. The write-back is the part that had to be
right - a class is a reference and is already changed, a struct is a value and has to be
pushed back through the outer projection or the change lands on a copy.

### 11.4 - the flagship template did not compile

Found while checking what the new templates had to match. `Trailhead` carried two type
errors that Xcode rejects and an untyped interpreter cannot see:

- `@Published var savedIDs = [2]` is `[Int]`, and `Trail.id` is a `UUID`. Every
  `savedIDs.contains(trail.id)` was a type error; here it silently answered false, so
  the Saved tab showed its empty state and the Save button never appeared to do
  anything.
- `NavigationLink(value: trail)` and `.navigationDestination(for: Trail.self)` both
  require `Trail: Hashable`, and `Trail` declared only `Identifiable`. Swift synthesises
  that conformance, but only for a type that asks for it.

A template is a promise that this is what the tool can do, and an exported project Xcode
refuses to open is the loudest possible way to break the promise the whole architecture
exists to keep. The store is keyed by name now and `Trail` declares `Hashable`. The
three new templates declare it too, and their ids and their collections are the same
type.

Nothing in the suite would have caught either, because the gate runs the *interpreter*
and the interpreter is untyped by design. That is the other half of 11.8.

### 11.5 - a gap the matrix had no row for, and now has a row and an implementation

`struct Arc: Shape { func path(in rect: CGRect) -> Path }` parsed, and `.stroke` on it
answered "Value of type 'Arc' has no member 'stroke'". Custom shapes are everywhere in
real SwiftUI, and the matrix listed `Path`, the built-in shapes and custom
`ViewModifier` while saying nothing about this one - which by the matrix's own rule is
indistinguishable from a bug.

The reason it looked hard is that a shape has to be handed the rect it is about to be
laid out in, and layout has not run yet. That is the same ordering problem
`GeometryReader` has, and the answer already in the codebase works here too: the size
measured last pass, with the pipeline running a second one when the guess was wrong. A
shape becomes a greedy container holding the `Path` it drew, which is what a shape is.

The modifiers split in two, and getting that right is most of the work: `.fill`,
`.stroke` and `.trim` are the shape's own and go on the path, while `.frame` and the
rest are view modifiers and go on the box - or `.frame(width: 160)` would leave the
shape greedy and the ring would fill the screen.

`CGRect` needed `minX`, `midY` and the rest while this was going in. They are derived
rather than stored, as Swift derives them; without them every custom shape reported no
such member on the first line of its `path(in:)`.

### 11.6 - the templates were 7% of the client bundle

`npm run budget` reported 424 KB of a 450 KB budget, and the template corpus was about
31 KB gzipped of it - all in the initial chunk, because `store.ts` imported
`createDefaultProject` from a package index that re-exported every template's source.

The metadata and the Swift are separate modules now. `catalog.ts` has what the sheet
needs to *draw* the gallery - name, kind, tagline, description, file paths - and is
about a kilobyte; `@studio/project-model/templates` has the sources and is imported
dynamically, by `applyTemplate` and by the one path that lays down a starter project.
`catalog.test.ts` asserts the two lists still agree, so a template added to one and
forgotten in the other fails rather than half-existing.

`isPristine` was what made this more than a `dynamic import`: it compared the project
against every template's text, so the sheet could not open without the whole corpus.
The project records a fingerprint of what it was created with instead. That is the
persisted field the first implementation avoided, and it earns its place now: it is
twelve characters, it survives a share link (absent, so the confirmation asks - the
conservative direction), and it keeps the property that mattered, which is that a
project edited and undone back to the original still counts as untouched.

**The measurement moved in the other direction, and that turned out to be the finding.**
The first paint dropped by 21 KB and the *total* rose by 3, because a split costs
overhead - so the only gate in the build got very slightly worse when the code got
better, and nothing in CI could tell that apart from a regression. The budget check
gates the largest chunk as well now. Turbopack emits no per-route manifest and the
framework's own entry measures React rather than the studio, so the biggest chunk is
the honest proxy: it is the studio, it is on the critical path, and it is exactly where
a careless static import lands.

### 11.7 - the share limit was capping the gallery

Not the coverage matrix, which is what the templates doc said. `share.test.ts` required
every template inside 80% of `MAX_SHARE_LENGTH`; Trailhead sat at 98% of that and
`Kitchen` was cut four separate times to get under it - two recipes and most of the doc
comments. None of those cuts made the template better.

"Room left to edit it" is a different number for the two kinds, and conflating them was
the error. You edit a one-file template by writing more of it, so headroom there means
doubling room; you edit an eight-file app by changing a screen. The hard limit is
unchanged and applies to both - past `MAX_SHARE_LENGTH` there is no link at all - and
the headroom is now 50% for a feature template and 8% for an app one.

### 11.8 - the gate reaches past the first screen

`tests/templates.test.ts` measured the *root*. For a one-file template that is the whole
template; for an eight-file app it was the first screen, with every detail view, sheet
and non-first tab uncovered.

It presses things now: depth-first from the root, at most three deep and twenty screens,
coming back through the navigation bar's own back button, running the same assertions -
no placeholders, finite geometry inside the screen, readable text - on everything it
reaches. It runs in dark mode, because that is the harder appearance and the other
checks do not depend on the palette.

It found two defects on its first run. One was in `Trailhead`: the route list printed
the step's `id` where its number belonged, and `id` had become a `UUID` - so three lines
of the detail screen read as 36-character hex strings. It had shipped, and every gate
was green, because no test had ever pushed that screen. The other is 12.3.

### 11.9 - Open reads what Export writes

The Open pane took loose `.swift` files; Export wrote a `.zip`. The round trip the whole
product is built around therefore had "unzip it yourself" in the middle of it.

`readProjectArchive` lives in the exporter, where `fflate` already is, and is imported
on demand so nothing new reaches the initial bundle. The four formats nest sources three
different ways and the archive adds a root folder, so the wrapper is peeled rather than
stripped in a fixed order: `App/App/`, `App/Sources/App/`, `App/Sources/`. A test
round-trips all four and asserts the user's bytes come back unchanged.

An archive is a stranger's bytes, so entry names never become paths: the count and the
total size are capped before anything is decoded, a path that climbs out keeps only its
name, and the project model normalises everything again afterwards.

### 11.10 - projects have their own ids, and a list

`DEFAULT_PROJECT_ID` was the string `counter-app`, and every project the studio ever
held was written to it.

Each one gets its own id now, the welcome sheet's Open pane is the list of them, and
the old key is read on startup so an install from before this still finds its work. The
rule for what is kept is the one the confirmation already implies: **a project you
edited is kept when you start another; one you never touched is not.** A template can be
recreated in two clicks, and keeping one per click would fill the list with things
nobody chose to keep.

Deleting is the one action in the sheet that destroys something and makes nothing, so
it asks first, and it refuses the project that is open - there would be nothing to show
afterwards, and the next autosave would write it straight back.

Closing this uncovered 12.8 underneath it.

## Phase 12 - What writing an app, rather than reading the matrix, found

Phase 11 closed by writing three templates. This one closed it the rest of the way and
then kept going in the same direction: sitting down to write the Swift a real app is
made of - a `@ViewBuilder` helper, a switch over an enum with a payload, a tally built
with `reduce(into:)` - and running it.

Seven defects, and the number that matters is this: **three of them were silent.** The
screen was empty or the figure was wrong, and the Problems pane said "No problems."
None of the seven is exotic and none was reachable by probing the coverage matrix,
because the matrix already claimed all seven.

| # | Item | State |
| --- | --- | --- |
| 12.1 | A `@ViewBuilder` helper of more than one statement drew nothing | ✅ |
| 12.2 | A contextual enum case dropped its associated values | ✅ |
| 12.3 | `@EnvironmentObject` was empty on any deferred screen | ✅ |
| 12.4 | A `Group` carrying a modifier drew a placeholder | ✅ |
| 12.5 | `AnyView` drew nothing at all | ✅ |
| 12.6 | `reduce(into:)` refused to write to its own accumulator | ✅ |
| 12.7 | No `Dictionary(grouping:by:)` | ✅ |
| 12.8 | Two concurrent first loads laid down two starter projects | ✅ |

### 12.1 - the helper that drew nothing

Splitting a long body into `@ViewBuilder` helpers is the first thing anybody does to a
real view, and every form of it produced an empty screen with no diagnostic:

```swift
@ViewBuilder func row(_ on: Bool) -> some View {
    if on { Text("yes") } else { Text("no") }
}
```

A helper of a *single expression* worked, which is why it went unnoticed for so long:
the implicit return covers one expression and a builder body almost never is one.
Everything else fell off the end of the function and returned `Void`.

`runBody` now runs a body carrying the attribute as a builder, and hands more than one
value to the host to wrap - an implicit `Group`, which is what SwiftUI's `TupleView`
does here. The attribute is the flag, not the return type: a plain function returning
`some View` still runs its statements and returns what it returns.

### 12.2 - the payload that was dropped on the way in

```swift
describe(.done("hi"))       // "Cannot find 's' in scope"
describe(Load.done("hi"))   // fine
```

A contextual member is resolved against the *declared type* at the call site, which is
the right design - only that type can say which enum `.done` belongs to. But the token
standing in for it until then carried the name and not the arguments, so `coerceToEnum`
built a case with an empty payload. The `switch` matched `.done` and bound nothing, and
the failure named the user's variable rather than the thing that lost it.

The token carries its arguments now. The spelling that worked is the one nobody uses.

### 12.3 - the environment that stopped at the push

`@EnvironmentObject var store: Store` on a screen reached through
`navigationDestination` trapped with "Value of type 'Optional' has no member …". The
environment here is a lexical stack, and a deferred builder - a pushed destination, a
presented sheet, a toolbar - runs at resolve time, long after the expansion that
declared it has unwound.

It was written down as a known limitation, and the flagship template worked around it
by handing the store to the detail screen as an `@ObservedObject` parameter. That is
not what anyone writes, and the workaround is what made it look acceptable.

A deferred modifier captures the frame it was *written* in and restores it when it
runs, which is what SwiftUI does. Held by reference rather than copied: the stack
replaces its maps instead of mutating them, so a captured frame cannot be written
through.

### 12.4 and 12.5 - two views that are not containers

`Group { … }.font(.caption)` drew a grey placeholder - the modifier made the group
opaque to the layout, which then matched nothing in its switch. The fix is also the
correct semantics rather than an approximation of them: SwiftUI applies a `Group`'s
modifiers to *each child*, so they are pushed down and the group disappears.

`AnyView(Text("erased"))` drew nothing. Its content arrives as an argument rather than
as a trailing closure, and the layout flattens the view by walking its children.

Both were ✅ in the matrix.

### 12.6 and 12.7 - building a collection up

`reduce(into:)` is a different function wearing the same name: its closure takes the
accumulator `inout` and returns nothing, so reading the closure's *result* collected a
list of Voids and the first mutation failed with "'acc' is a 'let' constant". The
accumulator is handed over as a projection now - the mechanism `inout` and `@Binding`
already use - so `acc.append(x)` and `acc[k, default: 0] += 1` both land.

The second of those needed its own fix: a compound assignment reads before it writes,
and the plain getter answered nil for a key that was not there yet. The default belongs
to the read half.

`Dictionary(grouping:by:)` did not exist, which is the one-liner that turns a flat list
into sections.

### 12.8 - two starter projects, from one visit

Found while looking at what 11.10 had changed. React mounts an effect twice in
development; both loads found an empty database and both laid down a starter project.

It had been true for as long as the effect had, and was invisible because every project
was written to one fixed key - the second load overwrote the first. Giving projects
their own ids fixed one bug and uncovered another underneath it, which is the ordinary
way of things. The first load is now a promise held at module scope, so it happens once
however many times it is asked for.

### What this phase is actually evidence for

Phases 1-10 swept 870 checks against the matrix and found 231 defects. Phases 11 and 12
wrote four apps and found eleven more - including the worst one in the register, an
overload resolved to the wrong function - in a fraction of the time.

That is not an argument against sweeping. It is an argument about what a sweep can
see: it tests the claims, and every one of these lived in the space *between* two
claims that were each true on their own. `@ViewBuilder` is supported and multi-statement
bodies are supported; contextual members are supported and enum payloads are supported;
`Group` is supported and modifiers are supported. Each pair failed where they met.

The corpus rule from 10.6 said the gallery must be written the way people write. This
is the same rule one level up: the *tests* have to be written the way people write, and
the cheapest way to do that is to write an app and see what happens.

## Phase 13 - What writing seven sample screens found 🟡

Phases 11 and 12 wrote *apps*. This one wrote *screens*: seven samples aimed at the
chrome rather than at the language, each one rendered and then measured in the DOM
against what iOS draws. The finding is not that a feature is missing. It is that most
of them are there and a handful of shared details are wrong, and because they are
shared, one wrong detail is visible on every screen at once.

Three of these produce a *blank preview* from ordinary Swift, which is the failure
Phase 3 exists to prevent arriving from a new direction.

| # | Item | State |
| --- | --- | --- |
| 13.1 | `.red.opacity(0.5)` and `.title.bold()` trap and blank the preview | ✅ |
| 13.2 | A progress bar fills from its centre | ✅ |
| 13.3 | `.presentationDetents` is read off the presenting view | ✅ |
| 13.4 | One unknown view name blanks the screen | ✅ |
| 13.5 | `ButtonRole` does not exist | ✅ |
| 13.6 | A button's label is never tinted | ✅ |
| 13.7 | Every label on screen is 15% transparent | ✅ |
| 13.8 | `.tint` as a shape style is the label colour | ✅ |
| 13.9 | An alert is not built like an alert | ✅ |
| 13.10 | The segmented control has no shadow and no dividers | ✅ |
| 13.11 | The bars are opaque | ⬜ |
| 13.12 | An indeterminate `ProgressView` is a filled circle | ✅ |
| 13.13 | The search field has no magnifier | ✅ |
| 13.14 | Grouped sections touch each other | ✅ |
| 13.15 | An unknown style token is a silent no-op | ✅ |
| 13.16 | The symbol table is 160 names | 🟡 |
| 13.17 | iOS 26 is absent, which is a decision rather than a defect | ⬜ |

### 13.1 - the shorthand everybody writes

```swift
.foregroundStyle(.red.opacity(0.5))            // trap
.shadow(color: .black.opacity(0.2), radius: 4) // trap
.fill(.blue.gradient)                          // trap
Color.red.opacity(0.5)                         // fine
```

"Value of type 'Token' has no member 'opacity'". A leading-dot colour resolves to a
`Token` and stays one, so the bare form works and any member on it does not. The
explicit `Color.red` form is a real colour and behaves.

`.shadow(color: .black.opacity(0.1), radius: 8)` is close to boilerplate in a card
layout, and it does not fail quietly: the trap stops evaluation and the whole screen
falls back to the last good tree. A contextual member that is *used* rather than
passed needs the same resolution `Color.red` gets.

A token asked for a member `Color` answers is promoted to a colour and the member
re-dispatched, in both the call path and the read path. Narrow in both directions: only
the members `Color` itself has, and only names the palette knows, so
`.ultraThinMaterial.opacity(0.5)` is declined and still reports. Promoting whatever was
asked for whatever it was asked for would replace a value the user built with one the
host invented, which is the rule `coerceToType` next to it is already written to.

Checking the other contextual types was written down here as worth doing, and doing it
found `Font` with the identical bug: `.font(.title.bold())` and
`.font(.body.weight(.semibold))` trapped on "Value of type 'Token' has no member", and
those are about as ordinary a line of SwiftUI as exists. Fixed in the same shape, and
closed here rather than filed, because a trap that blanks the preview is what this phase
*is*.

A font comes back as a token again rather than as a font value, because that is how
fonts already travel: `.system(size:weight:)` is a token whose name carries its size and
weight, and `resolveFontArg` is the single place that reads one. A `style:` token is the
same idea keeping the style's *name*, so `.title.bold()` still leads at 34 - the value
the text-style table gives - rather than at the 36 a ratio recomputed from 28 rounds to.
Four members: `weight`, `bold`, `italic` and `monospaced`. `.monospacedDigit()` and
`.leading(_:)` still report, because answering them would mean handing back a font that
ignores what was asked.

The rest of the contextual types are genuinely fine: `.rect(cornerRadius:)` and
`.linear(duration:)` arrive through `callImplicitMember`, which sees the arguments, and
`.easeInOut` and `.opacity` become animations and transitions before they are ever plain
tokens. All four were run rather than reasoned about, which is how `Font` turned up.

Pinned by `tests/chrome-fidelity.test.ts`, "a contextual colour with a member on it" and
"a contextual text style with a face change on it".

### 13.2 - a progress bar fills from its centre

`ProgressView(value: 0.4)` draws grey, then blue, then grey. The fill is sized by
`{ kind: 'scale', x: fraction, y: 1 }` in `progressView` (`to-layout.ts`), and the
transform in `RenderTreeView.tsx` emits `scale(x, y)` with no `transform-origin`, so
CSS uses its default of `50% 50%`.

Two ways to fix it and they are not equivalent. Setting the origin to the leading edge
fixes the bar; giving the fill a real width fixes the bar *and* means the rounded cap
at its trailing end is not squashed horizontally, which the scale approach always gets
wrong. The width won, which needed one new layout modifier: `relativeWidth` takes its
fraction off the proposal during measurement and then does nothing at placement, because
by then the parent has already sized the rect. A proposal of `nil` or `'infinity'` is not
an amount and has no fraction to take, so the modifier stands aside - the same thing
`.frame(maxWidth:)` does when it is offered no width to bound.

The same code path draws `Gauge`, which is a progress view with a range, so it was fixed
by the same change and is pinned by its own test.

Pinned by `tests/chrome-fidelity.test.ts`, "a determinate progress bar".

### 13.3 - the detent is read off the wrong view

`detentOf` in `presentation.ts` looks for `presentationDetents` on the modifiers of
the view that carries `.sheet`. SwiftUI puts it on the sheet's *content*:

```swift
.sheet(isPresented: $show) {
    ComposeView().presentationDetents([.medium])
}
```

so it is never found and every sheet falls to the `0.92` default. A `.medium` sheet is
the commonest kind there is.

It reads the presented views now, through `collectModifier`, which searches the whole
subtree rather than only its root - a detent is a preference in SwiftUI and propagates up
from wherever inside the sheet it was written.

`presentationBackground`, `presentationCornerRadius` and `presentationDragIndicator` sit
on the same view and are still not recognised at all. They are 13.9's work, not this
one's: each needs something drawn, where the detent only needed looking in the right
place.

Pinned by `tests/chrome-fidelity.test.ts`, "a sheet detent".

### 13.4 - one unknown name takes the screen

`ContentUnavailableView` is iOS 17 and is not in the builtins, so it is
`unresolved_identifier`, which is blocking, which blanks the preview. `Table`, `Chart`
and `Map` are unknown in exactly the same way and draw a labelled placeholder instead.

The difference is only that those three are listed, and the list's own comment says
why that is the mechanism: "a name missing from here is treated as a typo, so the list
has to cover the real framework rather than only the parts already drawn". The fix is
therefore the list, not a heuristic. A heuristic that let any unknown capitalised name
through would also let `ConentView()` through, and a typo on a type name is exactly the
thing a checker is for.

Added: `ContentUnavailableView`, `PhaseAnimator`, `KeyframeAnimator`, `EditButton`,
`PasteButton`, `RenameButton`, `UnevenRoundedRectangle`, `AnyShape` and `PhotosPicker`
for iOS 16 and 17, and `Tab`, `TabSection` and `MeshGradient` for 18. Each one now warns
and draws the labelled placeholder that already existed.

`ContentUnavailableView` is drawn now rather than placeholdered, which came with the
coverage work in 13.16: an empty state is what a screen shows *before* it has anything
to show, so it is among the first things written and the first things looked at. The
static-member spelling, `ContentUnavailableView.search`, arrives carrying no arguments
at all - the initialisers all take at least a label - and stands for text iOS supplies
itself.

Pinned by `tests/chrome-fidelity.test.ts`, "a view name the preview does not draw".

### 13.5 to 13.8 - four colour bugs, visible everywhere

`grep -rn "destructive\|ButtonRole" packages/` returns one unrelated comment. The role
is parsed, accepted and dropped, so a destructive button is label-coloured in a form,
in an alert, in a confirmation dialog and in a swipe action.

`applyButtonStyle` returns the label untouched for anything that is not `.bordered` or
`.borderedProminent`, which is to say for `.automatic`, `.borderless` and `.plain`.
Measured on a toolbar item: `rgba(0, 0, 0, 0.85)`, where iOS draws `rgb(0, 122, 255)`.
`Link` is already tinted, so the mechanism exists and `Button` is not using it.

`label` and `primary` are `rgba(0, 0, 0, 0.85)` in `style.ts`, and
`rgba(255, 255, 255, 0.9)` in the dark table. `UIColor.label` is opaque in both
appearances. Every string in every preview is drawn 15% transparent, which is most of
why the result reads as washed out beside a device.

`.foregroundStyle(.tint)` resolves to the label colour rather than to the accent.

These four are one change in shape if not in code: what colour is a thing that has not
been given one. They are also the cheapest items in the register and the ones that
change the most screenshots.

All four are closed. `label` and `primary` are opaque in both appearances; the
*secondary* levels stay translucent, which is how they go on working over a coloured
background. `.tint` is in the palette as an alias of the accent, so it behaves like every
other colour name and `.tint.opacity(0.5)` works through 13.1's promotion. A button's
label takes the accent unless the style is `.plain`, which is the style that exists to
opt out, and `role: .destructive` makes that tint red - in a form, in a toolbar, in an
alert and in a swipe action, because all four go through the same `button()`.

`role: .cancel` is still drawn like any other button. Its only effect on iOS is the
semibold weight it gets *inside an alert*, which is a property of the alert's button
strip rather than of the button, and the strip is 13.9.

Pinned by `tests/chrome-fidelity.test.ts`, "what colour a label is when nothing has
said" and "a button label".

### 13.9 - an alert is not built like an alert

The box is right: 270pt wide, 14pt radius, a 32% backdrop. Measured and correct.

Inside it, the buttons were centred text in a stack. iOS builds them as full-width 44pt
rows divided by hairlines, with two sharing one row split by a vertical hairline,
`.cancel` leading and semibold and `.destructive` red.

All of that is built now, and the head and the strip are two blocks rather than one
padded stack - which is what made the old shape impossible, since the buttons sat
inside the title's padding with nothing between them. The panel is a material.

SwiftUI *reorders* the buttons, and the strip does too: the `.cancel` one goes leading
in a pair and last in a stack however it was declared. Written into the strip rather
than left to the caller, because the caller is the user's own source and SwiftUI does
not honour its order here either.

`role: .cancel`'s semibold weight is the one place the role changes a face rather than
a colour, and it belongs to the *alert* rather than to `Button` - a cancel button in a
form is not semibold. A flag set while the strip converts its buttons is how the one
tells the other.

The vertical rule between a pair cost a second pass: written as `maxHeight: .infinity`
it took every point the screen would give, and a two-button alert came out the height
of the phone. A fixed 44 is what a row is.

`confirmationDialog` is the same strip in a different frame and came out of the same
change.

Pinned by `tests/chrome-fidelity.test.ts`, "an alert".

### 13.10 - the segmented control

The structure was right - a track at radius 9, the selected segment a
`systemBackground` pill at radius 7, inset 2 - and everything that makes it read as a
control was missing: the shadow under the pill, the hairlines between adjacent
*unselected* segments, and the label size.

All three are in. The rules are drawn between segments rather than as a border on each,
which would double up between every pair and leave the outermost ones ruled against
nothing; the two beside the chosen pill are omitted, because its own edge already
separates them. The label is 13pt, semibold on the chosen one, where `subheadline` at
15 regular was two points large and made a three-segment control run wider than iOS
draws it.

The track is `tertiarySystemFill` now. It was `systemFill`, which is nearly twice as
dark - the difference between a control cut into a surface and a filled box sitting on
one. That fill and `quaternarySystemFill` were both missing from the palette, and the
search field was drawn at the same wrong value for the same reason.

Pinned by `tests/chrome-fidelity.test.ts`, "a segmented picker".

### 13.11 - the bars are opaque

**Open, and it is a bigger change than this entry first said.**

`navigationBar` fills with `screenBackground` and the tab bar does the same. On iOS both
are translucent materials, and a navigation bar grows a hairline when content scrolls
under it.

The obvious version of this fix is theatre. Content is laid out *below* the bars here -
the screen's content rect starts under the navigation bar and stops above the tab bar -
so a material over the bar would blur the bar's own background and change nothing that
anyone could see. And the hairline is not a constant: iOS shows it only when content is
actually underneath, which this preview cannot know, because the browser owns the scroll
offset. Drawing it always would be wrong at the top of every large-title screen, which
is the commonest state there is.

What it really needs is for content to compose *under* the bars, with the scroll view
carrying a top inset the size of the bar so that its resting position is unchanged. That
is a change to `screenToLayout` and to the scroll element, and it interacts with
`.safeAreaInset`, which is already built on the current arrangement.

The concrete symptom, which is worth more than "the bars are opaque": a screen whose
content carries a **gradient** background draws a flat 155-point strip above it with a
hard horizontal edge, because `screenBackground` only hoists a background that is a flat
opaque colour. Measured: the gradient starts at y=155 and the bar above it is white. On
iOS the scroll view runs to the top of the screen and the gradient runs under the bar.
That is the same defect as this one seen from the other side, and whichever is fixed
first should fix both.

### 13.12 and 13.13 - two controls drawn as something else

`ProgressView()` with no value was a filled `secondaryLabel` circle. The comment beside
it claimed "a dotted ring ... and the renderer spins it", and neither half was true of
what appeared.

It is the activity indicator now: eight tapered spokes fading round the circle, turning
once a second in eight discrete steps. `steps(8)` rather than a smooth rotation because
a real one *is* stepped - the lit spoke moves from one to the next - and a continuously
sweeping ring is the Android indicator, not this one. Carried as a `spinner` shape kind
rather than its own node kind, because it behaves like every other shape and differs
only in what the renderer puts inside the box.

`searchField` built a magnifying glass and a field side by side, and then
`withHitTarget` made the whole padded box one text field, so the renderer put an
`<input>` across all of it. Confirmed in the DOM: the input spanned the full 316 points
and there was no `<svg>` anywhere near the search area.

Two faults, and both are fixed. The hit target is scoped to the field rather than the
box, so the glass is painted beside it and the caret starts where iOS starts it; the
cost is the few points of grey under the glass no longer focusing the field, which is a
smaller lie than a search bar with no glass in it. And the icon is built through
`symbolImage` now, so the *name* reaches the renderer and the drawn magnifier is used -
built inline, it carried only the Unicode fallback. `Stepper` had the same inline
construction and so drew its minus and plus as characters; it goes through the same
helper.

Pinned by `tests/chrome-fidelity.test.ts`, "the search field".

### 13.14 - grouped sections touch

Measured on a two-section `Form`: the first card ran y 155 to 272 and the second
started at 272. Two headerless sections drew as one card with a hairline between them,
which says the opposite of what a section break says.

A section with a header supplies the gap through the header's own top padding, and one
without supplied nothing. There is 20 points between cards now, only where there is no
header and never above the first.

**The card inset is deliberately unchanged.** iOS insets a card further from the screen
edge than the 16 used here - 20 is the number usually quoted - but nobody has put this
beside a device and measured it, and it moves every grouped row on every screen. Left
at 16 with the reason written next to the constant, rather than changed from memory.

Pinned by `tests/chrome-fidelity.test.ts`, "inset grouped sections".

### 13.15 - an unknown style token is a silent no-op

`Button("x") { }.buttonStyle(.glass)` compiles clean and draws a bare label.
`buttonStyle` is a supported modifier, so the name passes, and `.glass` is not one of
the two styles `applyButtonStyle` handles, so nothing happens and nothing is said.

This is the exact failure the unimplemented-modifier machinery exists to prevent,
arriving one level down at the argument instead of at the name - the same observation
`BLEND_MODES` is in `builtins.ts` to handle, applied to one modifier and not to the
rest.

`STYLE_TOKENS` closes it for all ten of them, and `checkStyleToken` is `checkBlendMode`
generalised. A set per modifier of the tokens that are *drawn*, rather than a list of
the ones that fail, because the failing set grows every WWDC and the working set does
not; anything absent warns.

Deciding membership meant reading the converter token by token rather than transcribing
Apple's enums, and the rule is: a token is in when the converter takes a branch of its
own for it, or when it is a spelling of the default. That put `.pickerStyle(.navigationLink)`
and `.listStyle(.inset)` *out* - both fall through to a drawing that is not what they
mean - which is the same honesty the entry is about, found one level further in.

Only a literal `.token` is checked. A style held in a variable has no value here, and
guessing would warn on correct code.

Pinned by `tests/chrome-fidelity.test.ts`, "a style token the preview does not draw".

### 13.16 - the symbol table is 160 names

89 drawn as shapes, 71 more in the Unicode fallback, plus variant resolution. Two of
the seven samples hit a name in neither: `tray.fill` and `speaker.wave.3.fill` both
came out as an empty box, and an empty box in a mail list is not an approximation of
anything.

The honesty rule holds and the inspector still badges it, so this is 🟡 rather than
open. What would move it is frequency: the next hundred names by how often they appear
in real SwiftUI, not the next hundred alphabetically.

Eighteen of them are drawn now, chosen that way: `tray` and `tray.fill`, `paperclip`,
`shield`, `waveform`, `percent`, `thermometer`, `hourglass`, `alarm`, `iphone`, `tv`,
`keyboard`, `airplane`, `chart.pie`, `list.dash`, `text.aligncenter` and
`text.alignright`. Roughly 175 names in total.

Two of the eighteen were wrong on the first pass and only a rendered sheet showed it:
`airplane` came out as a bird and `chart.pie` as a blob with a wedge stuck to it. Path
data cannot be reviewed by reading it, which is the same lesson as the rest of the
phase one level down.

Still 🟡, and it will stay 🟡: the table is finite by construction and the honest
question is only which hundred names are next.

### 13.17 - iOS 26

The preview targets iOS 17 and the export agrees with it - `deploymentTarget: '17.0'`,
devices stopping at iPhone 16 Pro Max. iOS 18 is visually almost identical to 17 for
standard controls, so closing 13.5 through 13.14 *is* what "look like iOS 18" means.

iOS 26's Liquid Glass is a different design system, and none of it exists here:
`glassEffect`, `tabViewBottomAccessory`, `tabBarMinimizeBehavior`,
`backgroundExtensionEffect` and `scrollEdgeEffectStyle` warn and are ignored;
`GlassEffectContainer` and `ToolbarSpacer` are unresolved identifiers.

Listed rather than scheduled. Drawing Liquid Glass for a project whose deployment
target is 17.0 would be the preview telling a lie about the device, so if it is built
it is built as a second design system selected by the target, not as a replacement for
the first.

### Found while closing 13.1-13.8

**The host answered for names it did not own.** Adding `Tab` to the unimplemented-view
list broke a standing test, and the break was not the list's fault. `getMember` ends in
a run of branches keyed on a type's *name* - `Color`, `Animation`, `Material`, and any
view name at all - with nothing asking whether the project had declared that name
itself. `enum Tab { case home }` is how a `TabView` selection is written, and
`Tab.allCases` on one that did not declare `CaseIterable` answered with a **view**. The
failure surfaced two members later as "Value of type 'View' has no member 'count'",
which names neither the type nor the mistake.

It had been true for `Settings`, `Table`, `Marker` and `Annotation` for as long as those
names had been in the list, and `Tab` is simply the first of them an app is likely to
want. A `declaresType` hook answers it now, supplied beside `conformsTo`, and the host
declines any type the project declared. The checker had the same hole one level up:
`checkCallee` guarded against a *local* shadowing the name and not against a type, so
`Marker(...)` warned in a file whose second line said `struct Marker`.

**Two template tests were measuring the wrong thing**, and both only showed it once the
colours were right.

The contrast check asserted a ratio for every text run including empty ones, and
`Button("") { }` over a coloured swatch - which the Palette template does, because a
swatch is not a caption - failed the moment button labels became tinted. An empty run
has no legibility to assess, the same way a transparent one does not, and it is skipped
beside it.

The dark-mode check pooled every painted colour into one set per appearance and required
the two sets to differ. But a correct dark mode is very often a *swap*: black text on
white becomes white text on black, and the two appearances then hold exactly the same
two colours in exactly the opposite places. Making `label` opaque turned the Vectors
template into precisely that, and the test called it "does not adapt", which is the
reverse of the truth. It compares colours per node now, which is what it meant.

Neither is a weakened assertion. One dropped a check that could not mean anything; the
other replaced a proxy with the property it was standing in for.

### What this phase is evidence for

The same argument as 11 and 12, pointed at the chrome. Phases 1-10 swept the coverage
matrix, and the matrix is about *names*: is `Button` supported, is `.alert` supported,
is `ProgressView` supported. All three are, and all three are drawn wrong, because
what a sweep by name cannot see is the shared detail - a tint that is never applied, a
transform origin that was never set, a colour that is 15% transparent.

Seven screens found it in an afternoon, because a screen is where a shared detail
becomes visible. The measure for this phase is therefore not a count of names: it is a
screenshot of each sample beside the same code in a simulator.

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
