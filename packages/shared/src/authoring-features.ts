import type { ModifierOperation } from './authoring-modifiers'
import type { ResourceOperation } from './design-resources'
import type { SourceSpan } from './source'
import type { DesignControl } from './design-edit'

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
  readonly canConfigureAction: boolean
  readonly binding?: {
    readonly label: string
    readonly type: string
    readonly current: string
    /** The name a new value for it takes: free on its screen, as the canvas names a control's value (D13). */
    readonly newName: string
  }
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

export type AuthoringOperation = ResourceOperation | ModifierOperation | NavigationOperation
  | { readonly kind: 'component-expose'; readonly control: string; readonly name: string }
  | { readonly kind: 'component-insert'; readonly component: string }
  | { readonly kind: 'component-variant'; readonly variant: ComponentVariant }
  | { readonly kind: 'screen-create'; readonly name: string; readonly title: string; readonly layout: 'VStack' | 'HStack' | 'ZStack' }
  | { readonly kind: 'screen-duplicate'; readonly name: string }
  | { readonly kind: 'screen-remove' }
  | { readonly kind: 'card-customize'; readonly color?: string }
  | { readonly kind: 'layer-duplicate' }
  | { readonly kind: 'layer-wrap'; readonly ids: readonly string[]; readonly layout: 'VStack' | 'HStack' | 'ZStack' }
  | { readonly kind: 'layer-reparent'; readonly ids: readonly string[]; readonly destination: string }
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
