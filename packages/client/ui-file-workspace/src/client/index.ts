/**
 * File-workspace plugin, browser half. It wires the file panel, the selection
 * sub-windows, and the sidebar Chat/Files toggle to their backends:
 *
 * - File and folder IO ride the file-workbench Connection RPC channel on
 *   absolute paths (`ctx.connection.rpc`).
 * - Files mode projects the standard Workspace list as filesystem roots.
 *   Adding uses the Host's native picker followed by `ctx.workspaces.create`;
 *   removing drops the Workspace registration without deleting its directory.
 * - The Host keeps one stable parent Session per Workspace-owned file and
 *   forks every selected passage beneath it. Ask/modify wait for explicit
 *   human input; explain/summarize start immediately. Compaction, durable
 *   history, lineage, deletion, and trajectory stay under the native Session
 *   model.
 * - The sidebar toggle drives `ctx.workbenchLayout` so choosing Files swaps the
 *   center column to this panel.
 *
 * The panel and overlay share one apply-constructed view store (root scope).
 */
import type {
  ClientContext, SessionId, SessionRuntime, SessionSummary,
} from '@deepseek-ai/dsh-client-runtime/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { IWorkbenchLayout } from '@deepseek-ai/dsh-client-ui-layout-workbench/client'
import type { IWorkspacePresentation } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-trajectory/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pull the workbench `workbench` slot, the base `shell.overlay`, and
// the sidebar `sidebar.footer.action` slot declarations into this program.
import type {} from '@deepseek-ai/dsh-client-ui-layout-workbench/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { createFileWorkspaceStore } from './stores.ts'
import { createFileWorkbenchIo } from './io.ts'
import { ChildSessionViews } from './child-session-views.ts'
import { FileWorkspacePanel } from './FileWorkspacePanel.tsx'
import { FileSidebar } from './FileSidebar.tsx'
import { SubWindows } from './SubWindows.tsx'
import { ModeToggle } from './ModeToggle.tsx'
import { en, NS, zh } from './locales.ts'
import type {
  FileWorkspaceInjected, RestorableSelectionsSnapshot,
} from './contract/slots.ts'
import type { FileWorkbenchSelectionProjection } from './protocol.ts'
import type { RestorableSelection } from './stores.ts'

export type { ChildSessionView } from './contract/slots.ts'

/** Required services (cordis fiber inject). */
export const inject = [
  'slots', 'sessions', 'workspaces', 'connection', 'workbenchLayout', 'workspacePresentation',
  'trajectoryPresentation', 'locale',
]

/** Read a File Workbench selection projection from one Session-list row. */
function restorableSelection(summary: SessionSummary): RestorableSelection | undefined {
  const projection: FileWorkbenchSelectionProjection | null | undefined
    = summary.projectionValues?.fileWorkbenchSelection
  return projection === undefined || projection === null
    ? undefined
    : { ...projection, sessionId: summary.id }
}

/**
 * Project the Session-list baseline into live File Workbench child metadata.
 * @param snapshot - current Session-list snapshot.
 * @returns list lifecycle plus every child carrying restoration metadata.
 */
export function restorableSelections(
  snapshot: ReturnType<SessionRuntime['list']['getSnapshot']>,
): RestorableSelectionsSnapshot {
  return {
    phase: snapshot.phase,
    items: snapshot.ids.flatMap((id) => {
      const summary = snapshot.byId[id]
      if (summary === undefined) return []
      const selection = restorableSelection(summary)
      return selection === undefined ? [] : [selection]
    }),
  }
}

/**
 * Client plugin body: build the shared store and IO caller, assemble the
 * injected face, and register the panel, sub-windows, and sidebar toggle.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-file-workspace: dictionaries')

  const connection = ctx.get('connection') as ConnectionHandle
  const workbenchLayout = ctx.get('workbenchLayout') as IWorkbenchLayout
  const workspacePresentation = ctx.get('workspacePresentation') as IWorkspacePresentation
  ctx.effect(
    () => workspacePresentation.retainForkLineage(),
    'ui-file-workspace: grouped child-session lineage',
  )
  const io = createFileWorkbenchIo(connection.rpc)
  const trajectoryPresentation = ctx.trajectoryPresentation
  // The concrete runtime exposes refresh()/binding(); the narrower injected
  // ISessions face omits host-refresh control used after plugin RPC mutations.
  const sessions = ctx.sessions as SessionRuntime
  const childViews = new ChildSessionViews(sessions)
  const restoredSelections = createSnapshotStore(restorableSelections(sessions.list.getSnapshot()))
  ctx.effect(() => {
    const project = (): void => { restoredSelections.set(restorableSelections(sessions.list.getSnapshot())) }
    return sessions.list.subscribe(project)
  }, 'ui-file-workspace: durable selection projection')

  // One shared handle under the panel and overlay (both root scope), so the
  // renderer supplies one framework-owned instance to both entries.
  const store = createFileWorkspaceStore()

  const injected: FileWorkspaceInjected = {
    hooks: {
      childViews: childViews.store,
      mode: workbenchLayout.mode,
      restorableSelections: restoredSelections,
    },
    listDir: async path => (await io.listDir(path)).entries,
    readText: path => io.readText(path),
    readImage: path => io.readImage(path),
    writeText: (path, content, expectedVersion) => io.writeText(path, content, expectedVersion),
    createEntry: (parent, name, kind) => io.createEntry(parent, name, kind),
    deleteEntry: path => io.deleteEntry(path),
    copyEntry: (source, destParent, name) => io.copyEntry(source, destParent, name),
    renameEntry: (path, newName) => io.renameEntry(path, newName),
    pickDirectory: () => ctx.workspaces.pickDirectory(),
    createWorkspace: path => ctx.workspaces.create({ path }),
    removeWorkspace: workspaceId => ctx.workspaces.delete(workspaceId),
    startSelectionSession: async (input) => {
      const result = await io.startSelectionSession({
        workspaceId: input.workspaceId,
        path: input.path,
        expectedVersion: input.fileVersion,
        selectedText: input.selectedText,
        lineContext: input.lineContext,
        action: input.action,
        selectionId: input.selectionId,
        visibleStart: input.visibleStart,
        occurrence: input.occurrence,
        sourceStart: input.sourceStart,
        sourceEnd: input.sourceEnd,
        colorIndex: input.colorIndex,
        ...input.instruction === undefined ? {} : { instruction: input.instruction },
      })
      await sessions.refresh().catch(() => {})
      return {
        sessionId: result.sessionId as SessionId,
        branchStartSeq: result.branchStartSeq,
        title: result.title,
      }
    },
    deleteSelectionSession: async (input) => {
      await io.deleteSelectionSession({
        workspaceId: input.workspaceId,
        path: input.path,
        sessionId: input.sessionId,
      })
      await sessions.refresh()
    },
    sendFollowUp: async (sessionId, text) => {
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) return
      const result = await session.prompt([{ type: 'text', text }], 'queue')
      if (!result.ok) throw new Error(result.error.message)
    },
    stopChildSession: async (sessionId) => {
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) return
      const result = await session.cancel()
      if (!result.ok) throw new Error(result.error.message)
    },
    watchChildSession: sessionId => childViews.watch(sessionId),
    renderChildTrajectory: (sessionId) => {
      const session = sessions.binding(sessionId)?.session
      if (session === undefined) return null
      return trajectoryPresentation.render({
        session,
        loadOlder: async () => {
          const before = session.getSnapshot().views.get('trajectory')
          await session.loadOlder()
          return session.getSnapshot().views.get('trajectory') !== before
        },
      })
    },
  }

  ctx.slots.inject('workbench', () => ctx.slots.register(
    { name: 'workbench', store, inject: () => injected, locale: NS },
    FileWorkspacePanel,
  ))
  ctx.slots.inject('sidebar.workspaces.overlay', () => ctx.slots.register(
    { name: 'sidebar.workspaces.overlay', store, inject: () => injected, locale: NS },
    FileSidebar,
  ))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register(
    { name: 'shell.overlay', id: 'file-workspace-windows', store, inject: () => injected, locale: NS },
    SubWindows,
  ))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register(
    {
      name: 'sidebar.footer.action',
      id: 'file-workspace-mode',
      locale: NS,
      inject: () => ({
        hooks: { mode: workbenchLayout.mode },
        setMode: workbenchLayout.setMode.bind(workbenchLayout),
      }),
    },
    ModeToggle,
  ))
  ctx.effect(
    () => ctx.on('ui-sidebar/before-start-session', () => { workbenchLayout.setMode('chat') }),
    'ui-file-workspace: New Session selects Chat mode',
  )
}
