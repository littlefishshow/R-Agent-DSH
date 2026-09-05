/** Client-plugin assembly for shared Workspace projection and mode switching. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import {
  createSnapshotStore, SlotRegistry, type SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { PromptContentPart } from '@deepseek-ai/dsh-client-connection/client'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  WorkbenchLayoutController,
} from '../../../src/client/layout/index.ts'
import type { ITrajectoryPresentation } from '../../../src/client/trajectory/index.ts'
import type { FileWorkspaceInjected } from '../../../src/client/files/contract/slots.ts'
import { apply, inject, restorableSelections } from '../../../src/client/files/index.ts'

const selectionLocation = {
  selectionId: 'selection',
  visibleStart: 0,
  occurrence: 0,
  sourceStart: 0,
  sourceEnd: 8,
  colorIndex: 0,
} as const

/** Mount the plugin over the slots and services it consumes. */
async function bench(options: {
  current?: string
  sourceSnapshot?: object
  childSnapshot?: object
} = {}) {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      workbench: { kind: 'single', scope: 'root' },
      'shell.overlay': { kind: 'list', scope: 'root' },
      'sidebar.workspaces.overlay': { kind: 'single', scope: 'root' },
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
    },
  } as never, () => null)
  const layout = new WorkbenchLayoutController()
  ctx.provide('workbenchLayout', layout)
  let forkLineageEnabled = false
  const workspacePresentation = {
    forkLineage: {
      getSnapshot: () => forkLineageEnabled,
      subscribe: () => () => {},
    },
    retainForkLineage: vi.fn(() => {
      forkLineageEnabled = true
      return () => { forkLineageEnabled = false }
    }),
  }
  ctx.provide('workspacePresentation', workspacePresentation)
  const renderTrajectory = vi.fn<ITrajectoryPresentation['render']>(() => null)
  const trajectoryPresentation = { render: renderTrajectory }
  ctx.provide('trajectoryPresentation', trajectoryPresentation)
  ctx.provide('locale', new LocaleRuntime(ctx))
  const rpcCall = vi.fn(async (): Promise<{ ok: true; value: unknown }> => ({
    ok: true,
    value: {
      fileSessionId: 'file-parent',
      sessionId: 'child',
      branchStartSeq: 9,
      title: 'Explain · selected',
    },
  }))
  ctx.provide('connection', {
    rpc: { call: rpcCall },
  } as never)
  const sourceId = (options.current ?? 'parent') as SessionId
  const childId = 'child' as SessionId
  const prompt = vi.fn<(
    content: PromptContentPart[],
    mode: 'queue' | 'steer',
  ) => Promise<{ ok: true; value: { accepted: true } }>>(async () => ({
    ok: true,
    value: { accepted: true },
  }))
  const source = {
    open: vi.fn(async () => {}),
    getSnapshot: vi.fn(() => options.sourceSnapshot ?? {
      nodes: [{ seq: 9 }],
      running: false,
      turnEnds: new Map([[1, 9]]),
    }),
  }
  const child = {
    open: vi.fn(async () => {}),
    getSnapshot: vi.fn(() => options.childSnapshot ?? { nodes: [{ seq: 9 }] }),
    prompt,
    cancel: vi.fn(async () => ({ ok: true })),
    subscribe: vi.fn(() => vi.fn()),
  }
  const sessions = {
    list: createSnapshotStore({
      ids: options.current === undefined ? [] : [sourceId],
      byId: {},
      current: options.current === undefined ? undefined : sourceId,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    }),
    binding: vi.fn((id: SessionId) => id === sourceId
      ? { session: source }
      : id === childId ? { session: child } : undefined),
    create: vi.fn(async () => childId),
    fork: vi.fn(async () => childId),
    refresh: vi.fn(async () => {}),
    open: vi.fn(),
  }
  ctx.provide('sessions', sessions as never)
  const workspaceList = createSnapshotStore({
    items: [{
      workspaceId: 'workspace',
      path: '/workspace',
      title: 'Workspace',
      sessionIds: [],
      createdAt: '2026-08-31T00:00:00.000Z',
      updatedAt: '2026-08-31T00:00:00.000Z',
    }],
    archivedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
    baselinesReady: true,
    recentWorkspaceId: 'workspace',
  })
  ctx.provide('workspaces', {
    list: workspaceList,
    pickDirectory: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
  } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  const injected = slots.entries('workbench')[0]!.inject!() as unknown as FileWorkspaceInjected
  return {
    child, ctx, fiber, injected, layout, rpcCall, sessions, slots, source,
    renderTrajectory, trajectoryPresentation, workspacePresentation,
  }
}

describe('ui-file-workspace apply', () => {
  it('registers the shared-Workspace projection and switches New Session to Chat first', async () => {
    const b = await bench()
    expect(b.workspacePresentation.forkLineage.getSnapshot()).toBe(true)
    expect(b.slots.entries('sidebar.workspaces.overlay')).toHaveLength(1)
    expect(b.slots.entries('workbench')).toHaveLength(1)
    expect(b.slots.entries('workbench')[0]?.store)
      .toBe(b.slots.entries('shell.overlay')[0]?.store)
    expect(b.slots.entries('workbench')[0]?.store)
      .toBe(b.slots.entries('sidebar.workspaces.overlay')[0]?.store)

    b.layout.setMode('files')
    b.ctx.emit('ui-sidebar/before-start-session')
    expect(b.layout.getMode()).toBe('chat')

    await b.fiber.dispose()
    expect(b.workspacePresentation.forkLineage.getSnapshot()).toBe(false)
    expect(b.slots.entries('sidebar.workspaces.overlay')).toHaveLength(0)
  })

  it('asks the Host to create a selection child under the file parent', async () => {
    const b = await bench({ current: 'parent' })
    const branch = await b.injected.startSelectionSession({
      workspaceId: 'workspace',
      path: '/workspace/README.md',
      fileVersion: 'v1',
      selectedText: 'selected',
      lineContext: 'selected',
      action: 'explain',
      ...selectionLocation,
    })

    expect(branch).toEqual({
      sessionId: 'child',
      branchStartSeq: 9,
      title: 'Explain · selected',
    })
    expect(b.rpcCall).toHaveBeenCalledWith(
      '/rpc-fileworkbench',
      'startSelectionSession',
      {
        workspaceId: 'workspace',
        path: '/workspace/README.md',
        expectedVersion: 'v1',
        selectedText: 'selected',
        lineContext: 'selected',
        action: 'explain',
        ...selectionLocation,
      },
      undefined,
    )
    expect(b.sessions.refresh).toHaveBeenCalledOnce()
  })

  it('passes explicit ask input to the Host without a browser default', async () => {
    const b = await bench()
    await b.injected.startSelectionSession({
      workspaceId: 'workspace',
      path: '/workspace/README.md',
      fileVersion: 'v1',
      selectedText: 'selected',
      lineContext: 'selected',
      action: 'ask',
      instruction: 'What does this mean?',
      ...selectionLocation,
    })

    expect(b.rpcCall).toHaveBeenCalledWith(
      '/rpc-fileworkbench',
      'startSelectionSession',
      expect.objectContaining({
        action: 'ask',
        instruction: 'What does this mean?',
      }),
      undefined,
    )
  })

  it('projects durable selection children from the ready Session list', () => {
    const projection = {
      id: 'selection',
      workspaceId: 'workspace',
      path: '/workspace/README.md',
      fileVersion: 'v1',
      selectedText: 'selected',
      lineContext: 'selected',
      action: 'explain' as const,
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 0,
      sourceEnd: 8,
      colorIndex: 0,
      title: 'Explain · selected',
      branchStartSeq: -1,
    }
    const childId = 'child' as SessionId
    expect(restorableSelections({
      ids: [childId],
      byId: {
        [childId]: {
          id: childId,
          displayTitle: projection.title,
          running: false,
          blank: false,
          updatedAt: 1,
          projectionValues: { fileWorkbenchSelection: projection },
        },
      },
      current: undefined,
      phase: 'ready',
      subagentsByParent: {},
      jobsBySession: {},
      currentAddress: undefined,
    })).toEqual({
      phase: 'ready',
      items: [{ ...projection, sessionId: 'child' }],
    })
  })

  it('deletes a selection child through the Host and refreshes session projections', async () => {
    const b = await bench()
    b.rpcCall.mockResolvedValueOnce({ ok: true, value: { deleted: true } })

    await b.injected.deleteSelectionSession({
      workspaceId: 'workspace',
      path: '/workspace/README.md',
      sessionId: 'child' as SessionId,
    })

    expect(b.rpcCall).toHaveBeenCalledWith(
      '/rpc-fileworkbench',
      'deleteSelectionSession',
      {
        workspaceId: 'workspace',
        path: '/workspace/README.md',
        sessionId: 'child',
      },
      undefined,
    )
    expect(b.sessions.refresh).toHaveBeenCalledOnce()
  })

  it('renders a child through the shared native trajectory service', async () => {
    const b = await bench()
    b.injected.renderChildTrajectory('child' as SessionId)
    expect(b.renderTrajectory).toHaveBeenCalledOnce()
    const input = b.renderTrajectory.mock.calls[0]?.[0]
    expect(input?.session).toBe(b.child)
    expect(typeof input?.loadOlder).toBe('function')
  })
})
