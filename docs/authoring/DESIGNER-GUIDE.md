# Designer workflow

Swift and bundled images are the app. Every design action writes one SwiftUI construct into those files: there is no intermediate format, and nothing is "generated later". States and layer labels belong to the editable document beside the source.

## The three levels

Design has one panel on the right, and it shows whatever is selected.

1. **App** — the app's name, its navigation, and the design tokens every screen reads. Click empty canvas, or the App row in the tree.
2. **Screen** — how the screen is reached, its title, values it overrides for everything inside it, and its states.
3. **View** — Basics, then the modifier stack, in the order the code runs.

The tree on the left shows the same app: the App, its Components, one lane per tab, the sheets, and screens nothing links to yet. Files appear in Code mode only.

## Tokens

Open **App → Design tokens**. A token is a Swift member in `DesignSystem/Tokens.swift`, so `space16` is `.space16` in the code and `space16` in the panel.

- Colours take a light and a dark value and are written to the asset catalog; spacing and corner radius are `CGFloat`; text styles and shadows carry their own values.
- Names follow one rule per kind: spacing starts with `space`, corner radius with `radius`. A name already in use is refused with a suggestion.
- Before a token is edited, the panel says how far the change reaches: "Used in 84 places across 14 screens."
- Any value field can take a token from its picker, or **Save as token** to make one from what is there. An existing global in the project appears as a token with **Move to Tokens.swift** when it can be moved safely.
- A screen can override a token for everything inside it; the override is marked in the Screen panel.

## The modifier stack

The stack is the code. Cards are listed in source order, top to bottom, and reordering one moves it in the file — `.padding()` then `.background()` colours the padding; the other way round colours only the text.

- **Add** offers a searchable list, grouped by what the modifier does. A new modifier lands where it belongs in the order rather than at the end.
- The switch on a card turns a modifier **off**: the line is commented out in place and restored exactly as written when it is switched back on.
- A chain that contains a comment somebody wrote, or a modifier the studio does not recognise, is left alone and says so.
- **Navigate to** is a card in the same stack: pick the screen, and pick how it opens — push, sheet, or full screen. Changing that later rewrites the view: a push is a `NavigationLink`, a sheet is a button that sets a value with a `.sheet` reading it, and switching between them carries the label and the modifiers across. A button that does more than open the screen is left alone and says so.

## The canvas

The canvas is laid out from the navigation, never by hand, so it always matches the code.

- One **lane per tab**, in tab order, with the tab's name and symbol in its header. A lane collapses to that header.
- **Columns** are navigation steps: a screen reached from the one to its left sits one column right. When a screen leads to several, the first stays in the row and each other one starts a **branch row** below.
- Arrows are labeled with how they navigate: solid for a push, dashed for a sheet or full-screen cover. A sheet opened from several screens is drawn once, with an arrow from each opener.
- **States** stack below a screen inside its tinted frame. Anything inside the frame is a state of that screen; anything outside it is a different screen. A frame shows "+2 states" until it is opened, and **Show all states** in the canvas heading opens every one.

A state is a set of preview inputs — no app data changes, and the screen's layout is shared by every state. Add one in **Screen → States**. A screen with nothing to switch yet gets its first switch from the same form: name the state "Loading" and the screen gains a `loading` value, off by default and on in that state, in one step you can undo. Use it in **Shown when**, or in any value field, to change what the screen shows.

## Components from copies

Copy freely, then promote one copy.

1. Select the view and open **Make component**. The studio looks for views with the same shape elsewhere in the project and lists them, pre-ticked; untick any you do not want.
2. Values the ticked copies disagree on become parameters, named after their role — `title`, `icon`, `action` — and you can rename them before anything is written.
3. Every ticked copy becomes a call to the new component in one undo step. The Main goes to `DesignSystem/Components/`.
4. Extra modifiers at the end of a copy's chain stay on the call, so `RowView(icon:title:).opacity(0.5)` keeps its own opacity.

Two views are copies only when their shape matches exactly: the same views nested the same way, the same modifiers in the same order, the same argument labels. Text, numbers, symbols, colours and actions are values and may differ. After the same view is pasted a third time, a dismissible hint offers to make it a component.

## Navigation and tabs

**App → Navigation** sets the shape: one screen, or tabs. Tabs are a list of rows — name, symbol, screen — written as `TabView` with one `.tabItem` per tab in `App/AppNavigation.swift`. Above five tabs the panel says what iPhone does with the rest. Tabs written in Swift in a way the studio cannot reproduce are shown read-only with **Open in Code**.

## Project shape

A project created here is laid out the way the panels expect:

```
App/           MyApp.swift, AppNavigation.swift
DesignSystem/  Tokens.swift, Components/
Features/      one folder per screen, each with its own #Preview
```

New screens get their own folder under `Features/`; components go to `DesignSystem/Components/`; tokens go to `DesignSystem/Tokens.swift`. An imported project keeps its own layout and is edited where it stands. Code the studio does not rewrite — custom expressions, unsupported constructs — appears as a locked block with **Open in Code**; it still runs and still draws.

## Images

Open **App → Images**.

- Import PNG or JPEG files. Add an Image from the Add palette, select it, and choose its **Bundled image**. This can replace an existing system symbol.
- Each image has a stable ID, name, and 1×/2×/3× pixel scale. Its optional dark variant must have the same pixel dimensions as the default image.
- Rename updates supported literal `Image`/`Label` references in the same undo step. Duplicate requires a new name. A referenced image needs an explicit replacement before deletion. Dynamic names or custom bundles require a code review.

Limits: 64 images; 4 MB per variant; 32 MB compressed image bytes and 16 megapixels decoded across the project. Each variant is limited to 4096 pixels per side and 4 megapixels. PNGs must be non-interlaced; orientation-changing JPEGs must be saved upright first. Names are checked for unsafe paths and case/Unicode collisions. Colour sets are limited to 256.

## Save, hand off, and return

**Save editable** downloads a `.swiftstudio.zip` containing Swift, images, colour sets, app settings, and versioned designer metadata. Local autosave is convenient; the archive is the portable copy. Share links are for projects without image resources that fit the URL limit.

**Export** retains four native formats. Swift bytes are preserved. Xcode and XcodeGen app exports place named images and colour sets in the main asset catalog. Swift package resources use a module resource bundle; package consumers must use that bundle or integrate the catalog into their host app. See [Apple's resource guide](https://developer.apple.com/documentation/xcode/bundling-resources-with-a-swift-package).

To return from a developer handoff:

1. Keep `.swiftstudio/project.json` in the exported archive and edit the actual Swift files.
2. Open the ZIP through **Projects → Choose files**.
3. Review the source versions. Matching project IDs enable a three-way merge; matching names alone never do.
4. Resolve every conflicting source/configuration/resource choice, then apply. Unresolved references to removed images block the merge. **Open as separate copy** keeps the current project independent.
5. Continue visual editing of supported source. Renamed fields/components and custom code are retained. Old metadata descriptions and states remain subject to their existing signature checks.

Removing `studio.json` does not change executable Swift or image bytes. A ZIP without the handoff manifest opens as a new source project; it cannot claim the old project's identity. Source bundles can include universal PNG/JPEG image sets at one pixel scale. Unsupported catalogs are rejected rather than silently discarded.

## Preview limits

The browser interprets a SwiftUI subset. Symbols, materials, fonts, color management, scrolling, and motion may differ from native SwiftUI. A successful export or browser test does not certify arbitrary Swift or native visual parity. Build and review the exported app on the supported Apple host before shipping.
