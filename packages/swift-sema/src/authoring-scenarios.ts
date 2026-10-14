import { validatePreviewScenario } from '@studio/shared'
import type { AuthoringSnapshot, DesignValue, PreviewScenario } from '@studio/shared'
import { Parser, type Decl, type Expr, type SourceFileNode } from '@studio/swift-syntax'
import { swiftValue, type FeatureContext } from './authoring-context'
import { styleExpression } from './authoring-resources'
import { recordsSwift } from './authoring-collections'
import { PREVIEW_ERROR, PREVIEW_ERROR_DECLARATION } from './authoring-states'

/**
 * A program with a preview state applied: its syntax, and the members the state holds.
 * The runtime keeps each held member at the state's value until the first interaction,
 * whatever the code writes to it and wherever (Wave 3b).
 */
export interface ScenarioProgram {
  readonly files: readonly SourceFileNode[]
  /** By the type that declares them: the screen for its own `@State`, or the model it reads. */
  readonly held: ReadonlyMap<string, ReadonlySet<string>>
}

/** Substitute validated initializers in the evaluation AST only. Source and authoring anchors stay authoritative. */
export function scenarioFiles(ctx: FeatureContext, snapshot: AuthoringSnapshot, scenario?: PreviewScenario): ScenarioProgram {
  if (!scenario) return { files: ctx.ast, held: new Map() }
  const problem = validatePreviewScenario(snapshot, scenario)
  if (problem) throw new Error(problem)
  const replacements = new Map<string, Expr>(), held = new Map<string, Set<string>>()
  let showsError = false
  for (const input of scenario.inputs ?? []) {
    const state = snapshot.inputs?.find(s => s.owner === input.owner && s.name === input.name && s.signature === input.signature)
    const collection = snapshot.nodes.map(n => n.collection).find(c => c?.owner === input.owner && c.name === input.name && c.signature === input.signature)
    let text: string
    if (collection && Array.isArray(input.value)) text = recordsSwift(collection, input.value)
    else if (state && !Array.isArray(input.value)) text = state.choices ? state.choices.find(c => c.value === input.value)!.swift : state.type === 'Date' ? `Date(timeIntervalSince1970: ${input.value})` : state.type === 'Color' ? styleExpression('color', input.value as string) : state.options ? '.' + input.value : swiftValue(input.value as DesignValue)
    else throw new Error(`Preview input ${input.owner}.${input.name} no longer matches its Swift declaration. Update or remove this scenario.`)
    // A model's member is set where the model declares it, so every copy of the model starts with it.
    const hold = state && !Array.isArray(input.value) ? state.held : undefined
    const target = hold ?? { type: input.owner, member: input.name }
    const key = JSON.stringify([target.type, target.member])
    if (replacements.has(key)) throw new Error('A scenario cannot override the same input twice.')
    const parsed = Parser.parse('let value = ' + text, '<scenario>')
    const declaration = parsed.sourceFile.declarations[0]
    if (parsed.diagnostics.some(d => d.severity === 'error') || declaration?.kind !== 'varDecl' || !declaration.initializer) throw new Error('The preview input cannot be represented as a Swift value.')
    replacements.set(key, declaration.initializer)
    if (text.startsWith(`${PREVIEW_ERROR}(`)) showsError = true
    if (hold) held.set(hold.type, (held.get(hold.type) ?? new Set()).add(hold.member))
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
  const files: SourceFileNode[] = ctx.ast.map(file => ({ ...file, declarations: file.declarations.map(decl => rewrite(decl)) }))
  if (applied.size !== replacements.size) throw new Error('A scenario input owner is ambiguous or unavailable.')
  // The error a state shows for an `Error?`, declared beside the app's own files.
  if (showsError) files.push(Parser.parse(PREVIEW_ERROR_DECLARATION, '<scenario>').sourceFile)
  return { files, held }
}
