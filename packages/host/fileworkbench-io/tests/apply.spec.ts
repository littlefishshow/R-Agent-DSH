/** apply() wiring: channel registration, endpoint dispatch, payload validation, error mapping. */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { agentEvents, type Agent, type AgentHandle, type CreateAgentOptions, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type {
  ConnectionRpcHandler, ConnectionRpcHandlerOptions, HostConnectionHandle,
} from '@deepseek-ai/dsh-client-connection'
import {
  apply, Config, FileWorkbench, fileSessionId, fileSessionTitle, FILE_WORKBENCH_CHANNEL, inject,
  orderSelectionMessages,
} from '../src/index.ts'

let dir: string
let ctx: Context
let handler: ConnectionRpcHandler
let options: ConnectionRpcHandlerOptions
let channel: string
const createdAgents = new Map<string, AgentHandle>()
const createAgentCalls = vi.fn()
const resumeAgent = vi.fn()
const attachSession = vi.fn<(id: SessionId) => Promise<void>>(async () => {})
const detachSession = vi.fn<(id: SessionId) => Promise<void>>(async () => {})
const deleteSession = vi.fn<(id: SessionId) => Promise<boolean>>(async () => true)
const unarchiveSession = vi.fn<(id: SessionId) => Promise<void>>(async () => {})
const getSessionTitle = vi.fn()
const renameSession = vi.fn()
const signal = new AbortController().signal
const archivedRoot = SessionId('file-workbench-v2-archived')
const archivedChild = SessionId('file-selection-archived')
const selectionLocation = {
  selectionId: 'selection',
  visibleStart: 0,
  occurrence: 0,
  sourceStart: 0,
  sourceEnd: 16,
  colorIndex: 0,
} as const

/** A fake ctx.connection capturing the single registered channel handler. */
function fakeConnection(): HostConnectionHandle {
  return {
    rpc: {
      handle: (ch, h, opts) => { channel = ch; handler = h; options = opts; return () => Promise.resolve() },
      intercept: () => () => Promise.resolve(),
    },
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-apply-'))
  createAgentCalls.mockClear()
  resumeAgent.mockReset()
  unarchiveSession.mockClear()
  ctx = new Context()
  await ctx.plugin(SessionStore)
  ctx.provide('connection', fakeConnection())
  const createAgent = async (input: CreateAgentOptions): Promise<AgentHandle> => {
    createAgentCalls(input)
    const session = ctx.sessions.prepare(input.sessionId, {
      ...(input.seed === undefined ? {} : { seed: input.seed }),
      ...(input.meta === undefined ? {} : { meta: input.meta }),
    })
    const detach = ctx.sessions.enter(session)
    let activity = Promise.resolve()
    const injected: UserMessage[] = []
    const agent = {
      id: input.sessionId,
      session,
      ctx,
      options: input.agentOptions ?? {},
      status: 'idle',
      followup: (message: UserMessage) => {
        activity = (async () => {
          const turn = (session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0) + 1
          session.append('turn/start', { turn })
          const messages = [...injected.splice(0), message]
          const decision = await agentEvents(ctx, agent).waterfall(
            'agent/pre-step',
            { messages, turn, step: 1, signal },
            () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages }),
          )
          if (decision.kind === 'enter') {
            for (const admitted of decision.messages) {
              session.append('user/message', admitted, { surfaceOp: 'append' })
            }
          }
          session.append('turn/end', {
            turn,
            reason: { kind: decision.kind === 'reject' ? 'blocked' : 'completed' },
          })
        })()
      },
      inject: (message: UserMessage) => { injected.push(message) },
      cancel: vi.fn(),
      whenIdle: async () => activity,
      runMaintenance: async <T>(task: (taskSignal: AbortSignal) => Promise<T>) => task(signal),
      send: vi.fn(),
      steer: vi.fn(),
      inbox: {},
    } as unknown as Agent
    await input.setup?.(ctx)
    ctx.sessions.announce(session)
    const handle: AgentHandle = {
      agent,
      dispose: async () => {
        createdAgents.delete(input.sessionId)
        detach()
      },
    }
    createdAgents.set(input.sessionId, handle)
    return handle
  }
  ctx.provide('agents', {
    get: (id: string) => createdAgents.get(id)?.agent,
    create: createAgent,
    resume: resumeAgent,
  } as never)
  ctx.provide('sessionPersistence', {
    list: async () => [],
    inspect: vi.fn(),
    delete: deleteSession,
  } as never)
  ctx.provide('workspaceRegistry', {
    archivedSessionIds: [archivedRoot, SessionId('file-selection-archived'), SessionId('ordinary-archived')],
    unarchiveSession,
    get: (id: string) => id === 'workspace'
      ? { id, path: dir, attachSession, detachSession }
      : undefined,
  } as never)
  ctx.provide('agentDefaultModel', {
    currentSelection: () => ({ provider: 'mock', model: 'mock' }),
  } as never)
  ctx.provide('agentPresets', {
    defaultId: 'standard',
    mount: vi.fn(async () => ({ id: 'standard' })),
    composeFrom: vi.fn(() => 'standard'),
  } as never)
  ctx.provide('sessionTitle', { get: getSessionTitle, rename: renameSession } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply, Config }, { authority: 'loopback' })
  await fiber.await()
  attachSession.mockClear()
  detachSession.mockClear()
  deleteSession.mockClear()
  getSessionTitle.mockClear()
  renameSession.mockClear()
})
afterEach(async () => {
  await ctx.fiber.dispose()
  createdAgents.clear()
  vi.restoreAllMocks()
  await rm(dir, { recursive: true, force: true })
})

describe('fileworkbench-io apply', () => {
  it('unarchives historical file roots and selection children when the plugin starts', () => {
    expect(unarchiveSession).toHaveBeenCalledWith(archivedRoot)
    expect(unarchiveSession).toHaveBeenCalledWith(archivedChild)
    expect(unarchiveSession).not.toHaveBeenCalledWith('ordinary-archived')
  })

  it('labels file-parent sessions with their Workspace-relative path', () => {
    expect(fileSessionTitle(dir, join(dir, 'nested', 'guide.md'))).toBe('[File] nested/guide.md')
  })

  it('registers the file-workbench channel loopback-only by default', () => {
    expect(channel).toBe(FILE_WORKBENCH_CHANNEL)
    expect(options.authority).toBe('loopback')
  })

  it('dispatches the full endpoint set through the handler', async () => {
    const created = await handler('createEntry', { parent: dir, name: 'a.md', kind: 'file' }, signal)
    expect(created).toMatchObject({ ok: true })

    const write = await handler('writeText', { path: join(dir, 'a.md'), content: '# hi' }, signal)
    expect(write).toMatchObject({ ok: true })

    const read = await handler('readText', { path: join(dir, 'a.md') }, signal) as RpcResult<{ content: string }>
    if (!read.ok) throw new Error('expected read to succeed')
    expect(read.value.content).toBe('# hi')

    await writeFile(join(dir, 'pixel.png'), Buffer.from([1]))
    const image = await handler('readImage', { path: join(dir, 'pixel.png') }, signal)
    expect(image).toMatchObject({ ok: true, value: { mediaType: 'image/png', dataUrl: 'data:image/png;base64,AQ==' } })

    const list = await handler('listDir', { path: dir }, signal) as RpcResult<{ entries: unknown[] }>
    if (!list.ok) throw new Error('expected list to succeed')
    expect(list.value.entries).toHaveLength(2)

    const rename = await handler('renameEntry', { path: join(dir, 'a.md'), newName: 'b.md' }, signal)
    expect(rename).toMatchObject({ ok: true })

    const copy = await handler('copyEntry', { source: join(dir, 'b.md'), destParent: dir, name: 'c.md' }, signal)
    expect(copy).toMatchObject({ ok: true })

    const del = await handler('deleteEntry', { path: join(dir, 'c.md') }, signal)
    expect(del).toMatchObject({ ok: true, value: { deleted: true } })
  })

  it('creates sibling selection children under one stable file parent', async () => {
    const readText = vi.spyOn(FileWorkbench.prototype, 'readText')
    const path = join(dir, 'context.md')
    await writeFile(path, '# Shared context')
    const read = await handler('readText', { path }, signal) as RpcResult<{
      fileIndex: string
      updatedAt: string
      version: string
    }>
    if (!read.ok) throw new Error('expected read to succeed')

    const first = await handler('startSelectionSession', {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'Shared context',
      lineContext: '# Shared context',
      action: 'explain',
      ...selectionLocation,
    }, signal) as RpcResult<{
      fileSessionId: string
      sessionId: string
      branchStartSeq: number
      title: string
    }>
    const second = await handler('startSelectionSession', {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'Shared',
      lineContext: '# Shared context',
      action: 'summarize',
      ...selectionLocation,
    }, signal) as RpcResult<{
      fileSessionId: string
      sessionId: string
      branchStartSeq: number
      title: string
    }>
    if (!first.ok || !second.ok) throw new Error('expected selection sessions')
    expect(first.value).toMatchObject({ branchStartSeq: -1, title: 'explain · Shared context' })
    expect(second.value).toMatchObject({
      fileSessionId: first.value.fileSessionId,
      branchStartSeq: -1,
      title: 'summarize · Shared',
    })
    const parent = createdAgents.get(first.value.fileSessionId)?.agent.session
    if (parent === undefined) throw new Error('expected file parent')
    expect(renameSession).toHaveBeenCalledWith(parent, '[File] context.md')
    expect(unarchiveSession).toHaveBeenCalledWith(first.value.fileSessionId)
    expect(parent.events.filter(event => event.type === 'turn/start').map(event => event.data.turn))
      .toEqual([1])
    expect(parent.events.filter(event => event.type === 'turn/end').map(event => event.data.turn))
      .toEqual([1])
    const expectedContext = [
      '<file_context>',
      `file_index: ${path}`,
      `last_updated: ${read.value.updatedAt}`,
      `version: ${read.value.version}`,
      '<content>',
      '# Shared context',
      '</content>',
      '</file_context>',
    ].join('\n')
    const parentContexts = parent.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'host-fileworkbench-io')
    expect(parentContexts).toHaveLength(1)
    const parentBlock = parentContexts[0]?.type === 'user/message'
      ? parentContexts[0].data.content[0]
      : undefined
    expect(parentBlock).toEqual({ type: 'text', text: expectedContext })
    expect(parent.deriveMessages().filter(message =>
      message.role === 'user'
      && message.source.kind === 'plugin'
      && message.source.plugin === 'host-fileworkbench-io')).toHaveLength(1)
    const parentHandle = createdAgents.get(first.value.fileSessionId)
    if (parentHandle === undefined) throw new Error('expected file-parent Agent')
    parentHandle.agent.followup(createUserMessage({
      content: [{ type: 'text', text: 'root question' }],
      source: { kind: 'user' },
    }))
    await parentHandle.agent.whenIdle()
    expect(parent.events.filter(event => event.type === 'turn/start').map(event => event.data.turn))
      .toEqual([1, 2])
    await Promise.all([
      createdAgents.get(first.value.sessionId)?.agent.whenIdle(),
      createdAgents.get(second.value.sessionId)?.agent.whenIdle(),
    ])
    for (const childId of [first.value.sessionId, second.value.sessionId]) {
      const child = createdAgents.get(childId)?.agent.session
      if (child === undefined) throw new Error('expected selection child')
      const fileContexts = child.events.filter(event =>
        event.type === 'user/message'
        && event.data.source.kind === 'plugin'
        && event.data.source.plugin === 'host-fileworkbench-io')
      expect(fileContexts).toHaveLength(1)
      const block = fileContexts[0]?.type === 'user/message' ? fileContexts[0].data.content[0] : undefined
      expect(block).toEqual({ type: 'text', text: expectedContext })
    }
    expect(createdAgents.get(first.value.sessionId)?.agent.session.header.parentSession)
      .toBe(first.value.fileSessionId)
    expect(createdAgents.get(second.value.sessionId)?.agent.session.header.parentSession)
      .toBe(first.value.fileSessionId)
    expect(readText).toHaveBeenCalledOnce()
  })

  it('reuses a live file parent opened by another host path', async () => {
    const path = join(dir, 'live-root.md')
    await writeFile(path, '# Live root')
    const read = await handler('readText', { path }, signal) as RpcResult<{
      version: string
    }>
    if (!read.ok) throw new Error('expected read to succeed')
    const rootId = fileSessionId('workspace', path)
    const existing = await ctx.agents.create({
      sessionId: rootId,
      meta: { cwd: dir, agentPreset: 'standard' },
      agentOptions: { provider: 'mock', model: 'mock' },
    })
    createAgentCalls.mockClear()

    const started = await handler('startSelectionSession', {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'Live root',
      lineContext: '# Live root',
      action: 'explain',
      ...selectionLocation,
    }, signal) as RpcResult<{ fileSessionId: string; sessionId: string }>

    expect(started).toMatchObject({ ok: true, value: { fileSessionId: rootId } })
    expect(ctx.agents.get(rootId)).toBe(existing.agent)
    expect(resumeAgent).not.toHaveBeenCalled()
    expect(createAgentCalls).toHaveBeenCalledOnce()
    expect(existing.agent.session.deriveMessages().filter(message =>
      message.role === 'user'
      && message.source.kind === 'plugin'
      && message.source.plugin === 'host-fileworkbench-io')).toHaveLength(1)
  })

  it('uses the first instruction as the child title and requires one fenced modify result', async () => {
    const path = join(dir, 'modify.md')
    await writeFile(path, '# Original')
    const read = await handler('readText', { path }, signal) as RpcResult<{ version: string }>
    if (!read.ok) throw new Error('expected read to succeed')

    const started = await handler('startSelectionSession', {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'Original',
      lineContext: '# Original',
      action: 'modify',
      instruction: 'Make the heading more specific',
      ...selectionLocation,
    }, signal) as RpcResult<{ sessionId: string; title: string }>
    if (!started.ok) throw new Error('expected modify selection to start')

    expect(started.value.title).toBe('Make the heading more specific')
    expect(renameSession).toHaveBeenCalledWith(
      createdAgents.get(started.value.sessionId)?.agent.session,
      'Make the heading more specific',
    )
    const child = createdAgents.get(started.value.sessionId)?.agent.session
    await createdAgents.get(started.value.sessionId)?.agent.whenIdle()
    const prompt = child?.events.findLast(event => event.type === 'user/message')
    if (prompt?.type !== 'user/message') throw new Error('expected opening prompt')
    const block = prompt.data.content[0]
    if (block?.type !== 'text') throw new Error('expected text opening prompt')
    expect(prompt.data.source).toMatchObject({
      kind: 'plugin',
      plugin: 'host-fileworkbench-io:selection-prompt',
      form: 'instructions',
      fileWorkbenchSelection: {
        id: 'selection',
        workspaceId: 'workspace',
        path,
        selectedText: 'Original',
        action: 'modify',
        title: 'Make the heading more specific',
      },
    })
    expect(block.text).toContain('回复中必须有且仅有一个 Markdown 代码块')
    expect(block.text).toContain('优先使用四反引号')
    expect(block.text).toContain('````markdown\n<完整替换文本>\n````')
    expect(block.text).toContain('代码块内容必须完整替换【所在段落】')
    expect(block.text).toContain('【修改要求】\nMake the heading more specific')
  })

  it('orders runtime context before the file snapshot and user question', async () => {
    const message = (text: string, source: UserMessage['source']): UserMessage =>
      createUserMessage({ content: [{ type: 'text', text }], source })
    const question = message('question', { kind: 'user' })
    const runtime = message('runtime', { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' })
    const file = message('<file_context>\nfile_index: /a.md\n</file_context>', {
      kind: 'plugin',
      plugin: 'host-fileworkbench-io',
    })
    const notice = message('notice', { kind: 'plugin', plugin: 'notice' })

    expect(orderSelectionMessages([file, question, runtime, notice]))
      .toEqual([runtime, notice, file, question])
    expect(orderSelectionMessages([question, runtime])).toEqual([runtime, question])
  })

  it('reorders the final pre-step decision without short-circuiting other listeners', async () => {
    const file = createUserMessage({
      content: [{ type: 'text', text: '<file_context>\nfile_index: /a.md\n</file_context>' }],
      source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
    })
    const question = createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    })
    const runtime = createUserMessage({
      content: [{ type: 'text', text: 'runtime' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    })
    const agent = {
      id: 'file-selection-ordering',
      session: {
        header: { parentSession: 'file-workbench-v2-parent', seedLength: 0 },
        events: [],
        deriveMessages: () => [],
      },
    } as never
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      {
        messages: [file, question],
        turn: 1,
        step: 1,
        signal,
      },
      () => Promise.resolve<PreStepDecision>({
        kind: 'enter',
        messages: [file, question, runtime],
      }),
    )
    expect(decision).toMatchObject({ kind: 'enter' })
    if (decision.kind === 'reject') throw new Error('expected enter decision')
    expect(decision.messages).toEqual([runtime, file, question])
  })

  it('keeps runtime context before later child questions without another file context', async () => {
    const question = createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    })
    const runtime = createUserMessage({
      content: [{ type: 'text', text: 'runtime' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    })
    const file = createUserMessage({
      content: [{ type: 'text', text: '<file_context>\nfile_index: /a.md\n</file_context>' }],
      source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
    })
    const agent = {
      id: 'file-selection-follow-up',
      session: {
        header: { parentSession: 'file-workbench-v2-parent', seedLength: 0 },
        events: [{ type: 'user/message', data: file }],
        deriveMessages: () => [file],
      },
    } as never
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      {
        messages: [question],
        turn: 1,
        step: 1,
        signal,
      },
      () => Promise.resolve<PreStepDecision>({
        kind: 'enter',
        messages: [question, runtime],
      }),
    )
    expect(decision).toMatchObject({ kind: 'enter' })
    if (decision.kind === 'reject') throw new Error('expected enter decision')
    expect(decision.messages).toEqual([runtime, question])
  })

  it('counts legacy child file contexts from the current surface rather than physical history', async () => {
    const file = createUserMessage({
      content: [{ type: 'text', text: '<file_context>\nfile_index: /a.md\n</file_context>' }],
      source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
    })
    const replacedFile = createUserMessage({
      content: [{ type: 'text', text: '<file_context>\nfile_index: /a.md\nversion: old\n</file_context>' }],
      source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
    })
    const question = createUserMessage({
      content: [{ type: 'text', text: 'follow up' }],
      source: { kind: 'user' },
    })
    const runtime = createUserMessage({
      content: [{ type: 'text', text: 'runtime' }],
      source: { kind: 'plugin', plugin: '@deepseek-ai/dsh-system-prompt' },
    })
    const agent = {
      id: 'file-selection-legacy',
      session: {
        header: { parentSession: 'file-workbench-v2-parent', seedLength: 4 },
        events: [
          { type: 'user/message', data: replacedFile },
          { type: 'user/message', data: file },
        ],
        deriveMessages: () => [file],
      },
    } as never
    const decision = await agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [question], turn: 2, step: 1, signal },
      () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [question, runtime] }),
    )
    expect(decision).toMatchObject({ kind: 'enter' })
    if (decision.kind === 'reject') throw new Error('expected enter decision')
    expect(decision.messages).toEqual([runtime, question])
  })

  it('rejects a selection child whose first step lacks a file context', async () => {
    const question = createUserMessage({
      content: [{ type: 'text', text: 'question' }],
      source: { kind: 'user' },
    })
    const agent = {
      id: 'file-selection-missing-file-context',
      session: {
        header: { parentSession: 'file-workbench-v2-parent', seedLength: 0 },
        events: [],
        deriveMessages: () => [],
      },
    } as never
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [question], turn: 1, step: 1, signal },
      () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [question] }),
    )).rejects.toThrow(/requires exactly one file context \(admitted 0, incoming 0\)/)
  })

  it('rejects a second file context after the child admitted its first one', async () => {
    const file = createUserMessage({
      content: [{ type: 'text', text: '<file_context>\nfile_index: /a.md\n</file_context>' }],
      source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
    })
    const question = createUserMessage({
      content: [{ type: 'text', text: 'follow up' }],
      source: { kind: 'user' },
    })
    const agent = {
      id: 'file-selection-repeated-file-context',
      session: {
        header: { parentSession: 'file-workbench-v2-parent', seedLength: 0 },
        events: [{ type: 'user/message', data: file }],
        deriveMessages: () => [file],
      },
    } as never
    await expect(agentEvents(ctx, agent).waterfall(
      'agent/pre-step',
      { messages: [file, question], turn: 2, step: 1, signal },
      () => Promise.resolve<PreStepDecision>({ kind: 'enter', messages: [file, question] }),
    )).rejects.toThrow(/requires exactly one file context \(admitted 1, incoming 1\)/)
  })

  it('refuses a stale selection snapshot before creating a child', async () => {
    const path = join(dir, 'stale.md')
    await writeFile(path, 'first')
    const read = await handler('readText', { path }, signal) as RpcResult<{ version: string }>
    if (!read.ok) throw new Error('expected read to succeed')
    await writeFile(path, 'second version')

    expect(await handler('startSelectionSession', {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'first',
      lineContext: 'first',
      action: 'explain',
      ...selectionLocation,
    }, signal)).toMatchObject({
      ok: false,
      error: { code: 'workspace-invalid-path' },
    })
  })

  it('disposes, detaches, and permanently deletes a selection child', async () => {
    const path = join(dir, 'delete.md')
    await writeFile(path, '# Delete')
    const read = await handler('readText', { path }, signal) as RpcResult<{ version: string }>
    if (!read.ok) throw new Error('expected read to succeed')
    const started = await handler('startSelectionSession', {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'Delete',
      lineContext: '# Delete',
      action: 'explain',
      ...selectionLocation,
    }, signal) as RpcResult<{ sessionId: string }>
    if (!started.ok) throw new Error('expected selection to start')

    expect(await handler('deleteSelectionSession', {
      workspaceId: 'workspace',
      path,
      sessionId: started.value.sessionId,
    }, signal)).toEqual({ ok: true, value: { deleted: true } })
    expect(detachSession).toHaveBeenCalledWith(started.value.sessionId)
    expect(deleteSession).toHaveBeenCalledWith(started.value.sessionId)
    expect(createdAgents.has(started.value.sessionId)).toBe(false)
  })

  it('creates a clean sibling after deleting a selection child', async () => {
    const path = join(dir, 'recreate.md')
    await writeFile(path, '# Recreate')
    const read = await handler('readText', { path }, signal) as RpcResult<{ version: string }>
    if (!read.ok) throw new Error('expected read to succeed')
    const request = {
      workspaceId: 'workspace',
      path,
      expectedVersion: read.value.version,
      selectedText: 'Recreate',
      lineContext: '# Recreate',
      action: 'explain',
      ...selectionLocation,
    }
    const first = await handler('startSelectionSession', request, signal) as RpcResult<{
      fileSessionId: string
      sessionId: string
      branchStartSeq: number
    }>
    if (!first.ok) throw new Error('expected first selection to start')
    await handler('deleteSelectionSession', {
      workspaceId: 'workspace',
      path,
      sessionId: first.value.sessionId,
    }, signal)

    const second = await handler('startSelectionSession', request, signal) as RpcResult<{
      fileSessionId: string
      sessionId: string
      branchStartSeq: number
    }>
    if (!second.ok) throw new Error('expected recreated selection to start')
    expect(second.value.fileSessionId).toBe(first.value.fileSessionId)
    expect(second.value.sessionId).not.toBe(first.value.sessionId)
    await createdAgents.get(second.value.sessionId)?.agent.whenIdle()
    const parent = createdAgents.get(second.value.fileSessionId)?.agent.session
    const child = createdAgents.get(second.value.sessionId)?.agent.session
    if (parent === undefined || child === undefined) throw new Error('expected parent and recreated child')
    expect(parent.events.filter(event => event.type === 'turn/start').map(event => event.data.turn))
      .toEqual([1])
    expect(parent.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'host-fileworkbench-io')).toHaveLength(1)
    expect(child.events.filter(event => event.type === 'turn/start').map(event => event.data.turn))
      .toEqual([1])
    expect(new Set(
      child.events
        .filter(event => event.type === 'turn/start')
        .map(event => event.data.turn),
    ).size).toBe(1)
    expect(child.events.filter(event =>
      event.type === 'user/message'
      && event.data.source.kind === 'plugin'
      && event.data.source.plugin === 'host-fileworkbench-io')).toHaveLength(1)
  })

  it('rejects an unknown endpoint with bad-request', async () => {
    expect(await handler('nope', {}, signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects a non-string required field with bad-request', async () => {
    expect(await handler('readText', { path: 42 }, signal)).toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects a non-string optional field with bad-request', async () => {
    await writeFile(join(dir, 'x.md'), 'x')
    expect(await handler('writeText', { path: join(dir, 'x.md'), content: 'y', expectedVersion: 5 }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects an invalid createEntry kind with bad-request', async () => {
    expect(await handler('createEntry', { parent: dir, name: 'z', kind: 'symlink' }, signal))
      .toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('maps a relative-path business error to workspace-invalid-path', async () => {
    expect(await handler('readText', { path: 'relative.md' }, signal))
      .toMatchObject({ ok: false, error: { code: 'workspace-invalid-path' } })
  })
})
