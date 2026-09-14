#!/usr/bin/env node
/**
 * Bundle-size budget gate (NFR-1).
 *
 * Enforced from Phase 0 on purpose. Bundle size is a ratchet — it only ever grows,
 * and by the time anyone notices it is made of fifty individually reasonable
 * decisions that nobody wants to unpick. A build that fails today is a five-minute
 * conversation; a 3 MB bundle in Phase 6 is a week.
 *
 * Measures total gzipped client JavaScript: everything the browser downloads to
 * open the editor, lazily-loaded chunks included.
 *
 * Note on the metric: NFR-1 splits its budget into shell and worker, but Turbopack
 * does not emit a per-route chunk manifest, and there is no stable way to attribute
 * a hashed chunk to a route. Rather than report a number we cannot actually compute,
 * this gates the sum and prints the per-chunk breakdown so a regression has an
 * obvious first suspect.
 *
 * Usage: node tooling/check-bundle-budget.mjs [--json]
 */

import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const NEXT_DIR = join(ROOT, 'apps', 'web', '.next')
const KB = 1024

/**
 * Total gzipped client JS, in KB.
 *
 * Raise this only as a deliberate decision with a reason, never to make CI green.
 * It is expected to move once: Phases 1-3 put the lexer, parser, type checker,
 * interpreter and layout engine into the worker chunk, which NFR-1 budgets
 * separately at 450 KB.
 *
 * History:
 *   Phase 0 — 324 KB actual (React, Next runtime, CodeMirror). Budget 450.
 */
const BUDGET_KB = 450

function walkJs(dir) {
  const out = []
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkJs(full))
    // .map files are not served to users and must not count against the budget.
    else if (entry.name.endsWith('.js')) out.push(full)
  }
  return out
}

function gzipKB(file) {
  return gzipSync(readFileSync(file), { level: 9 }).length / KB
}

function main() {
  const asJson = process.argv.includes('--json')

  try {
    statSync(NEXT_DIR)
  } catch {
    console.error(`No build found at ${relative(ROOT, NEXT_DIR)}. Run \`npm run build\` first.`)
    process.exit(2)
  }

  const chunks = walkJs(join(NEXT_DIR, 'static'))
  if (chunks.length === 0) {
    console.error('Build contains no client chunks — something is wrong with the build output.')
    process.exit(2)
  }

  const sizes = chunks
    .map((file) => ({ file: relative(NEXT_DIR, file), kb: gzipKB(file) }))
    .sort((a, b) => b.kb - a.kb)

  const total = sizes.reduce((sum, c) => sum + c.kb, 0)
  const pct = (total / BUDGET_KB) * 100

  if (asJson) {
    console.log(JSON.stringify({ total, budget: BUDGET_KB, chunks: sizes }, null, 2))
  } else {
    const status = total > BUDGET_KB ? 'FAIL' : pct > 85 ? 'WARN' : 'ok'
    console.log('\n  Client JS budget (gzipped)\n')
    console.log(
      `  ${status.padEnd(5)} ${total.toFixed(1).padStart(7)} KB  /  ${BUDGET_KB} KB  (${pct.toFixed(0)}%)   ${chunks.length} chunks\n`,
    )
    console.log('  Largest:')
    for (const { file, kb } of sizes.slice(0, 6)) {
      console.log(`    ${kb.toFixed(1).padStart(7)} KB  ${file}`)
    }
    console.log()
  }

  if (total > BUDGET_KB) {
    console.error(
      `Bundle budget exceeded: ${total.toFixed(1)} KB gzipped against a ${BUDGET_KB} KB budget.\n` +
        'Either trim the payload or raise BUDGET_KB in tooling/check-bundle-budget.mjs as a\n' +
        'deliberate decision, recording the new baseline in the History note above.',
    )
    process.exit(1)
  }
}

main()
