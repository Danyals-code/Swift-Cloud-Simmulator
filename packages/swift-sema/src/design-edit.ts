import { customizeCard, editsCardSurface } from './authoring-card'
import { editModifier } from './authoring-modifiers'
import { featureEdit } from './authoring-features'
import type { DesignEditPlan, DesignEditRequest, PreviewColorAsset, SourceFile, SourceChange, ModifierOperation } from '@studio/shared'
import { Parser, forEachChild, deleteView, moveView, moveViewTo, insertView, hideView, showView, type Expr, type Node } from '@studio/swift-syntax'
import { buildAuthoringModel } from './authoring'
import { designControlRecipes, validateControlValue, viewCallChain } from './design-controls'
import { Checker } from './checker'

/** Plans against an immutable source revision. Commit must compare the whole project again. */
export function planDesignEdit(request: DesignEditRequest): DesignEditPlan {
  const reject = (reason: string): DesignEditPlan => ({ ok: false, reason })
  const file = request.files.find(f => f.id === request.target.file)
  if (!file) return reject('The target file is no longer available.')
  const parsed = request.files.map(f => Parser.parse(f.text, f.id))
  // Deliberately conservative: recovery ASTs are useful for reading, never for rewriting.
  if (parsed.some(p => p.diagnostics.some(d => d.severity === 'error'))) return reject('Resolve syntax errors before changing the design.')
  const ast = parsed.map(p => p.sourceFile)
  const diagnostics = Checker.check(ast).diagnostics
  const model = buildAuthoringModel({ ...request, revision: request.baseRevision, parsed: ast, diagnostics })
  const node = model.nodes.find(n => n.source.file === file.id && n.source.start === request.target.start && n.source.end === request.target.end && n.fingerprint === request.fingerprint)
  const operation = request.operation
  if (operation.kind !== 'show' && !node) return reject('The source identity changed. Select the view again.')
  if (node && request.scope !== node.owner) return reject('The requested source ownership changed. Select the view again.')
  if (node && diagnostics.some(d => d.severity === 'error' && d.span.file === file.id && d.span.start < node.source.end && d.span.end >= node.source.start)) return reject('Resolve the diagnostics for this view before editing it.')
  const materializeCard = node && editsCardSurface(node, operation)
  const finish = (files: readonly SourceFile[], selection: { file: string; offset: number }, colors?: readonly PreviewColorAsset[]): DesignEditPlan => {
    if (materializeCard) {
      try {
        const ast = files.map(file => Parser.parse(file.text, file.id).sourceFile)
        const snapshot = buildAuthoringModel({ ...request, files, colors: colors ?? request.colors, parsed: ast, revision: request.baseRevision })
        const card = snapshot.nodes.find(candidate => candidate.name === 'GroupBox' && candidate.source.file === selection.file && candidate.source.start === selection.offset)
        if (!card) return reject('The card surface changed. Select it again.')
        files = customizeCard({ files, ast, nodes: snapshot.nodes, deploymentTarget: request.deploymentTarget, colors: colors ?? request.colors }, card).files
      } catch (error) { return reject(error instanceof Error ? error.message : 'Could not update the card surface.') }
    }
    return finishDesignPlan(request, files, selection, colors)
  }
  if (node && operation.kind.startsWith('modifier-')) {
    let expression: Expr | undefined
    function find(item: Node): void {
      if (item.kind === 'call' && item.span.file === node!.source.file && item.span.start === node!.source.start && item.span.end === node!.source.end) expression = item
      else forEachChild(item, find)
    }
    ast.forEach(find)
    if (!expression) return reject('This view no longer has an editable modifier chain.')
    try {
      const shadowToken = model.styles?.find(style => style.kind === 'shadow' && style.form === 'token')?.name
      const text = editModifier(node, expression, file.text, operation as ModifierOperation, request.deploymentTarget, { shadowToken })
      return finish(request.files.map(f => f.id === file.id ? { ...f, text } : f), { file: file.id, offset: node.source.start })
    } catch (error) { return reject(error instanceof Error ? error.message : 'This modifier change could not be planned.') }
  }
  if (node && (!['property', 'delete', 'move', 'moveTo', 'insert', 'hide', 'show'].includes(operation.kind) || operation.kind === 'property' && operation.control.startsWith('component:'))) {
    try {
      const result = featureEdit({ deploymentTarget: request.deploymentTarget, files: request.files, ast, nodes: model.nodes, descriptions: request.componentDescriptions, colors: request.colors }, node, operation as Parameters<typeof featureEdit>[2])
      return finish(result.files, { file: file.id, offset: result.offset }, result.colors)
    } catch (error) { return reject(error instanceof Error ? error.message : 'The design operation could not be planned.') }
  }
  let changed: { text: string; offset: number } | null = null
  if (operation.kind === 'property' && node) {
    let expression: Expr | undefined
    function visit(item: Node): void {
      if (item.kind === 'call' && item.span.start === node!.source.start && item.span.end === node!.source.end && item.span.file === file!.id) expression = item
      else forEachChild(item, visit)
    }
    ast.forEach(visit)
    if (!expression) return reject('This source expression cannot be edited safely.')
    const recipe = designControlRecipes(node, expression, file.text, request.deploymentTarget).find(r => r.control.id === operation.control)
    if (!recipe) return reject('This property is controlled by Swift or is outside the editable subset.')
    const invalid = validateControlValue(recipe.control, operation.value)
    if (invalid) return reject(invalid)
    if (operation.value === recipe.control.value || recipe.control.kind === 'number' && recipe.control.value !== '' && Number(operation.value) === Number(recipe.control.value)) {
      return materializeCard ? finish(request.files, { file: file.id, offset: node.source.start }) : { ok: true, projectId: request.projectId, baseRevision: request.baseRevision, changes: [], selection: { file: file.id, offset: node.source.start } }
    }
    const patch = recipe.patch(operation.value)
    changed = { text: file.text.slice(0, patch.start) + patch.text + file.text.slice(patch.end), offset: node.source.start }
  } else {
    const offset = node?.kind === 'template' && operation.kind === 'insert' ? model.nodes.find(n => n.id === node.parentId)?.source.start ?? request.target.start : request.target.start
    switch (operation.kind) {
      case 'delete': changed = deleteView(file.text, file.id, offset); break
      case 'move': changed = moveView(file.text, file.id, offset, operation.direction); break
      case 'moveTo': changed = moveViewTo(file.text, file.id, offset, operation.targetOffset, operation.position); break
      case 'insert': {
        // A link offered by the palette must be runnable immediately. If this
        // screen has no navigation container, wrap its root in the same edit.
        const snippet = Parser.parse(`struct InsertPreview: View { var body: some View { ${operation.snippet} } }`, '__insert.swift')
        let isLink = false
        const inspect = (item: Node, insideNavigation = false) => {
          if (item.kind === 'call') {
            const base = viewCallChain(item)?.base
            const name = base?.callee.kind === 'identifier' ? base.callee.name : ''
            insideNavigation ||= ['NavigationStack', 'NavigationView'].includes(name)
            if (name === 'NavigationLink' && !insideNavigation) isLink = true
          }
          forEachChild(item, child => inspect(child, insideNavigation))
        }
        inspect(snippet.sourceFile)
        let root = node!, parent = node, branch: typeof node, hasNavigation = false
        const seen = new Set<string>()
        while (parent && !seen.has(parent.id)) {
          seen.add(parent.id)
          if (['NavigationStack', 'NavigationView'].includes(parent.name)) { hasNavigation = true; break }
          if (parent.kind === 'definition') break
          if (parent.kind === 'branch') branch ??= parent
          if (!branch && parent.kind === 'view' && parent.name !== 'WindowGroup') root = parent
          parent = model.nodes.find(candidate => candidate.id === parent!.parentId)
        }
        if (isLink && !hasNavigation) {
          if (Number.parseFloat(request.deploymentTarget ?? '17') < 16) return reject('Adding a navigation screen requires iOS 16 or later.')
          if (root.source.file !== file.id || root.kind !== 'view' || !parent || !['definition', 'branch'].includes(parent.kind)) return reject('Select a view within the screen before adding a navigation link.')
          const start = root.source.start, end = root.source.end
          const indent = /^[\t ]*/.exec(file.text.slice(file.text.lastIndexOf('\n', start - 1) + 1, start))?.[0] ?? ''
          const prefix = `NavigationStack {\n${indent}    `
          const body = file.text.slice(start, end).replace(/\n/g, '\n    ')
          const wrapped = file.text.slice(0, start) + prefix + body + `\n${indent}}` + file.text.slice(end)
          const shifted = offset + prefix.length + (file.text.slice(start, offset).match(/\n/g)?.length ?? 0) * 4
          changed = insertView(wrapped, file.id, shifted, operation.snippet)
        } else changed = insertView(file.text, file.id, offset, operation.snippet)
        break
      }
      case 'hide': changed = hideView(file.text, file.id, offset); break
      case 'show': changed = showView(file.text, file.id, offset); break
    }
  }
  if (!changed) return reject('This operation has no valid destination or would leave invalid view content.')
  const next = Parser.parse(changed.text, file.id)
  if (next.diagnostics.some(d => d.severity === 'error')) return reject('The proposed change does not parse. The project was not changed.')
  const nextDiagnostics = Checker.check(ast.map(f => f.span.file === file.id ? next.sourceFile : f)).diagnostics
  // Existing unrelated semantic diagnostics can remain; new errors cannot be committed.
  const signature = (d: (typeof diagnostics)[number]) => JSON.stringify([d.code, d.message, d.span.file])
  const remaining = new Map<string, number>()
  for (const d of diagnostics.filter(d => d.severity === 'error')) remaining.set(signature(d), (remaining.get(signature(d)) ?? 0) + 1)
  for (const d of nextDiagnostics.filter(d => d.severity === 'error')) {
    const key = signature(d), count = remaining.get(key) ?? 0
    if (!count) return reject('The proposed change introduces a source diagnostic: ' + d.message)
    remaining.set(key, count - 1)
  }
  const nextFiles = request.files.map(f => f.id === file.id ? { ...f, text: changed.text } : f)
  if (materializeCard) return finish(nextFiles, { file: file.id, offset: changed.offset })
  const authoring = buildAuthoringModel({ projectId: request.projectId, revision: request.authoringRevision ?? 0, files: nextFiles, parsed: ast.map(f => f.span.file === file.id ? next.sourceFile : f), diagnostics: nextDiagnostics, componentDescriptions: request.componentDescriptions, deploymentTarget: request.deploymentTarget })
  return { ok: true, authoring, projectId: request.projectId, baseRevision: request.baseRevision, changes: changed.text === file.text ? [] : [{ file: file.id, before: file.text, after: changed.text }], selection: operation.kind === 'delete' || operation.kind === 'hide' ? null : { file: file.id, offset: changed.offset } }
}

/** Independent edits and new source files share one plan and one commit. */
export function planDesignBatch(requests: readonly DesignEditRequest[], newFiles: readonly SourceFile[] = []): DesignEditPlan {
  const first = requests[0]
  if (!first) return { ok: false, reason: 'A batch needs a source command to establish project ownership.' }
  const changes: SourceChange[] = []
  let selection: { file: string; offset: number } | null = null
  const affected = new Set<string>()
  for (const request of requests) {
    if (request.projectId !== first.projectId || request.baseRevision !== first.baseRevision || JSON.stringify(request.files) !== JSON.stringify(first.files)) return { ok: false, reason: 'Every batch command must use the same project and revision.' }
    const plan = planDesignEdit(request)
    if (!plan.ok) return plan
    for (const change of plan.changes) {
      if (affected.has(change.file)) return { ok: false, reason: 'Overlapping file edits must be expressed as one source command.' }
      affected.add(change.file); changes.push(change)
    }
    selection = plan.selection
  }
  for (const file of newFiles) {
    if (affected.has(file.id) || first.files.some(f => f.id === file.id)) return { ok: false, reason: 'A new file conflicts with an existing or changed file.' }
    affected.add(file.id); changes.push({ file: file.id, before: null, after: file.text })
  }
  const nextFiles = first.files.map(f => ({ ...f, text: changes.find(c => c.file === f.id)?.after ?? f.text })).concat(newFiles)
  const parsed = nextFiles.map(f => Parser.parse(f.text, f.id))
  if (parsed.some(p => p.diagnostics.some(d => d.severity === 'error'))) return { ok: false, reason: 'A proposed source file has syntax errors. No files were changed.' }
  const beforeErrors = Checker.check(first.files.map(f => Parser.parse(f.text, f.id).sourceFile)).diagnostics.filter(d => d.severity === 'error')
  const afterErrors = Checker.check(parsed.map(p => p.sourceFile)).diagnostics.filter(d => d.severity === 'error')
  if (afterErrors.some(d => !beforeErrors.some(old => old.code === d.code && old.message === d.message && old.span.file === d.span.file)) || afterErrors.length > beforeErrors.length) return { ok: false, reason: 'The combined sources introduce a semantic error. No files were changed.' }
  return { ok: true, projectId: first.projectId, baseRevision: first.baseRevision, changes, selection }
}

/** Validate the complete post-edit program before any file is committed. */
function finishDesignPlan(request: DesignEditRequest, nextFiles: readonly SourceFile[], selection: { file: string; offset: number }, colors?: readonly PreviewColorAsset[]): DesignEditPlan {
  const parsed = nextFiles.map(f => Parser.parse(f.text, f.id))
  if (parsed.some(p => p.diagnostics.some(d => d.severity === 'error'))) return { ok: false, reason: 'The proposed design change has a syntax error. No files were changed.' }
  const diagnostics = Checker.check(parsed.map(p => p.sourceFile)).diagnostics
  const before = Checker.check(request.files.map(f => Parser.parse(f.text, f.id).sourceFile)).diagnostics
  const signature = (d: (typeof diagnostics)[number]) => JSON.stringify([d.code, d.message, d.span.file])
  const counts = new Map<string, number>()
  for (const d of before.filter(d => d.severity === 'error')) counts.set(signature(d), (counts.get(signature(d)) ?? 0) + 1)
  for (const d of diagnostics.filter(d => d.severity === 'error')) {
    const remaining = counts.get(signature(d)) ?? 0
    if (!remaining) return { ok: false, reason: 'The proposed change introduces a source diagnostic: ' + d.message }
    counts.set(signature(d), remaining - 1)
  }
  const changes: SourceChange[] = nextFiles.flatMap(f => {
    const before = request.files.find(old => old.id === f.id)?.text ?? null
    return before === f.text ? [] : [{ file: f.id, before, after: f.text }]
  })
  // A file an edit emptied out - a style moved to Tokens.swift - goes in the same step.
  for (const old of request.files) if (!nextFiles.some(f => f.id === old.id)) changes.push({ file: old.id, before: old.text, after: '', deleted: true })
  const authoring = buildAuthoringModel({ ...request, files: nextFiles, colors: colors ?? request.colors, parsed: parsed.map(p => p.sourceFile), revision: request.authoringRevision ?? 0, diagnostics })
  return { ok: true, projectId: request.projectId, baseRevision: request.baseRevision, changes, selection, authoring, ...(colors ? { colorSets: colors } : {}) }
}
