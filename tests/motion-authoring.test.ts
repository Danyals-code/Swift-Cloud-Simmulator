import { describe, expect, it } from 'vitest'
import { MOTION_CONTROLS, type AuthoringNode, type DesignControl, type DesignEditRequest } from '@studio/shared'
import { buildAuthoringModel, planDesignEdit } from '@studio/swift-sema'
import { XCODE, edited, project, refusal, screen, typecheckInXcode, viewWritten } from './helpers/layer-project'

/**
 * Motion in Design (Wave 5a): a tap that animates what it changes, a view's transition as it
 * comes and goes, digits that roll, and a view that moves with another between states. Read
 * and written through the authoring model and the edit planner, as the panel does.
 */

/** A screen with `members` in ContentView and `body`, as `screen` writes it. */
const withState = (members: string, body: string, declarations = '') => screen(body, declarations).replace('struct ContentView: View {\n', `struct ContentView: View {\n${members}\n`)

const expand = (action: string) => withState('    @State private var expanded = false', `        VStack {
            Button("Expand") {
${action}
            }
            Text("More")
        }`)

describe('Animate this change: reading', () => {
  it.each([
    ['withAnimation(.smooth)', { style: 'smooth', written: '.smooth' }],
    ['withAnimation', { style: 'default', written: '' }],
    ['withAnimation(.default)', { style: 'default', written: '.default' }],
    ['withAnimation(.easeInOut(duration: 0.4))', { style: 'easeInOut', duration: 0.4, written: '.easeInOut(duration: 0.4)' }],
    ['withAnimation(.linear)', { style: 'linear', written: '.linear' }],
    ['withAnimation(Animation.bouncy)', { style: 'bouncy', written: 'Animation.bouncy' }],
    ['withAnimation(.spring(response: 0.4))', { style: null, written: '.spring(response: 0.4)' }],
  ])('reads an action written in %s', (opening, animation) => {
    const source = expand(`                ${opening} {\n                    expanded.toggle()\n                }`)
    expect(viewWritten(source, source.slice(source.indexOf('Button("Expand")'), source.indexOf('            }\n            Text("More")') + 13)).behavior?.animation).toEqual(animation)
  })

  it('reads no animation on an action that does more than animate', () => {
    const source = expand('                withAnimation {\n                    expanded.toggle()\n                }\n                print("tapped")')
    expect(viewWritten(source, source.slice(source.indexOf('Button("Expand")'), source.indexOf('            }\n            Text("More")') + 13)).behavior?.animation).toBeUndefined()
  })
})

describe('Animate this change: writing', () => {
  const button = (source: string) => source.slice(source.indexOf('Button("Expand")'), source.indexOf('\n            Text("More")'))
  const animate = (source: string, animation: Parameters<typeof animationOperation>[0]) => edited(source, button(source), animationOperation(animation))
  function animationOperation(animation: { style: 'smooth' | 'snappy' | 'bouncy' | 'default' | 'easeInOut' | 'linear'; duration?: number } | null) { return { kind: 'animate-action' as const, animation } }
  const plain = withState('    @State private var expanded = false', `        VStack {
            Button("Expand") { expanded.toggle() }
            Text("More")
        }`)
  const smooth = expand('                withAnimation(.smooth) {\n                    expanded.toggle()\n                }')

  it('wraps an action in withAnimation, keeping what it does', () => {
    expect(animate(plain, { style: 'smooth' })).toBe(smooth)
  })

  it('keeps every statement and note of an action written over lines', () => {
    const source = expand('                // Opens the details\n                expanded.toggle()\n                print("tapped")')
    expect(animate(source, { style: 'bouncy' })).toBe(expand('                withAnimation(.bouncy) {\n                    // Opens the details\n                    expanded.toggle()\n                    print("tapped")\n                }'))
  })

  it('indents inside withAnimation by the file’s own step', () => {
    const tabs = (source: string) => source.replace(/^(?: {4})+/gm, indent => '\t'.repeat(indent.length / 4))
    const source = tabs(expand('                expanded.toggle()\n                print("tapped")'))
    const tap = source.slice(source.indexOf('Button("Expand")'), source.indexOf('\n\t\t\tText("More")'))
    expect(edited(source, tap, animationOperation({ style: 'smooth' }))).toBe(tabs(expand('                withAnimation(.smooth) {\n                    expanded.toggle()\n                    print("tapped")\n                }')))
  })

  it.each([
    [{ style: 'snappy' as const }, 'withAnimation(.snappy) {'],
    [{ style: 'default' as const }, 'withAnimation {'],
    [{ style: 'easeInOut' as const, duration: 0.4 }, 'withAnimation(.easeInOut(duration: 0.4)) {'],
    [{ style: 'linear' as const, duration: 1 }, 'withAnimation(.linear(duration: 1)) {'],
  ])('changes the style of an animated action to %o', (animation, opening) => {
    expect(animate(smooth, animation)).toBe(smooth.replace('withAnimation(.smooth) {', opening))
  })

  it('takes the animation away, keeping what the action does, over the lines it is written on', () => {
    expect(animate(smooth, null)).toBe(expand('                expanded.toggle()'))
    const several = expand('                withAnimation {\n                    expanded.toggle()\n                    print("tapped")\n                }')
    expect(animate(several, null)).toBe(expand('                expanded.toggle()\n                print("tapped")'))
  })

  it('refuses an action that does nothing yet, and a duration on a spring', () => {
    const empty = withState('    @State private var expanded = false', `        VStack {
            Button("Expand") { }
            Text("More")
        }`)
    expect(refusal(empty, 'Button("Expand") { }', { kind: 'animate-action', animation: { style: 'smooth' } })).toBe('Choose what a tap does first, then animate it.')
    expect(refusal(plain, 'Button("Expand") { expanded.toggle() }', { kind: 'animate-action', animation: { style: 'smooth', duration: 2 } })).toBe('Choose Smooth, Snappy, Bouncy, Default, Ease in and out or Linear, and a duration of up to 10 seconds.')
  })

  it('keeps the animation when the action is replaced, unless it is switched off', () => {
    const spring = expand('                withAnimation(.spring(response: 0.4)) {\n                    expanded.toggle()\n                }')
    const replaced = (animation?: { style: 'snappy' } | null) => edited(spring, button(spring), { kind: 'behavior', action: { type: 'set', state: 'expanded', value: true, ...animation !== undefined ? { animation } : {} }, replace: true })
    expect(replaced()).toBe(expand('                withAnimation(.spring(response: 0.4)) {\n                    expanded = true\n                }'))
    expect(replaced(null)).toBe(plain.replace('expanded.toggle()', 'expanded = true'))
    expect(replaced({ style: 'snappy' })).toBe(expand('                withAnimation(.snappy) {\n                    expanded = true\n                }'))
  })

  describe.skipIf(!XCODE)('in Xcode 27', () => {
    it('type-checks each style at iOS 13 and 27', () => {
      const forms = [{ style: 'smooth' as const }, { style: 'snappy' as const }, { style: 'bouncy' as const }, { style: 'default' as const }, { style: 'easeInOut' as const, duration: 0.4 }, { style: 'linear' as const, duration: 2 }].map(animation => animate(plain, animation))
      typecheckInXcode([...forms, ...forms.map(form => `// target: iOS 13\n${form}`)])
    }, 300_000)
  })
})

/** The view's control with `id`, as the Visibility group shows it. */
const control = (node: AuthoringNode, id: string): DesignControl | undefined => node.controls?.find(c => c.id === id)
const set = (source: string, view: string, id: string, value: string, target?: string) => edited(source, view, { kind: 'property', control: id, value }, target)

describe('Transition', () => {
  const banner = (view: string, members = '    @State private var showBanner = false') => withState(members, `        VStack {
            if showBanner {
                ${view}
            }
            Button("Toggle") { showBanner.toggle() }
        }`)

  it.each([
    ['Text("Hi")', 'None', undefined, undefined],
    ['Text("Hi")\n                    .transition(.opacity)', 'Fade', undefined, undefined],
    ['Text("Hi")\n                    .transition(.slide)', 'Slide', undefined, 'false'],
    ['Text("Hi")\n                    .transition(.move(edge: .top).combined(with: .opacity))', 'Move from edge', 'top', 'true'],
    ['Text("Hi")\n                    .transition(AnyTransition.push(from: .trailing))', 'Push from edge', 'trailing', 'false'],
    ['Text("Hi")\n                    .transition(.blurReplace)', 'Blur', undefined, 'false'],
  ])('reads %s', (view, style, edge, fades) => {
    const node = viewWritten(banner(view), view)
    expect(control(node, MOTION_CONTROLS.transition)).toMatchObject({ kind: 'select', value: style, group: 'Visibility' })
    expect(control(node, MOTION_CONTROLS.edge)?.value).toBe(edge)
    expect(control(node, MOTION_CONTROLS.fades)?.value).toBe(fades)
  })

  it('offers the transitions the deployment target has', () => {
    const node = (target: string) => viewWritten(banner('Text("Hi")'), 'Text("Hi")', target)
    expect(control(node('15.0'), MOTION_CONTROLS.transition)?.options).toEqual(['None', 'Fade', 'Slide', 'Scale', 'Move from edge'])
    expect(control(node('17.0'), MOTION_CONTROLS.transition)?.options).toEqual(['None', 'Fade', 'Slide', 'Scale', 'Move from edge', 'Push from edge', 'Blur'])
  })

  it('reads a transition different in and out as written, and offers none on a view that is always shown', () => {
    const view = 'Text("Hi")\n                    .transition(.asymmetric(insertion: .scale, removal: .opacity))'
    expect(control(viewWritten(banner(view), view), MOTION_CONTROLS.transition)).toMatchObject({ value: 'Different in and out', disabledReason: 'This transition is one Design doesn’t write. Change it in Code.' })
    expect(control(viewWritten(banner('Text("Hi")'), 'Button("Toggle") { showBanner.toggle() }'), MOTION_CONTROLS.transition)).toBeUndefined()
  })

  it('writes a transition on the view inside the if, and an animation on the stack around it, each on its own line', () => {
    expect(set(banner('Text("Hi")'), 'Text("Hi")', MOTION_CONTROLS.transition, 'Fade')).toBe(banner('Text("Hi")\n                    .transition(.opacity)').replace('showBanner.toggle() }\n        }\n', 'showBanner.toggle() }\n        }\n        .animation(.default, value: showBanner)\n'))
  })

  it('leaves the stack alone when the tap that shows the view animates already', () => {
    const source = banner('Text("Hi")').replace('Button("Toggle") { showBanner.toggle() }', 'Button("Toggle") {\n                withAnimation {\n                    showBanner.toggle()\n                }\n            }')
    expect(set(source, 'Text("Hi")', MOTION_CONTROLS.transition, 'Scale')).toBe(source.replace('                Text("Hi")\n', '                Text("Hi")\n                    .transition(.scale)\n'))
  })

  it('takes away the animation it added on the stack with the last transition that plays by it', () => {
    const faded = set(banner('Text("Hi")'), 'Text("Hi")', MOTION_CONTROLS.transition, 'Fade')
    expect(faded).toContain('        .animation(.default, value: showBanner)\n')
    expect(set(faded, 'Text("Hi")\n                    .transition(.opacity)', MOTION_CONTROLS.transition, 'None')).toBe(banner('Text("Hi")'))
  })

  it('keeps that animation while another transition plays by it', () => {
    const both = withState('    @State private var showBanner = false', `        VStack {
            if showBanner {
                Text("Hi")
                    .transition(.opacity)
            } else {
                Text("Bye")
                    .transition(.slide)
            }
            Button("Toggle") { showBanner.toggle() }
        }
        .animation(.default, value: showBanner)`)
    expect(set(both, 'Text("Hi")\n                    .transition(.opacity)', MOTION_CONTROLS.transition, 'None')).toBe(both.replace('\n                    .transition(.opacity)', ''))
  })

  it('takes away the animation it added on the stack when the tap that changes its value is animated, so the tap’s style plays', () => {
    const faded = set(banner('Text("Hi")'), 'Text("Hi")', MOTION_CONTROLS.transition, 'Fade')
    const tap = 'Button("Toggle") { showBanner.toggle() }'
    expect(edited(faded, tap, { kind: 'animate-action', animation: { style: 'snappy' } })).toBe(banner('Text("Hi")\n                    .transition(.opacity)').replace(tap, 'Button("Toggle") {\n                withAnimation(.snappy) {\n                    showBanner.toggle()\n                }\n            }'))
  })

  it('changes the style, the edge and Fades too in place, and takes the transition away', () => {
    const view = 'Text("Hi")\n                    .transition(.move(edge: .top))'
    const source = banner(view)
    expect(set(source, view, MOTION_CONTROLS.transition, 'Push from edge')).toBe(banner('Text("Hi")\n                    .transition(.push(from: .top))'))
    expect(set(source, view, MOTION_CONTROLS.edge, 'bottom')).toBe(banner('Text("Hi")\n                    .transition(.move(edge: .bottom))'))
    expect(set(source, view, MOTION_CONTROLS.fades, 'true')).toBe(banner('Text("Hi")\n                    .transition(.move(edge: .top).combined(with: .opacity))'))
    expect(set(source, view, MOTION_CONTROLS.transition, 'None')).toBe(banner('Text("Hi")'))
  })

  it('offers and writes a transition below iOS 15, which builds at iOS 13', () => {
    expect(control(viewWritten(banner('Text("Hi")'), 'Text("Hi")', '13.0'), MOTION_CONTROLS.transition)?.disabledReason).toBeUndefined()
    expect(viewWritten(banner('Text("Hi")'), 'Text("Hi")', '14.0').behavior?.appear).toEqual({ by: 'branch' })
    expect(set(banner('Text("Hi")'), 'Text("Hi")', MOTION_CONTROLS.transition, 'Slide', '13.0')).toContain('                Text("Hi")\n                    .transition(.slide)\n')
  })

  it('writes the Appear animation of before each on a line of its own, never glued to a brace', () => {
    expect(edited(banner('Text("Hi")'), 'Text("Hi")', { kind: 'transition', state: 'showBanner', style: 'opacity', duration: 0.25 })).toBe(banner('Text("Hi")\n                    .transition(.opacity)').replace('showBanner.toggle() }\n        }\n', 'showBanner.toggle() }\n        }\n        .animation(.easeInOut(duration: 0.25), value: showBanner)\n'))
  })

  it('refuses a transition newer than the deployment target', () => {
    expect(refusal(banner('Text("Hi")'), 'Text("Hi")', { kind: 'property', control: MOTION_CONTROLS.transition, value: 'Blur' }, '16.0')).toMatch(/Blur/)
  })
})

describe('Rolls digits', () => {
  const counter = (view: string, members = '    @State private var count = 9') => withState(members, `        VStack {
            ${view}
            Button("Add") { count += 1 }
        }`)
  const number = 'Text("\\(count)")'

  it('offers it on a text showing a value, from iOS 16, and not on plain words', () => {
    expect(control(viewWritten(counter(number), number, '16.0'), MOTION_CONTROLS.rollsDigits)).toMatchObject({ kind: 'toggle', value: 'false', group: 'Visibility' })
    expect(control(viewWritten(counter(number), number, '15.0'), MOTION_CONTROLS.rollsDigits)?.disabledReason).toBe('Rolling digits needs iOS 16 or newer.')
    expect(control(viewWritten(counter('Text("Count")'), 'Text("Count")'), MOTION_CONTROLS.rollsDigits)).toBeUndefined()
  })

  it('writes numericText, with the value where iOS 17 can take it, and takes it away', () => {
    expect(set(counter(number), number, MOTION_CONTROLS.rollsDigits, 'true', '16.0')).toBe(counter(`${number}\n                .contentTransition(.numericText())`))
    expect(set(counter(number), number, MOTION_CONTROLS.rollsDigits, 'true', '17.0')).toBe(counter(`${number}\n                .contentTransition(.numericText(value: Double(count)))`))
    const score = counter('Text("\\(score)")', '    @State private var score = 0.5\n    @State private var count = 0')
    expect(set(score, 'Text("\\(score)")', MOTION_CONTROLS.rollsDigits, 'true')).toBe(score.replace('Text("\\(score)")', 'Text("\\(score)")\n                .contentTransition(.numericText(value: score))'))
    const rolling = `${number}\n                .contentTransition(.numericText())`
    expect(control(viewWritten(counter(rolling), rolling), MOTION_CONTROLS.rollsDigits)?.value).toBe('true')
    expect(set(counter(rolling), rolling, MOTION_CONTROLS.rollsDigits, 'false')).toBe(counter(number))
  })

  it('writes numericText with the value a Text formats, where iOS 17 can take it', () => {
    const price = 'Text(price, format: .currency(code: "USD"))', count = 'Text(count, format: .number)'
    const source = counter(`${price}\n            ${count}`, '    @State private var price = 9.99\n    @State private var count = 0')
    expect(set(source, price, MOTION_CONTROLS.rollsDigits, 'true', '17.0')).toBe(source.replace(price, `${price}\n                .contentTransition(.numericText(value: price))`))
    expect(set(source, count, MOTION_CONTROLS.rollsDigits, 'true', '17.0')).toBe(source.replace(count, `${count}\n                .contentTransition(.numericText(value: Double(count)))`))
    expect(set(source, price, MOTION_CONTROLS.rollsDigits, 'true', '16.0')).toBe(source.replace(price, `${price}\n                .contentTransition(.numericText())`))
  })

  it('reads another content transition as written', () => {
    const fading = `${number}\n                .contentTransition(.opacity)`
    expect(control(viewWritten(counter(fading), fading), MOTION_CONTROLS.rollsDigits)).toMatchObject({ value: 'false', disabledReason: 'This text changes in a way Design doesn’t write. Change it in Code.' })
  })
})

describe('Moves with', () => {
  const big = 'RoundedRectangle(cornerRadius: 24)\n                    .frame(height: 300)'
  const small = 'RoundedRectangle(cornerRadius: 12)\n                    .frame(width: 80, height: 80)'
  const card = (first = big, second = small, members = '    @State private var expanded = false') => withState(members, `        VStack {
            if expanded {
                ${first}
            } else {
                ${second}
            }
            Button("Toggle") { expanded.toggle() }
        }`)
  const effect = '\n                    .matchedGeometryEffect(id: "roundedRectangle", in: namespace)'
  const matched = card(big + effect, small + effect, '    @State private var expanded = false\n    @Namespace private var namespace')

  it('offers the views of the if’s other branch, from iOS 14', () => {
    expect(control(viewWritten(card(), big), MOTION_CONTROLS.movesWith)).toMatchObject({ kind: 'select', value: 'None', options: ['None', 'Rounded rectangle'], group: 'Visibility' })
    expect(control(viewWritten(card(), small, '13.0'), MOTION_CONTROLS.movesWith)?.disabledReason).toBe('Moving between states needs iOS 14 or newer.')
    expect(control(viewWritten(card(), 'Button("Toggle") { expanded.toggle() }'), MOTION_CONTROLS.movesWith)).toBeUndefined()
  })

  it('marks both views as the same thing in one namespace, and takes it away again', () => {
    const written = set(card(), big, MOTION_CONTROLS.movesWith, 'Rounded rectangle')
    expect(written).toBe(card(big + effect, small + effect).replace('\n    var body: some View {', '\n    @Namespace private var namespace\n    var body: some View {'))
    expect(control(viewWritten(matched, big + effect), MOTION_CONTROLS.movesWith)?.value).toBe('Rounded rectangle')
    expect(control(viewWritten(matched, small + effect), MOTION_CONTROLS.movesWith)?.value).toBe('Rounded rectangle')
    expect(set(matched, small + effect, MOTION_CONTROLS.movesWith, 'None')).toBe(card())
  })

  it('reads an effect whose partner is written elsewhere as written', () => {
    const lone = card(big + effect, small, '    @State private var expanded = false\n    @Namespace private var namespace')
    expect(control(viewWritten(lone, big + effect), MOTION_CONTROLS.movesWith)).toMatchObject({ value: 'None', disabledReason: 'This view moves with another in a way Design doesn’t write. Change it in Code.' })
  })

  it('keeps the namespace while anything else uses it, such as a view it is given to', () => {
    const hero = '\n                    .matchedGeometryEffect(id: "dot", in: hero)'
    const shared = (effect: string) => withState('    @State private var big = false\n    @Namespace private var hero', `        VStack {
            if big {
                Circle()${effect}
                    .frame(width: 200, height: 200)
            } else {
                Circle()${effect}
                    .frame(width: 40, height: 40)
            }
            Badge(namespace: hero)
        }`, '\nstruct Badge: View {\n    let namespace: Namespace.ID\n    var body: some View {\n        Text("Badge")\n    }\n}\n')
    const small = `Circle()${hero}\n                    .frame(width: 40, height: 40)`
    expect(set(shared(hero), small, MOTION_CONTROLS.movesWith, 'None')).toBe(shared(''))
  })
})

describe('Transition and animation cards', () => {
  const view = 'Text("Hi")\n                    .transition(.move(edge: .top))'
  const source = withState('    @State private var showBanner = false', `        VStack {
            if showBanner {
                ${view}
            }
        }
        .animation(.easeInOut(duration: 0.25), value: showBanner)`)
  const stack = () => buildAuthoringModel({ projectId: 'p', revision: 1, files: project(source) }).nodes.find(n => n.name === 'VStack')!
  const onStack = (operation: DesignEditRequest['operation']) => {
    const node = stack(), plan = planDesignEdit({ projectId: 'p', baseRevision: 1, files: project(source), scope: node.owner, target: node.source, fingerprint: node.fingerprint, operation })
    if (!plan.ok) throw new Error(plan.reason)
    return plan.changes[0]!.after
  }

  it('edits a transition on its card, and takes it out', () => {
    const card = viewWritten(source, view).modifiers!.find(m => m.name === 'transition')!
    expect(card.capabilities).toMatchObject({ edit: true, remove: true })
    expect(card.controls.map(c => [c.label, c.value])).toEqual([['Transition', 'Move from edge'], ['Edge', 'top'], ['Fades too', 'false']])
    expect(set(source, view, card.controls[1]!.id, 'leading')).toBe(source.replace('.move(edge: .top)', '.move(edge: .leading)'))
    expect(set(source, view, card.controls[0]!.id, 'Scale')).toBe(source.replace('.move(edge: .top)', '.scale'))
    expect(edited(source, view, { kind: 'modifier-remove', modifier: card.id })).toBe(source.replace('\n                    .transition(.move(edge: .top))', ''))
  })

  it('edits the animation of a value on its card, and takes it out', () => {
    const card = stack().modifiers!.find(m => m.name === 'animation')!
    expect(card.capabilities).toMatchObject({ edit: true, remove: true })
    expect(card.controls.map(c => [c.label, c.value])).toEqual([['Animation', 'Ease in and out'], ['Duration', '0.25']])
    expect(onStack({ kind: 'property', control: card.controls[0]!.id, value: 'Smooth' })).toBe(source.replace('.easeInOut(duration: 0.25)', '.smooth'))
    expect(onStack({ kind: 'property', control: card.controls[0]!.id, value: 'Default' })).toBe(source.replace('.easeInOut(duration: 0.25)', '.default'))
    expect(onStack({ kind: 'property', control: card.controls[1]!.id, value: '1' })).toBe(source.replace('.easeInOut(duration: 0.25)', '.easeInOut(duration: 1)'))
    expect(onStack({ kind: 'modifier-remove', modifier: card.id })).toBe(source.replace('\n        .animation(.easeInOut(duration: 0.25), value: showBanner)', ''))
  })
})

describe.skipIf(!XCODE)('motion forms in Xcode 27', () => {
  it('type-checks each transition, digits and moving between states at their iOS', () => {
    const banner = (target: string) => withState('    @State private var showBanner = false\n    @State private var count = 0', `        VStack {
            if showBanner {
                Text("\\(count)")
            }
            Button("Toggle") { showBanner.toggle() }
        }`).replace('import SwiftUI', `// target: iOS ${target}\nimport SwiftUI`)
    const view = 'Text("\\(count)")'
    const forms: string[] = []
    for (const [style, target] of [['Fade', '13'], ['Slide', '13'], ['Scale', '13'], ['Move from edge', '13'], ['Push from edge', '16'], ['Blur', '17']] as const) {
      const written = set(banner(target), view, MOTION_CONTROLS.transition, style, `${target}.0`)
      forms.push(written)
      if (style !== 'Fade') forms.push(set(written, written.slice(written.indexOf(view), written.indexOf(')\n', written.indexOf('.transition(')) + 1), MOTION_CONTROLS.fades, 'true', `${target}.0`))
    }
    forms.push(set(banner('16'), view, MOTION_CONTROLS.rollsDigits, 'true', '16.0'), set(banner('17'), view, MOTION_CONTROLS.rollsDigits, 'true', '17.0'))
    const price = 'Text(price, format: .currency(code: "USD"))', priced = withState('    @State private var price = 9.99', `        VStack {\n            ${price}\n        }`).replace('import SwiftUI', '// target: iOS 17\nimport SwiftUI')
    forms.push(set(priced, price, MOTION_CONTROLS.rollsDigits, 'true', '17.0'))
    // A tap animated after a transition: the stack's own animation taken away, the tap's style kept.
    const faded = set(banner('13'), view, MOTION_CONTROLS.transition, 'Fade', '13.0'), tap = 'Button("Toggle") { showBanner.toggle() }'
    forms.push(edited(faded, tap, { kind: 'animate-action', animation: { style: 'snappy' } }, '17.0').replace('// target: iOS 13', '// target: iOS 17'))
    const big = 'RoundedRectangle(cornerRadius: 24)', source = withState('    @State private var expanded = false', `        VStack {
            if expanded {
                ${big}
            } else {
                Circle()
            }
        }`).replace('import SwiftUI', '// target: iOS 14\nimport SwiftUI')
    forms.push(set(source, big, MOTION_CONTROLS.movesWith, 'Circle', '14.0'))
    typecheckInXcode(forms)
  }, 300_000)
})
