import { describe, expect, it } from 'vitest'
import { galleryChangeView, viewCentredOn } from './canvasView'

/** Where the Design canvas looks, as the screens it is asked to show come and go. */
describe('bringing a screen into view', () => {
  const viewport = { width: 900, height: 700 }
  const phone = { left: 1000, top: 1200, width: 400, height: 800 }

  it('puts the screen in the middle of the viewport at the zoom it is at', () => {
    expect(viewCentredOn(phone, viewport, 0.5, 28)).toEqual({ x: -150, y: -450, scale: 0.5 })
  })

  it('zooms out as far as it takes to show all of a screen too tall for the viewport, and never in', () => {
    // 644 of the 700 points are left inside the padding: 644 / 800.
    const fitted = viewCentredOn(phone, viewport, 1, 28)
    expect(fitted.scale).toBeCloseTo(0.805)
    expect(fitted.x).toBeCloseTo(-516)
    expect(fitted.y).toBeCloseTo(-938)
    expect(viewCentredOn(phone, viewport, 0.2, 28).scale).toBe(0.2)
  })
})

describe('the canvas changing between one phone and every screen', () => {
  it('fits the first screens a workspace draws while Fit is chosen, as a workspace opens', () => {
    expect(galleryChangeView({ first: true, zoom: 'fit' })).toBe('fit')
  })

  it('otherwise keeps the phone being looked at where it is, at its zoom', () => {
    expect(galleryChangeView({ first: true, zoom: '0.5' })).toBe('keep')
    expect(galleryChangeView({ first: false, zoom: 'fit' })).toBe('keep')
  })
})
