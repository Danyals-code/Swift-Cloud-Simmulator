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
  background: 'Background', overlay: 'Overlay', toolbar: 'Toolbar', sheet: 'Sheet', fullScreenCover: 'Full screen cover',
  navigationDestination: 'Destination', safeAreaInset: 'Safe area inset', alert: 'Alert', confirmationDialog: 'Confirmation dialog',
}

/**
 * The parts of an alert or a confirmation dialog besides its title, each a slot within its
 * own (Wave 3b): by the argument label that writes it, `trailing` for the closure after the
 * parentheses, which is its actions.
 */
export const PRESENTATION_PARTS: Readonly<Record<string, string>> = { trailing: 'Actions', actions: 'Actions', message: 'Message' }

/** Every slot name a view's content can be listed under besides its own: its parts' and its modifiers'. */
export const CONTENT_SLOT_NAMES: ReadonlySet<string> = new Set([...Object.values(MODIFIER_SLOTS), ...Object.values(PRESENTATION_PARTS), ...Object.values(VIEW_PARTS).flatMap(parts => Object.values(parts.slots))])

/** The views the preview draws `label:` and `icon:` views of as layers of their own (`drawnAsLayers`). */
export const LAYERED_LABEL_VIEWS: ReadonlySet<string> = new Set(Object.entries(VIEW_PARTS).flatMap(([name, parts]) => parts.drawnAsLayers ? [name] : []))
