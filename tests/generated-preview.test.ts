import { expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { previewIssues } from '../apps/web/lib/generation/validate'
import { stressApp } from './fixtures/swiftui-stress-cases'

it('surfaces onAppear traps in generated-project validation', () => {
  resetPipelineState()
  const result = compile({ files: [{ id: 'Sources/App.swift', text: stressApp('Text("Hello").onAppear { let values = [1]; print(values[5]) }') }], canvas: { width: 393, height: 852 }, colorScheme: 'light', revision: 1 })
  expect(previewIssues(result).join(' ')).toContain('Index out of range')
})
