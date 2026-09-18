#!/usr/bin/env node
/**
 * Bundle-size budget gate (NFR-1).
 *
 * Enforced from Phase 0 on purpose. Bundle size is a ratchet - it only ever grows,
 * and by the time anyone notices it is made of fifty individually reasonable
 * decisions that nobody wants to unpick. A build that fails today is a five-minute
 * conversation; a 3 MB bundle in Phase 6 is a week.
 *
 * Measures total gzipped client JavaScript that a *supported browser* can fetch -
 * lazily-loaded chunks included, because they are still shipped and still cached.
 *
 * Two honesty notes about the metric, because it is easy to read more into it than
 * it says:
 *
 * 1. **Next's `nomodule` polyfill bundle is excluded**, read from the build manifest
 *    rather than matched by name. It is served behind `nomodule`, so any browser that
 *    supports ES modules - which is every browser that can run a Web Worker and
 *    CodeMirror 6, i.e. every browser this app works in - never downloads it.
 *    Counting 38 KB nobody fetches made the gate wrong in the expensive direction:
 *    it consumed a tenth of the budget and would eventually have forced a real
 *    feature to be cut to pay for bytes that were never sent.
 *
 * 2. **Two numbers, because one of them was the wrong one to optimise.** The total is
 *    a ratchet on shipped bytes: it only ever grows, and it is what stops fifty
 *    reasonable decisions adding up to three megabytes. But moving code behind a
 *    dynamic import makes the first paint *smaller* and the total very slightly
 *    larger, because a split costs overhead - so for a while the only gate in the
 *    build actively discouraged the thing most worth doing. Splitting the template
 *    corpus out took 21 KB off the first paint and put 3 KB on the total, and nothing
 *    in CI could tell that apart from a regression.
 *
 *    So the largest chunk is gated too. Turbopack emits no per-route manifest, and
 *    the framework's own entry - `rootMainFiles` - measures React and the Next
 *    runtime rather than the studio, so it moves for none of the reasons worth
 *    watching. The biggest chunk *is* the studio, it is on the critical path, and it
 *    is exactly what a static import of something large lands in.
 *
 * NFR-1 splits its budget into shell and worker, but Turbopack does not emit a
 * per-route chunk manifest and there is no stable way to attribute a hashed chunk to
 * a route. Rather than report a number that cannot actually be computed, this gates
 * the sum.
 *
 * Usage: node tooling/check-bundle-budget.mjs [--json]
 */

import { gzipSync } from 'node:zlib'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
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
 *   Phase 0  - 324 KB actual (React, Next runtime, CodeMirror). Budget 450.
 *   Phase 10 - 367 KB actual, after excluding the nomodule polyfills (see note 1).
 *              The measured number fell by 38 KB without a byte changing hands.
 *   Prompt creation - 457 KB actual with two additional multi-file apps and the
 *              lazy-loaded provider form, draft validation, and source review.
 *              The main chunk remains 162 KB; allow 470 KB for the expanded scope.
 *   Design tools - 467 KB actual after the page gallery and the canvas controls,
 *              which is 99% of a 470 KB ceiling. Raised to 600 KB by decision
 *              rather than by measurement: the studio is a tool people open and
 *              keep open, not a page they arrive at from a search result, so the
 *              first load is worth more bytes than the old number allowed. It is a
 *              ceiling to notice, not a target to fill - and the per-chunk gate
 *              below is the one that still says something about the critical path.
 */
const BUDGET_KB = 600

/**
 * The biggest single chunk, in KB gzipped - which is the studio's own.
 *
 * On the critical path and, unlike the total, it goes *down* when something large is
 * moved behind a dynamic import. That is the whole reason it is here: for a while the
 * only gate in the build got very slightly worse when the code got better.
 *
 * Set close to where it sits rather than comfortably above it. A ceiling with room in
 * it stops nothing.
 *
 * History:
 *   Phase 11 - 183 KB before, 162 KB after `@studio/project-model/templates` became a
 *              separate entry point imported only where a template is created.
 */
const LARGEST_CHUNK_KB = 172

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

/** Next's client build manifest, or null when the build predates it. */
function readManifest() {
  try {
    return JSON.parse(readFileSync(join(NEXT_DIR, 'build-manifest.json'), 'utf8'))
  } catch {
    return null
  }
}

function main() {
  const asJson = process.argv.includes('--json')

  try {
    statSync(NEXT_DIR)
  } catch {
    console.error(`No build found at ${relative(ROOT, NEXT_DIR)}. Run \`npm run build\` first.`)
    process.exit(2)
  }

  const all = walkJs(join(NEXT_DIR, 'static'))
  if (all.length === 0) {
    console.error('Build contains no client chunks - something is wrong with the build output.')
    process.exit(2)
  }

  // `nomodule`, so no supported browser fetches it. Read from the manifest rather
  // than matched by filename, which is a content hash and changes every build.
  const polyfills = new Set(
    (readManifest()?.polyfillFiles ?? []).map((f) => join(NEXT_DIR, f.split('/').join(sep))),
  )
  const chunks = all.filter((file) => !polyfills.has(file))

  const sizes = chunks
    .map((file) => ({ file: relative(NEXT_DIR, file), kb: gzipKB(file) }))
    .sort((a, b) => b.kb - a.kb)

  const total = sizes.reduce((sum, c) => sum + c.kb, 0)
  const pct = (total / BUDGET_KB) * 100

  const largest = sizes[0]?.kb ?? 0
  const largestPct = (largest / LARGEST_CHUNK_KB) * 100

  const label = (used, budget, share) => (used > budget ? 'FAIL' : share > 85 ? 'WARN' : 'ok')

  if (asJson) {
    console.log(
      JSON.stringify(
        { total, budget: BUDGET_KB, largest, largestBudget: LARGEST_CHUNK_KB, chunks: sizes },
        null,
        2,
      ),
    )
  } else {
    console.log('\n  Client JS budget (gzipped)\n')
    console.log(
      `  ${label(total, BUDGET_KB, pct).padEnd(5)} ${total.toFixed(1).padStart(7)} KB  /  ${BUDGET_KB} KB  (${pct.toFixed(0)}%)   total, ${chunks.length} chunks`,
    )
    console.log(
      `  ${label(largest, LARGEST_CHUNK_KB, largestPct).padEnd(5)} ${largest.toFixed(1).padStart(7)} KB  /  ${LARGEST_CHUNK_KB} KB  (${largestPct.toFixed(0)}%)   largest chunk\n`,
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

  if (largest > LARGEST_CHUNK_KB) {
    console.error(
      `Largest chunk over budget: ${largest.toFixed(1)} KB gzipped against a ${LARGEST_CHUNK_KB} KB ceiling.\n` +
        'Something big is being imported statically that could be imported on demand -\n' +
        'look at what that chunk pulls in before raising LARGEST_CHUNK_KB.',
    )
    process.exit(1)
  }
}

main()
