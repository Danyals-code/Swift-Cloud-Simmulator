import type { SourceSpan } from '@studio/shared'
import { walk, type CallExpr, type Expr } from '@studio/swift-syntax'

/**
 * What the preview draws differently in Wave 6d's paint and scrolling, said where it is
 * written: a MeshGradient form it draws nothing for or draws in part, a mesh used as a
 * stroke or the foreground of text or a symbol, a view-aligned scroll's limit and a nil
 * content margin. Xcode draws each as written. Everything else 6d draws says nothing. Pure,
 * and only for the few calls it names.
 */
export interface PaintScrollWarning { readonly span: SourceSpan; readonly message: string; readonly feature: string }

/** The modifiers that paint a mesh in one of its colours in the preview, whatever they're on. */
const STROKES: ReadonlySet<string> = new Set(['stroke', 'strokeBorder', 'border'])
/** The views the preview paints a mesh foreground on in one of its colours; a shape takes it in full. */
const WORDS: ReadonlySet<string> = new Set(['Text', 'Label', 'Image'])

export const isMesh = (e: Expr): boolean => e.kind === 'call' && e.callee.kind === 'identifier' && e.callee.name === 'MeshGradient'
const named = (call: CallExpr, label: string) => call.args.find(a => a.label === label)?.value

/** A MeshGradient call's own forms the preview doesn't draw as written (Wave 6d). */
export function meshWarnings(call: CallExpr): PaintScrollWarning[] {
  const found: PaintScrollWarning[] = [], feature = 'MeshGradient'
  const locations = named(call, 'locations')
  if (locations) return [{ span: locations.span, message: 'The preview draws no mesh written with locations:. Write points: and colors: as arrays.', feature }]
  const points = named(call, 'points'), colors = named(call, 'colors'), width = named(call, 'width'), height = named(call, 'height')
  const inits = points?.kind === 'arrayLiteral' && points.elements.some(p => p.kind === 'call' && p.callee.kind === 'memberAccess' && !p.callee.base && p.callee.member === 'init')
  if (inits) found.push({ span: points.span, message: 'The preview draws no mesh with points written as .init. Write each as [x, y].', feature })
  else if (width?.kind === 'integerLiteral' && height?.kind === 'integerLiteral') {
    const places = width.value * height.value
    if (points?.kind === 'arrayLiteral' && points.elements.length !== places || colors?.kind === 'arrayLiteral' && colors.elements.length !== places) {
      found.push({ span: call.span, message: `A ${width.value} by ${height.value} mesh needs ${places} points and ${places} colors, so nothing draws.`, feature })
    }
  }
  for (const label of ['background', 'colorSpace']) {
    const value = named(call, label)
    if (value) found.push({ span: value.span, message: `The preview leaves out a mesh’s ${label}:.`, feature })
  }
  return found
}

/**
 * A modifier on `view` that the preview draws other than as written (Wave 6d); undefined for
 * every other. A mesh foreground is one colour on text or a symbol, or a view holding one.
 */
export function modifierPaintWarning(member: string, args: CallExpr['args'], view: Expr): PaintScrollWarning | undefined {
  if (STROKES.has(member) || member === 'foregroundStyle') {
    const mesh = args.find(a => isMesh(a.value))
    let words = STROKES.has(member)
    if (mesh && !words) walk(view, n => !(words ||= n.kind === 'call' && n.callee.kind === 'identifier' && WORDS.has(n.callee.name)))
    return mesh && words ? { span: mesh.value.span, message: 'The preview paints this mesh in one color.', feature: `.${member}(MeshGradient)` } : undefined
  }
  if (member === 'scrollTargetBehavior') {
    const behaviour = args[0]?.value
    const limited = behaviour?.kind === 'call' && behaviour.callee.kind === 'memberAccess' && !behaviour.callee.base && behaviour.callee.member === 'viewAligned' && behaviour.args.length > 0
    return limited ? { span: behaviour.span, message: 'The preview snaps to the nearest view, without this limit.', feature: '.scrollTargetBehavior(.viewAligned(limitBehavior:))' } : undefined
  }
  if (member === 'contentMargins') {
    const none = args.find(a => a.label === null && a.value.kind === 'nilLiteral')
    return none && { span: none.value.span, message: 'The preview estimates a nil margin as 16 pt.', feature: '.contentMargins(nil)' }
  }
  return undefined
}
