import { expect, it } from 'vitest'
import type { PagePreview } from '@studio/shared'
import { pageSlots } from './pageLayout'

const page = (id: string, parentId?: string): PagePreview => ({ id, name: id, active: false, parentId, tree: { nodes: [], canvas: { width: 402, height: 874 }, revision: 1 } })

it('keeps tab roots horizontal and all their descendants in the owning column', () => {
  const pages = [page('Library'), page('Detail', 'Library'), page('More', 'Detail'), page('Add', 'Library'), page('Saved'), page('Compose', 'Saved'), page('Settings')]
  expect(pageSlots(pages).map(({ page, column, row, depth }) => [page.id, column, row, depth])).toEqual([
    ['Library', 0, 0, 0], ['Detail', 0, 1, 1], ['More', 0, 2, 2], ['Add', 0, 3, 1],
    ['Saved', 1, 0, 0], ['Compose', 1, 1, 1], ['Settings', 2, 0, 0],
  ])
})

it('shows one tab with its child phones when all tabs are hidden', () => {
  const pages = [page('Library'), page('Details', 'Library'), page('Saved'), page('Compose', 'Saved')]
  expect(pageSlots(pages, 'Saved').map(({ page, column, row }) => [page.id, column, row])).toEqual([['Saved', 0, 0], ['Compose', 0, 1]])
})

it('keeps an orphan visible as a root and handles an empty document', () => {
  expect(pageSlots([])).toEqual([])
  expect(pageSlots([page('Detached', 'Missing')]).map(({ page, column, row }) => [page.id, column, row])).toEqual([['Detached', 0, 0]])
})
