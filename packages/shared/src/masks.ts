/**
 * The masks the preview draws (Wave 6a), shared by the renderer that draws them and the
 * checker that warns about the rest, so the two can't disagree.
 */
/** What paints as a fill when masked or masking: a gradient or a colour. */
export const MASK_PAINTS: ReadonlySet<string> = new Set(['LinearGradient', 'RadialGradient', 'AngularGradient', 'EllipticalGradient', 'Color'])
/** The shapes a mask cuts with. */
export const MASK_SHAPES: ReadonlySet<string> = new Set(['Circle', 'Capsule', 'Ellipse', 'Rectangle', 'RoundedRectangle', 'UnevenRoundedRectangle'])
/** What a shape mask may carry and still only cut: a frame, and the paint it would fill with. */
export const MASK_SHAPE_MODIFIERS: ReadonlySet<string> = new Set(['frame', 'fill', 'foregroundStyle', 'foregroundColor'])
/** What a view masked by text or a symbol may carry before the mask and still be only a fill. */
export const MASK_RECEIVER_MODIFIERS: ReadonlySet<string> = new Set(['frame', 'padding', 'overlay', 'opacity', 'font', 'fontWeight', 'bold', 'italic'])
