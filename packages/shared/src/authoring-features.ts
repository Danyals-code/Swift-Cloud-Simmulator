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
  readonly binding?: { readonly label: string; readonly type: string; readonly current: string }
}
export type BehaviorAction =
  | { readonly type: 'toggle'; readonly state: string }
  | { readonly type: 'set'; readonly state: string; readonly value: DesignValue }
  | { readonly type: 'call'; readonly name: string }
  | { readonly type: 'navigate'; readonly destination: string }
  | { readonly type: 'sheet'; readonly destination: string }
  | { readonly type: 'dismiss'; readonly state: string }
  | { readonly type: 'append'; readonly collection: string; readonly record: DesignRecord }
  | { readonly type: 'delete'; readonly collection: string; readonly id: DesignValue }
export type AuthoringOperation = ResourceOperation | ModifierOperation
  | { readonly kind: 'component-expose'; readonly control: string; readonly name: string }
  | { readonly kind: 'component-insert'; readonly component: string }
  | { readonly kind: 'component-variant'; readonly variant: ComponentVariant }
  | { readonly kind: 'screen-create'; readonly name: string; readonly title: string; readonly layout: 'VStack' | 'HStack' | 'ZStack' }
  | { readonly kind: 'screen-duplicate'; readonly name: string }
  | { readonly kind: 'screen-remove' }
  | { readonly kind: 'layer-duplicate' }
  | { readonly kind: 'layer-wrap'; readonly ids: readonly string[]; readonly layout: 'VStack' | 'HStack' | 'ZStack' }
  | { readonly kind: 'layer-reparent'; readonly ids: readonly string[]; readonly destination: string }
  | { readonly kind: 'guided-action'; readonly action: BehaviorAction; readonly replace: boolean; readonly createValue?: { readonly name: string; readonly value: DesignValue; readonly activeTitle?: string }; readonly createScreen?: { readonly name: string; readonly title: string } }
  | { readonly kind: 'navigation-target'; readonly destination: string }
  | { readonly kind: 'records'; readonly records: readonly DesignRecord[] }
  | { readonly kind: 'collection-field'; readonly name: string; readonly type: RecordField['type']; readonly optional: boolean; readonly value: DesignValue }
  | { readonly kind: 'collection-convert'; readonly name: string; readonly recordType: string }
  | { readonly kind: 'empty-state'; readonly text: string }
  | { readonly kind: 'bind-field'; readonly field: string }
  | { readonly kind: 'extract-component'; readonly name: string }
  | { readonly kind: 'behavior'; readonly action: BehaviorAction; readonly replace: boolean }
  | { readonly kind: 'bind-state'; readonly name: string; readonly create?: { readonly value: DesignValue } }
  | { readonly kind: 'transition'; readonly state: string; readonly style: 'opacity' | 'slide' | 'scale'; readonly duration: number }
