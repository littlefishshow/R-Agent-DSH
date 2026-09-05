/**
 * File-workbench Host backend. Its dedicated Connection RPC channel
 * ({@link FILE_WORKBENCH_CHANNEL}) lists, reads, writes, and reorganizes text
 * documents and owns file-parent/selection-child Session lifecycles. File IO
 * uses ABSOLUTE paths through Node's stdlib rather than sandbox-confined
 * `ctx.fs`; selection operations additionally verify the named Workspace owns
 * the document path.
 *
 * The channel is loopback-only by default: reading and rewriting arbitrary
 * files is as sensitive as shell access, and a LAN client must not reach it
 * without an explicit deployment decision to widen the trust fence.
 * @module @deepseek-ai/dsh-host-fileworkbench-io
 */

import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentHandle, ModelSelection, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session-title'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import type { RpcResult } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { ConnectionRpcAuthority } from '@deepseek-ai/dsh-client-connection'
import {
  FILE_WORKBENCH_CHANNEL,
  FILE_WORKBENCH_ENDPOINTS,
  type DeleteSelectionSessionRequest,
  type EntryResponse,
  type FileWorkbenchEntry,
  type ReadImageResponse,
  type ListDirResponse,
  type ReadTextResponse,
  type SelectionAction,
  type StartSelectionSessionRequest,
  type StartSelectionSessionResponse,
  type WriteTextResponse,
} from './protocol.ts'
import {
  FILE_WORKBENCH_SELECTION_SOURCE_FIELD,
  fileWorkbenchSelectionProjectionDefinition,
  type FileWorkbenchSelectionProjection,
} from './selection-projection.ts'

export * from './protocol.ts'
export * from './selection-projection.ts'

/** Cordis function-plugin name. */
export const name = 'host-fileworkbench-io'
/** Services required before the channel can be mounted. */
export const inject = [
  'connection', 'agents', 'sessions', 'sessionPersistence', 'workspaceRegistry',
  'agentDefaultModel', 'agentPresets', 'sessionTitle',
]

/** Text extensions this backend reads and writes as UTF-8 (lowercased, with dot). */
const EDITABLE_EXTENSIONS = new Set([
  '.bash', '.c', '.cc', '.cpp', '.css', '.csv', '.env', '.go', '.h', '.hpp',
  '.html', '.ini', '.java', '.js', '.json', '.jsx', '.kt', '.kts', '.less',
  '.lua', '.md', '.markdown', '.mjs', '.mts', '.php', '.py', '.rb', '.rs',
  '.scss', '.sh', '.sql', '.svelte', '.toml', '.ts', '.tsx', '.txt', '.vue',
  '.xml', '.yaml', '.yml', '.zsh',
])
/** Extension-less text filenames commonly used in source workspaces. */
const EDITABLE_FILENAMES = new Set([
  '.env', '.gitignore', '.npmrc', 'Dockerfile', 'LICENSE', 'Makefile', 'README',
])
/** Inclusive byte cap on a single text read/write, guarding against a huge or binary file. */
const MAX_TEXT_BYTES = 8 * 1024 * 1024
/** Inclusive image byte cap: enough for document figures without unbounded RPC payloads. */
const MAX_IMAGE_BYTES = 16 * 1024 * 1024
/** Parent-id namespace for the Agent-driven file-context log format. */
const FILE_SESSION_ID_PREFIX = 'file-workbench-v2-'
/** Message source used only to create the file parent's model-free root turn. */
const FILE_ROOT_PLUGIN = `${name}:file-root`
/** Message source used only for a selection child's hidden opening prompt. */
const SELECTION_PROMPT_PLUGIN = `${name}:selection-prompt`
/** Image extensions the Markdown reader may load as data URLs. */
const IMAGE_MEDIA_TYPES: Readonly<Record<string, ReadImageResponse['mediaType']>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
} as const

/** Validated plugin configuration. */
export interface Config {
  /**
   * Browser trust the channel accepts. `loopback` (the default) serves only
   * same-host callers; `trusted-host` additionally serves the deployment's
   * declared LAN authorities. Arbitrary-file access is shell-sensitive, so the
   * default stays loopback-only.
   */
  authority: ConnectionRpcAuthority
}

/** Plugin configuration schema. */
export const Config: z<Config> = z.object({
  authority: z.union([z.const('loopback'), z.const('trusted-host')]).default('loopback'),
})

/** A validated string field on the wire, or a `bad-request` failure. */
function requireString(payload: unknown, key: string): string {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'string') {
    throw badRequest(`field ${JSON.stringify(key)} must be a string`)
  }
  return value
}

/** An optional string field on the wire, or a `bad-request` failure for a wrong type. */
function optionalString(payload: unknown, key: string): string | undefined {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw badRequest(`field ${JSON.stringify(key)} must be a string when present`)
  }
  return value
}

/** A non-negative integer field on the wire, or a `bad-request` failure. */
function requireNonnegativeInteger(payload: unknown, key: string): number {
  const value = (payload as Record<string, unknown> | null)?.[key]
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw badRequest(`field ${JSON.stringify(key)} must be a non-negative integer`)
  }
  return value
}

/** A business error surfaced through the shared RPC error vocabulary. */
class WorkbenchError extends Error {
  constructor(
    readonly result: Extract<RpcResult<never>, { ok: false }>,
  ) {
    super(result.error.message)
  }
}

/** A `bad-request` business error for a malformed wire payload. */
function badRequest(message: string): WorkbenchError {
  return new WorkbenchError({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })
}

/** A `workspace-invalid-path` business error for a rejected or unusable path. */
function invalidPath(path: string, message: string): WorkbenchError {
  return new WorkbenchError({ ok: false, error: { code: 'workspace-invalid-path', message, details: { path } } })
}

/** Require an absolute host path; a relative or blank path is refused before any filesystem call. */
function requireAbsolute(path: string): string {
  if (path.trim() === '' || !isAbsolute(path)) {
    throw invalidPath(path, `path must be absolute: ${JSON.stringify(path)}`)
  }
  return resolve(path)
}

/** Require a single non-blank path segment (no separators, no dot entries). */
function requireSegment(name: string): string {
  if (name.trim() === '' || name === '.' || name === '..' || /[/\\]/.test(name)) {
    throw invalidPath(name, `${JSON.stringify(name)} is not a single path segment`)
  }
  return name
}

/** Whether a basename is an editable text document by extension. */
function isEditable(name: string): boolean {
  const fileName = basename(name)
  const dot = fileName.lastIndexOf('.')
  const ext = dot < 0 ? '' : fileName.slice(dot).toLowerCase()
  return EDITABLE_EXTENSIONS.has(ext) || EDITABLE_FILENAMES.has(fileName)
}

/** Node error code, when the thrown value carries one. */
function errorCode(error: unknown): string | undefined {
  /* v8 ignore start -- node:fs rejects with an Error carrying `code`; the non-object guard is defensive. */
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined
  }
  /* v8 ignore stop */
  return String(error.code)
}

/** A freshness token derived from a file's nanosecond mtime and size — changes on every write. */
function versionOf(mtimeNs: bigint, size: number): string {
  return `${mtimeNs.toString()}-${String(size)}`
}

/** Stable file index used in repeated document snapshots. */
function fileIndexOf(path: string): string {
  return path
}

/** Exact model-facing file snapshot placed before a selection question. */
function documentContext(read: ReadTextResponse): string {
  return [
    '<file_context>',
    `file_index: ${read.fileIndex}`,
    `last_updated: ${read.updatedAt}`,
    `version: ${read.version}`,
    '<content>',
    read.content,
    '</content>',
    '</file_context>',
  ].join('\n')
}

/** Stable child title: explicit operator text when present, otherwise the built-in action and selection. */
function selectionTitle(input: StartSelectionSessionRequest): string {
  const instruction = input.instruction?.trim()
  return (instruction === undefined || instruction === '')
    ? `${input.action} · ${input.selectedText.trim()}`.slice(0, 80)
    : instruction.slice(0, 80)
}

/**
 * Build the stable parent Session identity for one Workspace-owned document.
 * @param workspaceId - Workspace registration that owns the file.
 * @param path - absolute document path.
 * @returns deterministic file-parent Session id.
 */
export function fileSessionId(workspaceId: string, path: string): SessionId {
  const digest = createHash('sha256')
    .update(workspaceId)
    .update('\0')
    .update(path)
    .digest('base64url')
    .slice(0, 32)
  return SessionId(`${FILE_SESSION_ID_PREFIX}${digest}`)
}

/**
 * Build the conversation-tree label for one file parent.
 * @param workspacePath - absolute Workspace root.
 * @param path - absolute document path.
 * @returns a stable file marker plus the Workspace-relative path.
 */
export function fileSessionTitle(workspacePath: string, path: string): string {
  const relativePath = relative(workspacePath, path)
  return `[File] ${relativePath === '' ? basename(path) : relativePath}`
}

/** Whether one admitted message is this plugin's complete-file snapshot. */
function isDocumentContext(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === name
}

/** Whether one admitted message is a selection child's model-facing opening instruction. */
function isSelectionPrompt(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === SELECTION_PROMPT_PLUGIN
}

/** Count file contexts on the current model-visible Session surface. */
function visibleDocumentContextCount(messages: readonly { role: string; source: unknown }[]): number {
  return messages.filter((message): message is UserMessage =>
    message.role === 'user' && isDocumentContext(message as UserMessage)).length
}

/** Whether one queued message creates a file root without entering a model step. */
function isFileRootActivation(message: UserMessage): boolean {
  return message.source.kind === 'plugin' && message.source.plugin === FILE_ROOT_PLUGIN
}

/** Ensure a path is inside the Workspace named on the request. */
function assertWorkspacePath(workspacePath: string, path: string): void {
  const suffix = relative(workspacePath, path)
  if (suffix === '' || (!suffix.startsWith('..') && !isAbsolute(suffix))) return
  throw invalidPath(path, `path is outside workspace ${workspacePath}: ${path}`)
}

/** Build the selection-specific first user prompt. */
function selectionPrompt(input: StartSelectionSessionRequest): string {
  const instruction = input.instruction?.trim() ?? ''
  let lead: string
  switch (input.action) {
    case 'modify':
      if (instruction === '') throw badRequest('field "instruction" is required for modify')
      lead = [
        '请根据下面的修改要求生成替换后的 Markdown 源文。',
        '回复中必须有且仅有一个 Markdown 代码块；代码块外可以有简短说明，但采纳时只会使用代码块内部文本。',
        '优先使用四反引号，避免替换文本中的三反引号提前结束代码块：',
        '````markdown',
        '<完整替换文本>',
        '````',
        '代码块内容必须完整替换【所在段落】；若没有单独的所在段落，则完整替换【选中文本】。',
        '不要调用任何写文件工具。',
        '【修改要求】',
        instruction,
      ].join('\n')
      break
    case 'ask':
      if (instruction === '') throw badRequest('field "instruction" is required for ask')
      lead = `请针对下面选中的文本回答我的问题。\n【问题】\n${instruction}`
      break
    case 'explain':
      lead = '请用清晰、简洁的方式解释下面选中的文本，必要时给出背景与例子。'
      break
    case 'summarize':
      lead = '请用一到三句话概括下面选中的文本的要点。'
      break
    default:
      return assertNeverAction(input.action)
  }
  const context = input.lineContext.trim() === input.selectedText.trim()
    ? ''
    : `\n【所在段落】\n${input.lineContext}`
  return [lead, `\n【选中文本】\n${input.selectedText}`, context]
    .filter(part => part !== '')
    .join('\n')
}

/** Closed-action exhaustiveness guard. */
function assertNeverAction(action: never): never {
  throw badRequest(`unsupported selection action: ${String(action)}`)
}

/** Validate the action field at the wire boundary. */
function requireSelectionAction(payload: unknown): SelectionAction {
  const action = requireString(payload, 'action')
  if (action === 'modify' || action === 'ask' || action === 'explain' || action === 'summarize') {
    return action
  }
  throw badRequest('field "action" must be "modify", "ask", "explain", or "summarize"')
}

/**
 * Keep all runtime/plugin context ahead of the file snapshot and all ordinary
 * user questions after it. Relative order inside each group is preserved.
 * @param messages - final pre-step messages after every other listener.
 * @returns messages in stable context → file → question order.
 */
export function orderSelectionMessages(
  messages: readonly UserMessage[],
): UserMessage[] {
  const context: UserMessage[] = []
  const documents: UserMessage[] = []
  const questions: UserMessage[] = []
  for (const message of messages) {
    if (isDocumentContext(message)) documents.push(message)
    else if (message.source.kind === 'user' || isSelectionPrompt(message)) questions.push(message)
    else context.push(message)
  }
  return [...context, ...documents, ...questions]
}

interface OwnedSelectionSession {
  readonly handle: AgentHandle
  readonly fileSessionId: SessionId
  readonly workspaceId: string
  readonly path: string
}

/**
 * Owns file-parent and selection-child Agent lifecycles for this plugin.
 * A parent records the first cached file context in a model-free turn. Every
 * child starts without inherited events and logs one child-local file context
 * before its independent selection prompt.
 */
class SelectionSessions {
  private readonly parents = new Map<SessionId, Promise<Agent>>()
  private readonly children = new Map<SessionId, OwnedSelectionSession>()

  constructor(private readonly ctx: Context, private readonly files: FileWorkbench) {}

  /** Install the standard model-selection listeners on one unpublished Agent scope. */
  private installModel(agentCtx: Context, model: ModelSelection): void {
    installModelSelection(agentCtx, { current: model, assembled: undefined })
  }

  /** Persist the root's file context, then close its activation turn before a model step. */
  private installParentActivation(agentCtx: Context): () => void {
    return agentCtx.on('agent/pre-step', async ({ agent, messages }, next): Promise<PreStepDecision> => {
      if (messages.length !== 1 || !isFileRootActivation(messages[0] as UserMessage)) return next()
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const activation = messages[0] as UserMessage
      agent.session.append('user/message', createUserMessage({
        content: activation.content,
        source: { kind: 'plugin', plugin: name },
      }), { surfaceOp: 'append' })
      return { kind: 'enter', messages: [] }
    }, { prepend: true })
  }

  /** Create a selection child, attach it to the file's Workspace, and send its first prompt. */
  async start(input: StartSelectionSessionRequest): Promise<StartSelectionSessionResponse> {
    const prompt = selectionPrompt(input)
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.workspaceId))
    if (workspace === undefined) throw badRequest(`workspace not found: ${input.workspaceId}`)
    const path = requireAbsolute(input.path)
    assertWorkspacePath(workspace.path, path)
    const read = await this.files.selectionSnapshot(path, input.expectedVersion)
    const parentAgent = await this.ensureParent(workspace.id, workspace.path, path, read)
    const parent = parentAgent.session
    const childId = SessionId(`file-selection-${randomUUID()}`)
    const presetId = resolveSessionPreset(parent)
    const model = this.ctx.agentDefaultModel.currentSelection()
    const childHandle = await this.ctx.agents.create({
      sessionId: childId,
      meta: {
        cwd: workspace.path,
        parentSession: parent.id,
        seedLength: 0,
        ...presetId === undefined ? {} : { agentPreset: presetId },
      },
      agentOptions: { provider: model.provider, model: model.model },
      setup: (agentCtx) => {
        this.installModel(agentCtx, model)
        this.ctx.agentPresets.composeFrom(agentCtx, parentAgent.ctx)
      },
    })
    const owned: OwnedSelectionSession = {
      handle: childHandle,
      fileSessionId: parent.id,
      workspaceId: String(workspace.id),
      path,
    }
    this.children.set(childId, owned)
    try {
      await workspace.attachSession(childId)
      const title = selectionTitle(input)
      this.ctx.sessionTitle.rename(childHandle.agent.session, title)
      const selection: FileWorkbenchSelectionProjection = {
        id: input.selectionId,
        workspaceId: input.workspaceId,
        path,
        fileVersion: read.version,
        selectedText: input.selectedText,
        lineContext: input.lineContext,
        action: input.action,
        visibleStart: input.visibleStart,
        occurrence: input.occurrence,
        sourceStart: input.sourceStart,
        sourceEnd: input.sourceEnd,
        colorIndex: input.colorIndex,
        title,
        branchStartSeq: -1,
      }
      childHandle.agent.inject(createUserMessage({
        content: [{ type: 'text', text: documentContext(read) }],
        source: { kind: 'plugin', plugin: name },
      }))
      const openingMessage = createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: {
          kind: 'plugin',
          plugin: SELECTION_PROMPT_PLUGIN,
          form: 'instructions',
          [FILE_WORKBENCH_SELECTION_SOURCE_FIELD]: selection,
        },
      })
      await this.admitOpeningMessage(childHandle, openingMessage)
      await this.ctx.sessions.flush(childHandle.agent.session)
      return {
        fileSessionId: parent.id,
        sessionId: childId,
        branchStartSeq: -1,
        title,
      }
    } catch (error: unknown) {
      this.children.delete(childId)
      await childHandle.dispose()
      await workspace.detachSession(childId)
      await this.ctx.sessionPersistence.delete(childId)
      throw error
    }
  }

  /** Queue the child's hidden opening instruction and wait until it commits to the log. */
  private async admitOpeningMessage(handle: AgentHandle, message: UserMessage): Promise<void> {
    let admitted = false
    let resolveAdmission: (() => void) | undefined
    const admission = new Promise<void>((resolvePromise) => { resolveAdmission = resolvePromise })
    const dispose = this.ctx.on('session/event', (session, event) => {
      if (session !== handle.agent.session || event.type !== 'user/message' || event.data.id !== message.id) return
      admitted = true
      resolveAdmission?.()
    }, { global: true })
    try {
      handle.agent.followup(message)
      await Promise.race([
        admission,
        handle.agent.whenIdle().then(() => {
          if (!admitted) throw new Error(`selection session "${handle.agent.id}" did not admit its opening prompt`)
        }),
      ])
    } finally {
      dispose()
    }
  }

  /** Dispose, detach, and permanently delete one selection child. */
  async delete(input: DeleteSelectionSessionRequest): Promise<boolean> {
    const childId = SessionId(input.sessionId)
    const expectedParent = fileSessionId(input.workspaceId, requireAbsolute(input.path))
    const owned = this.children.get(childId)
    if (owned !== undefined) {
      if (owned.fileSessionId !== expectedParent
        || owned.workspaceId !== input.workspaceId
        || owned.path !== resolve(input.path)) {
        throw badRequest(`selection session does not belong to ${input.path}`)
      }
      const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.workspaceId))
      await owned.handle.dispose()
      await workspace?.detachSession(childId)
      const deleted = await this.ctx.sessionPersistence.delete(childId)
      this.children.delete(childId)
      return deleted
    }
    if (this.ctx.agents.get(childId) !== undefined || this.ctx.sessions.get(childId) !== undefined) {
      throw badRequest(`selection session is live but not owned by this file workbench: ${childId}`)
    }
    const stored = (await this.ctx.sessionPersistence.list()).find(header => header.id === childId)
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(input.workspaceId))
    if (workspace === undefined) throw badRequest(`workspace not found: ${input.workspaceId}`)
    assertWorkspacePath(workspace.path, resolve(input.path))
    if (stored === undefined) {
      await workspace.detachSession(childId)
      return false
    }
    if (stored.parentSession !== expectedParent) {
      throw badRequest(`selection session does not belong to ${input.path}`)
    }
    await workspace.detachSession(childId)
    return this.ctx.sessionPersistence.delete(childId)
  }

  private async ensureParent(
    workspaceId: ReturnType<typeof WorkspaceId>,
    cwd: string,
    path: string,
    read: ReadTextResponse,
  ): Promise<Agent> {
    const id = fileSessionId(String(workspaceId), path)
    let pending = this.parents.get(id)
    if (pending === undefined) {
      pending = this.openParent(id, workspaceId, cwd, path, read).finally(() => {
        if (this.parents.get(id) === pending) this.parents.delete(id)
      })
      this.parents.set(id, pending)
    }
    return pending
  }

  private async openParent(
    id: SessionId,
    workspaceId: ReturnType<typeof WorkspaceId>,
    cwd: string,
    path: string,
    read: ReadTextResponse,
  ): Promise<Agent> {
    const live = this.ctx.agents.get(id)
    if (live !== undefined) {
      await this.prepareParent(live, workspaceId, cwd, path, read, true)
      return live
    }
    const stored = (await this.ctx.sessionPersistence.list()).find(header => header.id === id)
    let handle: AgentHandle | undefined
    try {
      if (stored === undefined) {
        const presetId = this.ctx.agentPresets.defaultId
        const model = this.ctx.agentDefaultModel.currentSelection()
        handle = await this.ctx.agents.create({
          sessionId: id,
          meta: { cwd, agentPreset: presetId },
          agentOptions: { provider: model.provider, model: model.model },
          setup: async (agentCtx) => {
            this.installModel(agentCtx, model)
            this.installParentActivation(agentCtx)
            void await this.ctx.agentPresets.mount(agentCtx, presetId)
          },
        })
      } else {
        if (stored.cwd !== cwd) {
          throw new Error(`file parent session "${id}" belongs to another workspace`)
        }
        const inspection = await this.ctx.sessionPersistence.inspect(id)
        const presetId = resolveSessionPreset({ header: inspection.meta, events: inspection.events })
        const model = this.ctx.agentDefaultModel.currentSelection()
        handle = await this.ctx.agents.resume({
          resumeSessionId: id,
          agentOptions: { provider: model.provider, model: model.model },
          setup: async (agentCtx) => {
            this.installModel(agentCtx, model)
            this.installParentActivation(agentCtx)
            void await this.ctx.agentPresets.mount(agentCtx, presetId)
          },
        })
      }
      await this.prepareParent(handle.agent, workspaceId, cwd, path, read, false)
      return handle.agent
    } catch (error: unknown) {
      const raced = this.ctx.agents.get(id)
      if (handle === undefined && raced !== undefined) {
        await this.prepareParent(raced, workspaceId, cwd, path, read, true)
        return raced
      }
      if (handle !== undefined) await handle.dispose()
      if (stored === undefined) await this.ctx.sessionPersistence.delete(id)
      throw error
    }
  }

  /** Validate and expose one live file parent without claiming its teardown capability. */
  private async prepareParent(
    agent: Agent,
    workspaceId: ReturnType<typeof WorkspaceId>,
    cwd: string,
    path: string,
    read: ReadTextResponse,
    borrowed: boolean,
  ): Promise<void> {
    if (agent.session.header.cwd !== cwd) {
      throw new Error(`file parent session "${agent.id}" belongs to another workspace`)
    }
    const title = fileSessionTitle(cwd, path)
    if (this.ctx.sessionTitle.get(agent.session)?.title !== title) {
      this.ctx.sessionTitle.rename(agent.session, title)
    }
    const workspace = this.ctx.workspaceRegistry.get(workspaceId)
    if (workspace === undefined) throw badRequest(`workspace not found: ${workspaceId}`)
    await workspace.attachSession(agent.id)
    await this.ctx.workspaceRegistry.unarchiveSession(agent.id)
    if (visibleDocumentContextCount(agent.session.deriveMessages()) > 0) return
    if (!borrowed) {
      await this.activateParent(agent, read)
      return
    }
    const disposeActivation = this.installParentActivation(agent.ctx)
    try {
      await this.activateParent(agent, read)
    } finally {
      disposeActivation()
    }
  }

  /** Store the first cached file snapshot in an Agent-owned turn without invoking a model. */
  private async activateParent(agent: AgentHandle['agent'], read: ReadTextResponse): Promise<void> {
    if (visibleDocumentContextCount(agent.session.deriveMessages()) > 0) return
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: documentContext(read) }],
      source: { kind: 'plugin', plugin: FILE_ROOT_PLUGIN },
    }))
    await agent.whenIdle()
    if (visibleDocumentContextCount(agent.session.deriveMessages()) !== 1) {
      throw new Error(`file parent session "${agent.id}" did not record its file context`)
    }
    await this.ctx.sessions.flush(agent.session)
  }
}

/**
 * The file-workbench backend: absolute-path filesystem operations plus the
 * latest text snapshots already delivered to this browser-facing service.
 * Retained so the invariant companion and tests can address the same rules the
 * channel uses.
 */
export class FileWorkbench {
  private readonly textSnapshots = new Map<string, ReadTextResponse>()

  /**
   * Build one listing entry for a directory child.
   * @param parent - absolute parent directory.
   * @param dirent - the child's name and kind.
   * @returns the entry.
   */
  private entryOf(parent: string, name: string, kind: 'directory' | 'file'): FileWorkbenchEntry {
    return { name, path: join(parent, name), kind, editable: kind === 'file' && isEditable(name) }
  }

  /**
   * List one directory level: directories first, then files, name-sorted.
   * @param path - absolute directory path.
   * @returns the directory's direct children.
   */
  async listDir(path: string): Promise<ListDirResponse> {
    const dir = requireAbsolute(path)
    let dirents
    try {
      dirents = await readdir(dir, { withFileTypes: true })
    } catch (error) {
      throw new WorkbenchError({
        ok: false,
        error: { code: 'directory-unreadable', message: `cannot list ${dir}: ${messageOf(error)}`, details: { path: dir } },
      })
    }
    const dirs: FileWorkbenchEntry[] = []
    const files: FileWorkbenchEntry[] = []
    for (const dirent of dirents) {
      /* v8 ignore start -- sockets and devices are not regular file-tree entries. */
      if (dirent.isDirectory()) dirs.push(this.entryOf(dir, dirent.name, 'directory'))
      else if (dirent.isFile()) files.push(this.entryOf(dir, dirent.name, 'file'))
      /* v8 ignore stop */
    }
    const byName = (a: FileWorkbenchEntry, b: FileWorkbenchEntry): number => a.name.localeCompare(b.name)
    dirs.sort(byName)
    files.sort(byName)
    return { path: dir, entries: [...dirs, ...files] }
  }

  /**
   * Read one editable text document.
   * @param path - absolute document path.
   * @returns the content and its freshness version.
   */
  async readText(path: string): Promise<ReadTextResponse> {
    const file = requireAbsolute(path)
    if (!isEditable(file)) throw invalidPath(file, `not an editable document: ${file}`)
    const info = await this.statFile(file)
    if (info.isDirectory()) throw invalidPath(file, `not a readable file: ${file}`)
    /* v8 ignore next -- large-file guard; exercising it needs an 8 MiB fixture, disproportionate for a unit test. */
    if (info.size > MAX_TEXT_BYTES) throw invalidPath(file, `file is too large to edit: ${file}`)
    let content: string
    try {
      content = await readFile(file, 'utf8')
    } catch (error) {
      /* v8 ignore next -- stat already proved a regular file; a read failure here is a defensive race/OS-fault path. */
      throw invalidPath(file, `cannot read ${file}: ${messageOf(error)}`)
    }
    const snapshot = {
      path: file,
      content,
      version: versionOf(info.mtimeNs, info.size),
      fileIndex: fileIndexOf(file),
      updatedAt: new Date(Number(info.mtimeNs / 1_000_000n)).toISOString(),
    }
    this.textSnapshots.set(file, snapshot)
    return snapshot
  }

  /**
   * Return the exact snapshot previously delivered to the browser after
   * verifying that its filesystem version is still current. Selection starts
   * never read the Markdown body a second time.
   * @param path - absolute document path.
   * @param expectedVersion - version returned by the preceding text read.
   * @returns the cached document snapshot used as the stable parent context.
   */
  async selectionSnapshot(path: string, expectedVersion: string): Promise<ReadTextResponse> {
    const file = requireAbsolute(path)
    const cached = this.textSnapshots.get(file)
    if (cached === undefined || cached.version !== expectedVersion) {
      throw invalidPath(file, `document snapshot is unavailable; reopen the file before asking about it: ${file}`)
    }
    const info = await this.statFile(file)
    if (versionOf(info.mtimeNs, info.size) !== expectedVersion) {
      this.textSnapshots.delete(file)
      throw invalidPath(file, `file changed since it was selected: ${file}`)
    }
    return cached
  }

  /**
   * Read one supported image as a browser-safe data URL.
   * @param path - absolute image path.
   * @returns the media type and complete data URL.
   */
  async readImage(path: string): Promise<ReadImageResponse> {
    const file = requireAbsolute(path)
    const mediaType = IMAGE_MEDIA_TYPES[extname(file).toLowerCase()]
    if (mediaType === undefined) throw invalidPath(file, `not a supported image: ${file}`)
    const info = await this.statFile(file)
    if (info.isDirectory()) throw invalidPath(file, `not a readable file: ${file}`)
    /* v8 ignore next -- large-image guard needs a 16 MiB fixture, disproportionate for a unit test. */
    if (info.size > MAX_IMAGE_BYTES) throw invalidPath(file, `image is too large to display: ${file}`)
    try {
      const data = await readFile(file)
      return { path: file, mediaType, dataUrl: `data:${mediaType};base64,${data.toString('base64')}` }
    } catch (error) {
      /* v8 ignore next -- stat already proved a regular file; a read failure here is a defensive race/OS-fault path. */
      throw invalidPath(file, `cannot read ${file}: ${messageOf(error)}`)
    }
  }

  /**
   * Overwrite one editable document, optionally guarding against a stale version.
   * @param path - absolute document path.
   * @param content - full new content.
   * @param expectedVersion - the version last read, or undefined for an unconditional write.
   * @returns the create/update operation and the file's new version.
   */
  async writeText(path: string, content: string, expectedVersion: string | undefined): Promise<WriteTextResponse> {
    const file = requireAbsolute(path)
    if (!isEditable(file)) throw invalidPath(file, `not an editable document: ${file}`)
    /* v8 ignore next -- large-content guard; exercising it needs an 8 MiB payload, disproportionate for a unit test. */
    if (Buffer.byteLength(content, 'utf8') > MAX_TEXT_BYTES) throw invalidPath(file, `content is too large to write: ${file}`)
    const existing = await this.tryStat(file)
    if (expectedVersion !== undefined) {
      if (existing === null || versionOf(existing.mtimeNs, existing.size) !== expectedVersion) {
        throw invalidPath(file, `file changed since it was read: ${file}`)
      }
    }
    if (existing?.isDirectory()) throw invalidPath(file, `not a writable file: ${file}`)
    try {
      await writeFile(file, content, 'utf8')
    } catch (error) {
      throw invalidPath(file, `cannot write ${file}: ${messageOf(error)}`)
    }
    const after = await this.statFile(file)
    const version = versionOf(after.mtimeNs, after.size)
    this.textSnapshots.set(file, {
      path: file,
      content,
      version,
      fileIndex: fileIndexOf(file),
      updatedAt: new Date(Number(after.mtimeNs / 1_000_000n)).toISOString(),
    })
    return { operation: existing === null ? 'create' : 'update', version }
  }

  /**
   * Create a new empty file or directory under a parent.
   * @param parent - absolute parent directory.
   * @param name - single path segment for the new entry.
   * @param kind - file or directory.
   * @returns the created entry.
   */
  async createEntry(parent: string, name: string, kind: 'file' | 'directory'): Promise<EntryResponse> {
    const dir = requireAbsolute(parent)
    const segment = requireSegment(name)
    const target = join(dir, segment)
    if (await this.tryStat(target) !== null) throw invalidPath(target, `already exists: ${target}`)
    try {
      if (kind === 'directory') await mkdir(target)
      else await writeFile(target, '', { flag: 'wx' })
    } catch (error) {
      throw invalidPath(target, `cannot create ${target}: ${messageOf(error)}`)
    }
    return { entry: this.entryOf(dir, segment, kind) }
  }

  /**
   * Delete a file or directory (recursively for a directory).
   * @param path - absolute path to delete.
   */
  async deleteEntry(path: string): Promise<void> {
    const target = requireAbsolute(path)
    try {
      await rm(target, { recursive: true, force: false })
      for (const cachedPath of this.textSnapshots.keys()) {
        if (cachedPath === target || cachedPath.startsWith(`${target}/`) || cachedPath.startsWith(`${target}\\`)) {
          this.textSnapshots.delete(cachedPath)
        }
      }
    } catch (error) {
      throw invalidPath(target, `cannot delete ${target}: ${messageOf(error)}`)
    }
  }

  /**
   * Copy a file or directory into a destination parent.
   * @param source - absolute source path.
   * @param destParent - absolute destination parent directory.
   * @param name - optional new basename; defaults to the source basename.
   * @returns the copied entry.
   */
  async copyEntry(source: string, destParent: string, name: string | undefined): Promise<EntryResponse> {
    const src = requireAbsolute(source)
    const parent = requireAbsolute(destParent)
    const segment = name === undefined ? basename(src) : requireSegment(name)
    const target = join(parent, segment)
    const info = await this.statFile(src)
    const parentInfo = await this.tryStat(parent)
    if (parentInfo === null || !parentInfo.isDirectory()) {
      throw invalidPath(parent, `destination is not a directory: ${parent}`)
    }
    if (info.isDirectory() && (parent === src || parent.startsWith(`${src}/`) || parent.startsWith(`${src}\\`))) {
      throw invalidPath(parent, `cannot copy a directory into itself: ${src}`)
    }
    if (await this.tryStat(target) !== null) throw invalidPath(target, `already exists: ${target}`)
    try {
      await cp(src, target, { recursive: true, errorOnExist: true, force: false })
    } catch (error) {
      /* v8 ignore next -- guards run first; a bare cp() failure past them is a defensive OS fault. */
      throw invalidPath(target, `cannot copy to ${target}: ${messageOf(error)}`)
    }
    return { entry: this.entryOf(parent, segment, info.isDirectory() ? 'directory' : 'file') }
  }

  /**
   * Rename a file or directory in place.
   * @param path - absolute path to rename.
   * @param newName - single path segment for the new name.
   * @returns the renamed entry.
   */
  async renameEntry(path: string, newName: string): Promise<EntryResponse> {
    const src = requireAbsolute(path)
    const segment = requireSegment(newName)
    const parent = dirname(src)
    const target = join(parent, segment)
    const info = await this.statFile(src)
    if (await this.tryStat(target) !== null) throw invalidPath(target, `already exists: ${target}`)
    try {
      await rename(src, target)
    } catch (error) {
      /* v8 ignore next -- guards run first; a bare rename() failure past them is a defensive OS fault. */
      throw invalidPath(target, `cannot rename to ${target}: ${messageOf(error)}`)
    }
    for (const [cachedPath, snapshot] of [...this.textSnapshots]) {
      if (cachedPath !== src && !cachedPath.startsWith(`${src}/`) && !cachedPath.startsWith(`${src}\\`)) continue
      const suffix = cachedPath.slice(src.length)
      const nextPath = `${target}${suffix}`
      this.textSnapshots.delete(cachedPath)
      this.textSnapshots.set(nextPath, {
        ...snapshot,
        path: nextPath,
        fileIndex: fileIndexOf(nextPath),
      })
    }
    return { entry: this.entryOf(parent, segment, info.isDirectory() ? 'directory' : 'file') }
  }

  /** Stat a path that must exist; an absent path is a business error. */
  private async statFile(path: string): Promise<{ mtimeNs: bigint; size: number; isDirectory: () => boolean }> {
    const info = await this.tryStat(path)
    if (info === null) throw invalidPath(path, `no such file: ${path}`)
    return info
  }

  /** Stat a path with nanosecond precision, returning null when it does not exist (other errors propagate). */
  private async tryStat(path: string): Promise<{ mtimeNs: bigint; size: number; isDirectory: () => boolean } | null> {
    try {
      const info = await stat(path, { bigint: true })
      return { mtimeNs: info.mtimeNs, size: Number(info.size), isDirectory: () => info.isDirectory() }
    } catch (error) {
      /* v8 ignore start -- a non-ENOENT stat failure (permission, IO) is a defensive OS fault. */
      if (errorCode(error) === 'ENOENT') return null
      throw invalidPath(path, `cannot access ${path}: ${messageOf(error)}`)
      /* v8 ignore stop */
    }
  }
}

/** Message text of an unknown thrown value. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Map a thrown value to the shared RPC error result. Business
 * {@link WorkbenchError}s already carry a chosen code and pass through; anything
 * else is an internal error. Exported for direct unit coverage of the
 * non-typed fault path.
 * @param error - the thrown value from a workbench operation.
 * @returns the failure branch of an RpcResult carrying a shared error code.
 */
export function toResult(error: unknown): Extract<RpcResult<never>, { ok: false }> {
  if (error instanceof WorkbenchError) return error.result
  return { ok: false, error: { code: 'internal', message: messageOf(error), details: {} } }
}

/**
 * Mount the file-workbench IO channel for the life of the plugin.
 * @param ctx - host context carrying `ctx.connection`.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const workbench = new FileWorkbench()
  const selections = new SelectionSessions(ctx, workbench)
  for (const sessionId of ctx.workspaceRegistry.archivedSessionIds) {
    if (String(sessionId).startsWith('file-workbench-')
      || String(sessionId).startsWith('file-selection-')) {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    }
  }
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(fileWorkbenchSelectionProjectionDefinition)
  })
  ctx.on('agent/pre-step', async (payload, next): Promise<PreStepDecision> => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const isSelectionChild = String(payload.agent.id).startsWith('file-selection-')
      && String(payload.agent.session.header.parentSession ?? '').startsWith(FILE_SESSION_ID_PREFIX)
    if (!isSelectionChild) return decision
    const admitted = visibleDocumentContextCount(payload.agent.session.deriveMessages())
    const incoming = decision.messages.filter(isDocumentContext).length
    if (admitted > 1 || admitted === 0 && incoming !== 1 || admitted === 1 && incoming !== 0) {
      throw new Error(
        `selection session "${payload.agent.id}" requires exactly one file context `
        + `(admitted ${admitted}, incoming ${incoming})`,
      )
    }
    return {
      kind: 'enter',
      messages: orderSelectionMessages(decision.messages),
    }
  }, { prepend: true })
  ctx.effect(() => ctx.connection.rpc.handle(
    FILE_WORKBENCH_CHANNEL,
    async (endpoint, payload): Promise<RpcResult<unknown>> => {
      try {
        switch (endpoint) {
          case FILE_WORKBENCH_ENDPOINTS.listDir:
            return { ok: true, value: await workbench.listDir(requireString(payload, 'path')) }
          case FILE_WORKBENCH_ENDPOINTS.readText:
            return { ok: true, value: await workbench.readText(requireString(payload, 'path')) }
          case FILE_WORKBENCH_ENDPOINTS.readImage:
            return { ok: true, value: await workbench.readImage(requireString(payload, 'path')) }
          case FILE_WORKBENCH_ENDPOINTS.startSelectionSession: {
            const instruction = optionalString(payload, 'instruction')
            return {
              ok: true,
              value: await selections.start({
                workspaceId: requireString(payload, 'workspaceId'),
                path: requireString(payload, 'path'),
                expectedVersion: requireString(payload, 'expectedVersion'),
                selectedText: requireString(payload, 'selectedText'),
                lineContext: requireString(payload, 'lineContext'),
                action: requireSelectionAction(payload),
                selectionId: requireString(payload, 'selectionId'),
                visibleStart: requireNonnegativeInteger(payload, 'visibleStart'),
                occurrence: requireNonnegativeInteger(payload, 'occurrence'),
                sourceStart: requireNonnegativeInteger(payload, 'sourceStart'),
                sourceEnd: requireNonnegativeInteger(payload, 'sourceEnd'),
                colorIndex: requireNonnegativeInteger(payload, 'colorIndex'),
                ...instruction === undefined ? {} : { instruction },
              }),
            }
          }
          case FILE_WORKBENCH_ENDPOINTS.deleteSelectionSession:
            return {
              ok: true,
              value: {
                deleted: await selections.delete({
                  workspaceId: requireString(payload, 'workspaceId'),
                  path: requireString(payload, 'path'),
                  sessionId: requireString(payload, 'sessionId'),
                }),
              },
            }
          case FILE_WORKBENCH_ENDPOINTS.writeText:
            return {
              ok: true,
              value: await workbench.writeText(
                requireString(payload, 'path'),
                requireString(payload, 'content'),
                optionalString(payload, 'expectedVersion'),
              ),
            }
          case FILE_WORKBENCH_ENDPOINTS.createEntry:
            return {
              ok: true,
              value: await workbench.createEntry(
                requireString(payload, 'parent'),
                requireString(payload, 'name'),
                requireKind(payload),
              ),
            }
          case FILE_WORKBENCH_ENDPOINTS.deleteEntry: {
            await workbench.deleteEntry(requireString(payload, 'path'))
            return { ok: true, value: { deleted: true } }
          }
          case FILE_WORKBENCH_ENDPOINTS.copyEntry:
            return {
              ok: true,
              value: await workbench.copyEntry(
                requireString(payload, 'source'),
                requireString(payload, 'destParent'),
                optionalString(payload, 'name'),
              ),
            }
          case FILE_WORKBENCH_ENDPOINTS.renameEntry:
            return {
              ok: true,
              value: await workbench.renameEntry(requireString(payload, 'path'), requireString(payload, 'newName')),
            }
          default:
            return { ok: false, error: { code: 'bad-request', message: `unknown endpoint: ${endpoint}`, details: { issues: [] } } }
        }
      } catch (error) {
        return toResult(error)
      }
    },
    { authority: config.authority },
  ), `${name}: ${FILE_WORKBENCH_CHANNEL} channel`)
}

/** Validate the `kind` field of a createEntry payload. */
function requireKind(payload: unknown): 'file' | 'directory' {
  const value = requireString(payload, 'kind')
  if (value !== 'file' && value !== 'directory') {
    throw badRequest('field "kind" must be "file" or "directory"')
  }
  return value
}
