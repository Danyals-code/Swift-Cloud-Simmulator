import { DEFAULT_DEPLOYMENT_TARGET, DEFAULT_PREVIEW_TARGET } from '@studio/shared'
import { DEFAULT_DEVICE } from '@studio/sim-shell'
import type { SourceFile } from '@studio/shared'
import { STARTER_TEMPLATE_ID, templateInfoById, type TemplateInfo } from './catalog'
import { fingerprintFiles, newProjectId } from './open'
import type { Project } from './types'

/**
 * Making a project from a template, and the one template that needs no download.
 *
 * Every other template's Swift is a static file under `apps/web/public/templates/`,
 * fetched when somebody presses Create. The blank screen stays here, inline, because
 * the first launch lays it down with nothing saved and must never wait on the network.
 * It is half a kilobyte, so it costs the initial bundle nothing worth measuring.
 */

/**
 * A template with its Swift.
 *
 * `files` is the one field that differs from the catalog entry - there it is the list
 * of paths the sheet shows, here it is those paths with their text - so the metadata
 * is inherited and that one property replaced.
 */
export interface Template extends Omit<TemplateInfo, 'files'> {
  /**
   * The files the template lays down, in navigator order.
   *
   * Was a single `source` string, which made every template a one-file project by
   * construction - and so made it impossible to ship an example of the thing people
   * actually build, which is several screens across several files. A template that
   * cannot show structure cannot teach it.
   */
  readonly files: readonly SourceFile[]
}

/**
 * A new project's folders, which the designer surface is built around.
 *
 * `App/` holds the entry point and, once there are tabs, the tab bar; `Features/`
 * holds one folder per screen; `DesignSystem/` holds `Tokens.swift` and the
 * components made from copies. Keeping new projects in this shape is what lets the
 * design panels stay simple - anything outside it still opens, and still works, but
 * it shows as a locked block rather than pretending to be editable.
 */
export const BLANK_FILES: readonly SourceFile[] = [
  { id: 'Sources/App/MyDesignApp.swift', text: `import SwiftUI

@main
struct MyDesignApp: App {
    var body: some Scene {
        WindowGroup {
            HomeScreen()
        }
    }
}
` },
  { id: 'Sources/Features/Home/HomeScreen.swift', text: `import SwiftUI

struct HomeScreen: View {
    var body: some View {
        NavigationStack {
            VStack(spacing: 16) {
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(.systemBackground))
        }
    }
}

#Preview {
    HomeScreen()
}
` },
]

/** The blank screen: its catalog entry with the inline files. */
export function blankTemplate(): Template {
  const info = templateInfoById(STARTER_TEMPLATE_ID)!
  return { ...info, files: BLANK_FILES }
}

/** The `@main` type's name, which becomes the project and target name. */
export function appNameOf(template: Template): string {
  for (const file of template.files) {
    const match = /struct (\w+): App/.exec(file.text)
    if (match?.[1]) return match[1]
  }
  return 'MyApp'
}

/** The starter project, `STARTER_TEMPLATE_ID`, which is the blank screen. */
export function createDefaultProject(now: number = Date.now()): Project {
  return createProjectFromTemplate(blankTemplate(), now)
}

export function createProjectFromTemplate(template: Template, now: number = Date.now()): Project {
  const appName = appNameOf(template)
  const files = template.files.map((file) => ({ id: file.id, text: file.text }))

  return {
    // Its own id. Every project the studio held used to be written to one key, so
    // creating from a template destroyed whatever was there with no copy anywhere.
    id: newProjectId(),
    manifest: {
      name: appName,
      bundleId: `com.example.${appName}`,
      deploymentTarget: DEFAULT_DEPLOYMENT_TARGET,
      previewTarget: DEFAULT_PREVIEW_TARGET,
      device: DEFAULT_DEVICE,
      colorScheme: 'light',
      // What `isPristine` compares against later, so the confirmation before a
      // replacement can tell "untouched" from "worked on" without the corpus.
      origin: fingerprintFiles(files),
      templateId: template.id,
    },
    files,
    createdAt: now,
    updatedAt: now,
  }
}
