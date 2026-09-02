/**
 * Optional presentation controls consumed by Workspace browser extensions.
 * The default browser remains unchanged until an extension retains a feature.
 */
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'

/** Reversible Workspace browser presentation controls. */
export interface IWorkspacePresentation {
  /** Whether grouped Session rows project ordinary fork lineage. */
  readonly forkLineage: HostObservable<boolean>
  /**
   * Enable grouped fork lineage for one plugin lifetime.
   * @returns an idempotent disposer that releases the request.
   */
  retainForkLineage(): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Optional Workspace browser presentation controls. */
    workspacePresentation: IWorkspacePresentation
  }
}

/** Reference-counted implementation so independent extensions compose safely. */
export class WorkspacePresentationController implements IWorkspacePresentation {
  #forkLineageRefs = 0
  readonly #listeners = new Set<() => void>()

  readonly forkLineage: HostObservable<boolean> = {
    getSnapshot: () => this.#forkLineageRefs > 0,
    subscribe: (listener) => {
      this.#listeners.add(listener)
      return () => { this.#listeners.delete(listener) }
    },
  }

  retainForkLineage(): () => void {
    this.#forkLineageRefs += 1
    if (this.#forkLineageRefs === 1) this.#publish()
    let active = true
    return () => {
      if (!active) return
      active = false
      this.#forkLineageRefs -= 1
      if (this.#forkLineageRefs === 0) this.#publish()
    }
  }

  #publish(): void {
    for (const listener of [...this.#listeners]) listener()
  }
}
