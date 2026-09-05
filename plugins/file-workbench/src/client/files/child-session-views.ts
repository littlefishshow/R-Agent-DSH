/**
 * React-free projection of watched child sessions into compact sub-window
 * views. The apply layer owns Session subscriptions; components receive one
 * framework-bound `useChildViews` selector hook through the inject `hooks`
 * compartment and never subscribe manually.
 */
import {
  createSnapshotStore,
  type SessionId,
  type SessionRuntime,
  type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChildSessionView } from './contract/slots.ts'
import { childSessionView } from './child-session.ts'
import { openBackgroundSession } from '../background-session.ts'

/** Child-session views keyed by session id. */
export type ChildSessionViewsSnapshot = Record<string, ChildSessionView>

/** Opens and watches child Session faces, then republishes their compact views. */
export class ChildSessionViews {
  /** Observable injected into the renderer's hooks compartment. */
  readonly store: SnapshotStore<ChildSessionViewsSnapshot> = createSnapshotStore({})
  readonly #watchers = new Map<SessionId, { refs: number; dispose: () => void }>()

  /** @param sessions - concrete runtime used to resolve child Session faces. */
  constructor(private readonly sessions: SessionRuntime) {}

  /**
   * Retain one child-session watch.
   * @param sessionId - child Session to project.
   * @returns disposer releasing this watch reference.
   */
  watch(sessionId: SessionId): () => void {
    const retained = this.#watchers.get(sessionId)
    if (retained !== undefined) {
      retained.refs += 1
      return () => { this.#release(sessionId) }
    }
    let disposed = false
    let disposeSession: (() => void) | undefined
    let disposeList = (): void => {}
    const attach = (): void => {
      if (disposed || disposeSession !== undefined) return
      const session = this.sessions.binding(sessionId)?.session
      if (session === undefined) return
      const publish = (): void => {
        const view = childSessionView(session.getSnapshot())
        this.store.update((draft) => { draft[sessionId] = view })
      }
      publish()
      disposeSession = session.subscribe(publish)
      void openBackgroundSession(session)
      disposeList()
    }
    disposeList = this.sessions.list.subscribe(attach)
    attach()
    const dispose = (): void => {
      disposed = true
      disposeList()
      disposeSession?.()
    }
    this.#watchers.set(sessionId, { refs: 1, dispose })
    return () => { this.#release(sessionId) }
  }

  #release(sessionId: SessionId): void {
    const retained = this.#watchers.get(sessionId)
    if (retained === undefined) return
    retained.refs -= 1
    if (retained.refs > 0) return
    retained.dispose()
    this.#watchers.delete(sessionId)
    const { [sessionId]: removed, ...rest } = this.store.getSnapshot()
    void removed
    this.store.set(rest)
  }
}
