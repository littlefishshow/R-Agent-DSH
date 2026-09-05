/** File-workbench IO caller tests over a fake Connection RPC channel. */
import { describe, expect, it, vi } from 'vitest'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { createFileWorkbenchIo } from '../src/client/io.ts'
import { FILE_WORKBENCH_CHANNEL } from '../src/client/protocol.ts'

/** A fake RPC caller returning a scripted result and recording its calls. */
function fakeRpc(result: { ok: true; value: unknown } | { ok: false; error: { message: string } }): {
  rpc: ClientConnectionRpc
  calls: { channel: string; endpoint: string; payload: unknown }[]
} {
  const calls: { channel: string; endpoint: string; payload: unknown }[] = []
  const rpc = {
    call: vi.fn((channel: string, endpoint: string, payload: unknown) => {
      calls.push({ channel, endpoint, payload })
      return Promise.resolve(result)
    }),
  } as unknown as ClientConnectionRpc
  return { rpc, calls }
}

describe('createFileWorkbenchIo', () => {
  const selectionLocation = {
    selectionId: 'selection',
    visibleStart: 0,
    occurrence: 0,
    sourceStart: 0,
    sourceEnd: 1,
    colorIndex: 0,
  } as const

  it('lists a directory on the file-workbench channel', async () => {
    const { rpc, calls } = fakeRpc({ ok: true, value: { path: '/abs', entries: [] } })
    const io = createFileWorkbenchIo(rpc)
    const result = await io.listDir('/abs')
    expect(result.path).toBe('/abs')
    expect(calls[0]).toEqual({ channel: FILE_WORKBENCH_CHANNEL, endpoint: 'listDir', payload: { path: '/abs' } })
  })

  it('reads and writes text, omitting expectedVersion when undefined', async () => {
    const read = fakeRpc({
      ok: true,
      value: {
        path: '/a.md',
        content: '# a',
        version: 'v1',
        fileIndex: '/a.md',
        updatedAt: '2026-08-31T00:00:00.000Z',
      },
    })
    expect((await createFileWorkbenchIo(read.rpc).readText('/a.md')).content).toBe('# a')

    const image = fakeRpc({ ok: true, value: { path: '/a.png', mediaType: 'image/png', dataUrl: 'data:image/png;base64,AQ==' } })
    expect((await createFileWorkbenchIo(image.rpc).readImage('/a.png')).dataUrl).toBe('data:image/png;base64,AQ==')
    expect(image.calls[0]?.endpoint).toBe('readImage')

    const selection = fakeRpc({
      ok: true,
      value: {
        fileSessionId: 'file-parent',
        sessionId: 'child',
        branchStartSeq: 3,
        title: 'Why?',
      },
    })
    await createFileWorkbenchIo(selection.rpc).startSelectionSession({
      workspaceId: 'workspace',
      path: '/a.md',
      expectedVersion: 'v1',
      selectedText: 'a',
      lineContext: '# a',
      action: 'ask',
      instruction: 'Why?',
      ...selectionLocation,
    })
    expect(selection.calls[0]).toEqual({
      channel: FILE_WORKBENCH_CHANNEL,
      endpoint: 'startSelectionSession',
      payload: {
        workspaceId: 'workspace',
        path: '/a.md',
        expectedVersion: 'v1',
        selectedText: 'a',
        lineContext: '# a',
        action: 'ask',
        instruction: 'Why?',
        ...selectionLocation,
      },
    })

    const removed = fakeRpc({ ok: true, value: { deleted: true } })
    expect(await createFileWorkbenchIo(removed.rpc).deleteSelectionSession({
      workspaceId: 'workspace',
      path: '/a.md',
      sessionId: 'child',
    })).toBe(true)
    expect(removed.calls[0]?.endpoint).toBe('deleteSelectionSession')

    const create = fakeRpc({ ok: true, value: { operation: 'create', version: 'v1' } })
    await createFileWorkbenchIo(create.rpc).writeText('/a.md', 'body', undefined)
    expect(create.calls[0]?.payload).toEqual({ path: '/a.md', content: 'body' })

    const update = fakeRpc({ ok: true, value: { operation: 'update', version: 'v2' } })
    await createFileWorkbenchIo(update.rpc).writeText('/a.md', 'body', 'v1')
    expect(update.calls[0]?.payload).toEqual({ path: '/a.md', content: 'body', expectedVersion: 'v1' })
  })

  it('creates, deletes, copies, and renames entries', async () => {
    const create = fakeRpc({ ok: true, value: { entry: { name: 'n.md', path: '/d/n.md', kind: 'file', editable: true } } })
    await createFileWorkbenchIo(create.rpc).createEntry('/d', 'n.md', 'file')
    expect(create.calls[0]).toEqual({ channel: FILE_WORKBENCH_CHANNEL, endpoint: 'createEntry', payload: { parent: '/d', name: 'n.md', kind: 'file' } })

    const del = fakeRpc({ ok: true, value: { deleted: true } })
    await createFileWorkbenchIo(del.rpc).deleteEntry('/d/n.md')
    expect(del.calls[0]?.payload).toEqual({ path: '/d/n.md' })

    const copyNamed = fakeRpc({ ok: true, value: { entry: { name: 'c.md', path: '/e/c.md', kind: 'file', editable: true } } })
    await createFileWorkbenchIo(copyNamed.rpc).copyEntry('/d/n.md', '/e', 'c.md')
    expect(copyNamed.calls[0]?.payload).toEqual({ source: '/d/n.md', destParent: '/e', name: 'c.md' })

    const copyDefault = fakeRpc({ ok: true, value: { entry: { name: 'n.md', path: '/e/n.md', kind: 'file', editable: true } } })
    await createFileWorkbenchIo(copyDefault.rpc).copyEntry('/d/n.md', '/e', undefined)
    expect(copyDefault.calls[0]?.payload).toEqual({ source: '/d/n.md', destParent: '/e' })

    const ren = fakeRpc({ ok: true, value: { entry: { name: 'r.md', path: '/d/r.md', kind: 'file', editable: true } } })
    await createFileWorkbenchIo(ren.rpc).renameEntry('/d/n.md', 'r.md')
    expect(ren.calls[0]?.payload).toEqual({ path: '/d/n.md', newName: 'r.md' })
  })

  it('throws the business error message on a failed result', async () => {
    const { rpc } = fakeRpc({ ok: false, error: { message: 'path must be absolute' } })
    await expect(createFileWorkbenchIo(rpc).readText('relative.md')).rejects.toThrow('path must be absolute')
  })
})
