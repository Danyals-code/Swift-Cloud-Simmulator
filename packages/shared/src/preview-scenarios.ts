import type { AuthoringSnapshot } from './authoring'
import type { DesignValue, PreviewScenario, RecordField } from './authoring-features'

export function validDesignValue(value: unknown, field: Pick<RecordField, 'type' | 'optional'>): value is DesignValue {
  if (value === null) return field.optional
  if (field.type === 'String') return typeof value === 'string' && value.length <= 16_384
  if (field.type === 'Bool') return typeof value === 'boolean'
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000 && (field.type !== 'Int' || Number.isSafeInteger(value))
}
export function validatePreviewScenario(snapshot: AuthoringSnapshot, scenario: PreviewScenario): string | null {
  if (!scenario.name.trim() || scenario.name.length > 120 || scenario.hook || (scenario.inputs?.length ?? 0) > 100) return 'Use a scenario name and at most 100 supported preview inputs.'
  const used = new Set<string>()
  let characters = 0
  for (const input of scenario.inputs ?? []) {
    characters += input.owner.length + input.name.length + input.signature.length
    if (characters > 1_000_000) return 'Preview inputs exceed the 1 MB text limit.'
    const key = JSON.stringify([input.owner, input.name])
    if (used.has(key)) return 'The same preview input appears twice.'
    used.add(key)
    const state = snapshot.inputs?.find(s => s.owner === input.owner && s.name === input.name && s.signature === input.signature)
    const collection = snapshot.nodes.map(n => n.collection).find(c => c?.owner === input.owner && c.name === input.name && c.signature === input.signature)
    if (state && !Array.isArray(input.value)) {
      if (typeof input.value === 'string') characters += input.value.length
      if (characters > 1_000_000) return 'Preview inputs exceed the 1 MB text limit.'
      if (state.options ? typeof input.value !== 'string' || !state.options.includes(input.value) : !validDesignValue(input.value, { type: state.type as RecordField['type'], optional: state.optional ?? false })) return `${input.name} needs a ${state.type} value.`
    } else if (collection && Array.isArray(input.value) && input.value.length <= 1000) {
      const ids = new Set<string>()
      for (const record of input.value) {
        if (!record || typeof record !== 'object' || Array.isArray(record) || Object.keys(record).some(k => !collection.fields.some(f => f.name === k))) return 'The preview record has unknown fields.'
        for (const field of collection.fields) if (!validDesignValue(record[field.name] ?? (field.optional ? null : undefined), field)) return `Invalid preview field ${field.name}.`
        characters += Object.values(record).reduce<number>((total, value) => total + (typeof value === 'string' ? value.length : 8), 0)
        if (characters > 1_000_000) return 'Preview inputs exceed the 1 MB text limit.'
        const id = JSON.stringify(record.id)
        if (ids.has(id)) return 'Preview records need unique IDs.'
        ids.add(id)
      }
    } else return `${input.owner}.${input.name} no longer matches its source. Update this scenario.`
  }
  return null
}
