/**
 * ui-file-workspace contracts. Three registrations share this package and one
 * view store:
 *
 * - FileWorkspacePanel fills the workbench frame's `workbench` center slot with
 *   the Markdown reader/editor and text-selection menu.
 * - FileSidebar fills `sidebar.workspaces.overlay` only in Files mode, where it
 *   projects the standard Workspace list as lazy filesystem trees.
 * - SubWindows fills the frame's `shell.overlay` layer: the floating modify/ask
 *   sub-windows, each a dsh child session with a chat and the shared complete
 *   trajectory renderer.
 * - ModeToggle fills the sidebar's `sidebar.footer.action` seat: the Chat/Files
 *   switch that drives `ctx.workbenchLayout`.
 *
 * The panel and overlay are root-scoped (not bound to the current session) and
 * share this package's view store. The injected face carries the host actions
 * each surface drives: file IO on absolute paths, Workspace registration
 * through the native picker, and child-session lifecycle.
 */
import type { ReactNode } from 'react'
import type { SessionId, WorkspaceId, WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, PropsHooks, PropsLocale, PropsRuntime, PropsStore,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pull the workbench frame's `workbench` SlotMap row, the base
// `shell.overlay` row, and the sidebar `sidebar.footer.action` row into programs
// resolving the runtime shares below.
import type {} from '../../layout/index.ts'
import type { WorkbenchMode } from '../../layout/index.ts'
import type {} from '../../sidebar/index.ts'
import type {
  EntryResponse, FileWorkbenchEntry, ReadTextResponse, WriteTextResponse,
} from '../protocol.ts'
import type { RestorableSelection, SelectionAction } from '../stores.ts'
import type { createFileWorkspaceStore } from '../stores.ts'
import type { ChildSessionViewsSnapshot } from '../child-session-views.ts'

/** The child-session facts a sub-window reads to render its conversation and trajectory. */
export interface ChildSessionView {
  /** Ordered durable conversation nodes from the child Session log. */
  messages: {
    role: 'user' | 'assistant' | 'context' | 'tool'
    text: string
    seq: number
    /** Present only for the transient assistant partial. */
    streaming?: boolean
  }[]
  /** Whether the child turn is running (drives the thinking indicator). */
  running: boolean
}

/** Session-list lifecycle plus every currently restorable selection child. */
export interface RestorableSelectionsSnapshot {
  /** The list must be ready before an absent child can be treated as deleted. */
  phase: 'pending' | 'ready'
  /** Current children carrying File Workbench selection metadata. */
  items: readonly RestorableSelection[]
}

/** File and folder actions the panel and its sub-windows drive (arrives via the register inject factory). */
export interface FileWorkspaceInjected {
  hooks: {
    /** Compact live projections of watched child sessions, keyed by Session id. */
    childViews: HostObservable<ChildSessionViewsSnapshot>
    /** Current center mode; directory trees load only while Files is active. */
    mode: HostObservable<WorkbenchMode>
    /** Live durable selection children used to rebuild highlights after reload. */
    restorableSelections: HostObservable<RestorableSelectionsSnapshot>
  }
  /** List one absolute directory level. */
  listDir: (path: string) => Promise<FileWorkbenchEntry[]>
  /** Read one document. */
  readText: (path: string) => Promise<ReadTextResponse>
  /** Read one supported image as a browser-safe data URL. */
  readImage: (path: string) => Promise<import('../protocol.ts').ReadImageResponse>
  /** Overwrite one document, guarding against a stale version. */
  writeText: (path: string, content: string, expectedVersion: string) => Promise<WriteTextResponse>
  /** Create a new empty file or directory under an absolute parent. */
  createEntry: (parent: string, name: string, kind: 'file' | 'directory') => Promise<EntryResponse>
  /** Delete a file or directory at an absolute path. */
  deleteEntry: (path: string) => Promise<void>
  /** Copy a file or directory into an absolute destination parent. */
  copyEntry: (source: string, destParent: string, name?: string) => Promise<EntryResponse>
  /** Rename a file or directory in place. */
  renameEntry: (path: string, newName: string) => Promise<EntryResponse>
  /** Open the Host's native directory picker. */
  pickDirectory: () => Promise<string | null>
  /** Register a picked path in the shared Workspace list. */
  createWorkspace: (path: string) => Promise<WorkspaceView>
  /** Remove a Workspace registration without deleting its directory. */
  removeWorkspace: (workspaceId: WorkspaceId) => Promise<void>
  /** Start one selection child beneath the document's stable file Session. */
  startSelectionSession: (input: {
    workspaceId: string
    path: string
    fileVersion: string
    selectedText: string
    lineContext: string
    action: SelectionAction
    instruction?: string
    selectionId: string
    visibleStart: number
    occurrence: number
    sourceStart: number
    sourceEnd: number
    colorIndex: number
  }) => Promise<{ sessionId: SessionId; branchStartSeq: number; title: string }>
  /** Permanently remove one selection child and its durable context. */
  deleteSelectionSession: (input: {
    workspaceId: string
    path: string
    sessionId: SessionId
  }) => Promise<void>
  /** Send a follow-up into an existing child session. */
  sendFollowUp: (sessionId: SessionId, text: string) => Promise<void>
  /** Stop the active child turn. */
  stopChildSession: (sessionId: SessionId) => Promise<void>
  /**
   * Retain the live child-session projection while its window record exists.
   * @returns an idempotent disposer that releases the projection.
   */
  watchChildSession: (sessionId: SessionId) => () => void
  /**
   * Render the full native trajectory for a child Session.
   * @param sessionId - child Session to resolve.
   * @returns the shared trajectory view, or null before the child is addressable.
   */
  renderChildTrajectory: (sessionId: SessionId) => ReactNode
}

/** Full file-panel props: workbench owner share + view store + injected actions + locale seat. */
export type FileWorkspacePanelProps =
  PropsRuntime<'workbench'>
  & PropsStore<ReturnType<typeof createFileWorkspaceStore>>
  & Omit<FileWorkspaceInjected, 'hooks'>
  & PropsHooks<FileWorkspaceInjected['hooks']>
  & PropsLocale<'fileWorkspace'>

/** Full Files-mode sidebar props. */
export type FileSidebarProps =
  PropsRuntime<'sidebar.workspaces.overlay'>
  & PropsStore<ReturnType<typeof createFileWorkspaceStore>>
  & Omit<FileWorkspaceInjected, 'hooks'>
  & PropsHooks<FileWorkspaceInjected['hooks']>
  & PropsLocale<'fileWorkspace'>

/** Full sub-windows props: overlay list-entry runtime share + view store + injected actions + locale seat. */
export type SubWindowsProps =
  PropsRuntime<'shell.overlay'>
  & PropsStore<ReturnType<typeof createFileWorkspaceStore>>
  & Omit<FileWorkspaceInjected, 'hooks'>
  & PropsHooks<FileWorkspaceInjected['hooks']>
  & PropsLocale<'fileWorkspace'>
