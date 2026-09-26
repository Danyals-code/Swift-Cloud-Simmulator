import { parsePreviousAttempt, type PreviousAttempt } from './previousAttempt'

export type Provider = 'openai' | 'anthropic'
export interface GenerationOptions {
  provider: Provider
  model: string
  prompt: string
  pageCount: number
  navigation: 'tabs' | 'stack'
  accent: 'blue' | 'indigo' | 'teal' | 'orange' | 'purple'
  sampleData: boolean
  includeSettings: boolean
  /** The second request of an attempt: what was wrong with the first answer (G2). */
  previousAttempt?: PreviousAttempt
}
export interface GeneratedApp {
  name: string
  summary: string
  pages: { title: string; file: string }[]
  files: { path: string; code: string }[]
}
export const DEFAULT_MODELS: Record<Provider, string> = { openai: 'gpt-5.4-mini', anthropic: 'claude-sonnet-5' }
export const PROJECT_SCHEMA = {
  type: 'object', additionalProperties: false,
  properties: {
    name: { type: 'string', description: 'The Swift @main App type name, an ASCII identifier ending in App.' },
    summary: { type: 'string' },
    pages: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { title: { type: 'string' }, file: { type: 'string' } }, required: ['title', 'file'] } },
    files: { type: 'array', items: { type: 'object', additionalProperties: false, properties: { path: { type: 'string' }, code: { type: 'string' } }, required: ['path', 'code'] } },
  },
  required: ['name', 'summary', 'pages', 'files'],
} as const
const record = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function parseOptions(value: unknown): GenerationOptions {
  if (!record(value) || !['openai', 'anthropic'].includes(String(value.provider))) throw new Error('Choose OpenAI or Anthropic.')
  if (typeof value.prompt !== 'string' || value.prompt.trim().length < 20 || value.prompt.length > 6000) throw new Error('Describe your app in 20–6,000 characters.')
  if (typeof value.model !== 'string' || !/^[a-zA-Z0-9._:-]{1,100}$/.test(value.model)) throw new Error('Enter a valid model ID.')
  if (!Number.isInteger(value.pageCount) || Number(value.pageCount) < 1 || Number(value.pageCount) > 6) throw new Error('Choose between 1 and 6 pages.')
  if (!['tabs', 'stack'].includes(String(value.navigation)) || !['blue', 'indigo', 'teal', 'orange', 'purple'].includes(String(value.accent))) throw new Error('Choose a navigation style and accent color.')
  if (typeof value.sampleData !== 'boolean' || typeof value.includeSettings !== 'boolean') throw new Error('Invalid project options.')
  const previousAttempt = parsePreviousAttempt(value.previousAttempt)
  return { provider: value.provider as Provider, model: value.model, prompt: value.prompt.trim(), pageCount: value.pageCount as number, navigation: value.navigation as GenerationOptions['navigation'], accent: value.accent as GenerationOptions['accent'], sampleData: value.sampleData, includeSettings: value.includeSettings, ...(previousAttempt ? { previousAttempt } : {}) }
}

const SWIFT_PATH = /^Sources\/(?:[A-Za-z][A-Za-z0-9_]*\/)*[A-Za-z][A-Za-z0-9_]*\.swift$/

/** Reject the entire response rather than silently dropping or renaming model files. */
export function parseGeneratedApp(value: unknown, expectedPages?: number): GeneratedApp {
  if (!record(value) || typeof value.name !== 'string' || !/^[A-Z][A-Za-z0-9]{0,60}App$/.test(value.name)) throw new Error('The response did not contain a valid app name. Try generating again.')
  if (typeof value.summary !== 'string' || !value.summary.trim() || value.summary.length > 2000) throw new Error('The app description is missing or too long.')
  if (!Array.isArray(value.files) || value.files.length < 1 || value.files.length > 24) throw new Error('The response must contain 1–24 Swift files.')
  const paths = new Set<string>()
  let total = 0
  const files = value.files.map((f) => {
    if (!record(f) || typeof f.path !== 'string' || !SWIFT_PATH.test(f.path) || f.path.length > 180) {
      // A folder written beside Sources/ rather than in it: say which, and where it goes (G2).
      if (record(f) && typeof f.path === 'string' && f.path.length < 170 && SWIFT_PATH.test(`Sources/${f.path}`)) throw new Error(`A generated file is not under Sources/: ${f.path}. Every file goes under Sources/, such as Sources/${f.path}.`)
      throw new Error('The response contained an invalid Swift file path.')
    }
    if (paths.has(f.path.toLowerCase())) throw new Error('The response contained duplicate file names.')
    paths.add(f.path.toLowerCase())
    if (typeof f.code !== 'string' || !f.code.trim() || f.code.length > 60000) throw new Error('The response contained an empty or oversized file.')
    total += f.code.length
    if (total > 240000) throw new Error('This app is too large. Try fewer pages or a smaller scope.')
    return { path: f.path, code: f.code }
  })
  if (!Array.isArray(value.pages) || value.pages.length < 1 || value.pages.length > 6) throw new Error('The generated page count does not match your request. Try generating again.')
  // A page either way is how the AI often reads "3 pages": a detail screen counted or not (G2).
  if (expectedPages !== undefined && Math.abs(value.pages.length - expectedPages) > 1) throw new Error(`The app has ${value.pages.length} ${value.pages.length === 1 ? 'page' : 'pages'}, and ${expectedPages} ${expectedPages === 1 ? 'was' : 'were'} asked for.`)
  const pages = value.pages.map((p) => {
    if (!record(p) || typeof p.title !== 'string' || !p.title.trim() || p.title.length > 100 || typeof p.file !== 'string' || !files.some(f => f.path === p.file)) throw new Error('A generated page refers to a missing file.')
    return { title: p.title, file: p.file }
  })
  // Check the entry point without mistaking commented examples for real declarations.
  const sources = files.map(f => f.code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, ''))
  if (sources.join('\n').match(/@main\b/g)?.length !== 1 || !sources.some(s => new RegExp(`@main\\s+(?:public\\s+)?struct\\s+${value.name}\\s*:\\s*App\\b`).test(s))) throw new Error('The response needs one complete SwiftUI app entry point.')
  return { name: value.name, summary: value.summary, pages, files }
}
