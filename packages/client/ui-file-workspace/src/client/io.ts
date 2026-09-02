/**
 * Typed caller over the file-workbench Connection RPC channel. Each method wraps
 * `ctx.connection.rpc.call` with the endpoint name and payload, unwraps the
 * shared RpcResult, and throws its business error message on failure so the
 * panel's async handlers can `try`/`catch` one way. All paths are absolute.
 */
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import {
  FILE_WORKBENCH_CHANNEL,
  FILE_WORKBENCH_ENDPOINTS,
  type DeleteSelectionSessionRequest,
  type EntryResponse,
  type ListDirResponse,
  type ReadImageResponse,
  type ReadTextResponse,
  type StartSelectionSessionRequest,
  type StartSelectionSessionResponse,
  type WriteTextResponse,
} from './protocol.ts'

/** The file-workbench actions the panel drives, each resolving a decoded value or throwing. */
export interface FileWorkbenchIo {
  /** List one directory level (child directories and files) at an absolute path. */
  listDir(path: string, signal?: AbortSignal): Promise<ListDirResponse>
  /** Read one editable document's content and freshness version. */
  readText(path: string, signal?: AbortSignal): Promise<ReadTextResponse>
  /** Read one supported image as a browser-safe data URL. */
  readImage(path: string, signal?: AbortSignal): Promise<ReadImageResponse>
  /** Start one selection child beneath the stable file parent Session. */
  startSelectionSession(
    input: StartSelectionSessionRequest,
    signal?: AbortSignal,
  ): Promise<StartSelectionSessionResponse>
  /** Permanently remove one selection child Session. */
  deleteSelectionSession(input: DeleteSelectionSessionRequest, signal?: AbortSignal): Promise<boolean>
  /** Overwrite one editable document, optionally guarding against a stale version. */
  writeText(path: string, content: string, expectedVersion: string | undefined, signal?: AbortSignal): Promise<WriteTextResponse>
  /** Create a new empty file or directory under a parent. */
  createEntry(parent: string, name: string, kind: 'file' | 'directory', signal?: AbortSignal): Promise<EntryResponse>
  /** Delete a file or directory (recursively for a directory). */
  deleteEntry(path: string, signal?: AbortSignal): Promise<void>
  /** Copy a file or directory into a destination parent, optionally renaming. */
  copyEntry(source: string, destParent: string, name: string | undefined, signal?: AbortSignal): Promise<EntryResponse>
  /** Rename a file or directory in place. */
  renameEntry(path: string, newName: string, signal?: AbortSignal): Promise<EntryResponse>
}

/**
 * Create the file-workbench IO caller bound to a Connection RPC channel.
 * @param rpc - the generic RPC caller from `ctx.connection.rpc`.
 * @returns the typed file-workbench actions.
 */
export function createFileWorkbenchIo(rpc: ClientConnectionRpc): FileWorkbenchIo {
  const call = async <T>(endpoint: string, payload: unknown, signal?: AbortSignal): Promise<T> => {
    const result = await rpc.call(FILE_WORKBENCH_CHANNEL, endpoint, payload, signal)
    if (!result.ok) throw new Error(result.error.message)
    return result.value as T
  }
  return {
    listDir: (path, signal) => call<ListDirResponse>(FILE_WORKBENCH_ENDPOINTS.listDir, { path }, signal),
    readText: (path, signal) => call<ReadTextResponse>(FILE_WORKBENCH_ENDPOINTS.readText, { path }, signal),
    readImage: (path, signal) => call<ReadImageResponse>(FILE_WORKBENCH_ENDPOINTS.readImage, { path }, signal),
    startSelectionSession: (input, signal) => call<StartSelectionSessionResponse>(
      FILE_WORKBENCH_ENDPOINTS.startSelectionSession,
      input,
      signal,
    ),
    deleteSelectionSession: async (input, signal) => {
      const response = await call<{ deleted: boolean }>(
        FILE_WORKBENCH_ENDPOINTS.deleteSelectionSession,
        input,
        signal,
      )
      return response.deleted
    },
    writeText: (path, content, expectedVersion, signal) => call<WriteTextResponse>(
      FILE_WORKBENCH_ENDPOINTS.writeText,
      expectedVersion === undefined ? { path, content } : { path, content, expectedVersion },
      signal,
    ),
    createEntry: (parent, name, kind, signal) =>
      call<EntryResponse>(FILE_WORKBENCH_ENDPOINTS.createEntry, { parent, name, kind }, signal),
    deleteEntry: async (path, signal) => {
      await call<{ deleted: true }>(FILE_WORKBENCH_ENDPOINTS.deleteEntry, { path }, signal)
    },
    copyEntry: (source, destParent, name, signal) => call<EntryResponse>(
      FILE_WORKBENCH_ENDPOINTS.copyEntry,
      name === undefined ? { source, destParent } : { source, destParent, name },
      signal,
    ),
    renameEntry: (path, newName, signal) =>
      call<EntryResponse>(FILE_WORKBENCH_ENDPOINTS.renameEntry, { path, newName }, signal),
  }
}
