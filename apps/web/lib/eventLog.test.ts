import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryEventStore } from '@studio/project-model'
import { createEventLog, type LoggedEvent } from './eventLog'

/**
 * The studio's event log: what somebody did, in order, written into each export.
 *
 * The storage is the memory one a browser without IndexedDB gets, and the clock is a
 * number the test moves.
 */

const BUILD = { commit: 'abc1234', builtAt: '2026-09-20T00:00:00.000Z' }

function logWith(limit?: number) {
  let now = Date.UTC(2026, 8, 24, 7, 30)
  const log = createEventLog(new MemoryEventStore(), { session: 's1', build: BUILD, now: () => now, limit })
  return { log, tick: (ms: number) => { now += ms } }
}

/** The exported lines, parsed: the header first. */
async function lines(log: ReturnType<typeof createEventLog>, project: string) {
  return (await log.file(project)).text.trimEnd().split('\n').map(line => JSON.parse(line))
}

afterEach(() => { vi.useRealTimers() })

describe('the event log', () => {
  it('writes each event with when it happened, the page load and its order, after a header', async () => {
    const { log, tick } = logWith()
    log.record('p1', { type: 'session', action: 'loaded', origin: 'fresh', build: 'abc1234' })
    tick(1500)
    log.record('p1', { type: 'history', direction: 'undo' })
    log.record('p2', { type: 'history', direction: 'redo' })

    const [header, ...events] = await lines(log, 'p1')

    expect(header).toEqual({ format: 'swift-web-studio-events', version: 1, project: 'p1', build: BUILD, events: 2, dropped: 0 })
    expect(events).toEqual([
      { t: '2026-09-24T07:30:00.000Z', session: 's1', seq: 1, type: 'session', action: 'loaded', origin: 'fresh', build: 'abc1234' },
      { t: '2026-09-24T07:30:01.500Z', session: 's1', seq: 2, type: 'history', direction: 'undo' },
    ])
  })

  it('keeps the first events past its limit and counts the rest, across page loads', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    const first = createEventLog(store, { session: 's1', build: BUILD, now: () => 0, limit: 2 })
    first.record('p1', { type: 'history', direction: 'undo' })
    first.record('p1', { type: 'history', direction: 'redo' })
    first.record('p1', { type: 'history', direction: 'undo' })
    await first.flush()

    const second = createEventLog(store, { session: 's2', build: BUILD, now: () => 0, limit: 2 })
    second.record('p1', { type: 'history', direction: 'redo' })
    second.record('p2', { type: 'history', direction: 'redo' })
    const [header, ...events] = await lines(second, 'p1')

    expect(header).toMatchObject({ events: 2, dropped: 2 })
    expect(events.map(event => [event.session, event.direction])).toEqual([['s1', 'undo'], ['s1', 'redo']])
    expect((await lines(second, 'p2'))[0]).toMatchObject({ events: 1, dropped: 0 })
  })

  it('keeps what the storage refused for this page’s exports, in order, and never throws at whoever records', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    const append = store.append.bind(store)
    let refusals = 1
    store.append = (...args) => refusals-- > 0 ? Promise.reject(new DOMException('Connection lost', 'UnknownError')) : append(...args)
    const log = createEventLog(store, { session: 's1', build: BUILD, now: () => 0 })

    log.record('p1', { type: 'history', direction: 'undo' })
    log.record('p1', { type: 'history', direction: 'redo' })
    await log.flush()

    const [header, ...events] = await lines(log, 'p1')
    expect(events.map(event => [event.seq, event.direction])).toEqual([[1, 'undo'], [2, 'redo']])
    expect(header).toMatchObject({ events: 2, dropped: 0 })
    expect(header).not.toHaveProperty('partial')
  })

  it('exports this page’s events when the stored ones cannot be read, and says the log is partial', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    const earlier = createEventLog(store, { session: 's1', build: BUILD, now: () => 0 })
    earlier.record('p1', { type: 'history', direction: 'undo' })
    await earlier.flush()
    const log = createEventLog(store, { session: 's2', build: BUILD, now: () => 0 })
    log.record('p1', { type: 'history', direction: 'redo' })
    await log.flush()
    store.read = () => Promise.reject(new DOMException('Connection lost', 'UnknownError'))

    const [header, ...events] = await lines(log, 'p1')

    expect(header).toMatchObject({ events: 1, partial: true })
    expect(events.map(event => [event.session, event.direction])).toEqual([['s2', 'redo']])
  })

  it('writes typing as one event a burst: the file, how much went in and out, and never the code', async () => {
    const { log, tick } = logWith()
    log.typed('p1', 'ContentView.swift', 'Text("Hi")', 'Text("Hi there")')
    tick(1000)
    log.typed('p1', 'ContentView.swift', 'Text("Hi there")', 'Text("Hi")')
    tick(1000)
    log.typed('p1', 'Other.swift', '', 'let a = 1')
    log.record('p1', { type: 'history', direction: 'undo' })
    tick(1000)
    log.typed('p1', 'Other.swift', 'let a = 1', 'let a = 12')
    tick(6000)
    log.typed('p1', 'Other.swift', 'let a = 12', 'let a = 123')

    const exported = (await log.file('p1')).text

    expect(exported).not.toMatch(/Text\(|let a/)
    expect(exported.trimEnd().split('\n').slice(1).map(line => JSON.parse(line))).toEqual([
      { t: '2026-09-24T07:30:00.000Z', session: 's1', seq: 1, type: 'code', file: 'ContentView.swift', inserted: 6, removed: 6, ms: 1000 },
      { t: '2026-09-24T07:30:02.000Z', session: 's1', seq: 2, type: 'code', file: 'Other.swift', inserted: 9, removed: 0, ms: 0 },
      { t: '2026-09-24T07:30:02.000Z', session: 's1', seq: 3, type: 'history', direction: 'undo' },
      { t: '2026-09-24T07:30:03.000Z', session: 's1', seq: 4, type: 'code', file: 'Other.swift', inserted: 1, removed: 0, ms: 0 },
      { t: '2026-09-24T07:30:09.000Z', session: 's1', seq: 5, type: 'code', file: 'Other.swift', inserted: 1, removed: 0, ms: 0 },
    ])
  })

  it('hands the events of a project nobody touched to the one that replaced it, in the order they happened', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    const earlier = createEventLog(store, { session: 's1', build: BUILD, now: () => 0, limit: 3 })
    earlier.record('p1', { type: 'history', direction: 'undo' })
    await earlier.flush()

    const log = createEventLog(store, { session: 's2', build: BUILD, now: () => 0, limit: 3 })
    log.record('starter', { type: 'session', action: 'loaded', origin: 'fresh', build: 'abc1234' })
    log.typed('starter', 'ContentView.swift', '', 'x')
    log.handOn('starter', 'p1')
    log.record('p1', { type: 'history', direction: 'redo' })
    log.record('p1', { type: 'history', direction: 'undo' })

    const [header, ...events] = await lines(log, 'p1')
    expect(events.map(event => [event.session, event.type])).toEqual([['s1', 'history'], ['s2', 'session'], ['s2', 'code']])
    expect(header).toMatchObject({ events: 3, dropped: 2 })
    expect((await lines(log, 'starter'))[0]).toMatchObject({ events: 0, dropped: 0 })
  })

  it('exports this page’s events after a moment when the storage never answers, and says the log is partial', async () => {
    vi.useFakeTimers()
    const store = new MemoryEventStore<LoggedEvent>()
    store.append = () => new Promise(() => {})
    const log = createEventLog(store, { session: 's1', build: BUILD, now: () => 0 })
    log.record('p1', { type: 'history', direction: 'undo' })

    const reading = log.file('p1')
    await vi.advanceTimersByTimeAsync(10_000)
    const { text, partial } = await reading

    expect(partial).toBe(true)
    expect(text.trimEnd().split('\n').map(line => JSON.parse(line))).toMatchObject([{ events: 1, partial: true }, { direction: 'undo' }])
  })

  it('hands a project’s events on in this page even when the storage refuses to move them', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    store.move = () => Promise.reject(new DOMException('Connection lost', 'UnknownError'))
    const log = createEventLog(store, { session: 's1', build: BUILD, now: () => 0 })
    log.record('starter', { type: 'session', action: 'loaded', origin: 'fresh', build: 'abc1234' })
    log.handOn('starter', 'p1')
    log.record('p1', { type: 'project', action: 'created', template: 'counter' })

    expect((await lines(log, 'p1')).slice(1).map(event => event.type)).toEqual(['session', 'project'])
  })

  it('writes the events in the order they happened, whichever tab’s write landed first', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    const later = createEventLog(store, { session: 'a', build: BUILD, now: () => 2000 })
    const sooner = createEventLog(store, { session: 'b', build: BUILD, now: () => 1000 })
    later.record('p1', { type: 'history', direction: 'undo' })
    await later.flush()
    sooner.record('p1', { type: 'history', direction: 'redo' })

    expect((await lines(sooner, 'p1')).slice(1).map(event => event.session)).toEqual(['b', 'a'])
  })

  it('forgets the events of a removed project, and only its own', async () => {
    const { log } = logWith(1)
    log.record('p1', { type: 'history', direction: 'undo' })
    log.record('p1', { type: 'history', direction: 'redo' })
    log.record('p2', { type: 'history', direction: 'redo' })

    log.forget('p1')
    log.record('p1', { type: 'history', direction: 'undo' })

    expect((await lines(log, 'p1'))[0]).toMatchObject({ events: 1, dropped: 0 })
    expect((await lines(log, 'p2'))[0]).toMatchObject({ events: 1, dropped: 0 })
  })

  it('writes what it has once another tab takes the project over, and nothing after', async () => {
    const store = new MemoryEventStore<LoggedEvent>()
    const log = createEventLog(store, { session: 's1', build: BUILD, now: () => 0 })
    log.record('p1', { type: 'session', action: 'loaded', origin: 'fresh', build: 'abc1234' })
    log.typed('p1', 'ContentView.swift', '', 'x')

    await log.stop()
    log.record('p1', { type: 'history', direction: 'undo' })
    log.typed('p1', 'ContentView.swift', 'x', 'xy')
    log.handOn('p1', 'p2')
    log.forget('p1')

    const other = createEventLog(store, { session: 's2', build: BUILD, now: () => 0 })
    expect((await lines(other, 'p1')).slice(1).map(event => event.type)).toEqual(['session', 'code'])
  })
})
