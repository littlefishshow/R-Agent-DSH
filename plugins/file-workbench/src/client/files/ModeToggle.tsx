/**
 * The sidebar Chat/Files mode toggle (a `sidebar.footer.action` seat). It reads
 * the shared center mode from `ctx.workbenchLayout` (bound as the `useMode`
 * hook) and sets it, so choosing Files swaps the center column to the file
 * workspace and Chat swaps it back. Renders a two-button row when the sidebar
 * is wide and a single icon that flips the mode on the collapsed rail.
 */
import clsx from 'clsx'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { WorkbenchMode } from '../layout/index.ts'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import { IconFolderOpenOutline16, IconNewChatOutline16 } from '../primitives/index.ts'
import css from './ModeToggle.module.css'

/** The toggle's injected face: the shared mode observable and the setter. */
export interface ModeToggleInjected {
  hooks: {
    /** The current center mode ('chat' | 'files'). */
    mode: HostObservable<WorkbenchMode>
  }
  /** Set the center mode. */
  setMode: (mode: WorkbenchMode) => void
}

/** Full toggle props: sidebar footer-action owner share + bound mode hook + locale seat. */
export type ModeToggleProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<ModeToggleInjected>
  & PropsLocale<'fileWorkspace'>

/** Plain segmented control shared by the two sidebar occupants. */
export function ModeSegment(props: {
  wide: boolean
  mode: WorkbenchMode
  setMode: (mode: WorkbenchMode) => void
  chatLabel: string
  filesLabel: string
}) {
  const { wide, mode, setMode, chatLabel, filesLabel } = props
  if (!wide) {
    const next: WorkbenchMode = mode === 'chat' ? 'files' : 'chat'
    return (
      <button
        type="button"
        className={css.rail}
        data-active-mode={mode}
        title={mode === 'chat' ? filesLabel : chatLabel}
        onClick={() => { setMode(next) }}
      >
        {mode === 'chat' ? <IconFolderOpenOutline16 /> : <IconNewChatOutline16 />}
      </button>
    )
  }
  return (
    <div className={css.segment} role="tablist" data-mode={mode}>
      <span className={css.indicator} aria-hidden="true" />
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'chat'}
        className={clsx(css.tab, mode === 'chat' && css.active)}
        onClick={() => { setMode('chat') }}
      >
        <IconNewChatOutline16 />
        <span>{chatLabel}</span>
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={mode === 'files'}
        className={clsx(css.tab, mode === 'files' && css.active)}
        onClick={() => { setMode('files') }}
      >
        <IconFolderOpenOutline16 />
        <span>{filesLabel}</span>
      </button>
    </div>
  )
}

/** The Chat/Files sidebar toggle. */
export function ModeToggle({ wide, useMode, setMode, t }: ModeToggleProps) {
  const mode = useMode(value => value)
  return (
    <ModeSegment
      wide={wide}
      mode={mode}
      setMode={setMode}
      chatLabel={t('mode.chat')}
      filesLabel={t('mode.files')}
    />
  )
}
