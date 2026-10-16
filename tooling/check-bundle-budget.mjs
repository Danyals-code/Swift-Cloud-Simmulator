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
 *   Layers, Settings and the Design-surface redesign - 654.5 KB actual. Measured
 *              at each step: 487.0 KB before "Detailed Settings for Views", 549.0
 *              after Phases 7-9, 595.3 after "Testing by Design Side only", 629.9
 *              after the redesign (8aa6853) and 654.5 after "Layer - Settings Bugs".
 *              It is the studio's own code: no library is duplicated, and the
 *              largest chunk has not moved (125.8 KB). Raised to 680 KB for the
 *              study build, so the gate stays close enough to catch the next
 *              addition rather than absorb it.
 *   Study plan - 678.7 KB actual after PR-C1 (edit integrity, 674.8) and PR-B
 *              (data safety: the one-tab lock, the storage banner, the switch
 *              dialog). Raised once for the rest of the study rather than PR by
 *              PR, by decision: its remaining items were estimated at
 *              40-50 KB, and a ceiling every PR has to argue past stops anyone
 *              reading it. 730 KB covers that estimate with little over, so an
 *              addition the plan did not foresee still stands out.
 *   Pilot fixes - 731.2 KB actual. PR-D2 left the plan's allowance at 729.4 KB,
 *              and the fixes the pilot rehearsal and the test of the studio's own
 *              AI found (taps through swipe rows, Add into AI screens, the text,
 *              bar and list layout measured in the iOS 27 simulator) added 1.8.
 *              Raised to 740 KB by decision: these were the additions the plan
 *              did not foresee, and they belong in the study build. 740 KB
 *              leaves room for the fix round after the pilot and no more.
 *   Agentic testing fixes - 745.0 KB actual, measured on main merged with
 *              the agentic-testing branch. Its additions are the Assets
 *              folder in Hierarchy, image drops onto the canvas and the
 *              zoomable image preview; the prompt and streaming work runs on
 *              the server and adds nothing here. Raised to 750 KB by decision.
 *   Design flexibility roadmap - 748.9 KB actual after the Apple-style design
 *              system and its usability fixes (745.0 on main, +3.9). The
 *              roadmap in docs/18-DESIGN-FLEXIBILITY-AUDIT.md adds Design
 *              controls and writers in waves 2 to 5 (layout and fills, real-code
 *              reach, system UI, states and motion). Raised once for those
 *              waves, by decision, rather than PR by PR; each PR still reports
 *              its own growth, and the largest-chunk gate is unchanged.
 *   Canvas handles - 796.1 KB actual after Wave 2a's layer sections. Wave 2b
 *              adds direct manipulation on the canvas: resize, padding and
 *              spacing handles, dragging to an offset and arrow-key nudging,
 *              with a live draft layout in the worker, estimated at 15 KB.
 *              Raised to 830 KB by decision, for 2b and some headroom.
 *   Values, states and screens - 821.8 KB actual after Wave 3a and the
 *              pipeline fixes. Wave 3b shows constants and tokens with their
 *              values, view-model states, and alerts, dialogs and previews as
 *              screens, estimated at 10 to 15 KB. Raised to 860 KB by
 *              decision, for 3b and the start of Wave 4.
 *   System UI - 843.3 KB actual after Wave 3b. Wave 4 adds toolbar items,
 *              search, sheet settings, swipe actions, context menus, list
 *              rows, a paging carousel and the missing Add palette views,
 *              estimated at 25 to 34 KB over three PRs. Raised to 880 KB by
 *              decision, for all of Wave 4.
 *   States, motion and components - 858.0 KB actual after Wave 4. Wave 5
 *              adds Shown when, Animate this change, transitions, numeric
 *              text, matched geometry, and component props, variants, swap
 *              and detach, estimated at 15 to 24 KB over two PRs. Raised to
 *              900 KB by decision, for Wave 5.
 *   Rendering fidelity - 892.4 KB actual after Wave 5. Wave 6 adds Markdown,
 *              images in text, SF Symbols toward the most-used 600, iOS 27
 *              chrome, date pickers, MeshGradient, basic Charts and custom
 *              font files, estimated at 42 to 58 KB over six PRs. Raised to
 *              950 KB by decision, for all of Wave 6.
 */
const BUDGET_KB = 950

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
 *   Wave 6   - 166.8 KB after Wave 5: the chunk is swift-sema with the parser,
 *              which the studio page and the worker both load. Wave 6 adds about
 *              4 KB of sema. Raised to 176 KB by decision.
 *   Wave 6e  - 175.7 KB with Charts: the sema chunk grows with each wave's checker
 *              and Design controls. Loading edit-only writers on demand to make room
 *              made Turbopack keep the page's and worker's shared chunk twice (+25 KB
 *              in total), so the writers stay eager. 6f adds about 0.8 KB more.
 *              Raised to 180 KB by decision, for 6e and 6f.
 */
const LARGEST_CHUNK_KB = 180

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
