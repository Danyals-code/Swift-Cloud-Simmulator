import { beforeEach, describe, expect, it } from 'vitest'
import type { CompileRequest, RenderNode, RenderTree } from '@studio/shared'
import { TRAILHEAD_FILES } from '@studio/project-model/templates'
import { applyEvent, compile, rerender, resetPipelineState } from '@studio/swiftui-runtime'
import { DEVICES } from '@studio/sim-shell'

/**
 * Trailhead, driven.
 *
 * The gallery gate in `templates.test.ts` asks whether a template renders; this
 * asks whether it *works*, because the thing it exists to demonstrate is a flow
 * across screens and files. Every assertion below crosses a file boundary: the tab
 * bar comes from one file, the grid from another, the model from a third, and the
 * detail screen a tap pushes is a fourth - which is the whole claim a multi-file
 * template makes, and the one a single render of the first screen cannot support.
 */

const device = DEVICES['iphone-15']
let revision = 1

function request(): CompileRequest {
  return {
    files: TRAILHEAD_FILES.map((file) => ({ id: file.id, text: file.text })),
    canvas: { width: device.width, height: device.height },
    safeArea: device.safeArea,
    colorScheme: 'light',
    revision: revision++,
  }
}

function texts(tree: RenderTree): string[] {
  return tree.nodes.flatMap((node) => (node.text?.runs ?? []).map((run) => run.text))
}

/** Case-insensitive: iOS uppercases grouped section headers, and that is styling. */
function shows(tree: RenderTree, needle: string): boolean {
  const lower = needle.toLowerCase()
  return texts(tree).some((text) => text.toLowerCase().includes(lower))
}

/**
 * A tappable node, found the way a person would: by what it says.
 *
 * The accessibility label is the right handle for this - it is the text a screen
 * reader reads out, so a test that can find a control by it is evidence that
 * somebody using VoiceOver could too. Node ids would be easier and would tie every
 * assertion here to the current shape of the layout tree.
 */
function target(tree: RenderTree, label: string): RenderNode {
  const found = tree.nodes.find((node) => node.hitTarget && (node.a11y?.label ?? '').includes(label))
  expect(found, `nothing tappable says "${label}". Found: ${labels(tree).join(' | ')}`).toBeDefined()
  return found!
}

function labels(tree: RenderTree): string[] {
  return tree.nodes.flatMap((n) => (n.hitTarget && n.a11y?.label ? [n.a11y.label] : []))
}

function tap(tree: RenderTree, label: string): RenderTree {
  applyEvent({
    kind: 'tap',
    handlerId: target(tree, label).hitTarget!.handlerId,
    location: { x: 0, y: 0 },
  })
  return rerender(revision++).renderTree!
}

beforeEach(() => {
  resetPipelineState()
})

describe('Trailhead', () => {
  it('opens on Discover, with the tab bar and both scroll directions', () => {
    const tree = compile(request()).renderTree!

    expect(shows(tree, 'Discover')).toBe(true)
    expect(shows(tree, 'Featured')).toBe(true)

    // Three tabs, from `MainTabs` - a different file to the one drawing the grid.
    for (const tab of ['Discover', 'Saved', 'Profile']) {
      expect(labels(tree).some((l) => l.includes(tab)), `no ${tab} tab`).toBe(true)
    }

    const axes = tree.nodes.flatMap((n) => (n.scroll ? [n.scroll.axis] : []))
    expect(axes, 'the carousel and the page should scroll on different axes').toContain('vertical')
    expect(axes).toContain('horizontal')
  })

  it('draws the trails its store declares, from another file again', () => {
    const tree = compile(request()).renderTree!

    expect(shows(tree, 'Cascade Ridge')).toBe(true)
    expect(shows(tree, 'Heather Meadows')).toBe(true)
    // The difficulty badge is a computed property on the enum in Trail.swift.
    expect(shows(tree, 'Moderate')).toBe(true)
  })

  it('pushes a detail screen, and comes back', () => {
    let tree = compile(request()).renderTree!

    tree = tap(tree, 'Cascade Ridge')
    expect(shows(tree, 'About this walk'), 'the detail screen did not appear').toBe(true)
    expect(shows(tree, 'Getting there')).toBe(true)
    // The navigation bar title comes from the pushed screen, not the first one.
    expect(shows(tree, 'Cascade Ridge')).toBe(true)

    tree = tap(tree, 'Discover')
    expect(shows(tree, 'About this walk')).toBe(false)
    expect(shows(tree, 'Featured')).toBe(true)
  })

  it('saves a trail on one screen and shows it on another', () => {
    // The point of the shared store: two tabs, one model, and a change made in one
    // of them visible in the other.
    let tree = compile(request()).renderTree!

    tree = tap(tree, 'Cascade Ridge')
    tree = tap(tree, 'Save')

    tree = tap(tree, 'Saved')
    expect(shows(tree, 'Cascade Ridge'), 'the saved trail is not in the Saved tab').toBe(true)
  })

  it('opens the filter sheet over the grid', () => {
    let tree = compile(request()).renderTree!

    tree = tap(tree, 'Filters')
    expect(shows(tree, 'trails match'), 'the sheet did not present').toBe(true)
  })

  it('shows the form on the Profile tab', () => {
    let tree = compile(request()).renderTree!

    tree = tap(tree, 'Profile')
    expect(shows(tree, 'Preferences')).toBe(true)
    expect(shows(tree, 'Offline maps')).toBe(true)
  })

  it('has more content than fits, which is what makes it scroll', () => {
    const tree = compile(request()).renderTree!
    const scroller = tree.nodes.find((n) => n.scroll?.axis === 'vertical')

    expect(scroller).toBeDefined()
    expect(
      scroller!.scroll!.content.height,
      'the page fits on screen, so nothing demonstrates scrolling',
    ).toBeGreaterThan(device.height)
  })
})
