import { ZERO_INSETS, type EdgeInsets, type LayoutElement, type StackElement } from './elements'

const DEFAULT: EdgeInsets = { top: 8, bottom: 8, leading: 8, trailing: 8 }

/** Outer spacing preferences survive wrappers and combine across containers. */
export function preferredSpacing(element: LayoutElement): EdgeInsets {
  if (element.preferredSpacing) return element.preferredSpacing
  if (element.kind === 'empty' || element.kind === 'spacer') return ZERO_INSETS
  if (element.kind === 'modified') return preferredSpacing(element.child)
  if (element.kind === 'stack' || element.kind === 'zstack') {
    const children = element.children.map(preferredSpacing)
    if (!children.length) return ZERO_INSETS
    const union = (edge: keyof EdgeInsets) => Math.max(...children.map((child) => child[edge]))
    const first = children[0]!, last = children[children.length - 1]!
    return {
      top: element.kind === 'stack' && element.axis === 'vertical' ? first.top : union('top'),
      bottom: element.kind === 'stack' && element.axis === 'vertical' ? last.bottom : union('bottom'),
      leading: element.kind === 'stack' && element.axis === 'horizontal' ? first.leading : union('leading'),
      trailing: element.kind === 'stack' && element.axis === 'horizontal' ? last.trailing : union('trailing'),
    }
  }
  return DEFAULT
}

function isSpacer(element: LayoutElement): boolean {
  return element.kind === 'spacer' || (element.kind === 'modified' && isSpacer(element.child))
}

/** Explicit gaps, including zero/negative values, bypass automatic preferences. */
export function stackGaps(stack: StackElement): number[] {
  return stack.children.slice(1).map((child, index) => {
    if (stack.spacing !== null) return stack.spacing
    const before = stack.children[index]!
    // Spacer carries its own minimum. Adding automatic gaps would count it twice.
    if (isSpacer(before) || isSpacer(child)) return 0
    const a = preferredSpacing(before), b = preferredSpacing(child)
    return stack.axis === 'vertical' ? Math.max(a.bottom, b.top) : Math.max(a.trailing, b.leading)
  })
}
