import { customizeCard, editsCardSurface } from './authoring-card'
import { editModifier } from './authoring-modifiers'
import { featureEdit } from './authoring-features'
import { argumentLayerProblem, canvasDropProblem, deploymentVersion, type DesignEditPlan, type DesignEditRequest, type PreviewColorAsset, type SourceFile, type SourceChange, type ModifierOperation } from '@studio/shared'
import { Parser, afterOffMarkers, forEachChild, deleteView, isSyntaxError, moveView, moveViewTo, insertView, hideView, showView, type Expr, type Node } from '@studio/swift-syntax'
import { buildAuthoringModel } from './authoring'
import { structuralEditProblem, type StructuralKind } from './structural-check'
import { applyPatches, type FeatureContext } from './authoring-context'
import { pastedValues } from './authoring-clipboard'
import { insideNavigationStack, navigationStackPatches } from './authoring-navigation'
import { liveControl } from './authoring-behavior'
import { TAPPABLE_WRAPPER, wrapperOf } from './authoring-structure'
import { designControlRecipes, spreadRoomProblem, validateControlValue, viewCallChain } from './design-controls'
import { Checker } from './checker'

/** The operations that act on a view's whole statement - its place, its copies, whether it is there at all - as the structural check knows them. */
const STRUCTURAL: Partial<Record<DesignEditRequest['operation']['kind'], StructuralKind>> = { delete: 'delete', move: 'move', moveTo: 'moveTo', insert: 'insert', paste: 'insert', hide: 'hide', show: 'show', 'layer-duplicate': 'duplicate', 'layer-wrap': 'wrap', 'layer-reparent': 'reparent', 'make-tappable': 'wrap' }

/** Plans against an immutable source revision. Commit must compare the whole project again. */
export function planDesignEdit(request: DesignEditRequest): DesignEditPlan {
  const reject = (reason: string): DesignEditPlan => ({ ok: false, reason })
  const file = request.files.find(f => f.id === request.target.file)
  if (!file) return reject('The target file is no longer available.')
  const parsed = request.files.map(f => Parser.parse(f.text, f.id))
  // Deliberately conservative: recovery ASTs are useful for reading, never for rewriting. Only the file
  // being changed has to parse - a half-typed draft somewhere else is no reason to stop designing.
  const broken = parsed.find(p => p.sourceFile.span.file === file.id)?.diagnostics.find(isSyntaxError)
  if (broken) return syntaxRefusal(file, broken.span.start)
  const ast = parsed.map(p => p.sourceFile)
  const diagnostics = Checker.check(ast).diagnostics
  const model = buildAuthoringModel({ ...request, revision: request.baseRevision, parsed: ast, diagnostics })
  const context: FeatureContext = { deploymentTarget: request.deploymentTarget, files: request.files, ast, nodes: model.nodes, descriptions: request.componentDescriptions, colors: request.colors }
  const matches = model.nodes.filter(n => n.source.file === file.id && n.source.start === request.target.start && n.source.end === request.target.end && n.fingerprint === request.fingerprint)
  // A slot written as an argument - `.overlay(Circle())` - has exactly the span of the view in it, and the view is what was selected.
  const node = matches.find(n => n.kind !== 'branch') ?? matches[0]
  const operation = request.operation
  if (operation.kind !== 'show' && !node) return reject('The source identity changed. Select the view again.')
  if (node && request.scope !== node.owner) return reject('The requested source ownership changed. Select the view again.')
  if (node && diagnostics.some(d => d.severity === 'error' && d.span.file === file.id && d.span.start < node.source.end && d.span.end >= node.source.start)) return reject('Resolve the diagnostics for this view before editing it.')
  // A view written as an argument has no statement of its own, so any of these would land on the view that takes it.
  const slotProblem = node && STRUCTURAL[operation.kind] ? argumentLayerProblem(model.nodes, node) : null
  if (slotProblem) return reject(slotProblem)
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
  if (node && (!['property', 'delete', 'move', 'moveTo', 'insert', 'paste', 'hide', 'show'].includes(operation.kind) || operation.kind === 'property' && operation.control.startsWith('component:'))) {
    try {
      const result = featureEdit(context, node, operation as Parameters<typeof featureEdit>[2])
      const after = result.files.find(f => f.id === file.id)?.text
      const kind = STRUCTURAL[operation.kind]
      const toward = operation.kind === 'layer-reparent' ? model.nodes.find(n => n.id === operation.destination)?.source.start : undefined
      const adds = operation.kind === 'layer-wrap' ? `${wrapperOf(context, node, operation.layout)} { }` : operation.kind === 'make-tappable' ? TAPPABLE_WRAPPER : undefined
      const problem = kind && after !== undefined && structuralEditProblem({ file: file.id, before: file.text, after, kind, view: node.source, adds, toward, inside: kind === 'reparent', landed: result.offset })
      if (problem) return reject(problem)
      // Any other feature rewrites in its own way; what it must not leave behind is a view that cannot build.
      for (const next of kind ? [] : result.files) {
        const old = request.files.find(f => f.id === next.id)
        const left = old && old.text !== next.text && structuralEditProblem({ file: next.id, before: old.text, after: next.text, kind: 'restructure', view: node.source })
        if (left) return reject(left)
      }
      return finish(result.files, { file: file.id, offset: result.offset }, result.colors)
    } catch (error) { return reject(error instanceof Error ? error.message : 'The design operation could not be planned.') }
  }
  let changed: { text: string; offset: number } | null = null
  /** Why an edit of the view refused, in the edit's own words (C7). */
  let refusal: string | undefined
  const refuse = (reason: string) => { refusal = reason }
  /** Set when an insert also wraps the screen in the NavigationStack a new link needs: all it brings. */
  let wrap: string | undefined
  // Where a structural change acts: the view itself, or for a row design's insert the collection it repeats in.
  /** A view added by this edit, from the library or pasted. */
  const adding = operation.kind === 'insert' || operation.kind === 'paste' ? operation : undefined
  const offset = node?.kind === 'template' && adding ? model.nodes.find(n => n.id === node.parentId)?.source.start ?? request.target.start : request.target.start
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
    const invalid = validateControlValue(recipe.control, operation.value) ?? recipe.problem?.(operation.value)
      ?? (operation.control === 'spacing' && operation.value === 'auto' && recipe.control.value !== 'auto' ? spreadRoomProblem(model.nodes, node) : null)
    if (invalid) return reject(invalid)
    if (operation.value === recipe.control.value || recipe.control.kind === 'number' && recipe.control.value !== '' && Number(operation.value) === Number(recipe.control.value)) {
      return materializeCard ? finish(request.files, { file: file.id, offset: node.source.start }) : { ok: true, projectId: request.projectId, baseRevision: request.baseRevision, changes: [], selection: { file: file.id, offset: node.source.start } }
    }
    const patch = recipe.patch(operation.value)
    changed = { text: file.text.slice(0, patch.start) + patch.text + file.text.slice(patch.end), offset: node.source.start }
    // A value written in more than one place, such as Auto spacing's Spacers (D4), may change nothing else.
    const reshaped = recipe.reshapes?.(operation.value)
    const problem = reshaped && structuralEditProblem({ file: file.id, before: file.text, after: changed.text, kind: 'spacing', view: node.source, ...reshaped })
    if (problem) return reject(problem)
  } else {
    switch (operation.kind) {
      case 'delete': changed = deleteView(file.text, file.id, offset, refuse); break
      case 'move': changed = moveView(file.text, file.id, offset, operation.direction, refuse); break
      case 'moveTo': {
        const problem = canvasDropProblem(model.nodes, node!, { file: file.id, start: operation.targetOffset }, operation.position)
        if (problem) return reject(problem)
        changed = moveViewTo(file.text, file.id, offset, operation.targetOffset, operation.position, refuse)
        break
      }
      case 'insert':
      case 'paste': {
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
        // A screen pushed onto a stack is on it already: a second stack would nest in it (D13).
        if (isLink && !hasNavigation && !insideNavigationStack(model.nodes, node!)) {
          if (deploymentVersion(request.deploymentTarget) < 16) return reject('Adding a navigation screen requires iOS 16 or later.')
          if (root.source.file !== file.id || root.kind !== 'view' || !parent || !['definition', 'branch'].includes(parent.kind)) return reject('Select a view within the screen before adding a navigation link.')
          // A modifier switched off at the end of the root's chain is written after it, and goes inside with it.
          const stack = navigationStackPatches(context, root.source, afterOffMarkers(file.text, root.source.end))
          const wrapped = applyPatches(context, stack).find(f => f.id === file.id)!.text
          // Only insertions: the view moves by what is written before it.
          const shifted = offset + stack.filter(p => p.start <= offset).reduce((moved, p) => moved + p.text.length, 0)
          changed = insertView(wrapped, file.id, shifted, operation.snippet, refuse)
          // The link and the stack the screen needs for it: two places, so checked as a wrap.
          wrap = `${operation.snippet} ${stack[0]!.text}${stack.at(-1)!.text}`
        } else {
          const live = node && operation.kind === 'insert' ? liveControl(context, node, operation.snippet) : null
          const brought = node && operation.kind === 'paste' ? pastedValues(context, node, operation.values) : undefined
          if (brought && 'problem' in brought) return reject(brought.problem)
          changed = insertView(file.text, file.id, offset, live?.snippet ?? operation.snippet, refuse)
          const member = live?.member ?? brought?.member
          if (member && changed) {
            // Values are declared above the view, which moves down by their lines.
            changed = { text: changed.text.slice(0, member.start) + member.text + changed.text.slice(member.end), offset: changed.offset + member.text.length - (member.end - member.start) }
            // The view and the values it reads: two places, so checked as a wrap.
            wrap = live ? `${live.snippet} ${live.declaration}` : `${operation.snippet} ${brought!.added.join(' ')}`
          }
        }
        break
      }
      case 'hide': changed = hideView(file.text, file.id, offset, refuse); break
      case 'show': changed = showView(file.text, file.id, offset, refuse); break
    }
  }
  if (!changed) return reject(refusal ?? 'This operation has no valid destination or would leave invalid view content.')
  const next = Parser.parse(changed.text, file.id)
  if (next.diagnostics.some(d => d.severity === 'error')) return reject('The proposed change does not parse. The project was not changed.')
  const structural = STRUCTURAL[operation.kind]
  if (structural) {
    const problem = structuralEditProblem({
      file: file.id, before: file.text, after: changed.text, view: node?.source ?? request.target,
      ...(wrap ? { kind: 'wrap', adds: wrap } : { kind: structural, adds: adding?.snippet }),
      toward: operation.kind === 'moveTo' ? operation.targetOffset : adding ? offset : undefined,
      inside: operation.kind === 'moveTo' ? operation.position === 'inside' : undefined,
      landed: !wrap && structural !== 'delete' && structural !== 'hide' && structural !== 'show' ? changed.offset : undefined,
    })
    if (problem) return reject(problem)
  }
  const nextDiagnostics = Checker.check(ast.map(f => f.span.file === file.id ? next.sourceFile : f)).diagnostics
  // Existing unrelated semantic diagnostics can remain; new errors cannot be committed.
  const signature = (d: (typeof diagnostics)[number]) => JSON.stringify([d.code, d.message, d.span.file])
  const remaining = new Map<string, number>()
  for (const d of diagnostics.filter(d => d.severity === 'error')) remaining.set(signature(d), (remaining.get(signature(d)) ?? 0) + 1)
  for (const d of nextDiagnostics.filter(d => d.severity === 'error')) {
    const key = signature(d), count = remaining.get(key) ?? 0
    // A pasted view reading something that is not where it landed: a value that could not come along, a row's item (D6).
    if (!count && operation.kind === 'paste' && d.code === 'unresolved_identifier' && d.span.file === file.id) {
      const name = changed.text.slice(d.span.start, d.span.end)
      return reject(`This view reads \`${name}\`, which doesn’t exist where it was pasted. Paste it where \`${name}\` is, or change it in Code.`)
    }
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
  const broken = brokenWrite(first.files, nextFiles)
  if (broken) return broken
  const parsed = nextFiles.map(f => Parser.parse(f.text, f.id))
  const beforeErrors = Checker.check(first.files.map(f => Parser.parse(f.text, f.id).sourceFile)).diagnostics.filter(d => d.severity === 'error')
  const afterErrors = Checker.check(parsed.map(p => p.sourceFile)).diagnostics.filter(d => d.severity === 'error')
  if (afterErrors.some(d => !beforeErrors.some(old => old.code === d.code && old.message === d.message && old.span.file === d.span.file)) || afterErrors.length > beforeErrors.length) return { ok: false, reason: 'The combined sources introduce a semantic error. No files were changed.' }
  return { ok: true, projectId: first.projectId, baseRevision: first.baseRevision, changes, selection }
}

/** Validate the complete post-edit program before any file is committed. */
function finishDesignPlan(request: DesignEditRequest, nextFiles: readonly SourceFile[], selection: { file: string; offset: number }, colors?: readonly PreviewColorAsset[]): DesignEditPlan {
  const broken = brokenWrite(request.files, nextFiles)
  if (broken) return broken
  const parsed = nextFiles.map(f => Parser.parse(f.text, f.id))
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

/**
 * A change may leave a file that does not parse alone, but a file it writes must parse afterwards. One
 * that was broken already is refused by name and line, where the error is now, for Show in Code.
 */
function brokenWrite(before: readonly SourceFile[], after: readonly SourceFile[]): DesignEditPlan | null {
  for (const next of after) {
    const old = before.find(f => f.id === next.id)
    if (old?.text === next.text || !Parser.parse(next.text, next.id).diagnostics.some(isSyntaxError)) continue
    const error = old && Parser.parse(old.text, old.id).diagnostics.find(isSyntaxError)
    return error ? syntaxRefusal(old, error.span.start) : { ok: false, reason: 'The proposed design change has a syntax error. No files were changed.' }
  }
  return null
}

/** Refuses a change to a file that does not parse, naming it and the line so the designer can find it in Code. */
function syntaxRefusal(file: SourceFile, offset: number): DesignEditPlan {
  const name = file.id.slice(file.id.lastIndexOf('/') + 1)
  const line = file.text.slice(0, offset).split('\n').length
  return { ok: false, reason: `${name} has an error on line ${line}, so its design can’t be changed until it’s fixed in Code.`, location: { file: file.id, offset } }
}
