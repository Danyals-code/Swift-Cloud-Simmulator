import type { AuthoringNode, AuthoringOperation, AuthoringSnapshot, SourceFile } from '@studio/shared'
import { collectionFor, addCollectionField, bindField, convertCollection, emptyState, enclosingCollection, recordsSwift, validateRecords } from './authoring-collections'
import { componentRecipes, componentSettings, extractComponent } from './authoring-components'
import { behaviorSettings, configureAction, configureBinding, configureTransition, stateInputs } from './authoring-behavior'
import { applyPatches, hasComments, patch, type FeatureContext, type SourcePatch } from './authoring-context'
import { editResource, sharedStyles, styleProperties } from './authoring-resources'
import { validateControlValue } from './design-controls'
import { navigationSettings, configureNavigationTarget } from './authoring-navigation'

export function enrichAuthoring(ctx: FeatureContext, snapshot: AuthoringSnapshot): AuthoringSnapshot {
  if (snapshot.diagnostics.some(d => d.severity === 'error')) return snapshot
  const nodes = snapshot.nodes.map(node => {
    const collection = collectionFor(ctx, node), component = componentSettings(ctx, node)
    const parent = enclosingCollection(ctx, node)
    const behavior = ['view', 'collection'].includes(node.kind) && node.name !== 'WindowGroup' ? behaviorSettings(ctx, node) : undefined
    return { ...node, navigation: navigationSettings(ctx, node), styles: styleProperties(ctx, node), collection, component, behavior, fields: parent && ['Text', 'Image', 'Toggle', 'TextField', 'SecureField'].includes(node.name) ? parent.fields.filter(f => node.name === 'Text' || node.name === 'Image' && f.type === 'String' && !f.optional || ['Toggle', 'TextField', 'SecureField'].includes(node.name) && parent.mutable && f.mutable && !f.optional && f.type === (node.name === 'Toggle' ? 'Bool' : 'String')).map(f => f.name) : undefined, controls: component ? [...component.controls, ...(node.controls ?? [])] : node.controls }
  })
  const inputs = snapshot.nodes.filter(n => n.kind === 'definition').flatMap(n => stateInputs(ctx, n))
  return { ...snapshot, nodes, inputs, styles: sharedStyles(ctx) }
}
export function featureEdit(ctx: FeatureContext, node: AuthoringNode, operation: AuthoringOperation | { kind: 'property'; control: string; value: string }): { files: SourceFile[]; offset: number } {
  let patches: SourcePatch[] = [], files: SourceFile[] = []
  switch (operation.kind) {
    case 'navigation-target': patches = configureNavigationTarget(ctx, node, operation.destination); break
    case 'style-create': case 'style-edit': case 'style-link': case 'style-local': case 'asset-use': case 'asset-references': { const result = editResource(ctx, node, operation); patches = result.patches; files = result.created ?? []; break }
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
    case 'bind-state': patches = configureBinding(ctx, node, operation.name, operation.create); break
    case 'behavior': patches = configureAction(ctx, node, operation.action, operation.replace); break
    case 'transition': patches = configureTransition(ctx, node, operation.state, operation.style, operation.duration); break
    default: throw new Error('This design command is not supported.')
  }
  return { files: applyPatches(ctx, patches, files), offset: node.source.start + patches.filter(p => p.file === node.source.file && p.end <= node.source.start).reduce((delta, p) => delta + p.text.length - (p.end - p.start), 0) }
}
