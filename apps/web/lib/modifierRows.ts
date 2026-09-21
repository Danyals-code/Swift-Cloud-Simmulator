import type { AuthoringModifier } from '@studio/shared'

export interface ModifierRow { readonly key: number; readonly modifier: AuthoringModifier }
export interface ModifierRows { readonly rows: readonly ModifierRow[]; readonly nextKey: number }

/** Source offsets change on every edit. UI identity follows occurrences instead. */
export function reconcileModifierRows(previous: ModifierRows, modifiers: readonly AuthoringModifier[]): ModifierRows {
  const remaining = [...previous.rows]
  let nextKey = previous.nextKey
  // Match all unchanged expressions before matching edited values by modifier name.
  // Otherwise an edited padding can steal a second, unchanged padding's identity.
  const same = (row: ModifierRow, modifier: AuthoringModifier) => row.modifier.name === modifier.name && row.modifier.expression === modifier.expression
  // Preserve positional matches first: editing one of two identical paddings
  // must leave the other one's expanded state and input focus alone.
  const matches = modifiers.map((modifier, index) => {
    const row = previous.rows[index]
    if (!row || !same(row, modifier)) return undefined
    remaining.splice(remaining.indexOf(row), 1)
    return row
  })
  modifiers.forEach((modifier, index) => {
    if (matches[index]) return
    const match = remaining.findIndex(row => same(row, modifier))
    if (match >= 0) matches[index] = remaining.splice(match, 1)[0]
  })
  return { rows: modifiers.map((modifier, index) => {
    let match = matches[index]
    if (!match) {
      const sameName = remaining.findIndex(row => row.modifier.name === modifier.name)
      if (sameName >= 0) match = remaining.splice(sameName, 1)[0]
    }
    return { key: match?.key ?? nextKey++, modifier }
  }), nextKey }
}

export function modifierDropIndex(top: number, height: number, pointerY: number, index: number): number {
  return index + (pointerY >= top + height / 2 ? 1 : 0)
}
