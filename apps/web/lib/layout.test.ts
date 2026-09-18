import { beforeEach, expect, it } from 'vitest'
import { PANE_LIMITS, restoreLayout, useLayout } from './layout'

beforeEach(() => useLayout.setState({ mode: 'design', theme: 'light', shown: { navigator: true, debug: false, preview: true } }))

it('restores the simulator when switching workspaces and keeps other panel preferences', () => {
  useLayout.getState().setPane('preview', false)
  useLayout.getState().setMode('develop')
  expect(useLayout.getState().shown).toEqual({ navigator: true, debug: false, preview: true })
  useLayout.getState().setMode('design')
  expect(useLayout.getState().shown.preview).toBe(true)
})

it('opens diagnostics without leaving Design', () => {
  useLayout.getState().togglePane('debug')
  expect(useLayout.getState().mode).toBe('design')
  expect(useLayout.getState().shown.debug).toBe(true)
})

it('keeps pane visibility separate from the two workspace modes', () => {
  useLayout.getState().togglePane('preview')
  expect(useLayout.getState().mode).toBe('design')
  expect(useLayout.getState().shown.preview).toBe(false)
  useLayout.getState().togglePane('preview')
  expect(useLayout.getState().mode).toBe('design')
  expect(useLayout.getState().shown.preview).toBe(true)
  useLayout.getState().setMode('develop')
  useLayout.getState().togglePane('navigator')
  expect(useLayout.getState().mode).toBe('develop')
  expect(useLayout.getState().shown.navigator).toBe(false)
})

it.each(['canvas', 'split', 'code', 'design', 'develop'])('opens in Design after a reload that saved %s, keeping its dark theme', (savedMode) => {
  const restored = restoreLayout({ mode: savedMode, theme: 'dark' }, useLayout.getState())
  expect(restored.mode).toBe('design')
  expect(restored.navigatorTab).toBe('layers')
  expect(restored.theme).toBe('dark')
  expect(restored.shown.preview).toBe(true)
})

it('restores the pane sizes a reload found, clamped to this release’s limits', () => {
  const restored = restoreLayout(
    { navigatorWidth: 300, previewWidth: 500, settingsWidth: 9000, debugHeight: 1 },
    useLayout.getState(),
  )
  expect(restored.navigatorWidth).toBe(300)
  expect(restored.previewWidth).toBe(500)
  expect(restored.settingsWidth).toBe(PANE_LIMITS.settings.max)
  expect(restored.debugHeight).toBe(PANE_LIMITS.debug.min)
})

it('keeps a hidden right-hand rail hidden across a reload', () => {
  expect(restoreLayout({ shown: { navigator: true, debug: false, preview: false } }, useLayout.getState()).shown.preview).toBe(false)
})

it('changing theme leaves workspace and pane settings untouched', () => {
  const { mode, shown } = useLayout.getState()
  useLayout.getState().setTheme('dark')
  expect(useLayout.getState()).toMatchObject({ mode, shown, theme: 'dark' })
})

it('opens Layers for Design and Files for Code on every explicit mode switch', () => {
  useLayout.getState().setMode('design')
  expect(useLayout.getState().navigatorTab).toBe('layers')
  useLayout.getState().setNavigatorTab('issues')
  useLayout.getState().setMode('develop')
  expect(useLayout.getState().navigatorTab).toBe('project')
  useLayout.getState().setPane('navigator', false)
  useLayout.getState().setMode('design')
  expect(useLayout.getState().navigatorTab).toBe('layers')
  expect(useLayout.getState().shown.navigator).toBe(true)
  expect(restoreLayout({ mode: 'design', navigatorTab: 'issues' }, useLayout.getState()).navigatorTab).toBe('layers')
})
