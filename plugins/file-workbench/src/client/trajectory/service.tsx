/**
 * Optional renderer service for surfaces that already own a Session snapshot
 * hook but need the same full trajectory UI as the main conversation tab.
 */
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type {
  HostObservable, SnapshotSelectorHook, TranslateNS,
} from '@deepseek-ai/dsh-client-ui-slots'
import { TrajectoryView } from './TrajectoryView.tsx'

/** Public optional face exposed by the trajectory plugin. */
export interface ITrajectoryPresentation {
  /**
   * Render the complete native trajectory for one caller-owned Session hook.
   * @param input - child Session hook and history loader.
   * @returns the shared trajectory view.
   */
  render(input: {
    session: HostObservable<ConversationSnapshot>
    loadOlder: () => Promise<boolean>
  }): ReactNode
}

function EmbeddedTrajectory(props: {
  session: HostObservable<ConversationSnapshot>
  duration: SnapshotStore<boolean>
  loadOlder: () => Promise<boolean>
  t: TranslateNS<'trajectory'>
}) {
  const { session, duration, loadOlder, t } = props
  const snapshot = useSyncExternalStore(
    listener => session.subscribe(listener),
    () => session.getSnapshot(),
  )
  const actualDuration = useSyncExternalStore(
    listener => duration.subscribe(listener),
    () => duration.getSnapshot(),
  )
  const useSession: SnapshotSelectorHook<ConversationSnapshot> = selector => selector(snapshot)
  const useDuration: SnapshotSelectorHook<boolean> = selector => selector(actualDuration)
  return (
    <TrajectoryView
      useSession={useSession}
      useDuration={useDuration}
      loadOlder={loadOlder}
      setActualDuration={(value) => { duration.set(value) }}
      t={t}
    />
  )
}

/** Create one trajectory-plugin-lifetime embedded renderer. */
export function createTrajectoryPresentation(
  t: TranslateNS<'trajectory'>,
  duration: SnapshotStore<boolean>,
): ITrajectoryPresentation {
  return {
    render(input: {
      session: HostObservable<ConversationSnapshot>
      loadOlder: () => Promise<boolean>
    }): ReactNode {
      return (
        <EmbeddedTrajectory
          session={input.session}
          duration={duration}
          loadOlder={input.loadOlder}
          t={t}
        />
      )
    },
  }
}
