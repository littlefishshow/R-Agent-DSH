/**
 * Durable browser-restoration projection for one File Workbench selection
 * child. The selection metadata rides the child's existing hidden opening
 * instruction source, so restoring UI state adds no model-visible message.
 * @module @deepseek-ai/dsh-host-fileworkbench-io/selection-projection
 */

import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

/** Persisted selection facts needed to rebuild one highlight and sub-window. */
export interface FileWorkbenchSelectionProjection {
  /** Browser-generated identity shared by the highlight and sub-window. */
  readonly id: string
  /** Workspace registration that owns the source document. */
  readonly workspaceId: string
  /** Absolute source-document path. */
  readonly path: string
  /** File version captured when the selection was created. */
  readonly fileVersion: string
  /** Readable selected Markdown, including restored TeX delimiters. */
  readonly selectedText: string
  /** Line-aligned source surrounding the selection. */
  readonly lineContext: string
  /** Operation represented by this child. */
  readonly action: 'modify' | 'ask' | 'explain' | 'summarize'
  /** Start offset in the rendered readable-text projection. */
  readonly visibleStart: number
  /** Selected occurrence of the readable text, zero-based. */
  readonly occurrence: number
  /** Start offset of the line-aligned Markdown source range. */
  readonly sourceStart: number
  /** End offset of the line-aligned Markdown source range. */
  readonly sourceEnd: number
  /** Stable color assignment for the highlight and window. */
  readonly colorIndex: number
  /** Child Session title. */
  readonly title: string
  /** Last inherited event seq; File Workbench children currently inherit none. */
  readonly branchStartSeq: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    fileWorkbenchSelection: FileWorkbenchSelectionProjection | null
  }

  interface SessionProjectionStateMap {
    fileWorkbenchSelection: FileWorkbenchSelectionProjection | null
  }
}

/** Field name attached to the existing hidden opening-instruction source. */
export const FILE_WORKBENCH_SELECTION_SOURCE_FIELD = 'fileWorkbenchSelection'

/** Validation shared by restored projection state and wire output. */
export const fileWorkbenchSelectionSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  path: z.string().min(1),
  fileVersion: z.string().min(1),
  selectedText: z.string().min(1),
  lineContext: z.string(),
  action: z.enum(['modify', 'ask', 'explain', 'summarize']),
  visibleStart: z.number().int().nonnegative(),
  occurrence: z.number().int().nonnegative(),
  sourceStart: z.number().int().nonnegative(),
  sourceEnd: z.number().int().nonnegative(),
  colorIndex: z.number().int().nonnegative(),
  title: z.string().min(1),
  branchStartSeq: z.number().int().min(-1),
}).strict()

/** Read valid File Workbench selection metadata from one user message. */
function selectionFromMessage(message: UserMessage): FileWorkbenchSelectionProjection | undefined {
  const source = message.source
  if (source.kind !== 'plugin' || source.plugin !== 'host-fileworkbench-io:selection-prompt') return undefined
  const candidate = (source as unknown as Record<string, unknown>)[FILE_WORKBENCH_SELECTION_SOURCE_FIELD]
  const parsed = fileWorkbenchSelectionSchema.safeParse(candidate)
  return parsed.success ? parsed.data : undefined
}

/** Latest File Workbench selection metadata carried by a child Session. */
export const fileWorkbenchSelectionProjectionDefinition = {
  key: 'fileWorkbenchSelection',
  stateVersion: 1,
  stateSchema: fileWorkbenchSelectionSchema.nullable(),
  init: () => null,
  apply: (state, event) => {
    if (event.type !== 'user/message') return state
    return selectionFromMessage(event.data) ?? state
  },
  wire: {
    viewSchema: fileWorkbenchSelectionSchema.nullable(),
    view: state => state,
  },
} satisfies ProjectionDefinition<
  'fileWorkbenchSelection',
  FileWorkbenchSelectionProjection | null
>
