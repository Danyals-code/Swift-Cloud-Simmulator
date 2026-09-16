import { asKeyPath, truthy } from '@studio/swift-runtime'
import type { ModifierValue, ViewValue } from './view-value'

/** Visual environment values must survive removal of Group/navigation containers. */
const INHERITED = new Set([
  'listStyle', 'tint', 'accentColor', 'buttonStyle', 'textFieldStyle', 'toggleStyle', 'pickerStyle',
  'labelStyle', 'progressViewStyle', 'gaugeStyle', 'controlSize', 'buttonBorderShape',
  'disabled', 'allowsHitTesting', 'foregroundStyle', 'foregroundColor', 'imageScale', 'environment', 'dynamicTypeSize',
])

function keyOf(modifier: ModifierValue): string {
  return modifier.name === 'environment'
    ? `environment:${asKeyPath(modifier.args[0]?.value)?.components.join('.') ?? ''}`
    : modifier.name
}

export function visualModifiers(view: ViewValue): readonly ModifierValue[] {
  return view.modifiers.filter((modifier) => INHERITED.has(modifier.name))
}

export function inheritVisualStyle(view: ViewValue, inherited: readonly ModifierValue[]): ViewValue {
  const modifiers = [...view.modifiers]
  for (const modifier of inherited) {
    if (!INHERITED.has(modifier.name)) continue
    // A disabled parent cannot be re-enabled by a child. The same applies to hit testing.
    const value = modifier.args[0]?.value
    const blocks = (modifier.name === 'disabled' && (value === undefined || truthy(value))) ||
      (modifier.name === 'allowsHitTesting' && value !== undefined && !truthy(value))
    if (blocks) {
      const existing = modifiers.findIndex((item) => item.name === modifier.name)
      if (existing >= 0) modifiers.splice(existing, 1)
      modifiers.unshift(modifier)
    } else if (!modifiers.some((item) => keyOf(item) === keyOf(modifier) ||
      (['tint', 'accentColor'].includes(item.name) && ['tint', 'accentColor'].includes(modifier.name)))) {
      modifiers.push(modifier)
    }
  }
  return { ...view, modifiers }
}
