import { describe, expect, it } from 'vitest'
import { commentFollows, offMarker, withoutOffMarkers } from './off-markers'

/** The question as it was first asked, of the whole rest of the file. */
const whole = (text: string, at: number) => /^[^\S\r\n]*(?:\/\/|\/\*)/.test(withoutOffMarkers(text.slice(at)))

describe('commentFollows', () => {
  const off = offMarker('.padding()')
  const cases: readonly [string, boolean][] = [
    ['', false],
    ['\n}', false],
    [' // note', true],
    ['\t/* note */', true],
    ['\n// on the next line', false],
    [`${off} // after a marker`, true],
    [`  ${off}  ${off}\t/* after two */`, true],
    [`${off}\n// past the line`, false],
    // A marker taken out joins what was either side of it, as the text it stands for.
    [`/${off}/ joined`, true],
    [`/${off}${off}* joined`, true],
    [`/ ${off}/ apart`, false],
    [' / not one', false],
    [' // a line separator is a space to this pattern', true],
    [' .bold() // later on the line', false],
  ]

  it('answers as the whole rest of the file would', () => {
    for (const [rest, expected] of cases) {
      const text = 'Text("A")' + rest
      expect([rest, commentFollows(text, 9)]).toEqual([rest, expected])
      expect(whole(text, 9)).toBe(expected)
    }
  })

  it('reads from where it is asked, past the end too', () => {
    expect(commentFollows('a // b', 1)).toBe(true)
    expect(commentFollows('a // b', 6)).toBe(false)
    expect(commentFollows('a', 4)).toBe(false)
  })
})
