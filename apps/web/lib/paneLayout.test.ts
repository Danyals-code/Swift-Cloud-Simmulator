import { describe, expect, it } from 'vitest'
import { environmentPlacement, paneLayout } from './paneLayout'

/**
 * How the panes share a window (D15). Half of a 13-14" laptop screen is 735-756 px, which
 * is what a participant gets with the instructions tiled beside the studio. Below 820 px
 * Design hid Layers, and neither its button nor ⌘0 brought it back.
 */

const panes = { navigator: 260, preview: 420 }
const design = (available: number, navigator = true, layersOver = false) =>
  paneLayout({ available, mode: 'design', shown: { navigator, preview: true }, widths: panes, layersOver })

describe('Layers in Design', () => {
  it('sits beside the canvas while the window has room for both', () => {
    expect(design(1440)).toMatchObject({ showNavigator: true, layersOver: false, nav: 260, narrow: false })
    expect(design(820)).toMatchObject({ showNavigator: true, layersOver: false, narrow: false })
  })

  it('stays away when it is switched off', () => {
    expect(design(1440, false)).toMatchObject({ showNavigator: false, layersOver: false })
  })

  it('leaves a narrow window to the canvas until it is asked for', () => {
    expect(design(760)).toMatchObject({ showNavigator: false, layersOver: false, narrow: true })
    expect(design(735)).toMatchObject({ showNavigator: false, narrow: true })
  })

  it('is drawn over the canvas when asked for in a narrow window, whatever the stored choice', () => {
    expect(design(760, true, true)).toMatchObject({ showNavigator: true, layersOver: true, nav: 260 })
    expect(design(760, false, true)).toMatchObject({ showNavigator: true, layersOver: true })
  })

  it('goes back beside the canvas once the window is wide again', () => {
    expect(design(1200, true, true)).toMatchObject({ showNavigator: true, layersOver: false })
  })
})

describe('the panes in Code', () => {
  const code = (available: number) => paneLayout({ available, mode: 'develop', shown: { navigator: true, preview: true }, widths: panes, layersOver: false })

  it('shows the files, the editor and the preview when they fit', () => {
    expect(code(1440)).toMatchObject({ showNavigator: true, showPreview: true, nav: 260, preview: 420 })
  })

  it('lets the preview go first when the three do not fit', () => {
    expect(code(760)).toMatchObject({ showNavigator: true, showPreview: false })
  })
})

describe('the preview environment in Design', () => {
  it('is in the toolbar while it has room', () => {
    expect(environmentPlacement(1440)).toEqual({ toolbar: ['device', 'appearance', 'text-size'], heading: [] })
    expect(environmentPlacement(1181)).toEqual({ toolbar: ['device', 'appearance', 'text-size'], heading: [] })
  })

  it('moves into the canvas heading a picker at a time as the toolbar runs out of room', () => {
    expect(environmentPlacement(1180)).toEqual({ toolbar: ['device', 'appearance'], heading: ['text-size'] })
    expect(environmentPlacement(1021)).toEqual({ toolbar: ['device', 'appearance'], heading: ['text-size'] })
    expect(environmentPlacement(1020)).toEqual({ toolbar: [], heading: ['device', 'appearance', 'text-size'] })
    expect(environmentPlacement(735)).toEqual({ toolbar: [], heading: ['device', 'appearance', 'text-size'] })
  })
})
