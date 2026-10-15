import { isNonView, type AuthoringNode, type AuthoringOperation, type AuthoringSnapshot, type PreviewColorAsset, type SourceFile } from '@studio/shared'
import { collectionFor, addCollectionField, bindField, convertCollection, emptyState, enclosingCollection, recordsSwift, validateRecords } from './authoring-collections'
import { componentRecipes, componentSettings, extractComponent, insertComponent, applyComponentVariant, exposeComponentInput } from './authoring-components'
import { behaviorSettings, configureAction, configureBinding, configureTransition, stateInputs } from './authoring-behavior'
import { applyPatches, hasComments, patch, type FeatureContext, type SourcePatch } from './authoring-context'
import { editResource, sharedStyles, styleProperties } from './authoring-resources'
import { constrainNumericControl, validateControlValue } from './design-controls'
import { navigationSettings, configureNavigationTarget, changeNavigationType } from './authoring-navigation'
import { appNavigation, navigationPatches } from './authoring-navigation-app'
import { appAccent } from './authoring-accent'
import { makeComponent } from './authoring-copies'
import { createScreenValue, guidedAction, screenEdit } from './authoring-screens'
import { customizeCard } from './authoring-card'
import { makeTappable, structureEdit } from './authoring-structure'
import { barsEdit, screenBars } from './authoring-bars'

export function enrichAuthoring(ctx: FeatureContext, snapshot: AuthoringSnapshot): AuthoringSnapshot {
  // A file with an error keeps its own views plain, and what is declared in it gives no settings: a
  // component defined there, records written there, a token there. Every other file keeps its settings,
  // as the planner keeps its edits - a typo in a service no screen uses is no reason to lock the design.
  const broken = new Set(snapshot.diagnostics.filter(d => d.severity === 'error').map(d => d.span.file))
  // These have only ever read projects with no errors; with part of one wrong, a surprise costs a view its settings, not the snapshot.
  const read = <T>(settings: () => T): T | undefined => { if (!broken.size) return settings(); try { return settings() } catch { return undefined } }
  const fileOf = new Map(snapshot.nodes.map(node => [node.id, node.source.file]))
  const sound = <T>(setting: T | undefined, file: (setting: T) => string | undefined): T | undefined => setting && !broken.has(file(setting) ?? '') ? setting : undefined
  const nodes = snapshot.nodes.map(node => broken.has(node.source.file) ? node : read(() => enrich(node)) ?? node)
  const inputs = snapshot.nodes.filter(n => n.kind === 'definition' && !broken.has(n.source.file)).flatMap(n => read(() => stateInputs(ctx, n)) ?? [])
  const styles = read(() => sharedStyles(ctx))?.filter(style => !broken.has(style.source.file))
  return { ...snapshot, nodes, inputs, styles, navigation: read(() => appNavigation(ctx)), accent: read(() => appAccent(ctx)) }

  function enrich(node: AuthoringNode): AuthoringNode {
    const collection = sound(collectionFor(ctx, node), c => c.source.file), component = sound(componentSettings(ctx, node), c => fileOf.get(c.definitionId))
    const parent = sound(enclosingCollection(ctx, node), c => c.source.file)
    // A copy of a component can be made tappable as any view can (D16).
    const behavior = ['view', 'collection', 'component'].includes(node.kind) && !isNonView(node) ? behaviorSettings(ctx, node) : undefined
    return { ...node, navigation: navigationSettings(ctx, node), styles: styleProperties(ctx, node), collection, component, behavior, bars: node.kind === 'definition' ? screenBars(ctx, node) : undefined, fields: parent && ['Text', 'Image', 'Toggle', 'TextField', 'SecureField'].includes(node.name) ? parent.fields.filter(f => node.name === 'Text' || node.name === 'Image' && f.type === 'String' && !f.optional || ['Toggle', 'TextField', 'SecureField'].includes(node.name) && parent.mutable && f.mutable && !f.optional && f.type === (node.name === 'Toggle' ? 'Bool' : 'String')).map(f => f.name) : undefined, controls: (component ? [...component.controls, ...(node.controls ?? [])] : node.controls)?.map(c => constrainNumericControl(c, node.name, behavior?.binding?.type)) }
  }
}
export function featureEdit(ctx: FeatureContext, node: AuthoringNode, operation: AuthoringOperation | { kind: 'property'; control: string; value: string }): { files: SourceFile[]; offset: number; colors?: PreviewColorAsset[] } {
  let patches: SourcePatch[] = [], files: SourceFile[] = [], colors: PreviewColorAsset[] | undefined, removed: readonly string[] = []
  switch (operation.kind) {
    case 'component-expose': return exposeComponentInput(ctx, node, operation.control, operation.name)
    case 'component-insert': return insertComponent(ctx, node, operation.component)
    case 'component-variant': return applyComponentVariant(ctx, node, operation.variant)
    case 'guided-action': return guidedAction(ctx, node, operation)
    case 'screen-create': case 'screen-duplicate': case 'screen-remove': { const result = screenEdit(ctx, node, operation); patches = result.patches; files = result.files ?? []; removed = result.removed ?? []; break }
    case 'card-customize': return customizeCard(ctx, node, operation.color)
    case 'toolbar-item-add': case 'searchable-add': case 'searchable-remove': return barsEdit(ctx, node, operation)
    case 'layer-duplicate': case 'layer-wrap': case 'layer-reparent': return structureEdit(ctx, node, operation)
    case 'make-tappable': return makeTappable(ctx, node)
    case 'navigation-target': patches = configureNavigationTarget(ctx, node, operation.destination); break
    case 'navigation-type': patches = changeNavigationType(ctx, node, operation.type); break
    case 'value-create': patches = createScreenValue(ctx, node, operation.name, operation.value); break
    case 'navigation-style': case 'tab-add': case 'tab-update': case 'tab-remove': case 'tab-move': { const result = navigationPatches(ctx, operation); patches = result.patches; files = result.created ?? []; break }
    case 'style-create-link': case 'style-create': case 'style-edit': case 'style-link': case 'style-local': case 'style-migrate': case 'asset-use': case 'asset-references': { const result = editResource(ctx, node, operation); patches = result.patches; files = result.created ?? []; colors = result.colors; removed = result.removed ?? []; break }
    case 'property': {
      const recipe = componentRecipes(ctx, node).find(r => r.control.id === operation.control)
      if (!recipe) throw new Error('This component argument is not a supported literal or its interface has changed.')
      const error = validateControlValue(recipe.control, operation.value)
      if (error) throw new Error(error)
      if (recipe.control.value !== operation.value && !(recipe.control.kind === 'number' && Number(recipe.control.value) === Number(operation.value))) patches = [recipe.write(operation.value)]
      break
    }
    case 'records': {
      const info = collectionFor(ctx, node)
      if (!info) throw new Error('This collection is outside the typed local-record form. Use Swift to change its data.')
      const problem = validateRecords(info.fields, operation.records)
      if (problem) throw new Error(problem)
      if (info.records.length === operation.records.length && info.records.every((record, index) => info.fields.every(field => (record[field.name] ?? null) === (operation.records[index]![field.name] ?? null)))) break
      if (hasComments(ctx, info.source)) throw new Error('This initializer includes comments. Edit records in Swift to preserve them; preview records remain available.')
      if (JSON.stringify(info.records) !== JSON.stringify(operation.records)) patches = [patch(info.source, recordsSwift(info, operation.records))]
      break
    }
    case 'collection-field': patches = addCollectionField(ctx, node, operation.name, operation.type, operation.optional, operation.value); break
    case 'collection-convert': patches = convertCollection(ctx, node, operation.name, operation.recordType); break
    case 'empty-state': patches = emptyState(ctx, node, operation.text); break
    case 'bind-field': patches = bindField(ctx, node, operation.field); break
    case 'extract-component': { const result = extractComponent(ctx, node, operation.name); patches = result.patches; files = result.files; break }
    case 'make-component': {
      const targets = operation.copies.map(id => {
        const found = ctx.nodes.find(n => n.id === id)
        if (!found) throw new Error('One of the copies changed. Find the copies again.')
        return found
      })
      const result = makeComponent(ctx, node, operation.name, targets, operation.names, operation.screens ?? [])
      patches = result.patches; files = result.files; break
    }
    case 'bind-state': patches = configureBinding(ctx, node, operation.name, operation.create); break
    case 'behavior': patches = configureAction(ctx, node, operation.action, operation.replace); break
    case 'transition': patches = configureTransition(ctx, node, operation.state, operation.style, operation.duration); break
    default: throw new Error('This design command is not supported.')
  }
  return { files: applyPatches(ctx, patches, files).filter(file => !removed.includes(file.id)), offset: node.source.start + patches.filter(p => p.file === node.source.file && p.end <= node.source.start).reduce((delta, p) => delta + p.text.length - (p.end - p.start), 0), ...(colors ? { colors } : {}) }
}
