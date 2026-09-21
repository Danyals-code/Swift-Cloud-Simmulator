import { useLayoutEffect, useRef } from 'react'
import type { RenderNode } from '@studio/shared'

/** Overlay geometry stays in points and never consumes content width. */
export function scrollThumb(viewport: number, content: number, offset: number) {
  const track = Math.max(0, viewport - 6)
  if (content <= viewport + 1 || track <= 0) return null
  const length = Math.min(track, Math.max(20, track * viewport / content))
  const position = 3 + Math.max(0, Math.min(1, offset / (content - viewport))) * (track - length)
  return { length, position }
}

export function ScrollIndicator({ node }: { node: RenderNode }) {
  const thumb = useRef<HTMLDivElement>(null)
  const axis = node.scroll?.axis
  useLayoutEffect(() => {
    // The child's layout effect runs before the parent's ref is attached.
    const indicator = thumb.current, panel = indicator?.parentElement
    if (!panel || !indicator || !axis) return
    let fade: ReturnType<typeof setTimeout> | undefined
    const update = (show: boolean) => {
      const vertical = axis === 'vertical'
      const geometry = scrollThumb(vertical ? panel.clientHeight : panel.clientWidth, vertical ? panel.scrollHeight : panel.scrollWidth, vertical ? panel.scrollTop : panel.scrollLeft)
      indicator.style.display = geometry ? 'block' : 'none'
      if (!geometry) return
      indicator.style.width = vertical ? '3px' : `${geometry.length}px`
      indicator.style.height = vertical ? `${geometry.length}px` : '3px'
      indicator.style.transform = `translate(${panel.scrollLeft + (vertical ? panel.clientWidth - 6 : geometry.position)}px, ${panel.scrollTop + (vertical ? geometry.position : panel.clientHeight - 6)}px)`
      if (show) {
        indicator.style.opacity = '1'
        clearTimeout(fade)
        fade = setTimeout(() => { indicator.style.opacity = '0' }, 900)
      }
    }
    const scroll = () => update(true)
    const resize = () => update(false)
    panel.addEventListener('scroll', scroll, { passive: true })
    const observer = new ResizeObserver(resize)
    observer.observe(panel)
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    update(false)
    return () => { panel.removeEventListener('scroll', scroll); observer.disconnect(); clearTimeout(fade) }
  }, [axis, node.scroll?.content.width, node.scroll?.content.height])
  return <div ref={thumb} data-scroll-indicator={axis} aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, zIndex: 2147483647, pointerEvents: 'none', borderRadius: 2, background: 'rgb(110 110 115 / 0.65)', boxShadow: '0 0 1px rgb(255 255 255 / 0.4)', opacity: 0, transition: 'opacity 180ms ease', willChange: 'transform' }} />
}
