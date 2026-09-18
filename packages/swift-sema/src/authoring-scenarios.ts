import { validatePreviewScenario } from '@studio/shared'
import type { AuthoringSnapshot, DesignValue, PreviewScenario } from '@studio/shared'
import { Parser, type Decl, type Expr, type SourceFileNode } from '@studio/swift-syntax'
import { swiftValue, type FeatureContext } from './authoring-context'
import { recordsSwift } from './authoring-collections'

/** Substitute validated initializers in the evaluation AST only. Source and authoring anchors stay authoritative. */
export function scenarioFiles(ctx: FeatureContext, snapshot: AuthoringSnapshot, scenario?: PreviewScenario): readonly SourceFileNode[] {
  if (!scenario) return ctx.ast
  const problem = validatePreviewScenario(snapshot, scenario)
  if (problem) throw new Error(problem)
  const replacements = new Map<string, Expr>()
  for (const input of scenario.inputs ?? []) {
    const key = JSON.stringify([input.owner, input.name])
    if (replacements.has(key)) throw new Error('A scenario cannot override the same input twice.')
    const state = snapshot.inputs?.find(s => s.owner === input.owner && s.name === input.name && s.signature === input.signature)
    const collection = snapshot.nodes.map(n => n.collection).find(c => c?.owner === input.owner && c.name === input.name && c.signature === input.signature)
    let text: string
    if (collection && Array.isArray(input.value)) text = recordsSwift(collection, input.value)
    else if (state && !Array.isArray(input.value)) text = state.options ? '.' + input.value : swiftValue(input.value as DesignValue)
    else throw new Error(`Preview input ${input.owner}.${input.name} no longer matches its Swift declaration. Update or remove this scenario.`)
    const parsed = Parser.parse('let value = ' + text, '<scenario>')
    const declaration = parsed.sourceFile.declarations[0]
    if (parsed.diagnostics.some(d => d.severity === 'error') || declaration?.kind !== 'varDecl' || !declaration.initializer) throw new Error('The preview input cannot be represented as a Swift value.')
    replacements.set(key, declaration.initializer)
  }
  // Match the source model's qualified owners, and refuse ambiguous duplicates.
  const applied = new Set<string>()
  function rewrite(decl: Decl, prefix = ''): Decl {
    if (decl.kind !== 'structDecl' && decl.kind !== 'enumDecl') return decl
    const owner = prefix + decl.name
    return { ...decl, members: decl.members.map(member => {
      if (member.kind === 'structDecl' || member.kind === 'enumDecl') return rewrite(member, owner + '.')
      if (member.kind !== 'varDecl') return member
      const key = JSON.stringify([owner, member.name]), expr = replacements.get(key)
      if (!expr) return member
      if (applied.has(key)) throw new Error('A scenario input owner is ambiguous. Qualify or rename its Swift declaration.')
      applied.add(key)
      return { ...member, initializer: expr }
    }) }
  }
  const files = ctx.ast.map(file => ({ ...file, declarations: file.declarations.map(decl => rewrite(decl)) }))
  if (applied.size !== replacements.size) throw new Error('A scenario input owner is ambiguous or unavailable.')
  return files
}
