import { describe, expect, it } from 'vitest'
import { getDevice } from '@studio/sim-shell'
import { deviceChrome } from './deviceChrome'

/**
 * The hardware drawn around the screen.
 *
 * The iPhone 18 Pro artwork is 978 x 2000 px, and its screen opening is the
 * transparent 874 x 1900 px at (52, 50): measured on both finishes, and the
 * opening's corners match Xcode 27's iPhone 18 Pro screen mask to 0.3 pt.
 */
describe('the frame around the screen', () => {
  const iphone18Pro = getDevice('iphone-18-pro')

  it('lays the iPhone 18 Pro artwork so its opening is exactly the screen', () => {
    const chrome = deviceChrome(iphone18Pro)
    const art = chrome.art!
    const pointsPerPixel = art.width / 978
    expect(chrome.screen).toEqual({ x: 24, y: 23 })
    expect(art.x + 52 * pointsPerPixel).toBeCloseTo(24, 2)
    expect(art.y + 50 * pointsPerPixel).toBeCloseTo(23, 2)
    expect(874 * pointsPerPixel).toBeCloseTo(402, 2)
    expect(Math.abs(1900 * pointsPerPixel - 874)).toBeLessThan(0.1)
    expect(art.height / 2000).toBeCloseTo(pointsPerPixel, 5)
  })

  it('makes the phone big enough for the artwork, on whole points', () => {
    const chrome = deviceChrome(iphone18Pro)
    expect({ width: chrome.width, height: chrome.height }).toEqual({ width: 450, height: 920 })
    expect(chrome.art!.x + chrome.art!.width).toBeLessThanOrEqual(450)
    expect(chrome.art!.y + chrome.art!.height).toBeLessThanOrEqual(920)
  })

  it('has a black phone for the light workspace and a silver one for the dark', () => {
    expect(deviceChrome(iphone18Pro).art).toMatchObject({ black: '/devices/iphone-18-pro-black.webp', silver: '/devices/iphone-18-pro-silver.webp' })
  })

  // The body's corner follows a 78 pt circle to within 0.3 pt, about 8 pt inside the box.
  it('rounds the whole phone as the artwork does, for what is drawn over it', () => {
    expect(deviceChrome(iphone18Pro).outerRadius).toBe(86)
  })

  it('keeps the drawn 10 pt frame on devices without artwork', () => {
    expect(deviceChrome(getDevice('iphone-15'))).toEqual({ width: 413, height: 872, screen: { x: 10, y: 10 }, outerRadius: 65 })
    expect(deviceChrome(getDevice('iphone-se-3'))).toEqual({ width: 395, height: 687, screen: { x: 10, y: 10 }, outerRadius: 10 })
  })
})
