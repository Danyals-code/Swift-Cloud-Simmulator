import type { GesturePhase, UIEvent } from '@studio/shared'
import { double, opaque, type ClosureValue, type SwiftValue } from '@studio/swift-runtime'

/**
 * Gestures.
 *
 * A gesture is built up by chaining - `DragGesture().onChanged { … }.onEnded { … }` -
 * so the value is accumulated rather than constructed in one go. Each link returns a
 * new gesture with one more handler, which is also why this is a value type here:
 * the chain is value-semantic in SwiftUI too.
 *
 * The one genuine subtlety is `.updating($state) { value, state, _ in … }`. Its
 * second parameter is `inout`, which the interpreter does not implement - but a
 * property-wrapper *projection* is exactly an `inout` by another name, so the
 * parameter is bound to a projection onto the gesture-state box and `state = …`
 * writes through it. The mechanism that made `@Binding` work turns out to be the
 * mechanism `inout` needs.
 */

export const GESTURE_TYPE = 'Gesture'
export const GESTURE_VALUE_TYPE = 'GestureValue'
export const SIZE_TYPE = 'CGSize'
export const POINT_TYPE = 'CGPoint'
export const RECT_TYPE = 'CGRect'

export type GestureKind = 'drag' | 'longPress' | 'magnify' | 'rotate' | 'tap'

export interface GestureHandler {
  readonly phase: 'changed' | 'ended'
  readonly closure: ClosureValue
}

export interface GestureUpdate {
  /** The `@GestureState` projection the closure writes through. */
  readonly binding: SwiftValue
  readonly closure: ClosureValue
}

export interface GesturePayload {
  readonly kind: GestureKind
  readonly minimumDistance: number
  readonly handlers: readonly GestureHandler[]
  readonly updates: readonly GestureUpdate[]
  /** `.simultaneously(with:)` - both run, which is the only composition modelled. */
  readonly also: readonly GesturePayload[]
}

export function gesture(kind: GestureKind, minimumDistance = 10): SwiftValue {
  return opaque(GESTURE_TYPE, {
    kind,
    minimumDistance,
    handlers: [],
    updates: [],
    also: [],
  } satisfies GesturePayload)
}

export function asGesture(value: SwiftValue | undefined): GesturePayload | null {
  return value !== undefined && value.kind === 'opaque' && value.typeName === GESTURE_TYPE
    ? (value.payload as GesturePayload)
    : null
}

export function withHandler(base: GesturePayload, handler: GestureHandler): SwiftValue {
  return opaque(GESTURE_TYPE, { ...base, handlers: [...base.handlers, handler] })
}

export function withUpdate(base: GesturePayload, update: GestureUpdate): SwiftValue {
  return opaque(GESTURE_TYPE, { ...base, updates: [...base.updates, update] })
}

export function combined(base: GesturePayload, other: GesturePayload): SwiftValue {
  return opaque(GESTURE_TYPE, { ...base, also: [...base.also, other] })
}

/** Every gesture in a chain, the root first. */
export function flattenGesture(payload: GesturePayload): GesturePayload[] {
  return [payload, ...payload.also.flatMap(flattenGesture)]
}

// ------------------------------------------------------------------- values

export function size(width: number, height: number): SwiftValue {
  return opaque(SIZE_TYPE, { width, height })
}

export function point(x: number, y: number): SwiftValue {
  return opaque(POINT_TYPE, { x, y })
}

/**
 * Reads a member of a `CGSize`, `CGPoint`, `CGRect` or a gesture value.
 *
 * These are the only structural values the host hands to user code, and each is a
 * flat record - so one lookup covers all of them rather than four near-identical
 * member tables.
 */
export function geometryMember(value: SwiftValue, member: string): SwiftValue | undefined {
  if (value.kind !== 'opaque') return undefined
  if (
    value.typeName !== SIZE_TYPE &&
    value.typeName !== POINT_TYPE &&
    value.typeName !== RECT_TYPE &&
    value.typeName !== GESTURE_VALUE_TYPE
  ) {
    return undefined
  }

  const payload = value.payload as Record<string, unknown>

  // A rect's derived edges and centre. Every custom `Shape` reads these - a path has
  // to be drawn somewhere inside the rect it was handed - and without them
  // `rect.midX` reported no such member and the shape drew nothing.
  if (value.typeName === RECT_TYPE) {
    const derived = rectMember(payload, member)
    if (derived !== undefined) return double(derived)
  }

  const found = payload[member]

  if (typeof found === 'number') return double(found)
  if (found && typeof found === 'object') return found as SwiftValue
  return undefined
}

/**
 * `minX`, `midY`, `maxX` and the rest, computed rather than stored.
 *
 * Swift's `CGRect` derives all of them from origin and size, and so does this -
 * storing them would mean eight numbers that can disagree with the four that matter.
 * `origin` and `size` are handled by the payload lookup above, which finds the
 * objects; these are the scalars.
 */
function rectMember(payload: Record<string, unknown>, member: string): number | undefined {
  const x = typeof payload.x === 'number' ? payload.x : 0
  const y = typeof payload.y === 'number' ? payload.y : 0
  const w = typeof payload.width === 'number' ? payload.width : 0
  const h = typeof payload.height === 'number' ? payload.height : 0

  switch (member) {
    case 'minX':
      return Math.min(x, x + w)
    case 'midX':
      return x + w / 2
    case 'maxX':
      return Math.max(x, x + w)
    case 'minY':
      return Math.min(y, y + h)
    case 'midY':
      return y + h / 2
    case 'maxY':
      return Math.max(y, y + h)
    default:
      return undefined
  }
}

/**
 * The value a gesture hands its closures.
 *
 * Shaped to match `DragGesture.Value`: `translation` and the locations are the
 * members real code reads. `predictedEndTranslation` is the translation itself -
 * honest rather than invented, since a preview has no velocity to extrapolate from.
 */
export function gestureValue(event: UIEvent): SwiftValue {
  if (event.kind === 'drag') {
    const translation = size(event.translation.x, event.translation.y)
    return opaque(GESTURE_VALUE_TYPE, {
      translation,
      predictedEndTranslation: translation,
      location: point(event.location.x, event.location.y),
      startLocation: point(event.startLocation.x, event.startLocation.y),
      width: event.translation.x,
      height: event.translation.y,
    })
  }

  if (event.kind === 'magnify') {
    return opaque(GESTURE_VALUE_TYPE, { magnification: event.scale, scale: event.scale })
  }

  if (event.kind === 'rotate') {
    return opaque(GESTURE_VALUE_TYPE, { degrees: event.degrees, radians: (event.degrees * Math.PI) / 180 })
  }

  return opaque(GESTURE_VALUE_TYPE, {})
}

/** The gesture kind an event drives. */
export function kindOfEvent(event: UIEvent): GestureKind | null {
  switch (event.kind) {
    case 'drag':
      return 'drag'
    case 'magnify':
      return 'magnify'
    case 'rotate':
      return 'rotate'
    case 'longPress':
      return 'longPress'
    case 'tap':
      return 'tap'
    default:
      return null
  }
}

export function phaseOfEvent(event: UIEvent): GesturePhase {
  return 'phase' in event ? event.phase : 'ended'
}
