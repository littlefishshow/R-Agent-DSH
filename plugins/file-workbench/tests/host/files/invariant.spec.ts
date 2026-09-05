/** File-workbench selection lineage and file-context invariant tests. */
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import InvariantRegistry, { InvariantError } from '@deepseek-ai/dsh-invariants'
import { describe, expect, it } from 'vitest'
import * as FileWorkbenchInvariant from '../../../src/host/files/invariant.ts'

async function setup(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(InvariantRegistry, { enabled: true })
  await ctx.plugin(FileWorkbenchInvariant)
  return ctx
}

/** Create one plugin-owned file-context message. */
function fileContext() {
  return createUserMessage({
    content: [{ type: 'text' as const, text: '<file_context>\ncontent\n</file_context>' }],
    source: { kind: 'plugin' as const, plugin: 'host-fileworkbench-io' },
  })
}

describe('file-workbench invariants', () => {
  it('accepts one parent file context and rejects a second one before commit', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('file-workbench-parent'))
    session.append('turn/start', { turn: 1 })
    session.append('user/message', fileContext(), { surfaceOp: 'append' })
    expect(() => {
      session.append('user/message', fileContext(), { surfaceOp: 'append' })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-host-fileworkbench-io',
    }))
    expect(() => {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
  })

  it('allows a restored parent with duplicate legacy file contexts to continue', async () => {
    const ctx = await setup()
    const seed = [
      {
        type: 'turn/start', seq: 0, time: 1, data: { turn: 1 },
      },
      {
        type: 'user/message', seq: 1, time: 2, data: fileContext(), surfaceOp: 'append',
      },
      {
        type: 'turn/end', seq: 2, time: 3, data: { turn: 1, reason: { kind: 'completed' } },
      },
      {
        type: 'turn/start', seq: 3, time: 4, data: { turn: 2 },
      },
      {
        type: 'user/message', seq: 4, time: 5, data: fileContext(), surfaceOp: 'append',
      },
      {
        type: 'turn/end', seq: 5, time: 6, data: { turn: 2, reason: { kind: 'completed' } },
      },
    ] as const

    expect(() => {
      ctx.sessions.create(SessionId('file-workbench-legacy-parent'), { seed })
    }).not.toThrow()
  })

  it('requires every selection child to name a file parent', async () => {
    const ctx = await setup()
    expect(() => {
      ctx.sessions.create(SessionId('file-selection-invalid'), {
        meta: {
          parentSession: SessionId('ordinary-parent'),
          seedLength: 0,
        },
      })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-host-fileworkbench-io',
    }))
  })

  it('accepts exactly one file context and rejects a second one before commit', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('file-selection-one-context'), {
      meta: {
        parentSession: SessionId('file-workbench-parent'),
        seedLength: 0,
      },
    })
    session.append('turn/start', { turn: 1 })
    session.append('user/message', fileContext(), { surfaceOp: 'append' })
    expect(() => {
      session.append('user/message', fileContext(), { surfaceOp: 'append' })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-host-fileworkbench-io',
    }))
    expect(session.events.filter(event => event.type === 'user/message')).toHaveLength(1)
    expect(() => {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).not.toThrow()
  })

  it('rejects a first turn that completes without a file context', async () => {
    const ctx = await setup()
    const session = ctx.sessions.create(SessionId('file-selection-missing-context'), {
      meta: {
        parentSession: SessionId('file-workbench-parent'),
        seedLength: 0,
      },
    })
    session.append('turn/start', { turn: 1 })
    expect(() => {
      session.append('turn/end', { turn: 1, reason: { kind: 'completed' } })
    }).toThrow(expect.objectContaining<Partial<InvariantError>>({
      code: 'INVARIANT',
      packageName: '@deepseek-ai/dsh-host-fileworkbench-io',
    }))
  })
})
