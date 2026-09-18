# Designer workflow

Swift and bundled images are the app. The inspector edits those files directly; preview scenarios and layer labels belong to the editable document.

## Edit the right scope

1. Switch to **Design → Edit** and select a source layer.
2. Use **Settings** for content, layout, style, data, or behavior. The control states which source it changes.
3. A collection has one **Row template**. Enter it to change every row's design. Use **List content** to edit records.
4. Choose **Preview records only** for experiments. Choose **App initial data (Swift)** to change what the app starts with.
5. Component arguments affect one instance. **Edit shared definition** shows the source call sites affected by a shared edit.
6. Switch to **Live** to exercise actions. **Run** resets runtime state.

Computed values and unsupported interfaces remain in Swift. **View source** opens their owner. Undo and redo cover source, resource, and metadata transactions together.

## Images and shared styles

Open **Settings → Project resources**.

- Import PNG or JPEG files. Add an Image from the Add palette, select it, and choose its **Bundled image**. This can replace an existing system symbol.
- Each image has a stable ID, name, and 1×/2×/3× pixel scale. Its optional dark variant must have the same pixel dimensions as the default image.
- Rename updates supported literal `Image`/`Label` references in the same undo step. Duplicate requires a new name. A referenced image needs an explicit replacement before deletion. Dynamic names or custom bundles require a code review.
- Create a shared **Color**, **Spacing**, or **Text style**. The value is saved as a Swift declaration. Existing immutable global and static declarations also appear when their type and initializer are supported.
- A style property shows its linkage. **Update shared value** affects every listed reference; **Use selected shared style** links this source property; **Apply local override** changes this property only. All runtime instances of a row template still share that source.

Limits: 64 images; 4 MB per variant; 32 MB compressed image bytes and 16 megapixels decoded across the project. Each variant is limited to 4096 pixels per side and 4 megapixels. PNGs must be non-interlaced; orientation-changing JPEGs must be saved upright first. Names are checked for unsafe paths and case/Unicode collisions.

## Save, hand off, and return

**Save editable** downloads a `.swiftstudio.zip` containing Swift, images, app settings, and versioned designer metadata. Local autosave is convenient; the archive is the portable copy. Share links are for projects without image resources that fit the URL limit.

**Export** retains four native formats. Swift bytes are preserved. Xcode and XcodeGen app exports place named images in the main asset catalog. Swift package resources use a module resource bundle; package consumers must use that bundle or integrate the catalog into their host app. See [Apple's resource guide](https://developer.apple.com/documentation/xcode/bundling-resources-with-a-swift-package).

To return from a developer handoff:

1. Keep `.swiftstudio/project.json` in the exported archive and edit the actual Swift files.
2. Open the ZIP through **Projects → Choose files**.
3. Review the source versions. Matching project IDs enable a three-way merge; matching names alone never do.
4. Resolve every conflicting source/configuration/resource choice, then apply. Unresolved references to removed images block the merge. **Open as separate copy** keeps the current project independent.
5. Continue visual editing of supported source. Renamed fields/components and custom code are retained. Old metadata descriptions and scenarios remain subject to their existing signature checks.

Removing `studio.json` does not change executable Swift or image bytes. A ZIP without the handoff manifest opens as a new source project; it cannot claim the old project's identity. Source bundles can include universal PNG/JPEG image sets at one pixel scale. Unsupported catalogs are rejected rather than silently discarded.

## Preview limits

The browser interprets a SwiftUI subset. Symbols, materials, fonts, color management, scrolling, and motion may differ from native SwiftUI. A successful export or browser test does not certify arbitrary Swift or native visual parity. Build and review the exported app on the supported Apple host before shipping.
