import { symbolDefinition } from '@studio/shared'
import { COMMON_SYMBOLS } from './common-symbols'

/**
 * The SF Symbols the prompts offer: `count` of the everyday names the preview draws, so
 * the list stays short. Each group of related names gives a share in proportion to its
 * size, after its first, so arrows and weather are offered as well as the top of the list,
 * and within a group the first of each kind comes before a second (house, magnifyingglass
 * and gear before house.fill). They are listed in the everyday list's order.
 */
export function offeredSymbols(count: number): string[] {
  const groups = COMMON_SYMBOLS.split('\n').map(line => {
    const seen = new Map<string, number>()
    const ranked = line.split(' ').filter(name => symbolDefinition(name)).map((name, at) => {
      const kind = name.split('.')[0]!, rank = seen.get(kind) ?? 0
      seen.set(kind, rank + 1)
      return { name, rank, at }
    })
    return ranked.sort((a, b) => a.rank - b.rank || a.at - b.at).map(entry => entry.name)
  }).filter(group => group.length)
  const taken = groups.map(() => 0), offered = new Set<string>()
  while (offered.size < count) {
    // The group that has given the smallest share of itself so far gives the next name, so every group gives its first.
    let next = -1
    groups.forEach((group, index) => { if (taken[index]! < group.length && (next < 0 || taken[index]! / group.length < taken[next]! / groups[next]!.length)) next = index })
    if (next < 0) break
    offered.add(groups[next]![taken[next]!++]!)
  }
  return COMMON_SYMBOLS.split(/\s+/).filter(name => offered.has(name))
}
