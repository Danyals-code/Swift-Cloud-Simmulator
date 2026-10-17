import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TEMPLATE_CATALOG } from '@studio/project-model'
import { templateById } from '@studio/project-model/templates'
import { fetchTemplate } from './templateSources'

const PUBLIC = new URL('../public/', import.meta.url)

/** A `fetch` that serves `apps/web/public` the way the dev server does, and records what it was asked for. */
function servePublic() {
  const asked: string[] = []
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    asked.push(url)
    const path = url.split('?')[0]!.replace(/^\//, '')
    try {
      return new Response(readFileSync(new URL(path, PUBLIC)), { status: 200 })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  }))
  return asked
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchTemplate', () => {
  it('fetches each file the catalog lists and returns the template with its text', async () => {
    const asked = servePublic()
    const folio = await fetchTemplate('folio')
    const info = TEMPLATE_CATALOG.find((t) => t.id === 'folio')!

    expect(asked.map((url) => url.split('?')[0])).toEqual(info.files.map((path) => `/templates/folio/${path}`))
    expect(folio?.name).toBe('Folio')
    expect(folio?.files.map((f) => f.id)).toEqual(info.files)
    expect(folio?.files[0]?.text).toContain('@main')
  })

  it('serves every template exactly as the tests and the exporter read it', async () => {
    servePublic()
    for (const info of TEMPLATE_CATALOG) {
      expect(await fetchTemplate(info.id), info.id).toEqual(templateById(info.id))
    }
  })

  it('keys the request to the build, so no copy from an earlier deploy is reused', async () => {
    const asked = servePublic()
    await fetchTemplate('counter')
    expect(asked).toHaveLength(1)
    expect(asked[0]).toMatch(/^\/templates\/counter\/Sources\/CounterApp\.swift\?v=\S+$/)
  })

  it('makes the blank screen without a request', async () => {
    const asked = servePublic()
    const blank = await fetchTemplate('blank')
    expect(asked).toEqual([])
    expect(blank?.files.map((f) => f.id)).toEqual(['Sources/App/MyDesignApp.swift', 'Sources/Features/Home/HomeScreen.swift'])
  })

  it('answers nothing for an id the catalog does not have', async () => {
    const asked = servePublic()
    expect(await fetchTemplate('not-a-template')).toBeUndefined()
    expect(asked).toEqual([])
  })

  // The gallery says what to do; the error names the file, for the console.
  it('throws, naming the file, when a file is missing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Not found', { status: 404 })))
    await expect(fetchTemplate('tasks')).rejects.toThrow('/templates/tasks/Sources/TasksApp.swift did not arrive.')
  })

  it('throws the same when the network is down', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    await expect(fetchTemplate('dispatch')).rejects.toThrow(/^\/templates\/dispatch\/\S+\.swift did not arrive\.$/)
  })
})

/**
 * The reason the sources are files.
 *
 * Anything in the app that imports `@studio/project-model/templates` puts the whole
 * corpus back into a chunk the bundle budget counts. Only tests may.
 */
describe('the web app', () => {
  it('never imports the template corpus', () => {
    const root = new URL('..', import.meta.url).pathname
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === '.next' || name === 'public') continue
        const path = join(dir, name)
        if (statSync(path).isDirectory()) walk(path)
        else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && readFileSync(path, 'utf8').includes('@studio/project-model/templates')) offenders.push(path)
      }
    }
    walk(root)
    expect(offenders).toEqual([])
  })
})
