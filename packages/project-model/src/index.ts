/**
 * The project model the app uses.
 *
 * Deliberately *not* `./templates`. The templates' Swift lives in static files under
 * `apps/web/public/templates/`, which the app fetches when somebody presses Create
 * (`apps/web/lib/templateSources.ts`); `./starter` holds the blank screen inline and
 * makes a project from a template. `@studio/project-model/templates` reads the same
 * files from disk for Node and the tests, and nothing in the app imports it.
 */

export * from './types'
export * from './catalog'
export * from './starter'
export * from './open'
export * from './stores'
export * from './share'
export * from './studio-metadata'

export * from './transactions'
export * from './assets'
export * from './library'
export * from './colors'
export * from './fonts'
export * from './prompt-history'
export * from './events'
