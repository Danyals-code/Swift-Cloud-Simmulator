import type { LayerSetOperation } from './layer'
import type { ModifierOperation } from './authoring-modifiers'
import type { ResourceOperation } from './design-resources'
import type { SourceSpan } from './source'
import type { DesignControl } from './design-edit'
import type { ContainerLayout } from './layer-moves'

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
}
/** Whether a view offers When tapped: a Button's action, or making any other view tappable (D16). */
export function offersWhenTapped(behavior: BehaviorSettings | undefined): boolean {
  return !!behavior && (behavior.canConfigureAction || !!behavior.canMakeTappable)
}
export type BehaviorAction =
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

/** Where a toolbar item sits (Wave 4b): the bar's leading or trailing side, in place of the title, the bottom bar, or where iOS puts it. */
export type ToolbarPlacement = 'leading' | 'trailing' | 'principal' | 'bottom' | 'automatic'
/** Each placement in a designer's words, as the Placement field and the Bars section name it (Wave 4b). */
export const TOOLBAR_PLACEMENT_WORDS: Readonly<Record<ToolbarPlacement, string>> = { leading: 'Leading', trailing: 'Trailing', principal: 'Title', bottom: 'Bottom', automatic: 'Automatic' }

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
}

export type AuthoringOperation = ResourceOperation | ModifierOperation | NavigationOperation | LayerSetOperation
  /** An item in the screen's toolbar at `placement`, making the toolbar when the screen has none (Wave 4b). */
  | { readonly kind: 'toolbar-item-add'; readonly placement: ToolbarPlacement; readonly snippet?: string }
  /** A search field on the screen, searching text kept in the screen's state (Wave 4b). */
  | { readonly kind: 'searchable-add'; readonly prompt: string }
  | { readonly kind: 'searchable-remove' }
  | { readonly kind: 'component-expose'; readonly control: string; readonly name: string }
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
