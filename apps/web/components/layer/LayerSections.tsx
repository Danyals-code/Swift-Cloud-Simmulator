'use client'

import { useCallback, useState } from 'react'
import type { AuthoringNode, LayerChange, SharedStyle } from '@studio/shared'
import type { FeatureChange } from '../AuthoringFeatures'
import type { SectionProps } from './section'
import { CornersSection } from './CornersSection'
import { EffectsSection } from './EffectsSection'
import { FillSection } from './FillSection'
import { LayoutSection } from './LayoutSection'
import { StrokeSection } from './StrokeSection'
import { TextSection } from './TextSection'
import { VariantsContext } from './parts'

const NO_TOKENS: readonly SharedStyle[] = []

/**
 * The view as a layer, in Figma's order: Layout, Fill, Corners, Stroke, Text, Effects.
 *
 * Each section shows values read from the modifier chain and writes a change as one
 * `layer-set` edit, so a change made here is one undo step however many modifiers it
 * touches. The modifier stack below still shows the chain as code.
 */
export function LayerSections({ node, onCommand, tokens = NO_TOKENS, fonts, disabled = false, measure, sizeOverlap }: { node: AuthoringNode; onCommand?: FeatureChange; tokens?: readonly SharedStyle[]; fonts?: SectionProps['fonts']; disabled?: boolean; measure?: SectionProps['measure']; sizeOverlap?: SectionProps['sizeOverlap'] }) {
  const [pending, setPending] = useState(false)
  const set = useCallback(async (changes: readonly LayerChange[]) => {
    if (!onCommand) return 'Select the view again.'
    setPending(true)
    try { return await onCommand({ kind: 'layer-set', changes }) }
    catch (cause) { return cause instanceof Error ? cause.message : 'Could not change this layer.' }
    finally { setPending(false) }
  }, [onCommand])
  const layer = node.layer
  if (!layer || !onCommand) return null
  const props = { node, layer, set, busy: disabled || pending, tokens, fonts, command: onCommand, measure, sizeOverlap }
  // A run of joined text is part of one Text: only its text styles are its own (Wave 3a).
  return <VariantsContext.Provider value={node.variants}><div data-testid="settings-layer">
    {!layer.textRun && <LayoutSection {...props} />}
    <FillSection {...props} />
    <CornersSection {...props} />
    <StrokeSection {...props} />
    <TextSection {...props} />
    {!layer.textRun && <EffectsSection {...props} />}
  </div></VariantsContext.Provider>
}
