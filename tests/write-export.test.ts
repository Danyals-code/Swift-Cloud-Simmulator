import { it } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { TEMPLATES, createProjectFromTemplate } from '@studio/project-model/templates'
import { buildExportBundle } from '@studio/exporter'

/** Writes a real export to disk for manual inspection. Skipped unless asked for. */
it.skipIf(!process.env.WRITE_EXPORT)('writes an export to disk', () => {
  const out = process.env.WRITE_EXPORT!
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  for (const [path, bytes] of buildExportBundle(createProjectFromTemplate(TEMPLATES[0]!, 0))) {
    const full = join(out, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, decoder.decode(bytes), 'utf8')
  }
})
