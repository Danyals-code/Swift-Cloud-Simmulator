import type { Project } from '@studio/project-model'
import { LineIndex, type CompileResult, type SourceSpan } from '@studio/shared'
import { MAX_PROBLEM_MESSAGE, MAX_PROBLEM_SOURCE, type PreviewProblem } from './previousAttempt'

/** The errors the preview reports for `project`, each with where it is when the preview says. */
function problemsIn(result: CompileResult, project: Project): PreviewProblem[] {
  const at = (full: string, span: SourceSpan | undefined): PreviewProblem => {
    const message = full.slice(0, MAX_PROBLEM_MESSAGE)
    const text = span && project.files.find(file => file.id === span.file)?.text
    if (text === undefined || !span) return { message }
    const lines = new LineIndex(text)
    const { line } = lines.locate(span.start)
    return { message, file: span.file, line, source: lines.lineText(line).trim().slice(0, MAX_PROBLEM_SOURCE) }
  }
  const found = [
    ...result.diagnostics.filter(d => d.severity === 'error').map(d => at(d.message, d.span)),
    ...result.logs.filter(log => log.level === 'error').map(log => at(log.message, log.origin)),
  ]
  // The preview reports what stops on the screen on show. A view that stops on another
  // screen, as iOS would run it once that screen opens, is only drawn stopped there.
  const seen = new Set<string>()
  for (const node of (result.pages ?? []).flatMap(page => page.tree.nodes)) {
    if (!node.placeholder?.stopped) continue
    const problem = at(node.placeholder.reason, node.origin)
    const place = `${problem.message}@${node.origin?.file}:${node.origin?.start}`
    if (seen.has(place) || found.some(reported => reported.message.startsWith(problem.message))) continue
    seen.add(place)
    found.push(problem)
  }
  return found
}

/**
 * What makes two errors the same one, before and after an answer: the message without
 * the name it suggests, which changes with every name the answer adds.
 */
const sameError = (problem: PreviewProblem) => problem.message.replace(/ Did you mean [^?]*\?$/, '')

/** A problem as the participant reads it: the message, and where it is when the preview says. */
export function describeProblem(problem: PreviewProblem): string {
  if (!problem.file) return problem.message
  const where = `${problem.file.replace(/^Sources\//, '')}${problem.line ? `, line ${problem.line}` : ''}`
  return `${problem.message.replace(/\.$/, '')} (${where}).`
}

/**
 * Checks AI answers against the project they change (G2): each check says which errors
 * the answer brought, and never those `before` already had, which would otherwise
 * block every AI edit to a project with one.
 */
export function previewCheck(compile: (project: Project) => Promise<CompileResult>, before: Project | null): (after: Project) => Promise<readonly PreviewProblem[]> {
  let known: Promise<PreviewProblem[]> | undefined
  return async after => {
    const found = problemsIn(await compile(after), after)
    if (!found.length || !before) return found
    known ??= compile(before).then(result => problemsIn(result, before))
    // The same error twice where the project had it once is one new error.
    const had = new Map<string, number>()
    for (const problem of await known) had.set(sameError(problem), (had.get(sameError(problem)) ?? 0) + 1)
    return found.filter(problem => {
      const left = had.get(sameError(problem)) ?? 0
      had.set(sameError(problem), left - 1)
      return left <= 0
    })
  }
}
