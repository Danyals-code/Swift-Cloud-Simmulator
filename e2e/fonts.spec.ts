import { readFileSync } from 'node:fs'
import { unzipSync } from 'fflate'
import { expect, test, type Page } from '@playwright/test'
import { openInDesign, sourceInCode } from './designer-helpers'

/**
 * Custom font files (Wave 6f), in Chrome and Safari alike: a .ttf added to Assets is listed
 * by its face, Typography's Family offers it, the text redraws in it, and the Xcode project
 * export carries the file with `UIAppFonts`. A file that isn't a font is refused with the reason.
 *
 * Geist Regular is under the SIL Open Font License 1.1, whose notice its name table carries.
 */
const FONT = 'e2e/fixtures/Geist-Regular.ttf'
const fontBytes = readFileSync(new URL('./fixtures/Geist-Regular.ttf', import.meta.url))

const app = `import SwiftUI

@main
struct FontApp: App {
    var body: some Scene {
        WindowGroup { HomeScreen() }
    }
}

struct HomeScreen: View {
    var body: some View {
        VStack(spacing: 12) {
            Text("Brand headline")
            Text("Plain words")
        }
    }
}
`

const tree = (page: Page) => page.getByTestId('render-tree')
/** A Text's words on the canvas: the innermost element that draws them, which carries their font. */
const drawn = (page: Page, words: string) => tree(page).getByText(words, { exact: true })
const assets = (page: Page) => page.getByTestId('assets-folder')
const fontRow = (page: Page) => assets(page).getByTestId('asset-font').filter({ hasText: 'Geist Regular' })
const idle = (page: Page) => expect(page.getByTestId('status-view')).toHaveAttribute('aria-busy', 'false')
/** Whether the page has the project's Geist face loaded, under the family the canvas draws it by. */
const geistLoaded = (page: Page) => page.evaluate(() => [...document.fonts].some(face => face.family.includes('Studio Font Geist') && face.status === 'loaded'))

async function addGeist(page: Page) {
  await page.getByTestId('hierarchy-files').click()
  await page.getByTestId('assets-import').setInputFiles(FONT)
  await expect(fontRow(page)).toBeVisible()
  await expect(fontRow(page)).toContainText('Geist-Regular.ttf')
}

async function openProblems(page: Page) {
  if (!(await page.getByTestId('splitter-debug-area-height').count())) {
    await page.getByTestId('workspace-more').click()
    await page.getByTestId('workspace-more-menu-problems').click()
  }
  await expect(page.getByTestId('console')).toBeVisible()
}

test('a font file added to Assets is chosen in Family, the text redraws in it, and the export carries it with UIAppFonts', async ({ page }) => {
  await openInDesign(page, app, 'Brand headline')
  await addGeist(page)

  // A file that isn't a font is refused with the reason, and the folder keeps what it had.
  await page.getByTestId('assets-import').setInputFiles({ name: 'Broken.otf', mimeType: 'font/otf', buffer: Buffer.from('not a font') })
  await expect(assets(page).getByRole('alert')).toContainText('Broken.otf: That file isn’t a TrueType or OpenType font.')
  await expect(assets(page).getByTestId('asset-font')).toHaveCount(1)

  // Family offers System, the project's face, then iOS's own families.
  await drawn(page, 'Brand headline').click()
  const family = page.getByTestId('layer-text').getByRole('combobox', { name: 'Font family', exact: true })
  await expect(family).toHaveValue('')
  await expect(family.locator('optgroup[label="In this project"] option')).toHaveText(['Geist Regular'])
  await expect(family.locator('optgroup[label="iOS"] option', { hasText: 'Avenir Next' }).first()).toBeAttached()
  await family.selectOption('Geist-Regular')
  await idle(page)
  await expect(family).toHaveValue('Geist-Regular')
  // Design applies to the system font only.
  await expect(page.getByTestId('layer-text').getByRole('combobox', { name: 'Font design', exact: true })).toBeDisabled()

  // Drawn in the file's own face, and the text beside it is not.
  await expect(drawn(page, 'Brand headline')).toHaveCSS('font-family', /Studio Font Geist/)
  await expect(drawn(page, 'Plain words')).not.toHaveCSS('font-family', /Studio Font Geist/)
  await expect.poll(() => geistLoaded(page)).toBe(true)
  await openProblems(page)
  await expect(page.getByTestId('console')).not.toContainText('Geist')

  // The code keeps the text style, so Dynamic Type still scales it.
  expect(await sourceInCode(page)).toContain('.font(.custom("Geist-Regular", size: 17, relativeTo: .body))')

  // The export carries the file, byte for byte, and names it in UIAppFonts.
  await idle(page)
  const waiting = page.waitForEvent('download')
  await page.getByTestId('export-button').click()
  const entries = unzipSync(new Uint8Array(readFileSync((await (await waiting).path())!)))
  const font = Object.entries(entries).find(([path]) => path.endsWith('/Fonts/Geist-Regular.ttf'))
  expect(font, 'the font file is in the export').toBeTruthy()
  expect(Buffer.from(font![1]).equals(fontBytes)).toBe(true)
  const plists = Object.entries(entries).filter(([path]) => path.endsWith('Info.plist')).map(([, bytes]) => new TextDecoder().decode(bytes))
  expect(plists.some(plist => /<key>UIAppFonts<\/key>\s*<array>\s*<string>[^<]*Geist-Regular\.ttf<\/string>/.test(plist))).toBe(true)
})

test('a font file removed from Assets leaves its text in the system font, with a warning that names it', async ({ page }) => {
  await openInDesign(page, app.replace('Text("Brand headline")', 'Text("Brand headline")\n                .font(.custom("Geist-Regular", size: 17, relativeTo: .body))'), 'Brand headline')
  // Before the file is added, the name is unknown, and says so.
  await openProblems(page)
  await expect(page.getByTestId('console')).toContainText('Geist-Regular')

  await addGeist(page)
  await idle(page)
  await expect(drawn(page, 'Brand headline')).toHaveCSS('font-family', /Studio Font Geist/)
  await expect(page.getByTestId('console')).not.toContainText('Geist-Regular')

  await fontRow(page).hover()
  await fontRow(page).getByRole('button', { name: 'Actions for Geist Regular', exact: true }).click()
  await page.getByRole('option', { name: 'Remove from project', exact: true }).click()
  await expect(assets(page).getByTestId('asset-font')).toHaveCount(0)
  await idle(page)
  await expect(drawn(page, 'Brand headline')).not.toHaveCSS('font-family', /Studio Font Geist/)
  await expect(page.getByTestId('console')).toContainText('Geist-Regular')
})
