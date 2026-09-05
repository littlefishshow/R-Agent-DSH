/**
 * Three-column workbench shell frame, registered into the built-in 'root' slot.
 * Columns are sidebar | center | details, same geometry as the base layout. The
 * center is MODE-SWAPPED: in `chat` mode it shows the conversation
 * (`renderSlot('conversation', {})`), in `files` mode it shows the file
 * workspace (`renderSlot('workbench', {})`). The sidebar stays mounted and
 * delegates its workspace region projection to the mode-aware sidebar
 * occupant. Both center subtrees stay mounted, so switching modes preserves
 * the conversation. Pure component: everything arrives through framework
 * shares.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { InjectFace, PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT } from './columns.ts'
import type { createWorkbenchLayoutStore } from './stores.ts'
import type { WorkbenchLayoutController } from './service.ts'
import css from './AppFrame.module.css'

/** The frame's injected face: the shared center-mode observable, bound to a useMode hook. */
export interface WorkbenchFrameInjected {
  hooks: {
    /** The current center mode ('chat' | 'files'). */
    mode: WorkbenchLayoutController['mode']
  }
}

/** Full composed props: runtime share + child-slot render share + store share + the bound mode hook. */
export type WorkbenchAppFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'workbench' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createWorkbenchLayoutStore>>
  & InjectFace<WorkbenchFrameInjected>

/** Center column grid item hosting both mode subtrees; the inactive one is hidden. */
function CenterColumn(props: { children?: ReactNode }) {
  return <div className={css.centerCol}>{props.children}</div>
}

/** Details column grid item; width 0 keeps the subtree mounted (never unmount on close). */
function DetailsColumn(props: { children?: ReactNode }) {
  return <div className={css.detailsCol}>{props.children}</div>
}

/**
 * One drag handle: pointer capture, rAF-throttled dx reports against the
 * drag-start origin. `side` keys the hover-reveal CSS to the owning column.
 */
function DragHandle(props: { side: 'sidebar' | 'details'; left: number; onStart: () => void; onDrag: (dx: number) => void; onEnd: () => void }) {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    origin.current = e.clientX
    latest.current = e.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    latest.current = e.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    e.currentTarget.releasePointerCapture(e.pointerId)
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className={css.handle}
      style={{ left: props.left }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** The three-column, mode-swapped workbench frame (see module doc). */
export function WorkbenchAppFrame({
  useStore,
  useSessions,
  useMode,
  actions,
  renderSlot,
}: WorkbenchAppFrameProps) {
  const panels = useStore(s => s)
  const mode = useMode(m => m)
  const detailsSession = useSessions((s) => {
    const current = s.current
    return current !== undefined && s.byId[current]?.blank === false ? current : undefined
  })
  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) {
      actions.closeDetails()
    }
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  useEffect(() => {
    const el = frameRef.current
    /* v8 ignore next -- the ref is always attached by effect time: the frame div renders unconditionally. */
    if (el === null) return
    let raf: number | null = null
    const observer = new ResizeObserver(() => {
      raf ??= requestAnimationFrame(() => {
        raf = null
        const width = el.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(el)
    return () => {
      observer.disconnect()
      if (raf !== null) cancelAnimationFrame(raf)
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => { actions.setNarrow(narrow) }, [actions, narrow])
  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed
    ? 0
    : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  // Details only opens in chat mode; the file workspace uses the full center.
  const detailsPref = mode === 'chat' && detailsSession !== undefined ? panels.details : 0
  const cols = computeColumns(viewport, sidebarPreference, detailsPref)
  const colsRef = useRef(cols)
  colsRef.current = cols

  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => { setDragging(false) }, [])
  const onSidebarStart = useCallback(() => { sidebarBase.current = colsRef.current.sidebar; setDragging(true) }, [])
  const onDetailsStart = useCallback(() => { detailsBase.current = colsRef.current.details; setDragging(true) }, [])
  const onSidebarDrag = useCallback((dx: number) => { actions.setSidebar(sidebarBase.current + dx) }, [actions])
  const onDetailsDrag = useCallback((dx: number) => { actions.setDetails(detailsBase.current - dx) }, [actions])

  return (
    <div
      ref={frameRef}
      className={css.frame}
      style={{ gridTemplateColumns: `${cols.sidebar}px minmax(0, 1fr) ${cols.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={cols.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      <div className={css.sidebarCol}>
        {renderSlot('sidebar', { collapsed: sidebarCollapsed, width: cols.sidebar })}
      </div>
      <CenterColumn>
        {/* Both mode subtrees stay mounted so a mode switch never remounts the
            conversation; the inactive one is hidden. */}
        <div className={css.modePane} data-active={mode === 'chat' || undefined} aria-hidden={mode !== 'chat'}>
          {renderSlot('conversation', {})}
        </div>
        <div className={css.modePane} data-active={mode === 'files' || undefined} aria-hidden={mode !== 'files'}>
          {renderSlot('workbench', {})}
        </div>
      </CenterColumn>
      <DetailsColumn>{renderSlot('details', {})}</DetailsColumn>
      <div className={css.overlayLayer} data-shell-overlay>
        {renderSlot('shell.overlay', {})}
      </div>
      {!sidebarCollapsed && (
        <DragHandle side="sidebar" left={cols.sidebar} onStart={onSidebarStart} onDrag={onSidebarDrag} onEnd={onDragEnd} />
      )}
      {cols.details > 0 && (
        <DragHandle side="details" left={viewport - cols.details} onStart={onDetailsStart} onDrag={onDetailsDrag} onEnd={onDragEnd} />
      )}
    </div>
  )
}
