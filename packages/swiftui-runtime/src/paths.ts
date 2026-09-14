import { opaque, type SwiftValue } from '@studio/swift-runtime'

/**
 * `Path` and the drawing commands that build one.
 *
 * The payload is *mutable*, which is unusual here and deliberate: `Path { p in
 * p.move(to: …); p.addLine(to: …) }` hands the closure a path and expects it to be
 * built up in place. Because an opaque payload is passed by reference and `copyValue`
 * leaves it alone, the mutations the closure makes are the path that comes back —
 * which is exactly the `inout` semantics the real initialiser has.
 *
 * Coordinates stay in the path's own space and are serialised to SVG at the end. The
 * renderer then draws one `<path>` element and has nothing to interpret.
 */

export const PATH_TYPE = 'Path'

export interface PathPoint {
  readonly x: number
  readonly y: number
}

export type PathCommand =
  | { readonly kind: 'move'; readonly to: PathPoint }
  | { readonly kind: 'line'; readonly to: PathPoint }
  | {
      readonly kind: 'curve'
      readonly to: PathPoint
      readonly control1: PathPoint
      readonly control2: PathPoint
    }
  | { readonly kind: 'quad'; readonly to: PathPoint; readonly control: PathPoint }
  | {
      readonly kind: 'arc'
      readonly centre: PathPoint
      readonly radius: number
      readonly startDegrees: number
      readonly endDegrees: number
      readonly clockwise: boolean
    }
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly width: number; readonly height: number; readonly radius: number }
  | { readonly kind: 'ellipse'; readonly x: number; readonly y: number; readonly width: number; readonly height: number }
  | { readonly kind: 'close' }

export interface PathPayload {
  /** Mutable on purpose — see the file comment. */
  commands: PathCommand[]
  /** `.trim(from:to:)`, applied when the path is serialised. */
  trim: { from: number; to: number } | null
}

export function newPath(commands: PathCommand[] = []): SwiftValue {
  return opaque(PATH_TYPE, { commands, trim: null } satisfies PathPayload)
}

export function asPath(value: SwiftValue | undefined): PathPayload | null {
  return value !== undefined && value.kind === 'opaque' && value.typeName === PATH_TYPE
    ? (value.payload as PathPayload)
    : null
}

function fmt(n: number): string {
  return Number.isFinite(n) ? String(Math.round(n * 100) / 100) : '0'
}

function pt(p: PathPoint): string {
  return `${fmt(p.x)} ${fmt(p.y)}`
}

/** A point on an ellipse arc, for the SVG `A` command's endpoints. */
function onCircle(centre: PathPoint, radius: number, degrees: number): PathPoint {
  const radians = (degrees * Math.PI) / 180
  return { x: centre.x + radius * Math.cos(radians), y: centre.y + radius * Math.sin(radians) }
}

/**
 * Serialises a path to SVG path data.
 *
 * Arcs are the fiddly part: SVG describes an arc by its *endpoint* plus flags, while
 * `addArc` describes it by centre and angles. A sweep of a full turn or more cannot
 * be expressed as one SVG arc at all — the start and end points coincide — so it is
 * emitted as two half sweeps.
 */
export function toSVGPath(payload: PathPayload): string {
  const parts: string[] = []

  for (const command of payload.commands) {
    switch (command.kind) {
      case 'move':
        parts.push(`M ${pt(command.to)}`)
        break
      case 'line':
        parts.push(`L ${pt(command.to)}`)
        break
      case 'curve':
        parts.push(`C ${pt(command.control1)} ${pt(command.control2)} ${pt(command.to)}`)
        break
      case 'quad':
        parts.push(`Q ${pt(command.control)} ${pt(command.to)}`)
        break
      case 'close':
        parts.push('Z')
        break

      case 'rect': {
        const { x, y, width, height, radius } = command
        if (radius <= 0) {
          parts.push(
            `M ${fmt(x)} ${fmt(y)} L ${fmt(x + width)} ${fmt(y)} L ${fmt(x + width)} ${fmt(y + height)} L ${fmt(x)} ${fmt(y + height)} Z`,
          )
          break
        }
        const r = Math.min(radius, width / 2, height / 2)
        parts.push(
          `M ${fmt(x + r)} ${fmt(y)}` +
            ` H ${fmt(x + width - r)} A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + width)} ${fmt(y + r)}` +
            ` V ${fmt(y + height - r)} A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + width - r)} ${fmt(y + height)}` +
            ` H ${fmt(x + r)} A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x)} ${fmt(y + height - r)}` +
            ` V ${fmt(y + r)} A ${fmt(r)} ${fmt(r)} 0 0 1 ${fmt(x + r)} ${fmt(y)} Z`,
        )
        break
      }

      case 'ellipse': {
        const { x, y, width, height } = command
        const rx = width / 2
        const ry = height / 2
        parts.push(
          `M ${fmt(x)} ${fmt(y + ry)}` +
            ` A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(x + width)} ${fmt(y + ry)}` +
            ` A ${fmt(rx)} ${fmt(ry)} 0 1 0 ${fmt(x)} ${fmt(y + ry)} Z`,
        )
        break
      }

      case 'arc': {
        const { centre, radius, startDegrees, endDegrees, clockwise } = command
        const sweep = Math.abs(endDegrees - startDegrees)
        const start = onCircle(centre, radius, startDegrees)
        parts.push(`${parts.length === 0 ? 'M' : 'L'} ${pt(start)}`)

        // One SVG arc cannot express a full turn: its endpoints would coincide.
        const steps = sweep >= 360 ? 2 : 1
        for (let step = 1; step <= steps; step++) {
          const angle = startDegrees + ((endDegrees - startDegrees) * step) / steps
          const to = onCircle(centre, radius, angle)
          const large = sweep / steps > 180 ? 1 : 0
          parts.push(
            `A ${fmt(radius)} ${fmt(radius)} 0 ${large} ${clockwise ? 1 : 0} ${pt(to)}`,
          )
        }
        break
      }
    }
  }

  return parts.join(' ')
}

/**
 * A `.trim(from:to:)` of a *stroked* path.
 *
 * Real trimming needs arc-length parameterisation of every segment. What is done
 * instead is exact for the shapes trimming is actually used on — a circle, for
 * progress rings — and approximate elsewhere: the arc's sweep is scaled. Anything
 * else is left whole rather than silently cut in the wrong place.
 */
export function applyTrim(payload: PathPayload): PathPayload {
  const trim = payload.trim
  if (!trim || (trim.from === 0 && trim.to === 1)) return payload

  const commands = payload.commands.map((command): PathCommand => {
    if (command.kind !== 'arc') return command
    const total = command.endDegrees - command.startDegrees
    return {
      ...command,
      startDegrees: command.startDegrees + total * trim.from,
      endDegrees: command.startDegrees + total * trim.to,
    }
  })

  return { commands, trim: null }
}

// ------------------------------------------------------------------- Canvas

export const CANVAS_CONTEXT_TYPE = 'GraphicsContext'

/** One drawing the `Canvas` closure asked for, in order. */
export interface CanvasDrawing {
  readonly d: string
  readonly fill: SwiftValue | null
  readonly stroke: SwiftValue | null
  readonly lineWidth: number
}

export interface CanvasContextPayload {
  /** Mutable: the closure draws into the context it was handed. */
  drawings: CanvasDrawing[]
}

export function newCanvasContext(): SwiftValue {
  return opaque(CANVAS_CONTEXT_TYPE, { drawings: [] } satisfies CanvasContextPayload)
}

export function asCanvasContext(value: SwiftValue | undefined): CanvasContextPayload | null {
  return value !== undefined &&
    value.kind === 'opaque' &&
    value.typeName === CANVAS_CONTEXT_TYPE
    ? (value.payload as CanvasContextPayload)
    : null
}
