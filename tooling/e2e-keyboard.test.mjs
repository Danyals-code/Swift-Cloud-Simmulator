import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const E2E = fileURLToPath(new URL('../e2e/', import.meta.url))

/**
 * A keyboard sends the shifted character: Shift and Z arrive as "Z". Playwright sends
 * exactly the key it is given, so `Shift+z` arrives as "z" with Shift held - which
 * CodeMirror on Linux and Windows reads as Ctrl+Z. That is how the redo tests passed
 * on a Mac and undid on the Linux CI runner.
 */
it('e2e chords with Shift name the character a keyboard would send', () => {
  const offenders = readdirSync(E2E).filter((name) => name.endsWith('.ts')).flatMap((name) =>
    readFileSync(join(E2E, name), 'utf8').split('\n').flatMap((line, index) =>
      /Shift\+[a-z]['"`]/.test(line) ? [`e2e/${name}:${index + 1}: ${line.trim()}`] : []))
  expect(offenders).toEqual([])
})
