import { beforeEach, expect, it } from 'vitest'
import { restoreLayout, useLayout } from './layout'

beforeEach(() => useLayout.setState({ mode: 'design', theme: 'light', shown: { navigator: true, debug: false, preview: true } }))

it('restores the simulator when switching workspaces and keeps other panel preferences', () => {
  useLayout.getState().setPane('preview', false)
  useLayout.getState().setMode('develop')
  expect(useLayout.getState().shown).toEqual({ navigator: true, debug: false, preview: true })
  useLayout.getState().setMode('design')
  expect(useLayout.getState().shown.preview).toBe(true)
})

it('reveals code when opening diagnostics from Design', () => {
  useLayout.getState().togglePane('debug')
  expect(useLayout.getState().mode).toBe('develop')
  expect(useLayout.getState().shown.debug).toBe(true)
})

it('keeps pane visibility separate from the two workspace modes', () => {
  useLayout.getState().togglePane('preview')
  expect(useLayout.getState().mode).toBe('develop')
  expect(useLayout.getState().shown.preview).toBe(false)
  useLayout.getState().togglePane('preview')
  expect(useLayout.getState().mode).toBe('develop')
  expect(useLayout.getState().shown.preview).toBe(true)
})

it.each([['canvas', 'design'], ['split', 'develop'], ['code', 'develop'], ['design', 'design'], ['develop', 'develop']])('restores %s as %s with its saved dark theme', (legacyMode, mode) => {
  const restored = restoreLayout({ mode: legacyMode, theme: 'dark' }, useLayout.getState())
  expect(restored.mode).toBe(mode)
  expect(restored.theme).toBe('dark')
  expect(restored.shown.preview).toBe(true)
})

it('changing theme leaves workspace and pane settings untouched', () => {
  const { mode, shown } = useLayout.getState()
  useLayout.getState().setTheme('dark')
  expect(useLayout.getState()).toMatchObject({ mode, shown, theme: 'dark' })
})
