/**
 * The light half of the project model.
 *
 * Deliberately *not* `./templates`. The welcome sheet opens at launch and needs the
 * catalog, the store and the project operations; the templates' Swift is 31 KB
 * gzipped and is not needed until somebody presses Create. Anything importing this
 * module from the app's static graph keeps that split intact - see
 * `@studio/project-model/templates` for the other half, which is imported
 * dynamically.
 */

export * from './types'
export * from './catalog'
export * from './open'
export * from './stores'
export * from './share'
export * from './studio-metadata'

export * from './transactions'
