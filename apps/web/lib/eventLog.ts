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

/** How a request to the AI ended. */
export type PromptOutcome =
  /** Create with AI: a draft is ready to review. */
  | { readonly action: 'answered'; readonly files: number; readonly issues: number }
  /** The edit is in the project. */
  | { readonly action: 'applied'; readonly files: number }
  /** An answer that changed nothing. */
  | { readonly action: 'replied' }
  /** No answer to use: the request failed, the answer could not be used, or its change failed the preview check. */
  | { readonly action: 'failed'; readonly stage: 'request' | 'answer' | 'preview'; readonly status?: number }
  | { readonly action: 'cancelled' }
  /** An answer thrown away: a draft left unopened, or an edit to a project that had moved on. */
  | { readonly action: 'discarded' }

/** One step of an attempt: sending, how it ended, or its draft opening as a project, in ms since sending. */
export type AttemptStep =
  | ({ readonly action: 'sent' } & SentPrompt)
  | (PromptOutcome & { readonly ms: number })
  | { readonly action: 'opened'; readonly ms: number }

/** A request to the AI, numbered within the panel that made it. */
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

/** The first line of an exported log, saying what the lines after it are. */
const FORMAT = 'swift-web-studio-events'

/**
 * Enough for hours of work: a design edit, a typing burst and a switch of mode are an
 * event each. The limit is there for something going round in a loop.
 */
const LIMIT = 10_000

/** A pause this long ends a burst of typing, as another file or anything else recorded does. */
const BURST_PAUSE_MS = 5000

interface Burst { readonly project: string; readonly file: FileId; readonly start: number; last: number; inserted: number; removed: number }

/** How many characters an edit took out and put in: what lies between the text it left alone at either end. */
function insertedAndRemoved(before: string, after: string): { readonly inserted: number; readonly removed: number } {
  const shorter = Math.min(before.length, after.length)
  let prefix = 0
  while (prefix < shorter && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (suffix < shorter - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++
  return { inserted: after.length - prefix - suffix, removed: before.length - prefix - suffix }
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
   * Runs a write after every one before it.
   *
   * A write the storage refuses loses that write and no other. Nothing here throws at
   * the caller: the log must never be why an edit did not happen.
   */
  const queue = (work: () => Promise<void>) => {
    if (!stopped) writing = writing.then(work).catch(() => {})
  }

  const append = (project: string, event: StudioEvent, at: number) => {
    const logged: LoggedEvent = { t: new Date(at).toISOString(), session, seq: ++seq, ...event }
    queue(async () => {
      const count = counts.get(project) ?? await store.count(project)
      const kept = count < limit ? [logged] : []
      counts.delete(project)
      await store.append(project, kept, 1 - kept.length)
      counts.set(project, count + kept.length)
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
      queue(async () => {
        counts.delete(from)
        counts.delete(to)
        await store.move(from, to)
      })
    },

    /** Forgets a project's events: the project was removed from this browser. */
    forget(project: string): void {
      endBurst()
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

    async jsonl(project: string): Promise<string> {
      endBurst()
      await writing
      const { events, dropped } = await store.read(project)
      const header = { format: FORMAT, version: 1, project, build, events: events.length, dropped }
      return [header, ...events].map(line => JSON.stringify(line)).join('\n') + '\n'
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
