/**
 * The workbench root entry's transient layout store: panel geometry as plain
 * widths in px (0 = closed), plus the narrow-viewport pair. The center MODE is
 * NOT here — it is owned by WorkbenchLayoutController (service.ts) because the
 * file-workspace plugin and frame share it, and it persists on its own. Module
 * level exports the factory only; register()
 * receives it and AppFrame derives its store share from the return type.
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampWidth, DETAILS_DEFAULT, DETAILS_MAX, DETAILS_MIN,
  SIDEBAR_DEFAULT, SIDEBAR_MAX, SIDEBAR_MIN,
} from './columns.ts'

/**
 * Workbench layout store state: panel width preferences in px (0 = closed) and
 * the narrow-viewport pair (mirrors AppFrame's breakpoint reading so
 * toggleSidebar picks semantics; narrowExpanded re-expands the auto-collapsed
 * sidebar).
 */
type WorkbenchLayoutState = {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

/**
 * Annotation twin of the actions literal below (the export needs a declared
 * return type); drift fails assignability at the defineStore call.
 */
type WorkbenchLayoutActions = {
  setSidebar: (draft: WorkbenchLayoutState, px: number) => void
  setDetails: (draft: WorkbenchLayoutState, px: number) => void
  toggleSidebar: (draft: WorkbenchLayoutState) => void
  setNarrow: (draft: WorkbenchLayoutState, narrow: boolean) => void
  openDetails: (draft: WorkbenchLayoutState) => void
  closeDetails: (draft: WorkbenchLayoutState) => void
}

/**
 * Create the workbench layout store handle. Panel widths are transient
 * per-instance; the center mode is not stored here (see the module doc).
 * @returns the store handle (spec + type + identity + factory in one).
 */
export function createWorkbenchLayoutStore(): EngineStoreHandle<WorkbenchLayoutState, WorkbenchLayoutActions> {
  return defineStore({
    init: (): WorkbenchLayoutState => ({
      sidebar: SIDEBAR_DEFAULT,
      details: 0,
      narrow: false,
      narrowExpanded: false,
    }),
    actions: {
      setSidebar: (d, px: number) => { d.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX) },
      setDetails: (d, px: number) => { d.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX) },
      toggleSidebar: (d) => {
        if (d.narrow) d.narrowExpanded = !d.narrowExpanded
        else d.sidebar = d.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      setNarrow: (d, narrow: boolean) => {
        if (d.narrow === narrow) return
        d.narrow = narrow
        d.narrowExpanded = false
      },
      openDetails: (d) => { if (d.details === 0) d.details = DETAILS_DEFAULT },
      closeDetails: (d) => { d.details = 0 },
    },
  })
}

/** The center-column mode: the conversation, or the file workspace. */
export type WorkbenchMode = 'chat' | 'files'
