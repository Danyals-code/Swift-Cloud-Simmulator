import type { LayerSetOperation } from './layer'
import type { ModifierOperation } from './authoring-modifiers'
import type { ResourceOperation } from './design-resources'
import type { SourceSpan } from './source'
import type { DesignControl } from './design-edit'
import type { ContainerLayout } from './layer-moves'
import type { ColorValue } from './layer'
import { nameInWords } from './render-tree'

export type DesignValue = string | number | boolean | null
export interface RecordField { readonly name: string; readonly type: 'String' | 'Int' | 'Double' | 'Bool'; readonly optional: boolean; readonly defaultValue?: DesignValue; readonly mutable?: boolean }
export type DesignRecord = Readonly<Record<string, DesignValue>>
export interface PreviewInput {
  readonly owner: string
  readonly name: string
  /** Signature protects fixtures from a changed declaration or record shape. */
  readonly signature: string
  readonly value: DesignValue | readonly DesignRecord[]
}
export interface PreviewScenario {
  readonly name: string
  readonly owner: string
  readonly hook: string
  readonly inputs?: readonly PreviewInput[]
}
/** Named instance property presets; applying one writes ordinary Swift arguments. */
export interface ComponentVariant {
  readonly owner: string
  readonly signature: string
  readonly name: string
  readonly values: readonly { readonly control: string; readonly value: string }[]
}
export interface ComponentDescription {
  readonly owner: string
  readonly signature?: string
  readonly properties: readonly { readonly name: string; readonly label: string; readonly description: string; readonly min?: number; readonly max?: number; readonly group?: string }[]
}
export interface CollectionSettings {
  readonly name: string
  readonly owner: string
  readonly signature: string
  readonly recordType: string
  readonly fields: readonly RecordField[]
  readonly records: readonly DesignRecord[]
  readonly binding: boolean
  readonly parameter: string
  readonly source: SourceSpan
  readonly mutable: boolean
  readonly templateId?: string
}
export interface ComponentSettings {
  readonly reusable: boolean
  readonly variantControls: readonly string[]
  readonly definitionId: string
  readonly signature: string
  readonly propertyNames: readonly string[]
  readonly callSites: readonly SourceSpan[]
  readonly controls: readonly DesignControl[]
  readonly descriptionStatus: string
}
export interface StateInput {
  readonly name: string
  readonly owner: string
  readonly signature: string
  readonly type: string
  readonly value: DesignValue
  readonly optional?: boolean
  readonly options?: readonly string[]
  readonly source: SourceSpan
  /** A value picked rather than typed: a list either empty or with its items, or an optional either nil or a sample (Wave 3b). */
  readonly choices?: readonly StateChoice[]
  /**
   * Where a value a condition of the screen reads is declared: on the screen, or on a model
   * it reads, as `model.isLoading`. A state holds it there from when it is shown until the
   * first touch in the preview, so code that runs as the screen appears, such as a model's
   * `load()`, can't replace it, and the touch acts on what the state drew.
   */
  readonly held?: { readonly type: string; readonly member: string }
  /** The states this value draws, named as a designer reads them: Loading, Empty, Error. */
  readonly states?: readonly SuggestedState[]
  /** What a value a condition reads holds, which says how its states set it: a list is empty or has its items. */
  readonly kind?: StateKind
  /**
   * A condition the screen draws whose value the preview can't set, and why. It is listed
   * so the panel can say so, and is never a value a state changes.
   */
  readonly problem?: string
}
/** A value a condition reads: a Bool, a number, a String, an optional, a list, or a case of a project enum. */
export type StateKind = 'flag' | 'scalar' | 'text' | 'optional' | 'list' | 'case'
/** One value a picked input can take, and the Swift a preview state puts in its place. */
export interface StateChoice {
  readonly value: string
  readonly label: string
  readonly swift: string
}
/** A state a branch of the screen's conditions draws, and the values that show it; or why it can't be shown. */
export interface SuggestedState {
  readonly name: string
  readonly inputs: readonly PreviewInput[]
  readonly problem?: string
}
export interface NavigationDestination {
  /** Original destination expression, including the route before parameter substitution. */
  readonly source?: SourceSpan
  readonly title: string
  readonly expression: string
  readonly viewName: string
  readonly requirements: readonly { readonly name: string; readonly type: string; readonly required: boolean }[]
  readonly available: boolean
  readonly reason?: string
}
export interface NavigationSettings {
  /** How the screen opens, when this site is a link or a presented screen. */
  readonly type?: 'push' | 'sheet' | 'cover'
  readonly destination: string
  readonly display: string
  readonly destinations: readonly NavigationDestination[]
  readonly editable: boolean
  readonly reason?: string
  readonly scope: 'link' | 'shared-route' | 'presentation'
  readonly scopeDescription: string
}
export interface BehaviorSettings {
  readonly dependencies?: readonly { readonly state: string; readonly nodeIds: readonly string[] }[]
  readonly states: readonly StateInput[]
  readonly collections: readonly CollectionSettings[]
  readonly actions: readonly string[]
  readonly destinations: readonly string[]
  readonly currentAction?: string
  /** A Button with a title, or with a label (D16), and one action closure: When tapped can set what it does. */
  readonly canConfigureAction: boolean
  /** A view When tapped can make tappable, by writing a Button or link around it (D16). */
  readonly canMakeTappable?: boolean
  /** The Button's title is plain text, which a switch can change while it is on. */
  readonly titled?: boolean
  /**
   * What a tap on the Button shows, when its action sets the value an alert or a dialog is
   * presented by (Wave 4a). `readOnly` says why When tapped can't write it back exactly, as
   * for a title with values in it or a text field among its buttons: it is then described for
   * display, its words as the code writes them, and Replace with an alert or options is refused.
   */
  readonly shows?: { readonly type: 'alert' | 'dialog'; readonly title: string; readonly message?: string; readonly actions: readonly AlertActionSpec[]; readonly readOnly?: string }
  /**
   * Whether an appear animation can play on the view: it comes and goes by an `if` or a
   * `switch` (which then needs a state to animate on), or as a row of a changing
   * collection. Otherwise, why not.
   */
  readonly appear?: { readonly by: 'branch' | 'row' } | { readonly problem: string }
  readonly binding?: {
    readonly label: string
    readonly type: string
    readonly current: string
    /** The name a new value for it takes: free on its screen, as the canvas names a control's value (D13). */
    readonly newName: string
  }
  /**
   * How the Button's action animates what it changes (Wave 5a): read when the action is
   * `withAnimation(…) { … }` and nothing else. Absent when it isn't animated.
   */
  readonly animation?: ReadAnimation
}
/**
 * The animation styles Animate this change offers (Wave 5a), with Apple's names: Smooth,
 * Snappy and Bouncy are springs, and Ease in and out and Linear take a duration.
 */
export type AnimationStyle = 'smooth' | 'snappy' | 'bouncy' | 'default' | 'easeInOut' | 'linear'
/** Each style in a designer's words, in the order the select lists them (Wave 5a). */
export const ANIMATION_STYLE_WORDS: Readonly<Record<AnimationStyle, string>> = { smooth: 'Smooth', snappy: 'Snappy', bouncy: 'Bouncy', default: 'Default', easeInOut: 'Ease in and out', linear: 'Linear' }
/** The styles, in the order the select lists them (Wave 5a). */
export const ANIMATION_STYLES = Object.keys(ANIMATION_STYLE_WORDS) as readonly AnimationStyle[]
/** Whether a style takes a duration (Wave 5a): Ease in and out and Linear do; the springs and Default don't. */
export const takesDuration = (style: AnimationStyle | null | undefined): boolean => style === 'easeInOut' || style === 'linear'
/** The duration in seconds a style that takes one starts at, and plays for when none is written: Apple's default (Wave 5a). */
export const DEFAULT_ANIMATION_DURATION = 0.35
/** An animation a tap action plays (Wave 5a): `withAnimation(.smooth) { … }`, or `.easeInOut(duration: 0.4)`. */
export interface ActionAnimation {
  readonly style: AnimationStyle
  /** In seconds, for Ease in and out and Linear; Apple's default, `DEFAULT_ANIMATION_DURATION`, when absent. */
  readonly duration?: number
}
/**
 * An action's animation as read (Wave 5a). `style` is null for one written in code that
 * Design doesn't name, `.spring(response: 0.4)`, which `written` shows as it is: it is kept
 * by Replace, and can be switched off or replaced by a style.
 */
export interface ReadAnimation {
  readonly style: AnimationStyle | null
  readonly duration?: number
  /** The animation as the code writes it, `.smooth` or `.spring(response: 0.4)`; empty for `withAnimation { … }`, which is Default. */
  readonly written: string
}
/**
 * What a Shown when asks of one value (Wave 5a). `input` is the value, as a screen's states
 * name it (`StateInput.name`): `showDetails`, `model.isLoading`, `items`, `selection`. `is` is
 * what it holds while the view shows: true or false for a Bool, a case's name for an enum,
 * `empty` or `items` for a list, `none` or `some` for an optional.
 */
export interface VisibilityWhen {
  readonly input: string
  readonly is: boolean | string
}
/** One choice of the Shown when select, as it lists it: "When Show details is on" (Wave 5a). */
export interface VisibilityOption {
  readonly when: VisibilityWhen
  readonly label: string
}
/** The name a new on/off switch of Shown when takes (Wave 5a), numbered past any the screen has: `isShown`, then `isShown2`. */
export const NEW_SWITCH_NAME = 'isShown'
/** The words Swift keeps for itself, and names a view has already, which no value Design names can take (Wave 5a). */
const RESERVED_NAMES: ReadonlySet<string> = new Set(['self', 'Self', 'body', 'init', 'deinit', 'class', 'struct', 'enum', 'var', 'let', 'func', 'if', 'else', 'return', 'true', 'false', 'nil', 'switch', 'case', 'default', 'in', 'for', 'while', 'import', 'some', 'any', 'Type', 'where', 'extension', 'protocol', 'private', 'public', 'static', 'repeat', 'try', 'throw', 'throws', 'async', 'await'])
/** Whether Design can name a value, a type or a screen `value` (Wave 5a): letters, digits and `_`, starting with no digit, up to 64 long, and no word Swift keeps. */
export function swiftIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(value) && !RESERVED_NAMES.has(value)
}
/**
 * When a view is shown (Wave 5a): always, or while an `if` around it holds. Every view a
 * statement of its own carries it, so Shown when can be set on any of them.
 */
export interface ViewVisibility {
  /** What shows it, when an `if` Design can write back says so; absent when it is always shown or `condition` says otherwise. */
  readonly when?: VisibilityWhen
  /** The condition as the code writes it, when the view is in an `if`: `showDetails`, `model.items.count > 3`. */
  readonly condition?: string
  /** The Shown when choices besides Always and "+ New on/off switch…", each value with its other side. */
  readonly options: readonly VisibilityOption[]
  /** Whether Shown when can be changed here; `problem` says why not. */
  readonly editable: boolean
  readonly problem?: string
  /** The name a new on/off switch for it takes, free on its screen. */
  readonly newName: string
  /**
   * The view is in a Main (Wave 5b): a new switch is an on/off property each copy sets,
   * `var isShown: Bool = true`, which Shown when offers as "+ New on/off property…".
   */
  readonly property?: true
  /** When it shows, in words: "Details is on", "Items is empty"; absent when the condition can't be said plainly. */
  readonly label?: string
  /** The other side of `label`, for "Hidden while Details is off". */
  readonly hiddenWhile?: string
  /**
   * The preview inputs that draw it, which Show it switches to: its own condition holding,
   * joined with the conditions around it, as a suggested state's are. Set for any view in an
   * `if` whose conditions the preview can set, editable or not; absent when it can't.
   */
  readonly shows?: readonly PreviewInput[]
}
/**
 * The ids of the Visibility group's controls (Wave 5a), which are `DesignControl`s on the view
 * and are set with the `property` operation as any control is:
 * - `transition`, a select: None, Fade, Slide, Scale, Move from edge, Push from edge (iOS 16), Blur (iOS 17);
 * - `edge`, a select for Move and Push from edge: top, bottom, leading, trailing;
 * - `fades`, a toggle: Fades too, `.combined(with: .opacity)`;
 * - `rollsDigits`, a toggle on a Text showing a number: `.contentTransition(.numericText())`;
 * - `movesWith`, a select: None, or a view of another branch of the same `if` or `switch`,
 *   which it morphs into (`.matchedGeometryEffect`).
 */
export const MOTION_CONTROLS = { transition: 'motion:transition', edge: 'motion:edge', fades: 'motion:fades', rollsDigits: 'motion:rolls-digits', movesWith: 'motion:moves-with' } as const
/** Whether a view offers When tapped: a Button's action, or making any other view tappable (D16). */
export function offersWhenTapped(behavior: BehaviorSettings | undefined): boolean {
  return !!behavior && (behavior.canConfigureAction || !!behavior.canMakeTappable)
}
/**
 * What a tap does. `animation` (Wave 5a) animates a change of a value, a list or a call:
 * absent keeps the animation the action has when it is replaced, and null removes it.
 */
export type BehaviorAction = BehaviorActionKind & { readonly animation?: ActionAnimation | null }
type BehaviorActionKind =
  | { readonly type: 'toggle'; readonly state: string }
  | { readonly type: 'set'; readonly state: string; readonly value: DesignValue }
  | { readonly type: 'call'; readonly name: string }
  | { readonly type: 'navigate'; readonly destination: string }
  | { readonly type: 'sheet'; readonly destination: string }
  /** Covers the whole screen: `.fullScreenCover(isPresented:)`. */
  | { readonly type: 'cover'; readonly destination: string }
  | { readonly type: 'dismiss'; readonly state: string }
  | { readonly type: 'append'; readonly collection: string; readonly record: DesignRecord }
  | { readonly type: 'delete'; readonly collection: string; readonly id: DesignValue }
  /** Asks before acting: `.alert(title, isPresented:)` with its buttons and message (Wave 4a). */
  | { readonly type: 'alert'; readonly title: string; readonly message?: string; readonly actions: readonly AlertActionSpec[] }
  /** Offers a choice: `.confirmationDialog(title, isPresented:)` with its buttons and message (Wave 4a). */
  | { readonly type: 'dialog'; readonly title: string; readonly message?: string; readonly actions: readonly AlertActionSpec[] }
/** One button of an alert or dialog that a tap action adds: its title, and the role iOS draws it with. */
export interface AlertActionSpec {
  readonly title: string
  readonly role?: 'destructive' | 'cancel'
}
/** A value inside a view that a copy of it may write differently. */
export interface CopyValue {
  readonly kind: 'text' | 'symbol' | 'number' | 'color' | 'action'
  /** The name it would take as a parameter: title, icon, action, padding… */
  readonly role: string
  readonly span: SourceSpan
  /** The source as written, which is what a call site passes. */
  readonly text: string
  /** The Swift type a number takes as a parameter. */
  readonly unit?: 'CGFloat' | 'Double' | 'Int'
}

/** Another view with the same shape as the selected one. */
export interface CopyMatch {
  readonly id: string
  readonly owner: string
  readonly source: SourceSpan
  readonly values: readonly CopyValue[]
  /** How many values this copy writes differently, which is what becomes a parameter. */
  readonly differences: number
  /** Modifiers at the end of this copy's chain that stay on the call. */
  readonly extraModifiers?: number
}

/** One tab of the app's tab bar, as the App panel lists it. */
export interface AppTab {
  readonly name: string
  /** The SF Symbol on the tab. */
  readonly icon: string
  /** The view the tab shows. */
  readonly screen: string
  /** The call as written, including any arguments the screen takes. */
  readonly content: string
}

/** How the app is navigated, and whether the studio can write that shape itself. */
export interface AppNavigationModel {
  readonly style: 'tabs' | 'stack' | 'none'
  readonly tabs: readonly AppTab[]
  /** False when the navigation is built in Swift beyond what the editor writes. */
  readonly editable: boolean
  /** Why it cannot be edited here, in the words the panel shows. */
  readonly reason?: string
  /** Where it is written, for "Open in Code". */
  readonly source?: SourceSpan
  /** The screen a single-stack app starts on. */
  readonly root?: string
}

/** Changes to the app's own navigation, made from the App panel. */
export type NavigationOperation =
  | { readonly kind: 'navigation-style'; readonly style: 'tabs'; readonly name: string; readonly icon: string }
  | { readonly kind: 'navigation-style'; readonly style: 'stack' }
  | { readonly kind: 'tab-add'; readonly screen: string; readonly name: string; readonly icon: string }
  | { readonly kind: 'tab-update'; readonly index: number; readonly name?: string; readonly icon?: string; readonly screen?: string }
  | { readonly kind: 'tab-remove'; readonly index: number }
  | { readonly kind: 'tab-move'; readonly index: number; readonly toIndex: number }

/**
 * A variant property of a Main (Wave 5b): `var style: Style` of a nested `enum Style` of two
 * cases, which a value of the Main can differ by and each copy picks one of.
 */
export interface VariantProperty {
  readonly name: string
  readonly cases: readonly [string, string]
}
/** What kind of value a copy of a component can set (Wave 5b). */
export type ComponentInputKind = 'text' | 'symbol' | 'image' | 'color' | 'number' | 'shown'
/**
 * Words a designer types as a Swift name, in camel case (Wave 5b): "Extra large" is
 * `extraLarge`, "frame · width" is `frameWidth`; empty when they make no name.
 */
export function swiftName(words: string): string {
  const name = words.split(/[^A-Za-z0-9_]+/).filter(Boolean).map((word, index) => (index ? word.charAt(0).toUpperCase() : word.charAt(0).toLowerCase()) + word.slice(1)).join('')
  return /^[A-Za-z_]\w*$/.test(name) ? name : ''
}
/** A variant's case as the panel says it (Wave 5b): `extraLarge` is "Extra large". */
export const variantCaseWords = (name: string) => { const words = nameInWords(name); return words.charAt(0).toUpperCase() + words.slice(1) }
/**
 * A colour as a copy's colour input holds it (Wave 5b): a system name, `#RRGGBB`, a hex with
 * its opacity as `#RRGGBBAA`, or a token as written. A system colour with an opacity is its
 * hex in `swatches`, as the colour field picks it; undefined for one not there, as reading
 * code finds it, since a system colour is no one hex in light and dark, and for a token with one.
 */
export function colorInputText(color: ColorValue, swatches: Readonly<Record<string, string>> = {}): string | undefined {
  const opacity = color.opacity ?? 1
  if (!('hex' in color) && opacity === 1) return 'name' in color ? color.name : color.token
  const hex = 'hex' in color ? color.hex : 'name' in color ? swatches[color.name] : undefined
  if (!hex) return undefined
  const alpha = Math.round((hex.length === 9 ? parseInt(hex.slice(7), 16) / 255 : 1) * opacity * 255)
  return hex.slice(0, 7).toUpperCase() + (alpha === 255 ? '' : alpha.toString(16).padStart(2, '0').toUpperCase())
}

/**
 * Each placement Bars sets in a designer's words, as the Placement field and the Bars section
 * name it, in the order they list them (Wave 4b): the bar's leading or trailing side, in place
 * of the title, the bottom bar, and (Wave 6c) where a sidebar or back button goes and the
 * middle of the bottom bar, as `.navigation` and `.status` put it, then where iOS puts it. A
 * placement added here is written as Swift by sema's `TOOLBAR_PLACEMENTS`.
 */
export const TOOLBAR_PLACEMENT_WORDS = { leading: 'Leading', trailing: 'Trailing', principal: 'Title', bottom: 'Bottom', navigation: 'Navigation', status: 'Status', automatic: 'Automatic' } as const
/** Where a toolbar item sits (Wave 4b), one of `TOOLBAR_PLACEMENT_WORDS`. */
export type ToolbarPlacement = keyof typeof TOOLBAR_PLACEMENT_WORDS

/** One of a screen's toolbar items, as its Bars section lists it (Wave 4b). */
export interface ScreenBarItem {
  /** The `ToolbarItem`, `ToolbarItemGroup` or view in the toolbar, to select. */
  readonly node: string
  /** Where it sits; null for a placement written in code that Bars doesn't set, such as `.confirmationAction`. */
  readonly placement: ToolbarPlacement | null
  /** What it shows: its button's title, its symbol, or its view's name. */
  readonly label: string
}

/**
 * A screen's bars, as Screen settings lists them (Wave 4b), on the screen's definition: read
 * from its own views, never from the sheets and pages it opens.
 */
export interface ScreenBars {
  /** The view the screen's `.navigationTitle` is written on, and the id of its Title control there. */
  readonly title?: { readonly node: string; readonly control: string }
  /** Set when the screen certainly has no navigation bar where it is shown, so a title on it doesn't show. */
  readonly barless?: true
  /** Its toolbar items, in the order written. */
  readonly items: readonly ScreenBarItem[]
  /**
   * Its search field, when it has one: the view `.searchable` is written on, its prompt when
   * the code writes one as words, and the id of the Prompt control on that view when it can be edited.
   */
  readonly search?: { readonly node: string; readonly prompt?: string; readonly control?: string }
  /** Why toolbar items can't be added from here, when they can't. */
  readonly problem?: string
  /** Why the search field can't be switched on here, when it can't. */
  readonly searchProblem?: string
  /**
   * The search tab of the tab bar the screen holds (Wave 6c), on the screen whose views hold
   * the TabView alone: whether it has a `Tab(role: .search)`, that Tab's layer to select, and
   * why it can't be switched here when it can't.
   */
  readonly searchTab?: { readonly on: boolean; readonly node?: string; readonly problem?: string }
}

export type AuthoringOperation = ResourceOperation | ModifierOperation | NavigationOperation | LayerSetOperation
  /** An item in the screen's toolbar at `placement`, making the toolbar when the screen has none (Wave 4b). */
  | { readonly kind: 'toolbar-item-add'; readonly placement: ToolbarPlacement; readonly snippet?: string }
  /** A search field on the screen, searching text kept in the screen's state (Wave 4b). */
  | { readonly kind: 'searchable-add'; readonly prompt: string }
  | { readonly kind: 'searchable-remove' }
  /** A search tab, `Tab(role: .search)`, as the last of the tabs the screen holds, or taken away again (Wave 6c). */
  | { readonly kind: 'search-tab-add' }
  | { readonly kind: 'search-tab-remove' }
  /** A value of the Main each copy can set: text as before, or a symbol, image, colour, number, or whether a view is shown (Wave 5b). */
  | { readonly kind: 'component-expose'; readonly control: string; readonly name: string; readonly as?: ComponentInputKind }
  /** A variant property on the Main: a nested enum of two cases and a property of it, defaulting to the first (Wave 5b). */
  | { readonly kind: 'component-variant-add'; readonly name: string; readonly cases: readonly [string, string] }
  /** A value in the Main that differs by a variant property: `property == .first ? value : value` (Wave 5b). */
  | { readonly kind: 'component-differs'; readonly control: string; readonly property: string }
  /** This copy becomes a copy of another component, keeping the inputs both have (Wave 5b). */
  | { readonly kind: 'instance-swap'; readonly component: string }
  /** This copy becomes the plain views it shows, with its inputs put in their place (Wave 5b). */
  | { readonly kind: 'instance-detach' }
  | { readonly kind: 'component-insert'; readonly component: string }
  | { readonly kind: 'component-variant'; readonly variant: ComponentVariant }
  | { readonly kind: 'screen-create'; readonly name: string; readonly title: string; readonly layout: ContainerLayout }
  | { readonly kind: 'screen-duplicate'; readonly name: string }
  | { readonly kind: 'screen-remove' }
  | { readonly kind: 'card-customize'; readonly color?: string }
  | { readonly kind: 'layer-duplicate' }
  | { readonly kind: 'layer-wrap'; readonly ids: readonly string[]; readonly layout: ContainerLayout }
  /** Puts a container's views in its place, when its parent can take them all and none of its modifiers would be lost (Wave 4c). */
  | { readonly kind: 'layer-unwrap' }
  | { readonly kind: 'layer-reparent'; readonly ids: readonly string[]; readonly destination: string }
  /** A Button whose label is the view, doing nothing until When tapped says what (D16). */
  | { readonly kind: 'make-tappable' }
  | { readonly kind: 'guided-action'; readonly action: BehaviorAction; readonly replace: boolean; readonly createValue?: { readonly name: string; readonly value: DesignValue; readonly activeTitle?: string }; readonly createScreen?: { readonly name: string; readonly title: string } }
  | { readonly kind: 'navigation-target'; readonly destination: string }
  /** How the screen this view opens arrives: pushed, as a sheet, or covering everything. */
  | { readonly kind: 'navigation-type'; readonly type: 'push' | 'sheet' | 'cover' }
  /** A value the screen can be in more than one of - what a state switches. */
  | { readonly kind: 'value-create'; readonly name: string; readonly value: DesignValue }
  | { readonly kind: 'records'; readonly records: readonly DesignRecord[] }
  | { readonly kind: 'collection-field'; readonly name: string; readonly type: RecordField['type']; readonly optional: boolean; readonly value: DesignValue }
  | { readonly kind: 'collection-convert'; readonly name: string; readonly recordType: string }
  | { readonly kind: 'empty-state'; readonly text: string }
  | { readonly kind: 'bind-field'; readonly field: string }
  | { readonly kind: 'extract-component'; readonly name: string }
  | { readonly kind: 'make-component'; readonly name: string; readonly copies: readonly string[]; /** Chosen parameter names, keyed by the name the dialog suggested. */ readonly names?: Readonly<Record<string, string>>; /** The views that are screens, so copies inside components are left alone. */ readonly screens?: readonly string[] }
  | { readonly kind: 'behavior'; readonly action: BehaviorAction; readonly replace: boolean }
  | { readonly kind: 'bind-state'; readonly name: string; readonly create?: { readonly value: DesignValue } }
  | { readonly kind: 'transition'; readonly state: string; readonly style: 'opacity' | 'slide' | 'scale'; readonly duration: number }
  /**
   * Shown when (Wave 5a): wraps the view in `if`, changes the condition of the `if` it is the
   * only view of, or with `when` null unwraps it. `create` makes a new on/off switch first,
   * `@State private var name = value`, which `when.input` then names.
   */
  | { readonly kind: 'visibility'; readonly when: VisibilityWhen | null; readonly create?: { readonly name: string; readonly value: boolean } }
  /** Animate this change (Wave 5a): wraps a Button's action in `withAnimation`, changes its style, or with null unwraps it. */
  | { readonly kind: 'animate-action'; readonly animation: ActionAnimation | null }
