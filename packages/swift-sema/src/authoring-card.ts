import { deploymentVersion, type AuthoringNode, type DesignEditRequest } from '@studio/shared'
import { styleExpression } from './authoring-resources'
import { applyPatches, callOf, hasComments, raw, type FeatureContext } from './authoring-context'
import { roundedCorners } from './design-controls'

/** Convert the native GroupBox surface into ordinary, editable SwiftUI layers. */
export function customizeCard(ctx: FeatureContext, node: AuthoringNode, color?: string) {
  const call = callOf(ctx, node)
  if (node.kind !== 'view' || node.name !== 'GroupBox' || !call?.trailingClosure) throw new Error('Select a Card with editable content.')
  if (node.modifiers?.some(modifier => modifier.name === 'groupBoxStyle')) throw new Error('This card has a custom style. Open it in Code to preserve that style.')
  const title = call.args.find(argument => argument.label === null)
  const label = call.args.find(argument => argument.label === 'label')
  if (call.args.some(argument => argument !== title && argument !== label) || title && label || label && label.value.kind !== 'closure') throw new Error('This card uses a custom constructor. Open it in Code to edit its layout.')
  if (hasComments(ctx, { ...node.source, start: call.callee.span.end, end: call.trailingClosure.span.start }) || label && label.value.span.start > call.trailingClosure.span.end && hasComments(ctx, { ...node.source, start: call.trailingClosure.span.end, end: label.value.span.start })) throw new Error('The card constructor contains comments. Open it in Code to preserve them.')
  const file = ctx.files.find(file => file.id === node.source.file)!
  const eol = file.text.includes('\r\n') ? '\r\n' : '\n'
  const indent = /^[\t ]*/.exec(file.text.slice(file.text.lastIndexOf('\n', node.source.start - 1) + 1, node.source.start))?.[0] ?? ''
  const body = raw(ctx, call.trailingClosure.body.span).slice(1, -1)
  const titleView = title ? `Text(${raw(ctx, title.value.span)}).font(.headline)` : label ? `Group ${raw(ctx, label.value.span)}.font(.headline)` : ''
  const hasCorners = node.modifiers?.some(modifier => ['cornerRadius', 'clipShape'].includes(modifier.name) && modifier.enabled !== false)
  const corners = roundedCorners(8, deploymentVersion(ctx.deploymentTarget))
  const existingFill = node.modifiers?.find(modifier => modifier.name === 'background' && modifier.enabled !== false)
  const existingColor = existingFill && node.styles?.find(style => style.kind === 'color' && existingFill.propertyIds.includes(style.property))
  const colorSpan = existingColor && node.properties.find(property => property.id === existingColor.property)?.source
  const expression = color ? styleExpression('color', color) : undefined
  // A background already in the chain must not be hidden by a new opaque surface.
  const fill = existingFill && (!expression || colorSpan) ? undefined : expression ?? 'Color(.secondarySystemBackground)'
  const text = `VStack(alignment: .leading, spacing: 8) {${titleView ? eol + indent + '    ' + titleView : ''}${eol}${body}${eol}${indent}}${eol}${indent}.frame(maxWidth: .infinity, alignment: .leading)${eol}${indent}.padding(16)${fill ? `${eol}${indent}.background(${fill})` : ''}${hasCorners || existingFill && !fill ? '' : `${eol}${indent}${corners}`}`
  return { files: applyPatches(ctx, [{ ...call.span, file: file.id, text }, ...(expression && colorSpan ? [{ ...colorSpan, text: expression }] : []), ...(existingFill && !fill && !hasCorners ? [{ file: file.id, start: existingFill.source.end, end: existingFill.source.end, text: `${eol}${indent}${corners}` }] : [])]), offset: node.source.start }
}

/** Appearance edits target the card surface, not the hidden area behind GroupBox. */
export function editsCardSurface(node: AuthoringNode, operation: DesignEditRequest['operation']): boolean {
  if (node.kind !== 'view' || node.name !== 'GroupBox') return false
  const surface = new Set(['background', 'cornerRadius', 'clipShape'])
  if (operation.kind === 'modifier-add') return surface.has(operation.name)
  if (['modifier-move', 'modifier-duplicate', 'modifier-toggle'].includes(operation.kind) && 'modifier' in operation) return node.modifiers?.some(modifier => modifier.id === operation.modifier && surface.has(modifier.name)) ?? false
  if (operation.kind === 'property') return ['add:background', 'add:cornerRadius'].includes(operation.control) || (node.modifiers?.some(modifier => surface.has(modifier.name) && modifier.controls.some(control => control.id === operation.control)) ?? false)
  if (['style-local', 'style-link', 'style-create-link'].includes(operation.kind) && 'property' in operation) return node.modifiers?.some(modifier => surface.has(modifier.name) && modifier.propertyIds.includes(operation.property)) ?? false
  return false
}
