# Layers & Modifiers: designer editor plan

**Status:** proposal, 18 September 2026. Replaces the current Layers and Settings UI. The engine underneath does not change: Swift stays the source of truth, every edit is planned and checked in the worker, and undo covers everything.

**Who it's for:** designers who don't know Swift yet.

## TL;DR

- **Layers = views.** One tree, plain names. Drag, rename, wrap, duplicate.
- **Settings = Basics, then Modifiers.**
  - **Basics:** what the view *is*. Its text, image, label, spacing, what it does when tapped. Always on top. Can't be removed or reordered.
  - **Modifiers:** how it looks, as a **stack** like Blender's. Add from a list, each has its own settings, drag to reorder, switch on/off, remove.
- **The stack is the code.** Same modifiers, same order as the Swift file. Nothing hidden, nothing invented.
- **No Swift talk on screen.** No "Defined in…", no "How this changes Swift".

---

## 1. Why this model works

SwiftUI code is already a view followed by a list of modifiers:

```swift
VStack(alignment: .leading, spacing: 8) {   // the view + its basics
    Text("Today")
}
.padding(16)                                // modifier 1
.background(.white)                         // modifier 2
.clipShape(.rect(cornerRadius: 12))         // modifier 3
.shadow(radius: 8)                          // modifier 4
```

So the editor can mirror the code one-to-one:

| In the Swift file | In the editor |
|---|---|
| A view (`VStack`, `Text`, `Button`, `TaskRow`…) | A row in **Layers** |
| What's inside the view's `( )` | **Basics** |
| Each `.modifier()` after it, in order | One panel in the **modifier stack**, same order |

Blender works the same way: an object plus a stack of modifiers, applied top to bottom. In both, order changes the result.

### How order works

Each modifier **wraps everything above it**, like layers of gift wrap. The top of the stack is closest to the view.

```
The stack (top → bottom)      What you get (inside → outside)

1. Padding 16                 ┌ Shadow ───────────────────────┐
2. Background white           │┌ Corner radius ──────────────┐│
3. Corner radius 12           ││┌ Background ───────────────┐││
4. Shadow                     │││┌ Padding ────────────────┐│││
                              ││││   Column (the view)     ││││
                              │││└─────────────────────────┘│││
                              ││└───────────────────────────┘││
                              │└─────────────────────────────┘│
                              └───────────────────────────────┘
```

Swap 1 and 2 and the white only sits behind the content; the padding becomes empty space outside it. The editor helps with this in two ways: it places new modifiers in a sensible spot (§3.6), and it points out common surprises with a one-click fix (§3.7).

The layout engine already models it this way. See the comment on `LayoutModifier` in [`elements.ts`](../../packages/swiftui-layout/src/elements.ts).

---

## 2. Layers: views only

### 2.1 One tree

- Today there are two trees behind a **Design / Runtime detail** switch. Keep one: the tree built from the code. Delete the switch.
- The top level has two groups: **Screens** and **Components**.
- Repeated rows appear **once**, with a count: `Tasks ×12`. Selecting the row edits all rows, and the banner says so (§3.3).
- Views that live inside a modifier (a `.background { }` view, an `.overlay { }` badge, toolbar buttons) sit in a labeled **slot** under their view: *Background*, *Overlay*, *Toolbar*. That way every view is a layer, and the modifier panel links to it.
- Conditions read like sentences: *Shown when: isLoggedIn* / *Otherwise*.

### 2.2 Names and icons

| Swift | Layer name | Icon |
|---|---|---|
| `VStack` | Column | ⬍ |
| `HStack` | Row | ⬌ |
| `ZStack` | Layered | ⧉ |
| `ScrollView` | Scroll area | ↕ |
| `List` | List | ☰ |
| `ForEach` | Repeat (×N) | ↻ |
| `Text` | its text, e.g. *Welcome back* | T |
| `Image` | its image or symbol name | ▣ |
| `Button` | its title, e.g. *Save* | ▭ |
| Your own view, e.g. `TaskRow` | TaskRow | ◆ |
| `if` / `else` | Shown when… / Otherwise | ⎇ |

- A renamed layer shows its custom name. Names are saved in the studio metadata `labels` that already exists ([`studio-metadata.ts`](../../packages/project-model/src/studio-metadata.ts)). Renaming never changes Swift.
- The stack Layout control currently calls `ZStack` "Overlay". Rename it to **Layered**, because *Overlay* becomes a modifier.

### 2.3 Actions

| Action | Shortcut | What happens in Swift |
|---|---|---|
| Rename | Enter or double-click | Nothing (metadata only) |
| Duplicate | ⌘D | The view's code is copied right after it |
| Wrap in Column / Row / Layered / Scroll area | ⇧A | The view goes inside a new stack |
| Unwrap | ⌥⇧A | The stack is removed; its children stay |
| Hide / Show | ⌘H | The view is commented out / back in (exists) |
| Delete | ⌫ | The view is removed |
| Copy / Paste | ⌘C / ⌘V | Exists |
| Make component | ⌥⌘K | Extracted into its own file (exists as *Extract component*) |
| Move | Drag | Reorder or move into another container (exists in the runtime tree; bring it over) |

### 2.4 Mockup

```
SCREENS
▾ ▢ Home
  ▾ ⬍ Column
      T  Welcome back
    ▾ ⬍ Card
        T  Today
        ▭  Save
      ▸ Background                      slot
    ▾ ↻ Tasks                           ×12
        ◆ TaskRow
    ▾ ⎇ Shown when: tasks is empty
        T  No tasks yet
▸ ▢ Details
COMPONENTS
▸ ◆ TaskRow                             used 3×
```

---

## 3. Settings: Basics, then Modifiers

### 3.1 The panel

```
⬍ Card                                    Column  ⋯
──────────────────────────────────────────────────
BASICS
  Direction   [Column | Row | Layered]
  Spacing     [ 8 ] pt
  Alignment   [◧ ▢ ▢]  Leading
──────────────────────────────────────────────────
MODIFIERS                                  [+ Add]
  ⠿ ▸ Padding         16             ◉  ⋯  ×
  ⠿ ▸ Background      ■ White        ◉  ⋯  ×
  ⠿ ▾ Corner radius   12             ◉  ⋯  ×
        Radius   [ 12 ] pt
  ⠿ ▸ Shadow          Soft           ◉  ⋯  ×
──────────────────────────────────────────────────
FROM PARENT
  Font            Body      from Home   [Override]
```

`⠿` drag · `▸ ▾` open/close · `◉` on/off · `⋯` more · `×` remove

The right-side panel keeps its **Settings | Preview** tabs. This replaces what's inside Settings.

### 3.2 Header

- Icon, layer name, and the view type in grey (*Card · Column*).
- The `⋯` menu: **Copy modifiers**, **Paste modifiers**, **Show in code**, **Show Swift names**.
- **Show Swift names** (off by default) adds the Swift name next to each title, like *Padding · padding*, for designers who want to learn.

### 3.3 Scope banner

This is the only "where is this defined" message left, and it only shows when an edit reaches **more than the thing you clicked**:

- `▌Row design · changes apply to all 12 rows`
- `▌Inside TaskRow · changes apply to all 3 TaskRows   [Edit this one's inputs]`

Everywhere else there's no scope text at all.

### 3.4 Basics

Basics sit above the stack. They can't be removed or reordered. Three kinds of setting live here:

1. **The view's own inputs**, meaning what's inside its `( )`: text, image, label, spacing, alignment, what a button does.
2. **"Must be first" settings.** A few modifiers only work directly on one type and must come before every other modifier: an image's *Resizable*, a shape's *Fill* and *Stroke*. Keeping them in Basics means they're always written first, so they can't break.
3. **Screen settings.** Title and title size are technically modifiers on the screen's content, but designers think of them as part of the screen.

| View | Basics | Swift it edits |
|---|---|---|
| Text | Text | `Text("Hello")` |
| Image | Source (symbol or project image), Scaling (Original / Fit / Fill) | `Image(systemName: "star")` · `.resizable().scaledToFit()` |
| Button | Label, Icon, When tapped | `Button("Save") { … }` |
| Toggle | Label, Saves to | `Toggle("Wi-Fi", isOn: $wifi)` |
| Text field | Placeholder, Saves to | `TextField("Name", text: $name)` |
| Picker | Label, Options, Saves to | `Picker("Size", selection: $size) { … }` |
| Column / Row / Layered | Direction, Spacing, Alignment | `VStack(alignment: .leading, spacing: 8)` |
| Scroll area | Direction, Show scroll bar | `ScrollView(.horizontal, showsIndicators: false)` |
| List / Repeat | Content: fixed rows or data table | `List(tasks) { task in … }` |
| Shape | Kind, Corner radius, Fill, Stroke | `RoundedRectangle(cornerRadius: 12).fill(.blue)` |
| Spacer | Minimum size | `Spacer(minLength: 8)` |
| Screen | Title, Title size | `.navigationTitle("Home")` · `.navigationBarTitleDisplayMode(.inline)` |
| Component (e.g. TaskRow) | Its inputs | `TaskRow(title: "Buy milk", done: false)` |

### 3.5 The modifier stack

- **It mirrors the code exactly.** Every modifier in the file shows up, in the file's order. Nothing is hidden.
- **Panel header:** drag handle, open/close, name, a one-line summary (*16*, *White*, *Soft*), on/off, `⋯`, remove.
- **`⋯` menu:** Duplicate, Move to top, Move to bottom, Copy, Show in code.
- **On/off** comments the modifier out, the same trick *Hide* uses for views. The Swift still builds, and switching it back on restores the exact original text. Handy for before/after.
- **Multiples are fine.** Padding → Border → Padding → Border draws a double border.
- **Locked modifiers.** If a value is set by code (e.g. `.opacity(isOn ? 1 : 0)`) or the modifier isn't in the catalog yet, its panel shows the value and **set in code**. It can still be moved, switched off or removed when that's safe.
- **Your own modifiers.** A developer's custom modifier (e.g. `.cardStyle()`) shows as *Card style* with its own icon.
- **Empty stack:** *"No modifiers yet."* plus 3 suggested buttons for this view type.

### 3.6 Adding a modifier

```
Add modifier
  [ Search…                                  ]
  Suggested    Padding · Background · Corner radius

  LAYOUT       Padding         space around it
               Size            width and height
               Offset          nudge it
  LOOK         Background      color behind it
               Corner radius   round the corners
               Border          an outline
               Shadow          a drop shadow
               Opacity         see-through
  TEXT         Font · Text color · Bold · Italic · Max lines …
  MOVE         Rotation · Scale
  BEHAVIOR     Disabled · Tint · Button style · Accessibility
```

- Only modifiers that work on the selected view are listed. Suggestions depend on the type: Text → Font, Text color; Column → Padding, Background, Corner radius; Button → Button style, Tint.
- **Smart placement.** A new modifier goes into its slot, so the result matches what a designer expects:

| Slot | Modifiers |
|---|---|
| 1 Text | Font, Text color, Bold/Italic/Underline, Alignment, Max lines, Letter & line spacing |
| 2 Padding | Padding |
| 3 Size | Size |
| 4 Background | Background |
| 5 Clip | Corner radius |
| 6 Border | Border |
| 7 Shadow | Shadow |
| 8 Move | Offset, Rotation, Scale |
| 9 Effects | Opacity, Blur |
| 10 Behavior | Disabled, Tint, styles, Accessibility, Animation |

  - It goes after the last modifier in the same or an earlier slot.
  - If the stack has something the app doesn't recognize, the new modifier goes at the bottom instead.
  - The new panel flashes so you can see where it landed.
  - Existing modifiers are never moved.

### 3.7 Order tips

When one of these common surprises happens, a single line appears under the modifier. It has a **Fix** button and can be dismissed.

| When | Tip | Fix moves |
|---|---|---|
| Padding is below Background | The space is outside the background, like a margin. | Padding above Background |
| Corner radius is above Background | The background isn't rounded. | Corner radius below Background |
| Shadow is above Corner radius | The corners cut the shadow off. | Shadow below Corner radius |
| Size is below Background | The background only covers the content, not the full size. | Size above Background |

### 3.8 From parent

Some modifiers flow down to every child, like Font, Text color, Tint and Button style. A child lists what it inherits:

```
FROM PARENT
  Font         Headline     from Card     [Override]
  Text color   Secondary    from Home     [Override]
```

- **Override** adds that modifier to this view's stack with the same value, ready to edit.
- Clicking *from Card* selects Card.

### 3.9 Controls

| Setting | Control |
|---|---|
| Numbers (padding, radius, size) | Field with a unit. Drag the label to scrub. Arrow keys ±1, ⇧ ±10 |
| Opacity | 0–100% slider plus field |
| Angles | Field in degrees |
| Colors | Swatch → project colors first, then system colors, then custom. A custom color offers **Save as project color** (shared styles already exist) |
| Size | **Hug \| Fill \| Fixed** per axis, plus a value when Fixed |
| Alignment | 3×3 grid, with only the valid cells enabled |
| Padding | One value, expandable to each side |
| Presets (font style, button style) | Menu with a live preview |
| Bold, Italic, Disabled | Toggle |

Drags update the preview live and save once on release. History already supports this.

### 3.10 What's removed

- "Defined in …" under every control
- "How this changes Swift" under every control
- The "Source values and ownership" section and its Literal / Token / Data binding / Computed badges
- The owning struct name and **View source** button in the header (now **Show in code** in `⋯`)
- Empty "add" fields mixed in with real values (now the **+ Add** menu)
- The **Design / Runtime detail** switch in Layers
- "…edit their state, actions, and modifiers in Code" in the Add view palette

---

## 4. Modifier catalog v1

✅ = a writer already exists (it may need the new panel UI) · 🆕 = new writer

| Modifier | Category | Settings | Swift it writes | |
|---|---|---|---|---|
| Padding | Layout | All sides, or each side | `.padding(16)` · `.padding(.horizontal, 16)` · `.padding(EdgeInsets(…))` | ✅ (per-side 🆕) |
| Size | Layout | Width and height: Hug / Fill / Fixed, alignment | `.frame(width: 200)` · `.frame(maxWidth: .infinity)` | ✅ |
| Offset | Layout | X, Y | `.offset(x: 0, y: 4)` | 🆕 |
| Background | Look | Color, optional rounded shape | `.background(.blue)` · `.background(.blue, in: .rect(cornerRadius: 12))` | ✅ (shape 🆕) |
| Corner radius | Look | Radius | `.clipShape(.rect(cornerRadius: 12))` | ✅ reads `.cornerRadius` · 🆕 writes `clipShape` |
| Border | Look | Color, width, radius | `.overlay { RoundedRectangle(cornerRadius: 12).strokeBorder(.gray, lineWidth: 1) }` | 🆕 |
| Shadow | Look | Color, blur, X, Y | `.shadow(color: .black.opacity(0.15), radius: 8, x: 0, y: 4)` | 🆕 |
| Opacity | Effects | 0–100% | `.opacity(0.5)` | ✅ |
| Blur | Effects | Radius | `.blur(radius: 4)` | 🆕 |
| Font | Text | Style or custom size/weight/design | `.font(.headline)` · `.font(.system(size: 17, weight: .semibold))` | ✅ |
| Text color | Text | Color | `.foregroundStyle(.secondary)` | ✅ (switch output from `foregroundColor`) |
| Bold / Italic / Underline / Strikethrough | Text | On/off | `.bold()` · `.italic()` · `.underline()` · `.strikethrough()` | 🆕 |
| Alignment | Text | Left / Center / Right | `.multilineTextAlignment(.center)` | ✅ |
| Max lines | Text | Number | `.lineLimit(2)` | ✅ |
| Letter spacing | Text | Points | `.tracking(1)` | 🆕 |
| Line spacing | Text | Points | `.lineSpacing(4)` | 🆕 |
| Rotation | Move | Degrees | `.rotationEffect(.degrees(15))` | 🆕 |
| Scale | Move | % | `.scaleEffect(1.1)` | 🆕 |
| Tint | Behavior | Color | `.tint(.orange)` | 🆕 |
| Disabled | Behavior | On/off | `.disabled(true)` | 🆕 |
| Button style | Behavior | Preset | `.buttonStyle(.borderedProminent)` | 🆕 |
| List style | Behavior | Preset | `.listStyle(.insetGrouped)` | ✅ |
| Accessibility label | Behavior | Text | `.accessibilityLabel("Close")` | ✅ |

New modifiers write modern Swift for the project's target (default iOS 17). Existing code keeps its form, and editing a value changes only the value.

---

## 5. Where today's features go

Nothing is lost. It moves somewhere easier to find.

| Today | Moves to |
|---|---|
| Design properties list | Basics plus one panel per modifier |
| Source values and ownership | Removed. Code-set values show as **set in code** in their panel |
| Interactions editor (actions, state bindings) | Button **When tapped**, Toggle/Text field **Saves to** (Basics) |
| Transitions | An *Appear animation* modifier |
| List content, records, fields | List / Repeat Basics → data table |
| Component instance arguments | Component Basics (its inputs) |
| Edit shared definition | Select the component under **Components**, with the banner |
| Describe component properties | Component definition Basics (input labels, ranges) |
| Extract reusable component | Layers → **Make component** |
| Shared styles (update / link / override) | A linked chip on color, spacing and font controls |
| Bundled image picker | Image Basics → Source |
| Design / Runtime detail switch | Removed. Repeats show ×N |

---

## 6. Build notes (for developers)

### 6.1 Rules that don't change

- Swift is the source of truth, and the stack is re-read from the code after every edit.
- Every action is a planned edit through `planDesignEdit`: parsed, type-checked, and refused if it would break the build.
- Minimal patches only. Bytes outside the edited view never change.
- One action is one undo step.
- No source offsets in React.

### 6.2 Data model (sketch)

```ts
// packages/shared/src/authoring.ts: added to AuthoringNode
readonly settings?: ViewSettings

interface ViewSettings {
  readonly basics: readonly DesignControl[]
  readonly modifiers: readonly ModifierEntry[]   // exact source order
  readonly inherited: readonly InheritedValue[]
  readonly scope?: { readonly kind: 'template' | 'component'; readonly name: string; readonly count: number }
}

interface ModifierEntry {
  readonly id: string            // node fingerprint + chain index
  readonly type: string          // catalog id: 'padding', 'shadow', … or 'custom'
  readonly title: string         // 'Padding'
  readonly summary: string       // '16', shown when collapsed
  readonly index: number         // position in the chain
  readonly enabled: boolean      // false = switched off (commented out)
  readonly locked: boolean       // set in code, or not in the catalog
  readonly controls: readonly DesignControl[]
  readonly tip?: { readonly text: string; readonly from: number; readonly to: number }
  readonly source: SourceSpan
}

interface InheritedValue {
  readonly type: string          // 'font', 'foregroundStyle', …
  readonly title: string
  readonly value: string
  readonly fromNodeId: string
  readonly fromName: string
}
```

`DesignControl` gains a `role` that picks the widget (`number`, `percent`, `angle`, `color`, `size-mode`, `alignment`, `padding`, `toggle`, `menu`, `text`) and a `unit`. `scope` and `description` stop being shown.

### 6.3 New operations (all through `planDesignEdit`)

| Operation | Does |
|---|---|
| `modifier-add { type, index? }` | Inserts from the catalog. With no index it uses smart placement |
| `modifier-remove { index }` | Deletes it |
| `modifier-move { from, to }` | Reorders it |
| `modifier-toggle { index, enabled }` | Comments it out or restores it |
| `modifier-duplicate { index }` | Copies it directly below |
| `modifiers-paste { snippet }` | Pastes copied modifiers |
| `wrap { container }` / `unwrap` | Layers |
| `duplicate` | Layers (`copyView` + insert) |

Rename is metadata only (studio `labels`).

### 6.4 Rewriting the chain

- `viewCallChain()` already splits a view into its base plus modifiers. Each modifier's text is `text.slice(m.callee.base.span.end, m.span.end)`. The frame writer in [`design-controls.ts`](../../packages/swift-sema/src/design-controls.ts) already slices this way.
- Add, remove and move all rebuild the chain from those slices, one modifier per line at the view's indent.
- Switch off comments out the modifier's lines with a marker, the same way `hideView` hides a view ([`edits.ts`](../../packages/swift-syntax/src/edits.ts)).
- Refuse, with a plain-English message, when a comment sits between modifiers or when the checker reports a new error. For example, moving `.resizable()` after `.frame()` gives: *"Resizable has to stay first, so it lives in Basics."*
- Output modern Swift for the target: `.foregroundStyle`, `.clipShape(.rect(cornerRadius:))`, `.overlay { }`.
- Views inside `.background { }` / `.overlay { }` become **slot** nodes, the way Section headers and footers already do in `buildAuthoringModel` ([`authoring.ts`](../../packages/swift-sema/src/authoring.ts)). Today they're mixed in with the view's own children.

### 6.5 Where the code goes

| Area | Files |
|---|---|
| Modifier catalog (names, categories, slots, snippets, availability) | New `packages/shared/src/modifier-catalog.ts`, plus entries in `authoring-capabilities.ts` and `authoring-writers.ts` |
| Building Basics / stack / inherited per view | `packages/swift-sema/src/authoring.ts` (the chain is already walked there), `design-controls.ts` |
| Planning the new operations | `packages/swift-sema/src/design-edit.ts`, `authoring-features.ts` |
| Chain, wrap and unwrap writers | `packages/swift-syntax/src/edits.ts` |
| Settings UI | New `apps/web/components/settings/`: `SettingsPanel`, `BasicsSection`, `ModifierStack`, `ModifierPanel`, `AddModifierMenu` (reuses `Spotlight`, like `AddView`), `controls/`. Replaces `AuthoringInspector.tsx` and `AuthoringFeatures.tsx` |
| Layers UI | New `LayersPanel.tsx`, replacing `Layers.tsx` and `LogicalLayers.tsx`. Remove the switch in `Navigator.tsx` |
| Modifier highlight on canvas | Every modifier is already its own nested `ModifiedElement` in `swiftui-layout`. Pass each one's frame through the render tree to a `DevicePane.tsx` overlay |

### 6.6 Build order

| Step | What | Done when |
|---|---|---|
| 1 | **Settings shell.** Basics plus a read-only stack that mirrors the code. Existing controls move into their modifier panels. Noise removed, banner added, *Show Swift names* added. | Every modifier in the test fixtures shows in source order. No "Defined in" or "How this changes Swift" anywhere. Existing authoring tests pass. |
| 2 | **Stack editing.** Add menu, remove, drag to move, on/off, duplicate, smart placement. | Do then undo returns the exact original text. Off then on returns the exact original text. Nothing outside the view changes. |
| 3 | **Real controls.** Swatches, drag-numbers, Hug/Fill/Fixed, alignment grid, per-side padding, %. | Every control works by mouse and keyboard. Drags save once. |
| 4 | **Catalog v1 and tips.** New modifiers, modern output, order tips. | Each new modifier has a capability entry, writer, and preservation and invalid-input tests (see [EXTENSION-GUIDE](EXTENSION-GUIDE.md)). |
| 5 | **Layers.** One tree, names, rename, slots, ×N, context menu, wrap/unwrap/duplicate. | The Design/Runtime switch is gone. Every layer action works from the tree. |
| 6 | **Canvas link.** Hovering a modifier lights up its box on the canvas. | Padding, Size, Background and Border boxes line up in the fixtures. |
| 7 | **Styles.** Copy/paste modifiers, and save a stack as a reusable style. | A saved style is real Swift (an `extension View` function) and appears under **My styles** in the Add menu. |

---

## 7. What "perfect" means

- [ ] No Swift words on screen unless **Show Swift names** is on
- [ ] Every modifier in the code is in the stack, in the same order
- [ ] Every action is one undo step
- [ ] Nothing the editor writes breaks the build (checked before saving)
- [ ] Bytes outside the edited view never change
- [ ] Off → on and do → undo give back the exact original text
- [ ] Canvas, Layers and Settings always agree on the selection
- [ ] Everything works from the keyboard, with visible focus
- [ ] Error messages say what to do next, in plain words
- [ ] No new UI libraries (the bundle is at 549 of 600 KB)
- [ ] Selecting and editing feel instant (the existing ≤100 ms target)

## 8. Later

- Multi-select: edit the modifiers that several views share (Blender's *Copy to Selected*).
- Starter presets per view type: *Card*, *Pill button*, *Tag*.
- Hover cards that explain a modifier with a tiny before/after picture.
