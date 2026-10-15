import type { AuthoringNode } from './authoring'
import type { SourceSpan } from './source'

/**
 * Where a view's content goes besides its own: the slots Design lists it in. The authoring
 * model names each slot from here, the preview draws the parts it keeps as arguments from
 * here, and the panels tell a slot from the view's own content by these names.
 */

/** The parts a SwiftUI view is drawn with besides its own content (Wave 3a). */
export interface ViewParts {
  /** Each part's slot, by the argument label that writes it; `trailing` for the closure after the parentheses. */
  readonly slots: Readonly<Record<string, string>>
  /** The trailing closure is the view's own content, as a Menu's items are, where no capability says so. */
  readonly views?: true
  /**
   * The preview keeps its `label:` and `icon:` views among its arguments and draws each
   * as a layer of its own, under the part's own path, which a click on the canvas finds.
   */
  readonly drawnAsLayers?: true
}

export const VIEW_PARTS: Readonly<Record<string, ViewParts>> = {
  // `Button { … } label: { … }`: the authoring model reads the label as the Button's own views, as its action is no view.
  Button: { slots: { label: 'Label' }, drawnAsLayers: true },
  Section: { slots: { header: 'Header', footer: 'Footer' } },
  Toggle: { slots: { trailing: 'Label', label: 'Label' } },
  Stepper: { slots: { trailing: 'Label', label: 'Label' } },
  Slider: { slots: { trailing: 'Label', label: 'Label', minimumValueLabel: 'Minimum label', maximumValueLabel: 'Maximum label' } },
  Menu: { views: true, slots: { label: 'Label' }, drawnAsLayers: true },
  Label: { slots: { trailing: 'Title', title: 'Title', icon: 'Icon' }, drawnAsLayers: true },
  LabeledContent: { slots: { trailing: 'Content', content: 'Content', label: 'Label' }, drawnAsLayers: true },
  DisclosureGroup: { slots: { label: 'Label' }, drawnAsLayers: true },
  Picker: { slots: { label: 'Label' }, drawnAsLayers: true },
  GroupBox: { slots: { label: 'Label' }, drawnAsLayers: true },
  ContentUnavailableView: { slots: { trailing: 'Label', label: 'Label', description: 'Description', actions: 'Actions' } },
}

/** The slot a modifier gives the views it takes: `.overlay { … }` is the view's Overlay. */
export const MODIFIER_SLOTS: Readonly<Record<string, string>> = {
  background: 'Background', overlay: 'Overlay', toolbar: 'Toolbar', sheet: 'Sheet', fullScreenCover: 'Full screen cover', popover: 'Popover',
  navigationDestination: 'Destination', safeAreaInset: 'Safe area inset', alert: 'Alert', confirmationDialog: 'Confirmation dialog',
  swipeActions: 'Swipe actions', contextMenu: 'Context menu',
}

/** A toolbar's items that hold views and take a `placement:` (Wave 4b). */
export const TOOLBAR_ITEMS: ReadonlySet<string> = new Set(['ToolbarItem', 'ToolbarItemGroup'])
/** What a toolbar holds besides views (Wave 4b): its items, and iOS's own spacers, items and title menu. */
export const TOOLBAR_CONTENT: ReadonlySet<string> = new Set([...TOOLBAR_ITEMS, 'ToolbarSpacer', 'DefaultToolbarItem', 'ToolbarTitleMenu'])

/**
 * What SwiftUI reads as a view's content but is no view: a scene, a tab, a toolbar's content,
 * a grid's column. It takes none of a view's settings, its layer, a tap, a modifier or being
 * made a component, as each would write a modifier or a wrapper that doesn't build (Wave 4b).
 */
const NON_VIEWS: ReadonlySet<string> = new Set(['WindowGroup', 'Tab', 'GridItem', ...TOOLBAR_CONTENT])
/** Whether `node` is SwiftUI's own content that is no view (`NON_VIEWS`). */
export const isNonView = (node: Pick<AuthoringNode, 'kind' | 'name'>): boolean => node.kind === 'view' && NON_VIEWS.has(node.name)

/** The slots of what a sheet, a popover or a full-screen cover shows, a page of its own over the screen that opens it (Wave 4b). */
export const PRESENTED_SLOTS: ReadonlySet<string> = new Set([MODIFIER_SLOTS.sheet!, MODIFIER_SLOTS.popover!, MODIFIER_SLOTS.fullScreenCover!])
/** The slots whose views draw on a page of their own, not on the screen they are written in: what it presents, pushes or alerts with (Wave 4b). */
export const PAGE_SLOTS: ReadonlySet<string> = new Set([...PRESENTED_SLOTS, MODIFIER_SLOTS.navigationDestination!, MODIFIER_SLOTS.alert!, MODIFIER_SLOTS.confirmationDialog!])

/**
 * The view a sheet, popover or full-screen cover page shows (Wave 4b), which carries its Sheet
 * settings (`presented`): the one view in the closure of the `.sheet(…)` that `source` ends
 * with, as a page's `source` does. That closure is the presented slot reaching furthest in
 * `source`, as one presented from inside it ends before it does. Undefined when it holds more
 * or less than one view.
 */
export function presentedRoot(nodes: readonly AuthoringNode[], source: SourceSpan): AuthoringNode | undefined {
  let slot: AuthoringNode | undefined
  for (const node of nodes) {
    const { file, start, end } = node.source
    if (node.kind === 'branch' && PRESENTED_SLOTS.has(node.name) && file === source.file && start >= source.start && end <= source.end && (!slot || end > slot.source.end || end === slot.source.end && start < slot.source.start)) slot = node
  }
  return slot && nodes.find(node => node.parentId === slot!.id && node.presented)
}

/** The slot of what a context menu shows lifted above the screen while it is open: its `preview:` (Wave 4a). */
export const CONTEXT_MENU_PREVIEW = 'Preview'

/**
 * The parts of an alert or a confirmation dialog besides its title, each a slot within its
 * own (Wave 3b): by the argument label that writes it, `trailing` for the closure after the
 * parentheses, which is its actions.
 */
export const PRESENTATION_PARTS: Readonly<Record<string, string>> = { trailing: 'Actions', actions: 'Actions', message: 'Message' }

/** Every slot name a view's content can be listed under besides its own: its parts' and its modifiers'. */
export const CONTENT_SLOT_NAMES: ReadonlySet<string> = new Set([...Object.values(MODIFIER_SLOTS), CONTEXT_MENU_PREVIEW, ...Object.values(PRESENTATION_PARTS), ...Object.values(VIEW_PARTS).flatMap(parts => Object.values(parts.slots))])

/** The views the preview draws `label:` and `icon:` views of as layers of their own (`drawnAsLayers`). */
export const LAYERED_LABEL_VIEWS: ReadonlySet<string> = new Set(Object.entries(VIEW_PARTS).flatMap(([name, parts]) => parts.drawnAsLayers ? [name] : []))
