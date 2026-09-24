import { createEventStore, type EventStore } from '@studio/project-model'
import type { StudioBuild } from '@studio/exporter'
import type { ArchiveFormat, DesignEditRequest, FileId } from '@studio/shared'
import { STUDIO_BUILD } from './build'
import type { Provider } from './generation/schema'
import type { RecoveryEvent } from './recovery'
import type { ProjectOrigin } from './store'

/** Changes Design makes to the studio's own records rather than through the planner. */
export type StudioChange = 'state-save' | 'state-delete' | 'screen-rename' | 'screen-move' | 'layer-rename' | 'images' | 'variant-save' | 'variant-delete' | 'component-describe'

/** A change made in Design, in the studio's own words: `designEvent` says which. */
export interface DesignEvent {
  readonly type: 'design'
  readonly op: DesignEditRequest['operation']['kind'] | StudioChange
  /** The layer's built-in type, such as Text or VStack, or else what kind of layer it is. */
  readonly layer?: string
  /** Which of the layer's controls changed. */
  readonly control?: string
  /** The library view added. */
  readonly view?: string
  readonly modifier?: string
  /** The studio said no, and why is on screen. */
  readonly refused?: true
}

/** What went to the AI: the prompt as typed, and never the key. */
export interface SentPrompt {
  readonly prompt: string
  readonly provider: Provider
  readonly model: string
  /** The options Create with AI sends with the prompt. */
  readonly settings?: Readonly<Record<string, string | number | boolean>>
  /** A selected view went with the prompt. */
  readonly selection?: boolean
}

/** How a request to the AI ended, when it did not fail. */
export type PromptOutcome =
  /** Create with AI: a draft is ready to review. */
  | { readonly action: 'answered'; readonly files: number; readonly issues: number }
  /** The edit is in the project. */
  | { readonly action: 'applied'; readonly files: number }
  /** An answer that changed nothing. */
  | { readonly action: 'replied' }
  | { readonly action: 'cancelled' }
  /** An answer thrown away: a draft left unopened, or an edit to a project that had moved on. */
  | { readonly action: 'discarded' }

/** How far a failed request got: no answer, an answer it could not use, or a change that failed the preview check. */
export type FailedStage = 'request' | 'answer' | 'preview'

/** One step of an attempt. After sending, each says how many ms had passed since. */
export type AttemptStep =
  | ({ readonly action: 'sent' } & SentPrompt)
  /** The server answered, with its HTTP status: the time to response. */
  | { readonly action: 'responded'; readonly status: number; readonly ms: number }
  /** The answer was broken, so it was asked for once more, with its problems (G2). */
  | { readonly action: 'retried'; readonly problems: number; readonly ms: number }
  | (PromptOutcome & { readonly ms: number })
  | { readonly action: 'failed'; readonly stage: FailedStage; readonly ms: number }
  /** Create with AI: its draft opened as a new app, and this is logged in that app's log. */
  | { readonly action: 'opened'; readonly ms: number }

/** A request to the AI, numbered within the page load and the panel that made it. */
export type AiEvent = { readonly type: 'ai'; readonly flow: 'create' | 'edit'; readonly attempt: number } & AttemptStep

/** What the studio records. */
export type StudioEvent =
  /** The page loaded with this project: fresh, restored, recovered after a crash, or from a share link. */
  | { readonly type: 'session'; readonly action: 'loaded'; readonly origin: ProjectOrigin; readonly build: string }
  /** Another tab took the studio over, and writes its own events from here. */
  | { readonly type: 'session'; readonly action: 'handed-over' }
  /** Made from a template, or from files opened or generated. */
  | { readonly type: 'project'; readonly action: 'created'; readonly template?: string; readonly files?: number }
  | { readonly type: 'project'; readonly action: 'opened' | 'imported' | 'renamed' }
  /** A part of the studio crashed, and what the person did about it. */
  | ({ readonly type: 'recovery' } & RecoveryEvent)
  /** An archive exported: the log in it ends here. */
  | { readonly type: 'export'; readonly format: ArchiveFormat }
  /** Design or Code, and whether the canvas is trying the app rather than editing it. */
  | { readonly type: 'mode'; readonly mode: 'design' | 'code'; readonly preview: boolean }
  | { readonly type: 'history'; readonly direction: 'undo' | 'redo' }
  /** A burst of typing in one file: how many characters went in and out, and for how long. */
  | { readonly type: 'code'; readonly file: FileId; readonly inserted: number; readonly removed: number; readonly ms: number }
  | DesignEvent
  | AiEvent

/** An event as the log keeps it: when it happened, in which page load, and in what order. */
export type LoggedEvent = { readonly t: string; readonly session: string; readonly seq: number } & StudioEvent

export interface EventLogOptions {
  /** This page load. */
  readonly session: string
  readonly build: StudioBuild
  readonly now: () => number
  /** The most events a project keeps. Past it they are counted, not kept. */
  readonly limit?: number
}

/** A project's log as an archive carries it. */
export interface LogFile {
  /** A header line saying what the lines after it are, then one event a line. */
  readonly text: string
  /** Only this page's own events: the stored ones could not be read. */
  readonly partial: boolean
}

/** The first line of an exported log, saying what the lines after it are. */
const FORMAT = 'swift-web-studio-events'

/** How long reading the log waits for the storage before going on with this page's own events. */
const READ_MS = 2000

/**
 * Enough for hours of work: a design edit, a typing burst and a switch of mode are an
 * event each. The limit is there for something going round in a loop.
 */
const LIMIT = 10_000

/** A pause this long ends a burst of typing, as another file or anything else recorded does. */
const BURST_PAUSE_MS = 5000

interface Burst { readonly project: string; readonly file: FileId; readonly start: number; last: number; inserted: number; removed: number }

/** An event this page recorded, and whether the storage has it yet. */
interface Recorded { readonly event: LoggedEvent; written: boolean }

/** How many characters an edit took out and put in: what lies between the text it left alone at either end. */
function insertedAndRemoved(before: string, after: string): { readonly inserted: number; readonly removed: number } {
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return { inserted: after.length - prefix - suffix, removed: before.length - prefix - suffix }
}

/** What `promise` settles to within `ms`, or null when it fails or takes longer. */
function settled<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), ms) })
  return Promise.race([promise.catch(() => null), late]).finally(() => clearTimeout(timer))
}

/** Events in the order they happened: by time, and within one page load by its own count. */
function chronological(events: readonly LoggedEvent[]): LoggedEvent[] {
  return [...events].sort((a, b) => a.t < b.t ? -1 : a.t > b.t ? 1 : a.session === b.session ? a.seq - b.seq : 0)
}

export function createEventLog(store: EventStore<LoggedEvent>, { session, build, now, limit = LIMIT }: EventLogOptions) {
  let seq = 0
  let writing = Promise.resolve()
  /** How many events each project has, once this page has asked. */
  const counts = new Map<string, number>()
  let burst: Burst | null = null
  /** Another tab has the project now, and writes its own events. */
  let stopped = false
  /**
   * This page's events, in memory as well, up to the limit: an export still has them
   * when the browser's storage refuses a write, or a read.
   */
  const recorded = new Map<string, Recorded[]>()

  /**
   * Runs a write after every one before it.
   *
   * A write the storage refuses is kept in memory for this page and loses nothing else.
   * Nothing here throws at the caller: the log must never be why an edit did not happen.
   */
  const queue = (work: () => Promise<void>) => {
    writing = writing.then(work).catch(() => {})
  }

  const append = (project: string, event: StudioEvent, at: number) => {
    if (stopped) return
    const entry: Recorded = { event: { t: new Date(at).toISOString(), session, seq: ++seq, ...event }, written: false }
    const mine = recorded.get(project) ?? []
    if (mine.length < limit) {
      mine.push(entry)
      recorded.set(project, mine)
    }
    queue(async () => {
      const count = counts.get(project) ?? await store.count(project)
      const kept = count < limit ? [entry.event] : []
      counts.delete(project)
      await store.append(project, kept, 1 - kept.length)
      counts.set(project, count + kept.length)
      entry.written = true
    })
  }

  const endBurst = () => {
    if (!burst) return
    const { project, file, start, last, inserted, removed } = burst
    burst = null
    append(project, { type: 'code', file, inserted, removed, ms: last - start }, start)
  }

  return {
    record(project: string, event: StudioEvent): void {
      endBurst()
      append(project, event, now())
    },

    /** Typing in a file, counted into the burst it belongs to. The text itself is never kept. */
    typed(project: string, file: FileId, before: string, after: string): void {
      if (stopped) return
      const at = now()
      if (burst?.project !== project || burst.file !== file || at - burst.last >= BURST_PAUSE_MS) {
        endBurst()
        burst = { project, file, start: at, last: at, inserted: 0, removed: 0 }
      }
      const { inserted, removed } = insertedAndRemoved(before, after)
      burst.inserted += inserted
      burst.removed += removed
      burst.last = at
    },

    /**
     * Gives a project's events to the one replacing it.
     *
     * A project nobody touched is discarded when another is opened or created in its
     * place. What happened while it was open - the page loading, a look around - is
     * part of the story of the one that follows.
     */
    handOn(from: string, to: string): void {
      endBurst()
      if (stopped) return
      const moving = recorded.get(from) ?? []
      recorded.delete(from)
      if (moving.length) recorded.set(to, [...recorded.get(to) ?? [], ...moving])
      queue(async () => {
        counts.delete(from)
        counts.delete(to)
        try {
          await store.move(from, to)
        } catch (error) {
          // Stored under the old project still, so not yet under the new one.
          for (const entry of moving) entry.written = false
          throw error
        }
      })
    },

    /** Forgets a project's events: the project was removed from this browser. */
    forget(project: string): void {
      endBurst()
      if (stopped) return
      recorded.delete(project)
      queue(async () => {
        counts.delete(project)
        await store.remove(project)
      })
    },

    /** Everything recorded so far is written, typing still going on included. */
    flush(): Promise<void> {
      endBurst()
      return writing
    },

    /** Writes what was recorded, and nothing after: another tab has taken the project over. */
    stop(): Promise<void> {
      endBurst()
      stopped = true
      return writing
    },

    /**
     * The project's log as an archive carries it: JSON lines, after a header.
     *
     * When the storage fails, or has not answered within a moment, this page's own events
     * go out, and the header says the log is partial.
     */
    async file(project: string): Promise<LogFile> {
      endBurst()
      const stored = await settled(writing.then(() => store.read(project)), READ_MS)
      const mine = recorded.get(project) ?? []
      const unwritten = mine.filter(entry => !entry.written).map(entry => entry.event)
      // Sorted, since another tab's writes can land between this one's.
      const events = chronological(stored ? [...stored.events, ...unwritten] : mine.map(entry => entry.event))
      const partial = !stored
      const header = { format: FORMAT, version: 1, project, build, events: events.length, dropped: stored?.dropped ?? 0, ...(partial ? { partial } : {}) }
      return { text: [header, ...events].map(line => JSON.stringify(line)).join('\n') + '\n', partial }
    },
  }
}

export type EventLog = ReturnType<typeof createEventLog>

/** The log of this page, as there is one store: IndexedDB, or memory where there is none. */
export const eventLog = createEventLog(createEventStore(), {
  session: Math.random().toString(36).slice(2, 10),
  build: STUDIO_BUILD,
  now: Date.now,
})
