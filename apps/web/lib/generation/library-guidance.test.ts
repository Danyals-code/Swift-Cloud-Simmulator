import { describe, expect, it } from 'vitest'
import { compile, resetPipelineState } from '@studio/swiftui-runtime'
import { LIBRARY_IMAGES } from '@studio/project-model'
import { typecheckInXcode, XCODE } from '../../../../tests/helpers/layer-project'
import { libraryPreviewImages } from '../../../../tests/helpers/library'
import { EDIT_SYSTEM_PROMPT } from './edit-prompt'
import { LIBRARY_GUIDANCE, SWIFTUI_GUIDANCE } from './guidance'
import { SYSTEM_PROMPT } from './prompt'

/** The forms the library guidance asks for, on one screen: a hero, and a record's photo. */
const LIBRARY_FORMS = `import SwiftUI
@main struct TripsApp: App { var body: some Scene { WindowGroup { NavigationStack { TripsView() } } } }
struct Trip: Identifiable { let id: Int; var name: String; var photo: String }
struct TripsView: View {
    @State private var trips: [Trip] = [Trip(id: 1, name: "Coast", photo: "red-roof-house"), Trip(id: 2, name: "City", photo: "red-bus-bridge")]
    var body: some View {
        List {
            Image("snowy-peak")
                .resizable()
                .scaledToFill()
                .frame(height: 220)
                .clipped()
            ForEach(trips) { trip in
                HStack {
                    Image(trip.photo)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: 56, height: 56)
                        .clipShape(.rect(cornerRadius: 8))
                    Text(trip.name)
                }
            }
        }
        .navigationTitle("Trips")
    }
}
`

/** What the preview reports for a source, errors and warnings both. */
function problems(text: string) {
  resetPipelineState()
  const preview = compile({ files: [{ id: 'App.swift', text }], canvas: { width: 402, height: 874 }, colorScheme: 'light', revision: 1, images: libraryPreviewImages() })
  return { preview, messages: [...preview.diagnostics.map(d => d.message), ...preview.logs.filter(log => log.level === 'error' || log.level === 'warn').map(log => log.message)] }
}

describe('the built-in library in both AI prompts (Wave 7b)', () => {
  it('lists every library image by its exact name, with its alt text, which gives its shape', () => {
    for (const prompt of [SYSTEM_PROMPT, EDIT_SYSTEM_PROMPT]) {
      for (const image of LIBRARY_IMAGES) expect(prompt).toContain(`- ${image.name}: ${image.alt}`)
    }
    expect(LIBRARY_GUIDANCE).toContain('Portrait, 2:3.')
  })
  it('asks for the name as a string literal, resizable and framed, and never an invented one', () => {
    expect(LIBRARY_GUIDANCE).toContain('Image("snowy-peak")')
    expect(LIBRARY_GUIDANCE).toMatch(/string literal/)
    expect(LIBRARY_GUIDANCE).toContain('.resizable()')
    expect(LIBRARY_GUIDANCE).toMatch(/[Nn]ever invent/)
  })
  it('never presents the people in the photos as users, contacts or authors, and never names them', () => {
    expect(LIBRARY_GUIDANCE).toContain('never as a user, contact, author, reviewer or coach')
    expect(LIBRARY_GUIDANCE).toContain('never give them a name')
  })
  it('lets the generate prompt use the library, and no other asset', () => {
    expect(SYSTEM_PROMPT).toContain('external assets other than the built-in library images')
  })
  it('tells the edit prompt that the project’s own image of a name replaces the library’s', () => {
    expect(EDIT_SYSTEM_PROMPT).toContain('An image in project.images replaces a library image of the same name.')
    expect(EDIT_SYSTEM_PROMPT).toMatch(/Never invent an image name that is neither in project\.images nor in the library/)
  })
  it('draws the forms it asks for, from the library, without a warning', () => {
    const { preview, messages } = problems(LIBRARY_FORMS)
    expect(messages).toEqual([])
    const urls = preview.renderTree?.nodes.map(node => node.image?.bitmap?.url).filter(Boolean)
    expect(urls).toEqual(['/library/v1/snowy-peak.jpg', '/library/v1/red-roof-house.jpg', '/library/v1/red-bus-bridge.jpg'])
  })
})

describe('rules the preview has outgrown (Wave 7b)', () => {
  const never = () => SWIFTUI_GUIDANCE.split('\n').find(line => line.includes('never use them:')) ?? ''
  it('no longer steers away from .redacted, which the preview draws as iOS does, as gray bars', () => {
    expect(never()).not.toContain('.redacted')
    expect(SWIFTUI_GUIDANCE).toContain('.redacted(reason: .placeholder)')
    const { preview, messages } = problems('import SwiftUI\n@main struct A: App { var body: some Scene { WindowGroup { V() } } }\nstruct V: View { var body: some View { VStack { Text("Loading the headline"); Text("Always shown").unredacted() }.redacted(reason: .placeholder) } }')
    expect(messages).toEqual([])
    expect(preview.renderTree?.nodes.filter(node => node.kind === 'text').map(node => !!node.redacted)).toEqual([true, false])
  })
})

describe.skipIf(!XCODE)('the Wave 7b library forms, in Xcode 27', () => {
  it('type-check with warnings as errors', () => {
    typecheckInXcode([LIBRARY_FORMS])
  }, 300_000)
})
