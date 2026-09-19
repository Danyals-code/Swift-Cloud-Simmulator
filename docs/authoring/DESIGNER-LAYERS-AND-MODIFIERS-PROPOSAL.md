# Designer Layers and Modifiers — implementation and roadmap

19 September 2026 · The first implementation is in place: designer Layers and **Basics → Modifiers → Data → Behavior** in Settings, with a supported core modifier editor. This document describes the current product and the remaining work. The original `LAYERS-AND-MODIFIERS-PLAN.md` remains an unchanged reference.

## Current experience

**Select a view in Layers, edit its content in Basics, and style it with modifier cards.** Data and actions belong to the selected view’s Settings. A list of task records is edited in Data; a Swift `.task` or a tap action belongs in Behavior. Neither becomes a separate visual layer.

Settings keeps the existing Preview tab separate. The selected view has a friendly name, a source-reveal button, and breadcrumbs. A concise scope message identifies row designs and shared preview instances. The previous “Defined in…” and “How this changes Swift” helper text has been removed.

| Settings section | Current contents |
| --- | --- |
| Basics | Supported text and image inputs, control labels, container spacing/alignment, component arguments, and explicit access to shared component or row design |
| Modifiers | Source-backed cards for visual modifiers, their supported controls, and Add modifier |
| Data | List/Repeat records, record fields, connected row fields, collection setup, and access to the row design |
| Behavior | Supported action and binding editors, transitions, and existing lifecycle/interaction/navigation/presentation modifier cards |
| Optional details | Shared styles and Code details, including existing component-extraction tools |

Only applicable sections appear. Preview records and app initial data remain separate choices. Changing app initial data writes Swift; a preview scenario changes its saved preview inputs. Numeric drafts can pass through empty or partial values, and validation precedes a source commit. Record forms validate on Apply.

## Layers now

The primary hierarchy uses **Column**, **Row**, **Stack**, **Text**, **Image**, **Button**, **List**, and **Repeat** labels where applicable. Visible text labels help identify views. Screens appear first; reusable definitions appear under a collapsible Components group.

A repeated collection has one row design, with an explicit shared editing context. Component instances and their shared definitions remain distinct. Selecting a canvas instance reveals its source path. Search matches displayed labels and tolerates surrounding whitespace and case differences.

Conditions expose their source content, including Otherwise and switch cases. Content absent from the current runtime result is marked **Not shown**; selecting it does not change the running app’s state. Known view-containing modifiers expose named content slots. Scalar background colors remain modifier settings, and action closures are not traversed as visual children.

The tree provides keyboard navigation, selection reveal, move up/down, supported drag placement, hide/restore, and delete through the existing source planners. Invalid structural changes are refused. Hidden views have restoration rows. **Runtime detail** remains available under Developer inspection.

This release does not claim a complete new suite of layer actions: custom layer naming, a dedicated layer-duplicate action, richer wrapping tools, and more flexible reparenting remain follow-up work.

## Modifier editing now

Each source modifier occurrence has its own descriptor, including repeated and custom modifiers. Visual cards retain their source order; behavior cards are displayed under Behavior while keeping their original position in the underlying chain. Splitting their presentation never silently reorders Swift.

The searchable Add modifier list currently contains eight entries:

| Entry | Initial Swift form |
| --- | --- |
| Padding | `.padding(16)` |
| Size | `.frame(width: 100, height: 100)` |
| Font | `.font(.system(size: 17))` |
| Text color | `.foregroundColor(Color.primary)` |
| Background | `.background(Color.blue)` |
| Corner radius | `.cornerRadius(8)` |
| Opacity | `.opacity(1)` |
| Max lines | `.lineLimit(3)` |

Add appends an explicit occurrence to the end of the chain, including when another modifier of that type already exists. Supported card controls edit that occurrence’s arguments. Existing frame sizing controls belong to their Size card. Component instances can receive visual modifiers without changing their shared definition.

Supported simple core entries have **Move up**, **Move down**, **Duplicate**, **Remove**, and drag reorder. Each operation has its own capability check. Reordering preserves the existing modifier slices; it does not reconstruct or normalize the entire chain. Moving Padding relative to Background changes both source and preview, with Undo available.

The following boundaries are deliberate:

- Custom modifiers, behaviors, image/shape operations, and view-content modifiers remain visible but structurally pinned. Supported argument controls can still be available.
- Reordering cannot cross a pinned entry. Unknown custom return types prevent catalog additions that cannot be validated safely.
- Comments within or immediately after a chain pin structural changes to preserve comment ownership. Supported value edits and safe append remain available.
- Computed or unsupported values keep their expressions and offer Code access. An evaluated preview value never authorizes replacing its source.
- Universal modifier on/off, presets, and insertion-gap controls are not part of the current UI. The planner supports validated explicit insertion points for future UI work.

## Source and validation contract

All changes use the existing worker planner, immutable project revisions, atomic transactions, and document history. React consumes descriptors and sends typed commands; it does not assemble Swift patches. Modifier identities distinguish duplicate occurrences and are validated together with the selected view’s source identity. Stale or invalid requests leave the project unchanged.

Regression coverage includes repeated occurrences, exact source preservation with Unicode and CRLF, comment restrictions, type-dependent boundaries, component-instance edits, stale identities, atomic commits, Undo/Redo, and source-to-preview compilation. An actual writer-generated fixture covering the eight additions and structural operations passed Apple Swift typechecking for an iOS 17 simulator target using SDK 27. This is fixture validation, not a claim that the browser can certify arbitrary Swift programs.

Browser acceptance covers selecting views, changing basic inputs, adding/editing/reordering/duplicating/removing modifier cards, checking the resulting Swift, and recovering with Undo. Data and Behavior must remain usable after their move into the new sections. Focus, invalid numeric drafts, repeated-row scope, and component-instance scope are part of these checks.

## Remaining roadmap

1. Broaden the safe modifier catalog using exact overload and deployment-target rules, with browser and native fixtures for each writer.
2. Add richer value controls, clearer linked/inherited styling, supported numeric scrubbing, and more useful compact summaries.
3. Design presets and explicit insertion-gap controls that show the exact source entries they will add.
4. Add reversible modifier disabling only with a versioned representation and tested restoration after intervening edits.
5. Complete the remaining layer actions and validate shared-component, row-design, and reparenting workflows with designers.

Keep modifier order explicit. Image resizing, shape operations, and view-producing modifiers can have type requirements; unsupported operations should remain preserved and understandable. Apple’s references explain the underlying order and type constraints: [Configuring views](https://developer.apple.com/documentation/swiftui/configuring-views) and [Image resizing](https://developer.apple.com/documentation/swiftui/image/resizable(capinsets:resizingmode:)).
