/**
 * Why a screen cannot be removed from its settings, in the words both sides use: the
 * settings panel says it before Remove is pressed, and the planner when it refuses.
 */
export const SCREEN_REMOVAL_REFUSALS = {
  tab: 'Tabs are removed in App › Navigation.',
  start: 'The app starts on this screen, so it cannot be removed.',
  opened: 'This screen is used by the app or another screen. Remove what opens it first.',
} as const
