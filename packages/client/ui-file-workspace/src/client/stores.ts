/**
 * The file-workspace view store: transient view state the panel and its
 * sub-windows re-render from, held as plain serializable data (the object-layer
 * rule keeps live Session instances OUT — those resolve through
 * `ctx.sessions.binding` in the component). It holds expanded directories and
 * their lazily-loaded children, the open document tabs, and
 * the selection highlights and sub-window records. Workspace roots are not
 * copied here: the standard `useWorkspaces` hook is their authority.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { FileWorkbenchEntry, FileWorkbenchSelectionProjection } from './protocol.ts'
import { isSameOrDescendant, rewritePathPrefix } from './path.ts'

/** The selection action a sub-window carries out over the selected text. */
export type SelectionAction = 'modify' | 'ask' | 'explain' | 'summarize'

/** A highlight painted over selected source text, linking it to a sub-window. */
export interface HighlightRecord {
  /** Stable highlight id (also the sub-window key once an action is chosen). */
  id: string
  /** Absolute document path the highlight belongs to. */
  path: string
  /** Readable Markdown for the selected text; formulas retain TeX delimiters. */
  text: string
  /** Exact start offset in the rendered document's readable-text projection. */
  visibleStart: number
  /** Which occurrence of the text in the document was selected (0-based). */
  occurrence: number
  /** Line-aligned source range the selection expanded to. */
  sourceStart: number
  sourceEnd: number
  /** A hue index used to color the highlight and its sub-window consistently. */
  colorIndex: number
}

/** A floating sub-window bound to one selection highlight and its child session. */
export interface SubWindowRecord {
  /** Same id as the highlight it is bound to. */
  id: string
  /** The dsh child session backing this sub-window's conversation, once created. */
  sessionId: SessionId | undefined
  /** Child creation/prompt failure shown inside this window. */
  error?: string
  /** The absolute document path the selection came from. */
  path: string
  /** Shared Workspace that owns the document. */
  workspaceId: string
  /** File version observed when this selection was captured. */
  fileVersion: string
  /** The selected text (shown in the window header and re-highlight). */
  selectedText: string
  /** Display title derived from the operator's first instruction. */
  title: string
  /** Source lines surrounding the selection. */
  lineContext: string
  /** Start offset in the rendered readable-text projection. */
  visibleStart: number
  /** Selected occurrence of the readable text, zero-based. */
  occurrence: number
  /** Start offset of the line-aligned Markdown source range. */
  sourceStart: number
  /** End offset of the line-aligned Markdown source range. */
  sourceEnd: number
  /** The action this window performs. */
  action: SelectionAction
  /** Whether the window awaits first input, creates its child, or has one. */
  phase: 'draft' | 'creating' | 'ready' | 'deleting' | 'cleanup-error'
  /** Window geometry in px, relative to the frame. */
  x: number
  y: number
  width: number
  height: number
  /** True while the window fills the application area; saved geometry remains for restore. */
  fullscreen: boolean
  /** True while collapsed to the dock; the highlight stays painted. */
  minimized: boolean
  /** True when the minimized dock entry is hidden; the highlight remains the restore affordance. */
  dockHidden: boolean
  /** Last inherited event seq; the compact window renders only later branch-local messages. */
  branchStartSeq: number
  /** Which tab the window shows. */
  tab: 'chat' | 'trajectory'
  /** Stacking order; the most recently raised window has the highest value. */
  zIndex: number
  /** The hue index shared with the highlight. */
  colorIndex: number
}

/** The loaded document in the editor pane. */
export interface OpenDocument {
  /** Absolute document path. */
  path: string
  /** The last-saved content (the freshness basis for highlights and writes). */
  content: string
  /** Freshness version from the backend, passed to writeText as the stale guard. */
  version: string
  /** Shared Workspace that owns the file parent and selection child Sessions. */
  workspaceId: string
  /** Explicit renderer for non-text files; text documents infer from their path when absent. */
  previewKind?: 'markdown' | 'text' | 'image' | 'unsupported'
  /** The in-editor draft when editing; equals content when clean. */
  draft: string
  /** Whether the draft differs from the saved content. */
  dirty: boolean
  /** Preview (rendered Markdown) or edit (source textarea). */
  viewMode: 'preview' | 'edit'
}

/** One live child Session plus the durable metadata needed to restore its UI. */
export interface RestorableSelection extends FileWorkbenchSelectionProjection {
  /** Child Session carrying this projection. */
  sessionId: SessionId
}

/** File-workspace view state (all serializable; live sessions resolve elsewhere). */
interface FileWorkspaceState {
  /** Absolute paths of expanded directories (roots and sub-directories). */
  expanded: Record<string, boolean>
  /** Lazily-loaded direct children by absolute directory path. */
  entriesByPath: Record<string, FileWorkbenchEntry[]>
  /** Loaded documents keyed by absolute path. */
  documents: Record<string, OpenDocument>
  /** Open tab order, oldest to newest. */
  documentOrder: string[]
  /** Active document path, or null when no tab is open. */
  activeDocumentPath: string | null
  /** Highlights by id (across all documents; the panel filters to the open one). */
  highlights: Record<string, HighlightRecord>
  /** Sub-windows by id. */
  windows: Record<string, SubWindowRecord>
  /** Selection ids backed by a durable child projection. */
  durableSelectionIds: Record<string, true>
  /** The next z-index to assign when a window is raised. */
  topZ: number
  /** The next hue index to assign to a new selection. */
  nextColor: number
}

/** Annotation twin of the actions literal below (the export needs a declared return type). */
type FileWorkspaceActions = {
  setEntries: (draft: FileWorkspaceState, path: string, entries: FileWorkbenchEntry[]) => void
  setExpanded: (draft: FileWorkspaceState, path: string, expanded: boolean) => void
  invalidateDir: (draft: FileWorkspaceState, path: string) => void
  openDocument: (draft: FileWorkspaceState, doc: OpenDocument) => void
  activateDocument: (draft: FileWorkspaceState, path: string) => void
  closeDocument: (draft: FileWorkspaceState, path: string) => void
  closeDocumentsUnder: (draft: FileWorkspaceState, path: string) => void
  rewriteDocumentPaths: (draft: FileWorkspaceState, from: string, to: string) => void
  setDraft: (draft: FileWorkspaceState, text: string) => void
  setViewMode: (draft: FileWorkspaceState, mode: 'preview' | 'edit') => void
  markSaved: (draft: FileWorkspaceState, path: string, content: string, version: string) => void
  addHighlight: (draft: FileWorkspaceState, highlight: HighlightRecord) => void
  restoreDocument: (draft: FileWorkspaceState, doc: OpenDocument) => void
  restoreSelection: (draft: FileWorkspaceState, selection: RestorableSelection) => void
  reconcileRestorableSelections: (draft: FileWorkspaceState, sessionIds: string[]) => void
  openSelectionWindow: (draft: FileWorkspaceState, window: SubWindowRecord) => void
  attachWindowBranch: (
    draft: FileWorkspaceState,
    id: string,
    branch: { sessionId: SessionId; branchStartSeq: number; title: string },
  ) => void
  setWindowError: (draft: FileWorkspaceState, id: string, error: string) => void
  clearWindowError: (draft: FileWorkspaceState, id: string) => void
  setWindowTitle: (draft: FileWorkspaceState, id: string, title: string) => void
  setWindowPhase: (draft: FileWorkspaceState, id: string, phase: SubWindowRecord['phase']) => void
  moveWindow: (draft: FileWorkspaceState, id: string, x: number, y: number) => void
  resizeWindow: (draft: FileWorkspaceState, id: string, width: number, height: number) => void
  setWindowFullscreen: (draft: FileWorkspaceState, id: string, fullscreen: boolean) => void
  setWindowTab: (draft: FileWorkspaceState, id: string, tab: 'chat' | 'trajectory') => void
  minimizeWindow: (draft: FileWorkspaceState, id: string, minimized: boolean) => void
  hideWindowDock: (draft: FileWorkspaceState, id: string) => void
  raiseWindow: (draft: FileWorkspaceState, id: string) => void
  removeSelection: (draft: FileWorkspaceState, id: string) => void
  removeHighlight: (draft: FileWorkspaceState, id: string) => void
}

/**
 * Create the file-workspace view store handle.
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createFileWorkspaceStore(): EngineStoreHandle<FileWorkspaceState, FileWorkspaceActions> {
  return defineStore({
    init: (): FileWorkspaceState => ({
      expanded: {},
      entriesByPath: {},
      documents: {},
      documentOrder: [],
      activeDocumentPath: null,
      highlights: {},
      windows: {},
      durableSelectionIds: {},
      topZ: 1,
      nextColor: 0,
    }),
    actions: {
      setEntries: (d, path, entries) => { d.entriesByPath[path] = entries },
      setExpanded: (d, path, expanded) => { d.expanded[path] = expanded },
      invalidateDir: (d, path) => {
        const { [path]: removed, ...rest } = d.entriesByPath
        void removed
        d.entriesByPath = rest
      },
      openDocument: (d, doc) => {
        d.documents[doc.path] = doc
        if (!d.documentOrder.includes(doc.path)) d.documentOrder.push(doc.path)
        d.activeDocumentPath = doc.path
      },
      activateDocument: (d, path) => {
        if (d.documents[path] !== undefined) d.activeDocumentPath = path
      },
      closeDocument: (d, path) => {
        const index = d.documentOrder.indexOf(path)
        if (index < 0) return
        const { [path]: removed, ...documents } = d.documents
        void removed
        d.documents = documents
        d.documentOrder.splice(index, 1)
        if (d.activeDocumentPath !== path) return
        d.activeDocumentPath = d.documentOrder[Math.min(index, d.documentOrder.length - 1)] ?? null
      },
      closeDocumentsUnder: (d, path) => {
        const removed = d.documentOrder.filter(candidate => isSameOrDescendant(candidate, path))
        if (removed.length === 0) return
        const removedSet = new Set(removed)
        d.documents = Object.fromEntries(
          Object.entries(d.documents).filter(([candidate]) => !removedSet.has(candidate)),
        )
        d.documentOrder = d.documentOrder.filter(candidate => !removed.includes(candidate))
        if (d.activeDocumentPath !== null && removed.includes(d.activeDocumentPath)) {
          d.activeDocumentPath = d.documentOrder.at(-1) ?? null
        }
      },
      rewriteDocumentPaths: (d, from, to) => {
        const rewrite = (path: string): string => rewritePathPrefix(path, from, to)
        const documents: Record<string, OpenDocument> = {}
        for (const [path, document] of Object.entries(d.documents)) {
          const nextPath = rewrite(path)
          documents[nextPath] = nextPath === path ? document : { ...document, path: nextPath }
        }
        d.documents = documents
        d.documentOrder = d.documentOrder.map(rewrite)
        if (d.activeDocumentPath !== null) d.activeDocumentPath = rewrite(d.activeDocumentPath)
        for (const highlight of Object.values(d.highlights)) highlight.path = rewrite(highlight.path)
        for (const window of Object.values(d.windows)) window.path = rewrite(window.path)
      },
      setDraft: (d, text) => {
        if (d.activeDocumentPath === null) return
        const document = d.documents[d.activeDocumentPath]
        if (document === undefined) return
        document.draft = text
        document.dirty = text !== document.content
      },
      setViewMode: (d, mode) => {
        if (d.activeDocumentPath === null) return
        const document = d.documents[d.activeDocumentPath]
        if (document !== undefined) document.viewMode = mode
      },
      markSaved: (d, path, content, version) => {
        const document = d.documents[path]
        if (document === undefined) return
        document.content = content
        document.draft = content
        document.version = version
        document.dirty = false
      },
      addHighlight: (d, highlight) => {
        d.highlights[highlight.id] = highlight
        d.nextColor += 1
      },
      restoreDocument: (d, doc) => {
        if (d.documents[doc.path] !== undefined) return
        d.documents[doc.path] = doc
        d.documentOrder.push(doc.path)
        d.activeDocumentPath ??= doc.path
      },
      restoreSelection: (d, selection) => {
        d.durableSelectionIds[selection.id] = true
        d.highlights[selection.id] ??= {
          id: selection.id,
          path: selection.path,
          text: selection.selectedText,
          visibleStart: selection.visibleStart,
          occurrence: selection.occurrence,
          sourceStart: selection.sourceStart,
          sourceEnd: selection.sourceEnd,
          colorIndex: selection.colorIndex,
        }
        const current = d.windows[selection.id]
        if (current === undefined) {
          d.windows[selection.id] = {
            id: selection.id,
            sessionId: selection.sessionId,
            path: selection.path,
            workspaceId: selection.workspaceId,
            fileVersion: selection.fileVersion,
            selectedText: selection.selectedText,
            title: selection.title,
            lineContext: selection.lineContext,
            visibleStart: selection.visibleStart,
            occurrence: selection.occurrence,
            sourceStart: selection.sourceStart,
            sourceEnd: selection.sourceEnd,
            action: selection.action,
            phase: 'ready',
            x: 96,
            y: 96,
            width: 560,
            height: 620,
            fullscreen: false,
            minimized: true,
            dockHidden: false,
            branchStartSeq: selection.branchStartSeq,
            tab: 'chat',
            zIndex: d.topZ + 1,
            colorIndex: selection.colorIndex,
          }
        } else {
          current.sessionId = selection.sessionId
          current.fileVersion = selection.fileVersion
          current.title = selection.title
          current.branchStartSeq = selection.branchStartSeq
          current.phase = 'ready'
          delete current.error
        }
        d.topZ = Math.max(d.topZ, d.windows[selection.id]?.zIndex ?? d.topZ)
        d.nextColor = Math.max(d.nextColor, selection.colorIndex + 1)
      },
      reconcileRestorableSelections: (d, sessionIds) => {
        const retained = new Set(sessionIds)
        const removed = Object.keys(d.durableSelectionIds).filter((id) => {
          const sessionId = d.windows[id]?.sessionId
          return sessionId === undefined || !retained.has(sessionId)
        })
        if (removed.length === 0) return
        const removedSet = new Set(removed)
        d.durableSelectionIds = Object.fromEntries(
          Object.entries(d.durableSelectionIds).filter(([id]) => !removedSet.has(id)),
        )
        d.highlights = Object.fromEntries(
          Object.entries(d.highlights).filter(([id]) => !removedSet.has(id)),
        )
        d.windows = Object.fromEntries(
          Object.entries(d.windows).filter(([id]) => !removedSet.has(id)),
        )
      },
      openSelectionWindow: (d, window) => {
        d.windows[window.id] = { ...window, zIndex: d.topZ + 1 }
        d.topZ += 1
      },
      attachWindowBranch: (d, id, branch) => {
        const window = d.windows[id]
        if (window === undefined) return
        window.sessionId = branch.sessionId
        window.branchStartSeq = branch.branchStartSeq
        window.title = branch.title
        window.phase = 'ready'
        d.durableSelectionIds[id] = true
        delete window.error
      },
      setWindowError: (d, id, error) => {
        const window = d.windows[id]
        if (window !== undefined) window.error = error
      },
      clearWindowError: (d, id) => {
        const window = d.windows[id]
        if (window !== undefined) delete window.error
      },
      setWindowTitle: (d, id, title) => {
        const window = d.windows[id]
        if (window !== undefined) window.title = title
      },
      setWindowPhase: (d, id, phase) => {
        const window = d.windows[id]
        if (window !== undefined) window.phase = phase
      },
      moveWindow: (d, id, x, y) => {
        const window = d.windows[id]
        if (window !== undefined) { window.x = x; window.y = y }
      },
      resizeWindow: (d, id, width, height) => {
        const window = d.windows[id]
        if (window !== undefined) { window.width = width; window.height = height }
      },
      setWindowFullscreen: (d, id, fullscreen) => {
        const window = d.windows[id]
        if (window === undefined) return
        window.fullscreen = fullscreen
        window.minimized = false
        window.dockHidden = false
      },
      setWindowTab: (d, id, tab) => {
        const window = d.windows[id]
        if (window !== undefined) window.tab = tab
      },
      minimizeWindow: (d, id, minimized) => {
        const window = d.windows[id]
        if (window !== undefined) {
          window.minimized = minimized
          window.dockHidden = false
          if (minimized) window.fullscreen = false
        }
      },
      hideWindowDock: (d, id) => {
        const window = d.windows[id]
        if (window !== undefined && window.minimized) window.dockHidden = true
      },
      raiseWindow: (d, id) => {
        const window = d.windows[id]
        if (window === undefined) return
        d.topZ += 1
        window.zIndex = d.topZ
        window.minimized = false
        window.dockHidden = false
      },
      removeSelection: (d, id) => {
        const { [id]: h, ...highlights } = d.highlights
        void h
        const { [id]: w, ...windows } = d.windows
        void w
        const { [id]: durable, ...durableSelectionIds } = d.durableSelectionIds
        void durable
        d.highlights = highlights
        d.windows = windows
        d.durableSelectionIds = durableSelectionIds
      },
      removeHighlight: (d, id) => {
        const { [id]: removed, ...highlights } = d.highlights
        void removed
        d.highlights = highlights
      },
    },
  })
}
