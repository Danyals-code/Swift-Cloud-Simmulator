import { describe, expect, it } from 'vitest'
import { fingerprintFiles } from './open'
import { TEMPLATES } from './templates'

/**
 * Every template's files, exactly as they were before the sources moved to
 * `apps/web/public/templates/`.
 *
 * Computed with `fingerprintFiles` on main at 642e49b, while the Swift was still
 * inline in TypeScript. The move is meant to change where the text lives and nothing
 * else, so a single changed byte, path or file order fails here first. Delete these
 * when the polish PRs start changing template content on purpose.
 */
const BEFORE_THE_MOVE: Readonly<Record<string, string>> = {
  blank: '1386php',
  counter: 'ui8q73',
  stacks: 'nwknp8',
  tasks: 'wb89az',
  card: '18vb858',
  palette: '2g2qza',
  navigation: '1a16drc',
  settings: '1h89muu',
  gallery: '3pt726',
  tabs: 'my3isy',
  motion: 'u2x9nw',
  inbox: '14ajeen',
  store: '1d570q3',
  flow: '71am4h',
  drawing: 'vlggus',
  drag: '1c9fepg',
  styled: 'l2uxjl',
  dispatch: '1uup8p5',
  market: 'wmroo4',
  folio: '116h1f0',
  trailhead: '2x38o0',
  ledger: 'wtdobb',
  kitchen: '1qr9jer',
  pulse: 'zx0gzm',
  typesetting: '1jqhhqx',
  loader: '1k3g4ou',
}

describe('template sources', () => {
  it('are byte for byte what they were before they became files', () => {
    const now = Object.fromEntries(TEMPLATES.map((t) => [t.id, fingerprintFiles(t.files)]))
    expect(now).toEqual(BEFORE_THE_MOVE)
  })
})
