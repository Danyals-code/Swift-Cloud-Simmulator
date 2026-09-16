import type { ResolvedFont, RGBA } from '@studio/shared'
import { CENTER, insets, type LayoutElement } from '@studio/swiftui-layout'
import { CONTROL_PARTS } from '../appearance/controls'

export function controlFont(child: LayoutElement, font: ResolvedFont): LayoutElement {
  return { kind: 'modified', id: `${child.id}-control-font`, modifier: { kind: 'controlFont', font }, child }
}

/** A fixed switch with the wide capsule thumb measured in the native reference. */
export function switchControl(path: string, on: boolean, tint: RGBA, off: RGBA): LayoutElement {
  const m = CONTROL_PARTS.switch
  const knob: LayoutElement = { kind: 'modified', id: `${path}knobframe`,
    modifier: { kind: 'frame', width: m.knobWidth, height: m.knob, alignment: CENTER },
    child: { kind: 'shape', id: `${path}knob`, shape: 'capsule', fill: { kind: 'solid', color: { r: 255, g: 255, b: 255, a: 1 } } } }
  return { kind: 'modified', id: `${path}switchframe`,
    modifier: { kind: 'frame', width: m.width, height: m.height, alignment: CENTER },
    child: { kind: 'zstack', id: `${path}switch`, alignment: { horizontal: on ? 'trailing' : 'leading', vertical: 'center' },
      children: [
        { kind: 'shape', id: `${path}track`, shape: 'capsule', fill: { kind: 'solid', color: on ? tint : off } },
        { kind: 'modified', id: `${path}knobpad`, modifier: { kind: 'padding', insets: insets(0, m.inset, 0, m.inset) },
          child: { kind: 'modified', id: `${path}knobround`, modifier: { kind: 'cornerRadius', radius: m.knob / 2 },
            child: { kind: 'modified', id: `${path}knobshadow`, modifier: { kind: 'shadow', radius: m.shadow, x: 0, y: 1, color: { r: 0, g: 0, b: 0, a: 0.18 } }, child: knob } } },
      ] } }
}
