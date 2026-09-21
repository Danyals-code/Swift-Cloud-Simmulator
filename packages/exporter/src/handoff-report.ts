import { validatePromptHistory, type Project } from '@studio/project-model'
import { normalizePreviewTarget } from '@studio/shared'
import { encodeText, newBundle, type ExportBundle } from './bundle'

export interface ScreenSnapshot {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly width: number
  readonly height: number
  readonly png: Uint8Array
}
export interface ExportReview {
  readonly device: string
  readonly colorScheme: 'light' | 'dark'
  readonly dynamicTypeSize: string
  readonly typeScale: number
  readonly screens: readonly ScreenSnapshot[]
  readonly diagnostics: readonly string[]
}

/** Human-readable handoff plus lossless settings and conversation records. No credentials. */
export function attachExportReview(project: Project, bundle: ExportBundle, review: ExportReview): ExportBundle {
  validatePromptHistory(project.chatHistory ?? [])
  if (!review.screens.length) throw new Error('No screen images were captured. Use a code-only export or resolve the preview errors.')
  const root = project.manifest.name, output = newBundle(root), base = `${root}/Studio Report`
  for (const [path, bytes] of bundle) output.put(path, bytes)
  const screens = review.screens.map((screen, index) => {
    if (!screen.png.length || screen.png.length > 4 * 1024 * 1024) throw new Error('A screen image exceeds the 4 MB archive limit. Export at a smaller device size.')
    const slug = screen.name.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 70) || 'Screen'
    const path = `Screens/${String(index + 1).padStart(3, '0')}-${slug}.png`
    output.put(`${base}/${path}`, screen.png)
    return { id: screen.id, name: screen.name, kind: screen.kind, path, width: screen.width, height: screen.height, scale: 2 }
  })
  const history = project.chatHistory ?? []
  const json = (name: string, value: unknown) => output.put(`${base}/${name}`, encodeText(JSON.stringify(value, null, 2) + '\n'))
  json('screens.json', screens)
  json('chat-history.json', history)
  json('settings.json', {
    manifest: project.manifest, previewTarget: normalizePreviewTarget(project.manifest.previewTarget),
    capture: { device: review.device, colorScheme: review.colorScheme, dynamicTypeSize: review.dynamicTypeSize, typeScale: review.typeScale, state: 'App starting content', scale: 2 },
    signing: { style: 'Automatic', developmentTeam: null },
    studio: project.studio ?? null, colors: project.colors ?? [],
    images: (project.assets ?? []).map(image => ({ name: image.name, scale: image.scale, width: image.light.width, height: image.light.height, darkVariant: !!image.dark })),
    sourceFiles: project.files.map(file => ({ path: file.id, bytes: encodeText(file.text).length })),
    diagnostics: review.diagnostics,
  })
  const quote = (text: string) => text.split('\n').map(line => `> ${line}`).join('\n')
  const chat = history.map(message => `## ${message.role === 'user' ? 'You' : 'AI'} · ${new Date(message.createdAt).toISOString()}\n\n${message.provider} / ${message.model} · ${message.kind}${message.status ? ` · ${message.status}` : ''}\n\n${message.selection ? `Selected: ${JSON.stringify(message.selection)}\n\n` : ''}${quote(message.content)}${message.changedFiles?.length ? `\n\nFiles: ${message.changedFiles.join(', ')}` : ''}`).join('\n\n')
  output.put(`${base}/chat-history.md`, encodeText(`# Prompts and AI conversation\n\n${chat || 'No prompts or AI messages have been saved in this project.'}\n`))
  const line = (value: string) => value.replace(/[\r\n]/g, ' ')
  const report = `# ${line(project.manifest.name)} — project report

## Contents

- Full Xcode project, shared scheme, asset catalog and original Swift source.
- ${screens.length} individual screen PNGs at 2× resolution; see screens.json for names and dimensions.
- settings.json contains app defaults, capture settings, resource inventory and designer metadata.
- chat-history.md and chat-history.json contain all ${history.length} saved prompt and AI messages, including unsuccessful requests and selection context.
- .swiftstudio metadata at the project root allows this archive to reopen in Studio.

## App defaults

- Bundle identifier: ${line(project.manifest.bundleId)}
- Minimum deployment target: iOS ${line(project.manifest.deploymentTarget)}
- Saved preview device: ${project.manifest.device}
- Saved appearance: ${project.manifest.colorScheme}
- Preview runtime / SDK / appearance: ${JSON.stringify(normalizePreviewTarget(project.manifest.previewTarget))}
- Signing: automatic; no development team is assigned. Choose your team in Xcode for a physical device.
- Fonts, padding, spacing and alignment retain the Swift source values. Omitted values use SwiftUI defaults; export does not add layout overrides.

## Screen capture

Device: ${line(review.device)}. Appearance: ${review.colorScheme}. Dynamic Type: ${line(review.dynamicTypeSize)}. Text multiplier: ${review.typeScale}.

Screens are fresh browser previews of app starting content, including discoverable navigation destinations, presentations and saved standalone screens. Runtime interactions and preview scenarios are not replayed. Data-dependent destinations that cannot be discovered from starting content need manual review in Xcode.

${screens.map(screen => `- ${line(screen.name)} (${screen.kind}): ${screen.path} — ${screen.width * 2} × ${screen.height * 2} pixels`).join('\n')}

## Sources and resources

${project.files.map(file => `- ${line(file.id)}`).join('\n')}

${project.assets?.length ?? 0} bundled images; ${project.colors?.length ?? 0} color sets; ${project.studio?.components.length ?? 0} documented components; ${project.studio?.scenarios.length ?? 0} saved preview scenarios.

## Preview diagnostics

${review.diagnostics.length ? review.diagnostics.map(message => `- ${line(message)}`).join('\n') : 'No diagnostics reported during this capture.'}

## Build and review

Open ${line(project.manifest.name)}.xcodeproj in Xcode. The Swift files are exported byte for byte. Add external dependencies referenced by your code and resolve native compiler diagnostics there. This export has not been built or signed by Xcode.

Browser screenshots approximate SwiftUI. Font metrics, SF Symbols, materials, scrolling and unsupported APIs can differ on iOS. Verify accessibility and behavior on a simulator or device. The report records saved defaults; it does not infer settings absent from the source.

Chat records describe what happened when each request ran. Later manual edits or Undo may change those results. API credentials are not stored in the conversation or generated report.
`
  output.put(`${base}/report.md`, encodeText(report))
  if ([...output.files.values()].reduce((total, bytes) => total + bytes.length, 0) > 60 * 1024 * 1024) throw new Error('This bundle exceeds the 60 MB resource limit. Use a code-only export and export images separately.')
  return output.files
}
