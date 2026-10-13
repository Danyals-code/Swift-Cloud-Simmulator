import type { Diagnostic, SourceSpan } from '@studio/shared'
import type { Token } from './tokens'

/**
 * `#if … #elseif … #else … #endif`, reduced to the tokens an iOS Debug build in the
 * simulator compiles.
 *
 * Swift compiles one clause of each block and ignores the others, wherever the block
 * is written: among statements, view-builder children, members, top-level
 * declarations or the steps of a modifier chain. Dropping the directives and the
 * clauses that are not compiled from the token stream gives the parser what the
 * compiler sees, at every one of those positions, and every token kept still carries
 * its place in the file - so the tree, the checker, the interpreter and the writers
 * all read ordinary Swift, and a writer's span is still a span of the real text.
 */
export function compiledTokens(tokens: readonly Token[]): { tokens: Token[]; diagnostics: Diagnostic[] } {
  if (!tokens.some(isDirective)) return { tokens: [...tokens], diagnostics: [] }
  const kept: Token[] = []
  const diagnostics: Diagnostic[] = []
  // One entry per open block: whether its enclosing code is compiled, whether a clause
  // already held (so later ones are skipped), and whether the current one is compiled.
  const open: { outer: boolean; taken: boolean; compiled: boolean; sawElse: boolean; start: Token }[] = []
  const compiling = () => open.length === 0 || open[open.length - 1]!.compiled
  const error = (span: SourceSpan, code: Diagnostic['code'], message: string) => diagnostics.push({ span, severity: 'error', code, message })

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!
    if (!isDirective(token)) {
      if (compiling() || token.kind === 'endOfFile') kept.push(token)
      continue
    }
    // A condition runs to the end of its line.
    let end = index + 1
    while (end < tokens.length && !tokens[end]!.newlineBefore && tokens[end]!.kind !== 'endOfFile') end++
    const condition = tokens.slice(index + 1, end)
    index = end - 1
    const block = open[open.length - 1]
    switch (token.text) {
      case 'if': {
        const outer = compiling()
        const holds = outer && holdsInDebugSimulator(condition)
        open.push({ outer, taken: holds, compiled: holds, sawElse: false, start: token })
        break
      }
      case 'elseif':
      case 'else': {
        if (!block) { error(token.span, 'unexpected_token', `'#${token.text}' has no '#if' to belong to.`); break }
        if (block.sawElse) { error(token.span, 'unexpected_token', `'#${token.text}' cannot follow '#else'.`); break }
        const holds = block.outer && !block.taken && (token.text === 'else' || holdsInDebugSimulator(condition))
        block.compiled = holds
        block.taken ||= holds
        block.sawElse = token.text === 'else'
        break
      }
      default: {
        if (!block) { error(token.span, 'unexpected_token', "'#endif' has no '#if' to close."); break }
        open.pop()
      }
    }
  }
  for (const block of open) error(block.start.span, 'expected_token', "Expected '#endif' to close this '#if'.")
  return { tokens: kept, diagnostics }
}

const DIRECTIVES: ReadonlySet<string> = new Set(['if', 'elseif', 'else', 'endif'])

/** A line that opens, divides or closes a conditional compilation block. */
export const DIRECTIVE_LINE = /^[ \t]*#(?:if|elseif|else|endif)\b/m

function isDirective(token: Token): boolean {
  return token.kind === 'macro' && DIRECTIVES.has(token.text)
}

/**
 * The frameworks an iOS app can import. A Swift package the preview cannot load is
 * read as missing, so a `#else` fallback is what draws - closer to the app than the
 * package's code, which the preview could not run anyway.
 */
const IOS_MODULES: ReadonlySet<string> = new Set([
  'Swift', 'SwiftUI', 'UIKit', 'Foundation', 'Combine', 'Observation', 'SwiftData', 'CoreData', 'CoreGraphics',
  'CoreImage', 'CoreLocation', 'CoreMotion', 'CoreText', 'CoreTransferable', 'QuartzCore', 'MapKit', 'Charts',
  'PhotosUI', 'Photos', 'AVFoundation', 'AVKit', 'StoreKit', 'WidgetKit', 'ActivityKit', 'AppIntents', 'HealthKit',
  'UserNotifications', 'AuthenticationServices', 'CloudKit', 'GameKit', 'SpriteKit', 'SceneKit', 'RealityKit',
  'ARKit', 'Vision', 'VisionKit', 'NaturalLanguage', 'OSLog', 'os', 'TipKit', 'MessageUI', 'SafariServices',
  'WebKit', 'EventKit', 'Contacts', 'ContactsUI', 'LocalAuthentication', 'Network', 'CryptoKit', 'Accessibility',
  'UniformTypeIdentifiers', 'PencilKit', 'MusicKit', 'WeatherKit', 'Translation', 'FoundationModels', 'Darwin',
])

/** Swift 5 language mode, the exported project's, on the compiler Xcode ships. */
const LANGUAGE_VERSION = [5, 10]
const COMPILER_VERSION = [6, 2]

/**
 * A `#if` condition as an iOS Debug build in the simulator decides it: `DEBUG` set,
 * `os(iOS)`, `targetEnvironment(simulator)`, an arm64 Mac's simulator. A flag nobody
 * defined is false, as it is to the compiler.
 */
function holdsInDebugSimulator(condition: readonly Token[]): boolean {
  const words = condition.map(token => token.text).join(' ').match(/\|\||&&|!|\(|\)|,|>=|<=|<|>|[A-Za-z_][A-Za-z0-9_]*|\d+(?:\.\d+)*/g) ?? []
  let at = 0
  const take = () => words[at++]
  const or = (): boolean => {
    let value = and()
    while (words[at] === '||') { take(); value = and() || value }
    return value
  }
  const and = (): boolean => {
    let value = not()
    while (words[at] === '&&') { take(); value = not() && value }
    return value
  }
  const not = (): boolean => {
    if (words[at] === '!') { take(); return !not() }
    return primary()
  }
  const primary = (): boolean => {
    const word = take()
    if (word === '(') {
      const value = or()
      if (words[at] === ')') take()
      return value
    }
    if (words[at] !== '(') return word === 'DEBUG' || word === 'true'
    take()
    const args: string[] = []
    while (at < words.length && words[at] !== ')') args.push(take()!)
    take()
    const first = args[0] ?? ''
    switch (word) {
      case 'os': return first === 'iOS'
      case 'targetEnvironment': return first === 'simulator'
      case 'arch': return first === 'arm64'
      case 'canImport': return IOS_MODULES.has(first)
      case '_endian': return first === 'little'
      case '_pointerBitWidth': return first === '_64'
      case '_runtime': return first === '_ObjC'
      case 'swift': return compares(LANGUAGE_VERSION, args)
      case 'compiler': return compares(COMPILER_VERSION, args)
      default: return false
    }
  }
  return or()
}

function compares(version: readonly number[], args: readonly string[]): boolean {
  const [operator, written] = args
  if (!written || !operator) return false
  const other = written.split('.').map(Number)
  let order = 0
  for (let i = 0; i < Math.max(version.length, other.length) && order === 0; i++) order = Math.sign((version[i] ?? 0) - (other[i] ?? 0))
  return operator === '>=' ? order >= 0 : operator === '<' ? order < 0 : false
}
