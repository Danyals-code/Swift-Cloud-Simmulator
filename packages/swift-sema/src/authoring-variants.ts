import { swiftIdentifier, swiftName, type AuthoringNode, type DesignControl, type AuthoringOperation, type VariantProperty } from '@studio/shared'
import type { StructDecl } from '@studio/swift-syntax'
import { declarationsNamed, enumCases, expressionOf, insertStoredMember, lineIndent, namedStruct, ownerOf, patch, type FeatureContext, type SourcePatch } from './authoring-context'
import { designControlRecipes, plainValue, variantOf } from './design-controls'
import { isComponent, ownInit } from './authoring-components'
import { layerProject } from './layer'

/**
 * Variants (Wave 5b): a Main's variant property, a nested enum of two cases and a property of
 * it, which each copy picks a case of, and values of the Main that differ by it, written as
 * `style == .primary ? 8 : 12`. Three or more values stay in Code.
 */

const variantCache = new WeakMap<FeatureContext, Map<string, readonly VariantProperty[]>>()

/** A Main's variant properties: each stored property whose type is an enum of two plain cases. */
function variantsOfMain(ctx: FeatureContext, decl: StructDecl): readonly VariantProperty[] {
  const found: VariantProperty[] = []
  for (const member of decl.members) {
    const variant = member.kind === 'varDecl' ? variantOf(decl, member, type => enumCases(ctx, type)) : undefined
    if (variant) found.push(variant)
  }
  return found
}

/** The variant properties of the Main `node` is or is a view inside, worked out once for each Main; undefined outside a Main. */
export function variantsOf(ctx: FeatureContext, node: AuthoringNode): readonly VariantProperty[] | undefined {
  if (node.kind !== 'definition' && node.kind !== 'view' && node.kind !== 'component' && node.kind !== 'collection') return undefined
  const name = node.kind === 'definition' ? node.name : node.owner
  if (!isComponent(ctx, name)) return undefined
  let known = variantCache.get(ctx)
  if (!known) variantCache.set(ctx, known = new Map())
  let variants = known.get(name)
  if (!variants) {
    const decl = namedStruct(ctx, name)
    known.set(name, variants = decl ? variantsOfMain(ctx, decl) : [])
  }
  return variants
}

const PLAINLY = 'Only a value written plainly, a text, a number, an on/off or a color, can differ by a variant. Change it in Code.'

/** The Main `node` is or is a view inside, which a variant is written on: refused outside one, or for one with an init of its own. */
function mainOf(ctx: FeatureContext, node: AuthoringNode): StructDecl {
  const owner = node.kind === 'definition' ? namedStruct(ctx, node.name) : ownerOf(ctx, node)
  if (!owner || !isComponent(ctx, owner.name)) throw new Error('Select a component’s Main, or a view inside it.')
  if (ownInit(owner)) throw new Error(`${owner.name} has an init of its own, which every copy calls. Add the variant in Code.`)
  return owner
}

/**
 * Add variant property and Differs by, written (Wave 5b). Adding writes `enum Style { case
 * primary, secondary }` first in the Main and `var style: Style = .primary` with its other
 * properties, so the copies there keep the first case. Differs by writes a value `x` the view's
 * control reads as `style == .primary ? x : x`, whose cases the panel then reads apart.
 */
export function variantEdit(ctx: FeatureContext, node: AuthoringNode, operation: Extract<AuthoringOperation, { kind: 'component-variant-add' | 'component-differs' }>): SourcePatch[] {
  const owner = mainOf(ctx, node)
  const file = ctx.files.find(f => f.id === owner.span.file)!.text
  let patches: SourcePatch[]
  if (operation.kind === 'component-variant-add') {
    // As the designer types them: "Size class" of "Extra large" and "Small" is `sizeClass: SizeClass` of `extraLarge` and `small`.
    const name = swiftName(operation.name), type = name.charAt(0).toUpperCase() + name.slice(1), cases = operation.cases.map(swiftName)
    if (!swiftIdentifier(name) || !swiftIdentifier(type)) throw new Error('Name the variant with letters and numbers, starting with a letter.')
    if (cases.length !== 2 || cases[0] === cases[1] || !cases.every(swiftIdentifier)) throw new Error('Give the variant two different values, each a name of letters and numbers.')
    const taken = [name, type].find(n => owner.members.some(m => 'name' in m && m.name === n))
    if (taken) throw new Error(`${owner.name} already has something called “${taken}”. Choose another name.`)
    if (declarationsNamed(ctx, type).length) throw new Error(`${type} is already a type in this project. Choose another name.`)
    const brace = file.indexOf('{', owner.span.start) + 1, eol = file.includes('\r\n') ? '\r\n' : '\n'
    const indent = owner.members[0] ? lineIndent(ctx, owner.span.file, owner.members[0].span.start).indent : '    '
    patches = [{ file: owner.span.file, start: brace, end: brace, text: `${eol}${indent}enum ${type} {${eol}${indent}    case ${cases.join(', ')}${eol}${indent}}${eol}` }, insertStoredMember(ctx, owner, `var ${name}: ${type} = .${cases[0]}`)]
  } else {
    const variant = variantsOf(ctx, node)?.find(v => v.name === operation.property)
    if (!variant) throw new Error(`Choose a variant property of ${owner.name}: one with two values.`)
    const expression = expressionOf(ctx, node), text = ctx.files.find(f => f.id === node.source.file)!.text
    const recipe = expression && designControlRecipes(node, expression, text, layerProject(ctx.ast, ctx.deploymentTarget, ctx.files), ctx.deploymentTarget).find(r => r.control.id === operation.control)
    const value = recipe && differing(recipe.control, text.slice(recipe.control.source.start, recipe.control.source.end))
    if (!recipe || value === undefined) throw new Error(PLAINLY)
    patches = [patch(recipe.control.source, `${variant.name} == .${variant.cases[0]} ? ${value} : ${value}`)]
  }
  return patches
}

/**
 * The Swift each case of a value starts as, when Differs by can write it: a value written
 * plainly, a text, a number, an on/off or a colour, which is written `Color.red` so the two
 * cases name their type. Undefined for anything else.
 */
function differing(control: DesignControl, written: string): string | undefined {
  const plain = plainValue(control, written)
  return plain === 'color' ? `Color.${control.value}` : plain && written
}
