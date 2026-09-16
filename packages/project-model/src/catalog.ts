/**
 * The gallery, without any of the Swift in it.
 *
 * Everything the welcome sheet needs to *draw* a template - what it is called, which
 * of the two kinds it is, what it says about itself, and the files it would lay down -
 * and nothing it needs to *create* one. That split is the whole point of this file:
 * the sheet opens at launch, and the sources behind it are 31 KB gzipped that nobody
 * needs until they press Create.
 *
 * This is also the single source of truth for the metadata. `templates.ts` pairs each
 * entry here with its files, and a test asserts the two lists still agree - so a
 * template added to one and forgotten in the other fails rather than half-existing.
 */

/**
 * Which of the two questions a template answers.
 *
 * `feature` is "how is this one thing written" - a counter, a drag gesture, a custom
 * `ViewModifier`. One file, one idea, read top to bottom in a minute.
 *
 * `app` is "what does a whole project look like" - several screens, a model, a store
 * shared between them, and folders that mean something. Nobody learns the second from
 * a pile of the first, which is why the gallery separates them instead of sorting
 * twenty-two cards by name and hoping.
 */
export type TemplateKind = 'app' | 'feature'

export interface TemplateInfo {
  readonly id: string
  readonly name: string
  readonly kind: TemplateKind
  /**
   * One line naming what the template is *for*, shown under its name in the gallery.
   *
   * Distinct from `description`, which says what it *contains*. "Track what you spend"
   * and "Six files: a tab view, a grouped list, a form" are both worth saying and
   * neither substitutes for the other.
   */
  readonly tagline: string
  readonly description: string
  /** Screen names for apps, or concepts taught by a focused example. */
  readonly highlights?: readonly string[]
  /** The paths it lays down, in navigator order. The text lives in `templates.ts`. */
  readonly files: readonly string[]
}

export const TEMPLATE_CATALOG: readonly TemplateInfo[] = [
  {
    id: 'counter',
    name: 'Counter',
    kind: 'feature',
    tagline: 'Start here: one screen with one piece of state.',
    description: 'State, a Spacer and modifier ordering - the reference app.',
    files: ['Sources/CounterApp.swift'],
  },
  {
    id: 'stacks',
    name: 'Stacks',
    kind: 'feature',
    tagline: 'Which stack puts what where.',
    description: 'VStack, HStack and ZStack, plus a reusable sub-view.',
    files: ['Sources/LayoutApp.swift'],
  },
  {
    id: 'tasks',
    name: 'Task list',
    kind: 'feature',
    tagline: 'Rows built from a loop, each answering a tap.',
    description: 'An interactive checklist with per-row actions, a completion count, and a reset toolbar button.',
    files: ['Sources/TasksApp.swift'],
  },
  {
    id: 'card',
    name: 'Profile card',
    kind: 'feature',
    tagline: 'One centred card, and a button that rewrites itself.',
    description: 'A centred card with a button that toggles its own label.',
    files: ['Sources/CardApp.swift'],
  },
  {
    id: 'palette',
    name: 'Palette',
    kind: 'feature',
    tagline: 'Colour, arranged by two loops.',
    description: 'A nested loop grid, and a function returning a Color.',
    files: ['Sources/PaletteApp.swift'],
  },
  {
    id: 'navigation',
    name: 'Explore',
    kind: 'feature',
    tagline: 'Search destinations and open their details.',
    description: 'A searchable list with symbol labels, a navigation stack, and an inline detail title.',
    files: ['Sources/ExplorerApp.swift'],
  },
  {
    id: 'settings',
    name: 'Settings',
    kind: 'feature',
    tagline: 'The grouped form every app ends up having.',
    description: 'A form of grouped sections: toggles, a slider and a text field.',
    files: ['Sources/SettingsApp.swift'],
  },
  {
    id: 'gallery',
    name: 'Gallery',
    kind: 'feature',
    tagline: 'A grid that reflows to whatever width it is given.',
    description: 'An adaptive grid of symbol tiles inside a scroll view.',
    files: ['Sources/GalleryApp.swift'],
  },
  {
    id: 'tabs',
    name: 'Tabs',
    kind: 'feature',
    tagline: 'Switch screens with tabs or a button.',
    description: 'Three navigation stacks with a shared tab selection, grouped lists, and a profile form.',
    files: ['Sources/TabsApp.swift'],
  },
  {
    id: 'motion',
    name: 'Motion',
    kind: 'feature',
    tagline: 'One state change, animating four things at once.',
    description: 'withAnimation driving size, corner radius and shadow together.',
    files: ['Sources/MotionApp.swift'],
  },
  {
    id: 'inbox',
    name: 'Inbox',
    kind: 'feature',
    tagline: 'A list, a toolbar button and a sheet over the top.',
    description: 'A list, a toolbar button and a sheet that composes a message.',
    files: ['Sources/InboxApp.swift'],
  },
  {
    id: 'store',
    name: 'Order',
    kind: 'feature',
    tagline: 'One object, two views, one source of truth.',
    description: 'An ObservableObject shared between two views, with @StateObject.',
    files: ['Sources/StoreApp.swift'],
  },
  {
    id: 'flow',
    name: 'Steps',
    kind: 'feature',
    tagline: 'A screen decided by an enum.',
    description: 'An enum driving the screen, switched on in the body.',
    files: ['Sources/FlowApp.swift'],
  },
  {
    id: 'drawing',
    name: 'Vectors',
    kind: 'feature',
    tagline: 'Drawing a shape instead of assembling one.',
    description: 'Path, arcs and trim - a progress ring drawn from scratch.',
    files: ['Sources/DrawingApp.swift'],
  },
  {
    id: 'drag',
    name: 'Drag',
    kind: 'feature',
    tagline: 'Following a finger, and springing back after it.',
    description: 'A drag gesture with @GestureState, and a spring on release.',
    files: ['Sources/DragApp.swift'],
  },
  {
    id: 'styled',
    name: 'Styled',
    kind: 'feature',
    tagline: 'Naming a look once so it can be used five times.',
    description: 'A custom ViewModifier, and extension View naming a modifier chain.',
    files: ['Sources/StyledApp.swift'],
  },
  {
    id: 'folio',
    name: 'Folio',
    kind: 'app',
    tagline: 'A little home for your next great read.',
    description: 'Browse a library, open a book, save it to your reading list, and add your own. A small, complete app with shared state and editable preferences.',
    highlights: ['Library', 'Book details', 'Reading list', 'Add a book', 'Settings'],
    files: [
      'Sources/FolioApp.swift',
      'Sources/Models/Library.swift',
      'Sources/Components/BookRow.swift',
      'Sources/Features/LibraryView.swift',
      'Sources/Features/BookDetailView.swift',
      'Sources/Features/AddBookView.swift',
      'Sources/Features/SettingsView.swift',
    ],
  },
  {
    id: 'trailhead',
    name: 'Trailhead',
    kind: 'app',
    tagline: 'Browse walks, save the good ones, read the route.',
    description:
      'Find a weekend walk, filter by distance, and save a route for later. Includes trail details, directions, a profile, and a shared collection of saved walks.',
    highlights: ['Discover', 'Trail details', 'Saved walks', 'Profile', 'Filters'],
    files: [
      'Sources/TrailheadApp.swift',
      'Sources/Models/Trail.swift',
      'Sources/Models/TrailStore.swift',
      'Sources/Components/TrailCard.swift',
      'Sources/Features/Discover/DiscoverView.swift',
      'Sources/Features/Discover/TrailDetailView.swift',
      'Sources/Features/Saved/SavedView.swift',
      'Sources/Features/Profile/ProfileView.swift',
    ],
  },
  {
    id: 'ledger',
    name: 'Ledger',
    kind: 'app',
    tagline: 'Keep everyday spending in view.',
    description:
      'Track expenses, search your transactions, and set a monthly budget. Add an expense once and see the summary and remaining budget update together.',
    highlights: ['Summary', 'Spending', 'Expense details', 'Add expense', 'Budget'],
    files: [
      'Sources/LedgerApp.swift',
      'Sources/Models/Expense.swift',
      'Sources/Models/Ledger.swift',
      'Sources/Components/Chrome.swift',
      'Sources/Features/Summary/SummaryView.swift',
      'Sources/Features/Spending/SpendingView.swift',
      'Sources/Features/Spending/AddExpenseView.swift',
      'Sources/Features/Budget/BudgetView.swift',
    ],
  },
  {
    id: 'kitchen',
    name: 'Kitchen',
    kind: 'app',
    tagline: 'Read a recipe, scale it, tick the steps off.',
    description:
      'Browse recipes by course, save favorites, adjust the servings, and follow a cooking checklist. A focused example of navigation and reusable components.',
    highlights: ['Recipes', 'Recipe details', 'Cooking steps'],
    files: [
      'Sources/KitchenApp.swift',
      'Sources/Models/Recipe.swift',
      'Sources/Models/Shelf.swift',
      'Sources/Components/RecipeCard.swift',
      'Sources/Features/Browse/BrowseView.swift',
      'Sources/Features/Recipe/RecipeView.swift',
      'Sources/Features/Recipe/Method.swift',
    ],
  },
  {
    id: 'pulse',
    name: 'Pulse',
    kind: 'app',
    tagline: 'See your training week take shape.',
    description:
      'Review weekly activity, explore past sessions, and adjust your training target. The progress ring, daily bars, and totals share one training log.',
    highlights: ['Today', 'History', 'Session details', 'Weekly target'],
    files: [
      'Sources/PulseApp.swift',
      'Sources/Models/Session.swift',
      'Sources/Models/TrainingLog.swift',
      'Sources/Components/Rings.swift',
      'Sources/Features/Today/TodayView.swift',
      'Sources/Features/Today/TargetSheet.swift',
      'Sources/Features/History/HistoryView.swift',
      'Sources/Features/History/SessionView.swift',
    ],
  },
  {
    id: 'typesetting',
    name: 'Typesetting',
    kind: 'feature',
    tagline: 'Everything a line of text can be told to do.',
    description: 'Text attributes, concatenation, shrink-to-fit and an inset footer.',
    files: ['Sources/TypeApp.swift'],
  },
  {
    id: 'loader',
    name: 'Loader',
    kind: 'feature',
    tagline: 'A protocol with a default, and an error that is caught.',
    description: 'A protocol with a default, and do/catch handling a thrown error.',
    files: ['Sources/LoaderApp.swift'],
  },
]

export function templateInfoById(id: string): TemplateInfo | undefined {
  return TEMPLATE_CATALOG.find((t) => t.id === id)
}

/** The templates of one kind, in gallery order. */
export function templatesOfKind(kind: TemplateKind): readonly TemplateInfo[] {
  return TEMPLATE_CATALOG.filter((t) => t.kind === kind)
}

/** The id the gallery opens on when there is nothing else to open. */
export const STARTER_TEMPLATE_ID = 'counter'
