import type { Rect, RenderNode, RenderTree, RGBA, SourceSpan } from '@studio/shared'

export interface ReviewFinding { readonly kind: 'contrast' | 'touch' | 'overflow'; readonly nodeId: string; readonly title: string; readonly detail: string; readonly source?: SourceSpan }
const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
const covers = (a: Rect, b: Rect) => a.x <= b.x && a.y <= b.y && a.x + a.width >= b.x + b.width && a.y + a.height >= b.y + b.height
function solidCoverage(node: RenderNode, rect: Rect): boolean {
  if (!covers(node.frame, rect) || node.path || node.shape && !['rectangle', 'roundedRectangle'].includes(node.shape.shape)) return false
  const radius = node.cornerRadius ?? node.shape?.cornerRadius ?? 0
  // The central horizontal/vertical strips of a rounded rectangle are fully solid.
  return !radius || rect.x >= node.frame.x + radius && rect.x + rect.width <= node.frame.x + node.frame.width - radius || rect.y >= node.frame.y + radius && rect.y + rect.height <= node.frame.y + node.frame.height - radius
}
function luminance(color: RGBA) {
  const linear = [color.r, color.g, color.b].map(v => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4 })
  return linear[0]! * 0.2126 + linear[1]! * 0.7152 + linear[2]! * 0.0722
}
export function contrastRatio(a: RGBA, b: RGBA) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }

/** Conservative preview checks. Complex compositing is explicitly unmeasured. */
export function reviewTree(tree: RenderTree) {
  const findings: ReviewFinding[] = [], byId = new Map(tree.nodes.map(n => [n.id, n]))
  const canvas = { x: 0, y: 0, ...tree.canvas }
  let contrastChecked = 0, contrastSkipped = 0
  const ancestors = (node: RenderNode) => { const parents: RenderNode[] = [], seen = new Set([node.id]); let p = node.parent; while (p && !seen.has(p)) { seen.add(p); const parent = byId.get(p); if (!parent) break; parents.push(parent); p = parent.parent }; return parents }
  const complex = (node: RenderNode) => !!(node.transform || node.filter || node.material || node.blendMode && node.blendMode !== 'normal' || node.opacity < 1)
  const ordered = [...tree.nodes].sort((a, b) => a.z - b.z)
  for (let index = 0; index < ordered.length; index++) {
    const node = ordered[index]!, parents = ancestors(node)
    if (node.opacity <= 0 || node.inert || node.a11y?.hidden || parents.some(p => p.opacity <= 0 || p.inert || p.a11y?.hidden) || node.frame.width <= 0 || node.frame.height <= 0) continue
    if (parents.some(p => (p.clip || p.scroll) && !overlaps(p.frame, node.frame))) continue
    const label = (node.a11y?.label || node.text?.runs.map(r => r.text).join('') || node.inspect?.name || 'Control').slice(0, 80)
    const add = (kind: ReviewFinding['kind'], title: string, detail: string) => findings.push({ kind, nodeId: node.id, title: `${title}: ${label}`, detail, source: node.origin })
    const measurable = !complex(node) && !parents.some(complex)
    if (measurable && overlaps(canvas, node.frame) && node.hitTarget?.enabled && !['drag', 'contextMenu'].includes(node.hitTarget.role) && (node.frame.width < 44 || node.frame.height < 44)) add('touch', 'Small touch target', `${Math.round(node.frame.width)} × ${Math.round(node.frame.height)} pt. Aim for a hit region of at least 44 × 44 pt, using padding or a larger control size.`)
    if (measurable && (node.text || node.hitTarget)) {
      const horizontal = node.frame.x < -1 || node.frame.x + node.frame.width > canvas.width + 1
      const vertical = node.frame.y < -1 || node.frame.y + node.frame.height > canvas.height + 1
      if (horizontal && !parents.some(p => p.scroll?.axis === 'horizontal') || vertical && !parents.some(p => p.scroll?.axis === 'vertical')) add('overflow', 'Extends beyond screen', 'Check fixed sizes, spacing, and text wrapping. Use a scrolling container when content should continue beyond the screen.')
    }
    if (!node.text || !overlaps(canvas, node.frame) || node.redacted) continue
    // Skip offscreen/clipped text, transforms and translucent text. A result must
    // describe actual, uniform colors rather than infer pixels behind a material.
    if (!measurable || !covers(canvas, node.frame) || parents.some(p => (p.clip || p.scroll) && !covers(p.frame, node.frame)) || node.text.runs.some(r => r.color.a < 1)) { contrastSkipped++; continue }
    let background: RGBA | null = tree.colorScheme === 'dark' ? { r: 0, g: 0, b: 0, a: 1 } : { r: 255, g: 255, b: 255, a: 1 }
    for (const paint of ordered.slice(0, index + 1)) {
      if (paint.opacity <= 0 || !overlaps(paint.frame, node.frame) || ancestors(paint).some(p => p.opacity <= 0 || (p.clip || p.scroll) && !overlaps(p.frame, node.frame))) continue
      const fill = paint.background ?? paint.shape?.fill ?? paint.path?.fill
      if (!fill && !paint.image && !paint.material && !paint.filter) continue
      if (complex(paint) || ancestors(paint).some(complex) || paint.image || paint.material || !solidCoverage(paint, node.frame) || fill?.kind !== 'solid' || fill.color.a < 1) background = null
      else background = fill.color
    }
    if (!background) { contrastSkipped++; continue }
    contrastChecked++
    const low = node.text.runs.filter(r => r.text.trim()).map(run => ({ ratio: contrastRatio(run.color, background!), minimum: run.font.size >= 24 || run.font.size >= 18.667 && run.font.weight >= 700 ? 3 : 4.5 })).filter(r => r.ratio < r.minimum).sort((a, b) => a.ratio - b.ratio)[0]
    if (low) add('contrast', 'Low text contrast', `${low.ratio.toFixed(2)}:1 against the measured solid background; aim for ${low.minimum}:1. Adjust the text or fill color and check both themes.`)
  }
  return { findings, contrastChecked, contrastSkipped }
}
