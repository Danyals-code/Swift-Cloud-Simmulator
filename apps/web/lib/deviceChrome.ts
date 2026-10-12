import type { DeviceKey, DeviceSpec } from '@studio/sim-shell'

/** The hardware around a device's screen, in points. */
export interface DeviceChrome {
  /** The phone's outer box, frame included. */
  readonly width: number
  readonly height: number
  /** Where the screen sits inside that box, on whole points so the app stays crisp. */
  readonly screen: { readonly x: number; readonly y: number }
  /** The rounding of the outer box, for anything drawn over the whole phone. */
  readonly outerRadius: number
  /**
   * Artwork laid over the screen's edges, or none where the frame is drawn in CSS.
   *
   * Both finishes, because the workspace theme picks one in CSS: black on the light
   * canvas and silver on the dark one, where a black phone would vanish.
   */
  readonly art?: { readonly black: string; readonly silver: string; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
}

/** The thickness of the frame drawn in CSS, on every side. */
const DRAWN_FRAME = 10

interface Artwork {
  readonly black: string
  readonly silver: string
  /** The image, in pixels. */
  readonly size: { readonly width: number; readonly height: number }
  /** The transparent screen opening's top-left corner and width, in pixels. */
  readonly opening: { readonly x: number; readonly y: number; readonly width: number }
  readonly screen: DeviceChrome['screen']
  readonly outerRadius: number
}

/**
 * Device artwork, measured.
 *
 * The iPhone 18 Pro's opening is 874 x 1900 px at (52, 50) in both finishes, which
 * is 402 x 874 pt, and its corners match Xcode 27's screen mask for the device. Its
 * island is part of the artwork, so the CSS one is not drawn over it.
 */
const ARTWORK: Partial<Record<DeviceKey, Artwork>> = {
  'iphone-18-pro': {
    black: '/devices/iphone-18-pro-black.webp',
    silver: '/devices/iphone-18-pro-silver.webp',
    size: { width: 978, height: 2000 },
    opening: { x: 52, y: 50, width: 874 },
    screen: { x: 24, y: 23 },
    outerRadius: 86,
  },
}

/** The frame for a device: its artwork where there is some, otherwise the drawn one. */
export function deviceChrome(device: DeviceSpec): DeviceChrome {
  const art = ARTWORK[device.key]
  if (!art) {
    return {
      width: device.width + DRAWN_FRAME * 2,
      height: device.height + DRAWN_FRAME * 2,
      screen: { x: DRAWN_FRAME, y: DRAWN_FRAME },
      outerRadius: device.cornerRadius + DRAWN_FRAME,
    }
  }
  const pointsPerPixel = device.width / art.opening.width
  return {
    width: device.width + art.screen.x * 2,
    height: device.height + art.screen.y * 2,
    screen: art.screen,
    outerRadius: art.outerRadius,
    art: {
      black: art.black,
      silver: art.silver,
      x: art.screen.x - art.opening.x * pointsPerPixel,
      y: art.screen.y - art.opening.y * pointsPerPixel,
      width: art.size.width * pointsPerPixel,
      height: art.size.height * pointsPerPixel,
    },
  }
}
