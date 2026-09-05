/**
 * WorkbenchLayoutController: the workbench frame's panel-action face. It plays
 * two roles. It re-provides `ctx.layout` (the base three-panel contract other
 * plugins already inject: sidebar toggle, details open/close) so ui-sidebar and
 * ui-conversation keep working unchanged when the workbench frame replaces the
 * base one. It also provides `ctx.workbenchLayout` — the center MODE (chat vs
 * file workspace) as an observable other plugins read and set — which the
 * sidebar mode toggle (in ui-file-workspace) drives and the frame projects.
 *
 * The mode is the controller's own state, self-persisted to localStorage,
 * because the file-workspace plugin and the frame share it.
 * The frame reads it through a bound `useMode` hook (the inject `hooks`
 * compartment); the toggle reads and writes it through this service.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BoundActions, HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { createWorkbenchLayoutStore, WorkbenchMode } from './stores.ts'

/** The workbench layout store's bound action set (framework-baked, draft params peeled). */
export type WorkbenchPanelActions = BoundActions<ReturnType<typeof createWorkbenchLayoutStore>>

/** localStorage key persisting the center mode across reloads. */
const MODE_STORAGE_KEY = 'dsh.workbench.mode.v1'

/**
 * The workbench center-mode face (`ctx.workbenchLayout`): read the current mode,
 * subscribe to changes, and set it. ui-file-workspace injects this for its
 * sidebar toggle; the frame injects `mode` for its `useMode` render hook.
 */
export interface IWorkbenchLayout {
  /**
   * Read the current center mode.
   * @returns the active Chat or Files mode.
   */
  getMode(): WorkbenchMode
  /** A HostObservable of the current mode, for the renderer's selector hooks. */
  readonly mode: HostObservable<WorkbenchMode>
  /**
   * Set the center mode.
   * @param mode - the mode to show.
   */
  setMode(mode: WorkbenchMode): void
}

/** Read the persisted mode, defaulting to chat when absent or unreadable. */
function readPersistedMode(): WorkbenchMode {
  if (typeof localStorage === 'undefined') return 'chat'
  try {
    return localStorage.getItem(MODE_STORAGE_KEY) === 'files' ? 'files' : 'chat'
  } catch {
    // Private mode / quota teardown: fall back to the default, same non-fatal
    // contract as the snapshot-store persistence layer.
    return 'chat'
  }
}

/** Persist the mode; storage failures only skip persistence. */
function persistMode(mode: WorkbenchMode): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(MODE_STORAGE_KEY, mode)
  } catch {
    // Non-fatal: the in-memory mode still drives the UI this session.
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The workbench center-mode face; the concrete service stays inside this plugin. */
    workbenchLayout: IWorkbenchLayout
  }
}

/**
 * Cross-plugin panel-action face for the workbench frame. Implements the base
 * `ILayout` contract (so `ctx.layout` consumers are unchanged) and owns the
 * shared, self-persisted center-mode observable behind `ctx.workbenchLayout`.
 */
export class WorkbenchLayoutController implements ILayout, IWorkbenchLayout {
  #panels: WorkbenchPanelActions | undefined
  #mode: WorkbenchMode = readPersistedMode()
  readonly #listeners = new Set<() => void>()

  /** A HostObservable of the current mode for the renderer's `use<Name>` selector hooks. */
  readonly mode: HostObservable<WorkbenchMode> = {
    getSnapshot: () => this.#mode,
    subscribe: (listener) => {
      this.#listeners.add(listener)
      return () => { this.#listeners.delete(listener) }
    },
  }

  /**
   * Adopt the root entry's bound store actions. Called from the root
   * registration's inject hook (a sanctioned assembly side effect), so the
   * face is live from the entry's first render.
   * @param actions - bound actions of the entry's workbench layout store instance.
   */
  attachPanels(actions: WorkbenchPanelActions): void {
    this.#panels = actions
  }

  /** The current center mode. */
  getMode(): WorkbenchMode {
    return this.#mode
  }

  /**
   * Set the center mode, persisting it and notifying subscribers.
   * @param mode - the mode to show.
   */
  setMode(mode: WorkbenchMode): void {
    if (this.#mode === mode) return
    this.#mode = mode
    persistMode(mode)
    for (const listener of [...this.#listeners]) listener()
  }

  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel (no-op when already open). */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  #require(): WorkbenchPanelActions {
    if (this.#panels === undefined) {
      throw new Error('layout-workbench: panel actions not wired (root entry not mounted)')
    }
    return this.#panels
  }
}

/**
 * Provide both `ctx.layout` and `ctx.workbenchLayout` from one controller for
 * the plugin's life.
 * @param ctx - the workbench layout plugin context.
 * @param controller - the shared controller instance.
 * @returns a disposer that retracts both service provisions.
 */
export function provideWorkbenchLayout(ctx: Context, controller: WorkbenchLayoutController): () => void {
  const disposeLayout = ctx.reflect.provide('layout', controller)
  const disposeWorkbench = ctx.reflect.provide('workbenchLayout', controller)
  return () => {
    void disposeLayout()
    void disposeWorkbench()
  }
}
