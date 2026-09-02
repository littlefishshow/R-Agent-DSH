/** ChildSessionViews watch/release lifecycle tests. */
import { describe, expect, it, vi } from 'vitest'
import {
  createSnapshotStore,
  type ConversationSnapshot, type SessionFace, type SessionId, type SessionRuntime,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ChildSessionViews } from '../src/client/child-session-views.ts'

/** A minimal ConversationSnapshot carrying only the fields the projection reads. */
function snapshot(text: string): ConversationSnapshot {
  return {
    nodes: [{
      kind: 'assistant',
      seq: 1,
      time: 0,
      turn: 1,
      step: 1,
      blocks: [{ kind: 'text', text }],
    }],
    partial: null,
    running: false,
    views: { get: () => undefined },
  } as unknown as ConversationSnapshot
}

/** A fake runtime whose single Session snapshot can be advanced by the test. */
function fakeRuntime(sessionId: SessionId): {
  runtime: SessionRuntime
  setAvailable: (available: boolean) => void
  publish: (text: string) => void
  completeBeforeWatch: (text: string) => void
  disposeCount: () => number
  ensureOpen: ReturnType<typeof vi.fn>
} {
  let current = snapshot('first')
  let coldCompletion: string | undefined
  let disposed = 0
  let available = true
  const listeners = new Set<() => void>()
  const list = createSnapshotStore({} as never)
  const session = {
    getSnapshot: () => current,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { disposed += 1; listeners.delete(listener) }
    },
  } as SessionFace
  const ensureOpen = vi.fn(() => {
    if (coldCompletion === undefined) return
    current = snapshot(coldCompletion)
    coldCompletion = undefined
    for (const listener of [...listeners]) listener()
  })
  return {
    runtime: {
      list,
      ensureOpen,
      binding: (id: SessionId) => available && id === sessionId
        ? { sessionId, session, ctx: {} as never }
        : undefined,
    } as unknown as SessionRuntime,
    setAvailable: (next) => {
      available = next
      list.set({} as never)
    },
    publish: (text) => {
      current = snapshot(text)
      for (const listener of [...listeners]) listener()
    },
    completeBeforeWatch: (text) => {
      current = snapshot('')
      coldCompletion = text
    },
    disposeCount: () => disposed,
    ensureOpen,
  }
}

describe('ChildSessionViews', () => {
  it('publishes updates and reference-counts repeated watches', () => {
    const sessionId = 'child-1' as SessionId
    const fake = fakeRuntime(sessionId)
    const views = new ChildSessionViews(fake.runtime)
    const releaseFirst = views.watch(sessionId)
    const releaseSecond = views.watch(sessionId)

    expect(views.store.getSnapshot()[sessionId]?.messages[0]?.text).toBe('first')
    expect(fake.ensureOpen).toHaveBeenCalledWith(sessionId)
    fake.publish('second')
    expect(views.store.getSnapshot()[sessionId]?.messages[0]?.text).toBe('second')

    releaseFirst()
    expect(fake.disposeCount()).toBe(0)
    releaseSecond()
    expect(fake.disposeCount()).toBe(1)
    expect(views.store.getSnapshot()[sessionId]).toBeUndefined()
    releaseSecond()
    expect(fake.disposeCount()).toBe(1)
  })

  it('binds when an initially unavailable session appears in the list', () => {
    const sessionId = 'missing' as SessionId
    const fake = fakeRuntime(sessionId)
    fake.setAvailable(false)
    const views = new ChildSessionViews(fake.runtime)
    const release = views.watch(sessionId)
    expect(views.store.getSnapshot()).toEqual({})

    fake.setAvailable(true)
    expect(views.store.getSnapshot()[sessionId]?.messages[0]?.text).toBe('first')
    expect(fake.ensureOpen).toHaveBeenCalledWith(sessionId)
    release()
    expect(views.store.getSnapshot()).toEqual({})
    expect(fake.disposeCount()).toBe(1)
  })

  it('opens a cold child so a response completed before the floating window is backfilled', () => {
    const sessionId = 'cold-child' as SessionId
    const fake = fakeRuntime(sessionId)
    fake.completeBeforeWatch('completed off stage')
    const views = new ChildSessionViews(fake.runtime)

    const release = views.watch(sessionId)

    expect(fake.ensureOpen).toHaveBeenCalledWith(sessionId)
    expect(views.store.getSnapshot()[sessionId]?.messages[0]?.text).toBe('completed off stage')
    release()
  })
})
