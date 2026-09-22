import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { expect, test } from '@playwright/test'

/**
 * A5: the studio says which build it is, and every export carries the same build, so
 * a study result can be tied to the pinned deployment that produced it.
 */
test('the More menu names this build, and an export carries the same commit', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('gallery-dismiss').click()

  await page.getByTestId('workspace-more').click()
  const item = page.getByTestId('workspace-more-menu-build')
  await expect(item).toHaveAccessibleName(/^Build [0-9a-f]{7}\b/)
  const commit = /build ([0-9a-f]{40})\b/.exec(await item.getAttribute('title') ?? '')?.[1]
  expect(commit).toBeDefined()
  await page.keyboard.press('Escape')

  const waiting = page.waitForEvent('download')
  await page.getByTestId('export-format').click()
  await page.getByTestId('export-format-menu-editable').click()
  const entries = unzipSync(readFileSync((await (await waiting).path())!))
  const document = Object.keys(entries).find(name => name.endsWith('/.swiftstudio/project.json'))!
  const { generator } = JSON.parse(new TextDecoder().decode(entries[document])) as { generator: { name: string; build: { commit: string; builtAt: string } } }
  expect(generator.name).toBe('Swift Web Studio')
  expect(generator.build.commit).toBe(commit)
  expect(Number.isNaN(Date.parse(generator.build.builtAt))).toBe(false)
  // In CI the build is made from the checked-out commit, so it has to be that one.
  if (process.env.GITHUB_SHA) expect(generator.build.commit).toBe(process.env.GITHUB_SHA)
})
