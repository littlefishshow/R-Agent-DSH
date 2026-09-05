/**
 * Workbench layout plugin, browser half. One register() call contributes the
 * three-column WorkbenchAppFrame into the runtime's built-in 'root' slot and, in
 * the same breath, declares its child slots: the base trio (sidebar,
 * conversation, details) plus shell.overlay carried forward, and the new
 * `workbench` slot whose occupant is the file workspace shown in the center when
 * the mode is `files`. It seats the workbench layout store, provides `ctx.layout`
 * (the base panel-action contract) and `ctx.workbenchLayout` (the shared center
 * mode), and a theme presenter.
 *
 * This frame REPLACES the base three-column layout: the two never coexist (the
 * bundle disables the base `ui-layout` row), so both declare the same 'root'
 * occupant and the same base child slots — whichever is loaded owns them.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
// Type-only: pulls the base layout's SlotMap declarations (sidebar,
// conversation, details, shell.overlay) and the ILayout/owner-share contracts
// this frame carries forward unchanged.
import type {
  ConvOwnerProps, DetailsOwnerProps, SidebarOwnerProps,
} from '@deepseek-ai/dsh-client-ui-layout/client'
import { WorkbenchAppFrame } from './AppFrame.tsx'
import { createWorkbenchLayoutStore } from './stores.ts'
import { provideWorkbenchLayout, WorkbenchLayoutController, type WorkbenchPanelActions } from './service.ts'
import { ThemePresenter } from './theme-presenter.ts'

export { WorkbenchLayoutController } from './service.ts'
export type { IWorkbenchLayout } from './service.ts'
export type { WorkbenchMode } from './stores.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The file-workspace surface, shown in the center column when the mode is
     * `files` (the conversation occupies it otherwise; both stay mounted).
     * OCCUPIED by ui-file-workspace's panel. Root-scoped: the file panel is not
     * bound to the current session, and its selection sub-windows open their own
     * child sessions.
     */
    'workbench': { kind: 'single'; scope: 'root'; owner: WorkbenchOwnerProps }
  }
}

/** Workbench owner share: empty — the file panel owns its own state and reads mode via ctx.workbenchLayout. */
export interface WorkbenchOwnerProps {}

/** Required services (cordis fiber inject — the loader passes all module exports as an object plugin). */
export const inject = ['slots', 'theme']

/**
 * Client plugin body: provide the layout services, then one register() call —
 * WorkbenchAppFrame into 'root' with the child-slot declarations, the workbench
 * layout store seat, and the inject hook that hands the store's bound actions
 * and persisted mode to the controller.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new WorkbenchLayoutController()
  ctx.effect(() => {
    const disposeService = provideWorkbenchLayout(ctx, controller)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'workbench': { kind: 'single', scope: 'root' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createWorkbenchLayoutStore,
      inject: (actions: WorkbenchPanelActions) => {
        controller.attachPanels(actions)
        return { hooks: { mode: controller.mode } }
      },
    }, WorkbenchAppFrame)
    return () => {
      disposeRegistration()
      disposeService()
    }
  }, 'ui-layout-workbench: service + root registration')

  ctx.effect(() => {
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => { presenter.apply(snapshot) })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'ui-layout-workbench: theme presenter')
}

export type { ConvOwnerProps, DetailsOwnerProps, SidebarOwnerProps }
