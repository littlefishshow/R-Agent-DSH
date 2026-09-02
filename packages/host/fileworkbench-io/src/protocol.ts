/**
 * Wire contract for the file-workbench IO channel: the logical channel path,
 * its endpoint names, and the request/response payloads each endpoint carries.
 *
 * The browser half of the file workbench cannot import this host package, so it
 * mirrors these payload types in its own module. This module is the source of
 * truth; the mirror must match it. Paths on the wire are ABSOLUTE host
 * filesystem paths — the file workspace lets the operator add arbitrary
 * folders, so the backend is not confined to one workspace root and validates
 * each path as absolute instead.
 * @module @deepseek-ai/dsh-host-fileworkbench-io/protocol
 */

/** Absolute logical channel this backend mounts on the Connection transport. */
export const FILE_WORKBENCH_CHANNEL = '/rpc-fileworkbench'

/** File-workbench endpoint names (channel-relative). */
export const FILE_WORKBENCH_ENDPOINTS = {
  /** List one directory level (child directories and files). */
  listDir: 'listDir',
  /** Read one text document's full content plus its freshness version. */
  readText: 'readText',
  /** Read one supported image as a browser-safe data URL. */
  readImage: 'readImage',
  /** Create one selection child under the document's stable parent Session. */
  startSelectionSession: 'startSelectionSession',
  /** Dispose and permanently delete one selection child Session. */
  deleteSelectionSession: 'deleteSelectionSession',
  /** Overwrite one text document, optionally guarded by an expected version. */
  writeText: 'writeText',
  /** Create a new empty file or directory under a parent. */
  createEntry: 'createEntry',
  /** Delete a file or directory (recursively for a directory). */
  deleteEntry: 'deleteEntry',
  /** Copy a file or directory into a destination parent. */
  copyEntry: 'copyEntry',
  /** Rename a file or directory in place. */
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
  /** Whether this file is an editable text document (Markdown or plain text). */
  editable: boolean
}

/** `listDir` request: the absolute directory to list one level of. */
export interface ListDirRequest {
  /** Absolute host directory path. */
  path: string
}

/** `listDir` response: the listed directory's direct children (directories first, then files, name-sorted). */
export interface ListDirResponse {
  /** Absolute path echoed back. */
  path: string
  /** Direct children of the directory. */
  entries: FileWorkbenchEntry[]
}

/** `readText` request: the absolute document to read. */
export interface ReadTextRequest {
  /** Absolute host document path. */
  path: string
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

/** `startSelectionSession` request. */
export interface StartSelectionSessionRequest {
  /** Workspace that owns the selected file and both resulting Sessions. */
  workspaceId: string
  /** Absolute document path. */
  path: string
  /** Version observed when the browser rendered the selection. */
  expectedVersion: string
  /** Exact selected visible text. */
  selectedText: string
  /** Source lines surrounding the selection. */
  lineContext: string
  /** Operation requested for this selection. */
  action: SelectionAction
  /** Required human question for ask, or requested edit for modify. */
  instruction?: string
}

/** `startSelectionSession` response. */
export interface StartSelectionSessionResponse {
  /** Stable parent Session for this file. */
  fileSessionId: string
  /** Independent child Session for this selection. */
  sessionId: string
  /** Last event hidden before the child-local branch; `-1` when the child inherits no events. */
  branchStartSeq: number
  /** Display title derived from the operator's first instruction. */
  title: string
}

/** `deleteSelectionSession` request. */
export interface DeleteSelectionSessionRequest {
  /** Workspace that owns the child membership. */
  workspaceId: string
  /** Absolute source document path used to verify lineage. */
  path: string
  /** Selection child Session to delete. */
  sessionId: string
}

/** `readImage` request: the absolute image path to read. */
export interface ReadImageRequest {
  /** Absolute host image path. */
  path: string
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

/** `writeText` request: the document, its new content, and an optional freshness guard. */
export interface WriteTextRequest {
  /** Absolute host document path. */
  path: string
  /** Full new file content. */
  content: string
  /**
   * The version last read; when present the write is refused with a stale
   * error if the file has since changed. Omit to overwrite unconditionally.
   */
  expectedVersion?: string
}

/** `writeText` response: whether a file was created or updated, and its new version. */
export interface WriteTextResponse {
  /** Whether the write created a new file or replaced an existing one. */
  operation: 'create' | 'update'
  /** Opaque version of the file after the write. */
  version: string
}

/** `createEntry` request: a new empty file or directory under a parent. */
export interface CreateEntryRequest {
  /** Absolute host parent directory path. */
  parent: string
  /** Single non-blank path segment for the new entry. */
  name: string
  /** Whether to create a file or a directory. */
  kind: 'file' | 'directory'
}

/** `deleteEntry` request: remove a file or directory (recursively). */
export interface DeleteEntryRequest {
  /** Absolute host path to delete. */
  path: string
}

/** `copyEntry` request: copy a file or directory into a destination parent. */
export interface CopyEntryRequest {
  /** Absolute host source path. */
  source: string
  /** Absolute host destination parent directory path. */
  destParent: string
  /** Optional new basename at the destination; defaults to the source basename. */
  name?: string
}

/** `renameEntry` request: rename a file or directory in place. */
export interface RenameEntryRequest {
  /** Absolute host path to rename. */
  path: string
  /** Single non-blank path segment for the new name. */
  newName: string
}

/** `createEntry` / `copyEntry` / `renameEntry` response: the resulting entry. */
export interface EntryResponse {
  /** The resulting entry after the operation. */
  entry: FileWorkbenchEntry
}
