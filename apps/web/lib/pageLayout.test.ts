import { expect, it } from 'vitest'
import type { PagePreview } from '@studio/shared'
import { CANVAS, canvasLayout, pageSlots } from './pageLayout'

const page = (id: string, parentId?: string, kind?: PagePreview['kind'], standalone?: boolean): PagePreview => ({ id, name: id, active: false, parentId, kind, standalone, tree: { nodes: [], canvas: { width: 402, height: 874 }, revision: 1 } })
const shape = (slots: ReturnType<typeof pageSlots>) => slots.map(({ page, lane, column, branchRow }) => [page.id, lane, column, branchRow])

it('gives each tab a lane, moves destinations right by step, and starts extra targets in branch rows', () => {
  const pages = [page('Library'), page('Detail', 'Library'), page('More', 'Detail'), page('Add', 'Library'), page('Saved'), page('Compose', 'Saved'), page('Settings')]
  expect(shape(pageSlots(pages))).toEqual([
    ['Library', 0, 0, 0], ['Detail', 0, 1, 0], ['More', 0, 2, 0], ['Add', 0, 1, 1],
    ['Saved', 1, 0, 0], ['Compose', 1, 1, 0], ['Settings', 2, 0, 0],
  ])
})

it('places a sheet opened from several screens once, beside the first opener, with an arrow from each', () => {
  const pages = [page('Home'), page('Profile', 'Home'), page('Edit·1', 'Home', 'sheet'), page('Edit·2', 'Profile', 'sheet')]
  const same = (p: PagePreview) => p.id.split('·')[0]!
  expect(shape(pageSlots(pages, undefined, same))).toEqual([['Home', 0, 0, 0], ['Profile', 0, 1, 0], ['Edit·1', 0, 1, 1]])
  const layout = canvasLayout(pages, { frame: { width: 100, height: 200 }, statesOf: () => [], expanded: new Set(), showAllStates: false, collapsedLanes: new Set(), laneNames: ['Home'], sameScreen: same })
  expect(layout.arrows).toEqual([{ from: 'Home', to: 'Profile', kind: 'push' }, { from: 'Home', to: 'Edit·1', kind: 'sheet' }, { from: 'Profile', to: 'Edit·1', kind: 'sheet' }])
})

it('shows one tab with its screens when the others are hidden, and keeps orphans and unlinked screens visible', () => {
  const pages = [page('Library'), page('Details', 'Library'), page('Saved'), page('Compose', 'Saved')]
  expect(shape(pageSlots(pages, 'Saved'))).toEqual([['Saved', 1, 0, 0], ['Compose', 1, 1, 0]])
  expect(pageSlots([])).toEqual([])
  expect(shape(pageSlots([page('Detached', 'Missing')]))).toEqual([['Detached', 0, 0, 0]])
  expect(shape(pageSlots([page('Home'), page('Draft', undefined, undefined, true), page('Other', undefined, undefined, true)]))).toEqual([['Home', 0, 0, 0], ['Draft', 1, 0, 0], ['Other', 1, 0, 1]])
})

it('stacks states inside a screen frame and starts the next row below the tallest frame', () => {
  const pages = [page('Home'), page('Detail', 'Home'), page('Search', 'Home')]
  const options = { frame: { width: 100, height: 200 }, statesOf: (p: PagePreview) => p.id === 'Home' ? ['Loading', 'Empty'] : [], collapsedLanes: new Set<number>(), laneNames: ['Home'] }
  const collapsed = canvasLayout(pages, { ...options, expanded: new Set(), showAllStates: false })
  expect(collapsed.phones.map(p => p.state ?? p.page.id)).toEqual(['Home', 'Detail', 'Search'])
  expect(collapsed.frames.find(f => f.page.id === 'Home')).toMatchObject({ states: ['Loading', 'Empty'], expanded: false })
  const open = canvasLayout(pages, { ...options, expanded: new Set(['Home']), showAllStates: false })
  const home = open.frames.find(f => f.page.id === 'Home')!
  expect(open.phones.filter(p => p.page.id === 'Home').map(p => p.state ?? 'default')).toEqual(['default', 'Loading', 'Empty'])
  expect(open.phones.filter(p => p.page.id === 'Home').every(p => p.x === home.x + CANVAS.framePad && p.y >= home.y && p.y + 200 <= home.y + home.height)).toBe(true)
  // Search is a different screen, so it sits outside Home's frame, below all of it.
  expect(open.phones.find(p => p.page.id === 'Search')!.y).toBeGreaterThan(home.y + home.height)
})

it('collapses a lane to its header', () => {
  const pages = [page('Library'), page('Saved'), page('Compose', 'Saved')]
  const layout = canvasLayout(pages, { frame: { width: 100, height: 200 }, statesOf: () => [], expanded: new Set(), showAllStates: false, collapsedLanes: new Set([1]), laneNames: ['Library', 'Saved'] })
  expect(layout.lanes.map(l => [l.name, l.collapsed, l.screens])).toEqual([['Library', false, 1], ['Saved', true, 2]])
  expect(layout.phones.map(p => p.page.id)).toEqual(['Library'])
})

it('draws one arrow per pair, and still places screens a cycle or a shared sheet hides', () => {
  const twice = [page('Home'), page('Edit·1', 'Home', 'sheet'), page('Edit·2', 'Home', 'sheet')]
  const same = (p: PagePreview) => p.id.split('·')[0]!
  const layout = canvasLayout(twice, { frame: { width: 100, height: 200 }, statesOf: () => [], expanded: new Set(), showAllStates: false, collapsedLanes: new Set(), laneNames: ['Home'], sameScreen: same })
  // One sheet opened twice from one screen is one screen and one arrow.
  expect(layout.arrows).toEqual([{ from: 'Home', to: 'Edit·1', kind: 'sheet' }])
  // A parent cycle used to drop both screens off the canvas entirely.
  const cycle = [page('Home'), page('A', 'B'), page('B', 'A')]
  expect(shape(pageSlots(cycle)).map(row => row[0])).toEqual(['Home', 'A', 'B'])
  // A root id nothing matches shows the whole app rather than nothing.
  expect(shape(pageSlots([page('Home'), page('Saved')], 'gone')).map(row => row[0])).toEqual(['Home', 'Saved'])
})
