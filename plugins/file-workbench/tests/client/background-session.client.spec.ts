import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SessionRuntime, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { openBackgroundSession } from '../../src/client/background-session.ts'
import { FakeApiClient, fakeRemote, ok } from '../helpers/fake-api.client.ts'

describe('unmodified published DSH runtime', () => {
  it('opens and reconnects a child history window while retaining the main selection', async () => {
    const ctx = new Context()
    const api = new FakeApiClient()
    const main = 'main' as SessionId
    const child = 'child' as SessionId
    api.onList = async () => ok({ items: [main, child].map(sessionId => ({ sessionId, updatedAt: 1, running: false, blank: false })) }) as never
    const runtime = new SessionRuntime(ctx, api, fakeRemote())
    await runtime.refresh()
    runtime.open(main)
    const childSession = runtime.binding(child)!.session
    const select = runtime.open
    expect(runtime).not.toHaveProperty('ensureOpen')
    await openBackgroundSession(childSession)
    expect(childSession.getSnapshot().openState).toBe('open')
    expect(runtime.list.getSnapshot().current).toBe(main)
    const reads = () => api.calls.filter(call => call.method === 'session.history' && (call.payload as { sessionId: string }).sessionId === child).length
    expect(reads()).toBe(1)
    await openBackgroundSession(childSession)
    expect(reads()).toBe(1)
    await runtime.handleConnected()
    expect(reads()).toBe(2)
    expect(runtime.list.getSnapshot().current).toBe(main)
    expect(runtime.open).toBe(select)
  })
})
