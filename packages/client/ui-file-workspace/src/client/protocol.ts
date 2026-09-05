/**
 * Browser-side mirror of the file-workbench IO wire contract. The host backend
 * (`@deepseek-ai/dsh-host-fileworkbench-io`) owns the source of truth in its
 * own `protocol` module; the browser cannot import a host package, so these
 * payload types are duplicated here and must match it. Paths are ABSOLUTE host
 * paths — the file workspace opens arbitrary folders the operator picks.
 */

/** Absolute logical channel the file-workbench backend mounts. */
export const FILE_WORKBENCH_CHANNEL = '/rpc-fileworkbench'

/** File-workbench endpoint names (channel-relative). */
export const FILE_WORKBENCH_ENDPOINTS = {
  listDir: 'listDir',
  readText: 'readText',
  readImage: 'readImage',
  startSelectionSession: 'startSelectionSession',
  deleteSelectionSession: 'deleteSelectionSession',
  writeText: 'writeText',
  createEntry: 'createEntry',
  deleteEntry: 'deleteEntry',
  copyEntry: 'copyEntry',
  renameEntry: 'renameEntry',
} as const

/** One direct child of a listed directory. */
export interface FileWorkbenchEntry {
  /** Basename within the parent directory. */
  name: string
  /** Absolute host path of this entry. */
  path: string
  /** Whether this entry is a directory or a file. */
  kind: 'directory' | 'file'
  /** Whether this file is a supported UTF-8 text document. */
  editable: boolean
}

/** `listDir` response: direct children, directories first and name-sorted. */
export interface ListDirResponse {
  /** Absolute path echoed back. */
  path: string
  /** Direct children of the directory. */
  entries: FileWorkbenchEntry[]
}

/** `readText` response: the document's content and its current freshness version. */
export interface ReadTextResponse {
  /** Absolute path echoed back. */
  path: string
  /** Full decoded UTF-8 content. */
  content: string
  /** Opaque freshness token, passed back to `writeText` to guard against a stale overwrite. */
  version: string
  /** Stable document index used in model-facing file context. */
  fileIndex: string
  /** ISO-8601 last-modified time used in model-facing file context. */
  updatedAt: string
}

/** Selection action supported by the file workbench. */
export type SelectionAction = 'modify' | 'ask' | 'explain' | 'summarize'

/** Durable child projection used to restore its highlight and sub-window. */
export interface FileWorkbenchSelectionProjection {
  id: string
  workspaceId: string
  path: string
  fileVersion: string
  selectedText: string
  lineContext: string
  action: SelectionAction
  visibleStart: number
  occurrence: number
  sourceStart: number
  sourceEnd: number
  colorIndex: number
  title: string
  branchStartSeq: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    fileWorkbenchSelection: FileWorkbenchSelectionProjection | null
  }
}

/** `startSelectionSession` request. */
export interface StartSelectionSessionRequest {
  workspaceId: string
  path: string
  expectedVersion: string
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
}

/** `startSelectionSession` response. */
export interface StartSelectionSessionResponse {
  fileSessionId: string
  sessionId: string
  /** Last event hidden before the child-local branch; `-1` when the child inherits no events. */
  branchStartSeq: number
  title: string
}

/** `deleteSelectionSession` request. */
export interface DeleteSelectionSessionRequest {
  workspaceId: string
  path: string
  sessionId: string
}

/** `readImage` response: a browser-safe data URL and its media type. */
export interface ReadImageResponse {
  /** Absolute path echoed back. */
  path: string
  /** Supported raster image media type. */
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif'
  /** Complete base64 data URL suitable for an image src. */
  dataUrl: string
}

/** `writeText` response: whether a file was created or updated, and its new version. */
export interface WriteTextResponse {
  /** Whether the write created a new file or replaced an existing one. */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  version: string
}

/** `createEntry` / `copyEntry` / `renameEntry` response: the resulting entry. */
export interface EntryResponse {
  /** The resulting entry after the operation. */
  entry: FileWorkbenchEntry
}
