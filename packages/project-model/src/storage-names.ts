/**
 * Where the browser keeps projects: the IndexedDB database, its table of projects,
 * and the index of them by when each last changed.
 *
 * A module of its own, with nothing else in it, so the page's recovery code can find
 * saved work without loading the rest of the project model - the code whose failure
 * it exists to survive.
 */
export const PROJECT_DATABASE = 'swiftui-web-studio'
export const PROJECTS = 'projects'
export const PROJECTS_BY_UPDATE = 'updatedAt'
