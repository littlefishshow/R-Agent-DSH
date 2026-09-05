/**
 * The floating selection sub-windows layer (registered through the frame's
 * `shell.overlay` slot and portaled to `document.body`). Each window is backed by a dsh child session: it shows the child
 * conversation (chat tab) or the shared complete durable trajectory
 * renderer (trajectory tab), a follow-up composer, and — for a modify branch — an
 * Accept button that writes the produced replacement back into the document and
 * closes the window. Minimized windows collapse to a bottom dock while their
 * highlight stays painted in the document. A window subscribes to its child
 * session through the injected read/subscribe pair so it re-renders as the
 * child turn streams.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Button, IconCloseOutline16, IconFullscreenOutline16, IconSendOutline16,
  MarkdownText, MessageText, Tooltip,
} from '../primitives/index.ts'
import type { SubWindowsProps } from './contract/slots.ts'
import type { ChildSessionView, FileWorkspaceInjected } from './contract/slots.ts'
import type { SubWindowRecord } from './stores.ts'
import { extractReplacement } from './selection-prompt.ts'
import css from './SubWindows.module.css'

type SubWindowInjected = Omit<FileWorkspaceInjected, 'hooks'>

/** Hide inherited history; plugin-marked opening prompts never enter this projection. */
function visibleBranchMessages(
  messages: ChildSessionView['messages'],
  branchStartSeq: number,
): ChildSessionView['messages'] {
  return messages.filter(message => message.seq > branchStartSeq)
}

/** Retain one child projection for exactly as long as its window record exists. */
function ChildSessionWatch(props: {
  sessionId: NonNullable<SubWindowRecord['sessionId']>
  watch: FileWorkspaceInjected['watchChildSession']
}) {
  const { sessionId, watch } = props
  useEffect(() => watch(sessionId), [sessionId, watch])
  return null
}

/** One floating sub-window. */
function SubWindow(props: {
  window: SubWindowRecord
  injected: SubWindowInjected
  view: ChildSessionView | undefined
  actions: SubWindowsProps['actions']
  onAccept: (window: SubWindowRecord, view: ChildSessionView) => void
  onDelete: (window: SubWindowRecord) => void
  t: SubWindowsProps['t']
}) {
  const { window: win, injected, view, actions, onAccept, onDelete, t } = props
  const childSessionId = win.sessionId
  const [followUp, setFollowUp] = useState('')
  const [sendError, setSendError] = useState<string | undefined>(undefined)
  const composingRef = useRef(false)
  const dragState = useRef<{ startX: number; startY: number; originX: number; originY: number } | null>(null)
  const resizeState = useRef<{
    startX: number
    startY: number
    originWidth: number
    originHeight: number
  } | null>(null)

  const onHeaderPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') !== null || win.fullscreen) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragState.current = { startX: e.clientX, startY: e.clientY, originX: win.x, originY: win.y }
    actions.raiseWindow(win.id)
  }, [actions, win.id, win.x, win.y])
  const onHeaderPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragState.current
    if (drag === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    actions.moveWindow(win.id, drag.originX + (e.clientX - drag.startX), drag.originY + (e.clientY - drag.startY))
  }, [actions, win.id])
  const onHeaderPointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    dragState.current = null
  }, [])

  const onResizePointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    resizeState.current = {
      startX: e.clientX,
      startY: e.clientY,
      originWidth: win.width,
      originHeight: win.height,
    }
    actions.raiseWindow(win.id)
  }, [actions, win.height, win.id, win.width])
  const onResizePointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const resize = resizeState.current
    if (resize === null || !e.currentTarget.hasPointerCapture(e.pointerId)) return
    actions.resizeWindow(
      win.id,
      Math.max(360, resize.originWidth + e.clientX - resize.startX),
      Math.max(330, resize.originHeight + e.clientY - resize.startY),
    )
  }, [actions, win.id])
  const onResizePointerUp = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    resizeState.current = null
  }, [])

  const sendFollowUp = useCallback(() => {
    const text = followUp.trim()
    if (text === '') return
    setSendError(undefined)
    if (win.phase === 'draft') {
      actions.setWindowTitle(win.id, text.slice(0, 80))
      actions.setWindowPhase(win.id, 'creating')
      void injected.startSelectionSession({
        workspaceId: win.workspaceId,
        path: win.path,
        fileVersion: win.fileVersion,
        selectedText: win.selectedText,
        lineContext: win.lineContext,
        action: win.action,
        instruction: text,
        selectionId: win.id,
        visibleStart: win.visibleStart,
        occurrence: win.occurrence,
        sourceStart: win.sourceStart,
        sourceEnd: win.sourceEnd,
        colorIndex: win.colorIndex,
      }).then((branch) => {
        actions.attachWindowBranch(win.id, branch)
      }).catch((error: unknown) => {
        actions.setWindowPhase(win.id, 'draft')
        setSendError(error instanceof Error ? error.message : String(error))
        setFollowUp(text)
      })
    } else {
      const sessionId = win.sessionId
      if (sessionId === undefined) return
      void injected.sendFollowUp(sessionId, text).catch((error: unknown) => {
        setSendError(error instanceof Error ? error.message : String(error))
        setFollowUp(text)
      })
    }
    setFollowUp('')
  }, [actions, followUp, injected, win])

  return (
    <div
      className={css.window}
      data-fullscreen={win.fullscreen || undefined}
      style={win.fullscreen
        ? { zIndex: win.zIndex }
        : { left: win.x, top: win.y, width: win.width, height: win.height, zIndex: win.zIndex }}
      onPointerDown={() => { actions.raiseWindow(win.id) }}
    >
      <div
        className={css.winHeader}
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onHeaderPointerMove}
        onPointerUp={onHeaderPointerUp}
      >
        <span className={css.winTitle}>{win.title}</span>
        {win.action === 'modify' && (
          <Button
            variant="ghost"
            disabled={view === undefined || win.phase !== 'ready'}
            onClick={() => { if (view !== undefined) onAccept(win, view) }}
          >
            {t('window.accept')}
          </Button>
        )}
        <div className={css.windowControls}>
          <Tooltip label={win.fullscreen ? t('window.restore') : t('window.fullscreen')}>
            <button
              type="button"
              className={css.windowIconButton}
              aria-label={win.fullscreen ? t('window.restore') : t('window.fullscreen')}
              onClick={() => { actions.setWindowFullscreen(win.id, !win.fullscreen) }}
            >
              <IconFullscreenOutline16 />
            </button>
          </Tooltip>
          <Tooltip label={t('window.minimize')}>
            <button
              type="button"
              className={css.windowIconButton}
              aria-label={t('window.minimize')}
              onClick={() => { actions.minimizeWindow(win.id, true) }}
            >
              <span aria-hidden="true">—</span>
            </button>
          </Tooltip>
          <Tooltip label={t('window.close')}>
            <button
              type="button"
              className={css.windowIconButton}
              aria-label={t('window.close')}
              disabled={win.phase === 'creating' || win.phase === 'deleting'}
              onClick={() => { onDelete(win) }}
            >
              <IconCloseOutline16 />
            </button>
          </Tooltip>
        </div>
      </div>
      <div className={css.winTabs}>
        <button type="button" className={css.tab} data-active={win.tab === 'chat'} onClick={() => { actions.setWindowTab(win.id, 'chat') }}>
          {t('window.chat')}
        </button>
        <button type="button" className={css.tab} data-active={win.tab === 'trajectory'} onClick={() => { actions.setWindowTab(win.id, 'trajectory') }}>
          {t('window.trajectory')}
        </button>
      </div>
      <div className={css.winBody}>
        <div className={css.selectedQuote} title={win.selectedText}>
          <span className={css.selectedQuoteLabel}>{t('window.selection')}</span>
          <div className={css.selectedQuoteContent}><MarkdownText text={win.selectedText} /></div>
        </div>
        {win.error !== undefined && <div className={css.sendError}>{win.error}</div>}
        {win.tab === 'chat'
          ? (
            <div className={css.chatFlow}>
              {visibleBranchMessages(view?.messages ?? [], win.branchStartSeq).map(message => (
                <div key={`${message.seq}:${message.role}`} className={css.message} data-role={message.role}>
                  {message.role === 'user'
                    ? <MessageText text={message.text} />
                    : message.role === 'assistant'
                      ? <MarkdownText text={message.text} streaming={message.streaming === true} />
                      : (
                        <details className={css.contextRow}>
                          <summary>{message.role === 'context' ? t('window.context') : t('window.tool')}</summary>
                          <pre>{message.text}</pre>
                        </details>
                      )}
                </div>
              ))}
              {view?.running && <div className={css.thinking}>{t('window.thinking')}…</div>}
            </div>
          )
          : (
            <div className={css.trajectory}>
              {view === undefined
                ? null
                : childSessionId === undefined ? null : injected.renderChildTrajectory(childSessionId)}
            </div>
          )}
        {win.phase === 'creating' && win.error === undefined && (
          <div className={css.thinking}>{t('window.creating')}…</div>
        )}
        {win.phase === 'deleting' && win.error === undefined && (
          <div className={css.thinking}>{t('window.deleting')}…</div>
        )}
      </div>
      <div className={css.winFooter}>
        {sendError !== undefined && <div className={css.sendError}>{sendError}</div>}
        <input
          className={css.followInput}
          value={followUp}
          placeholder={win.phase === 'draft'
            ? t(win.action === 'modify' ? 'window.modifyPlaceholder' : 'window.askPlaceholder')
            : t('window.sendPlaceholder')}
          disabled={win.phase === 'creating' || win.phase === 'deleting' || win.phase === 'cleanup-error'}
          onChange={(e) => { setFollowUp(e.target.value) }}
          onCompositionStart={() => { composingRef.current = true }}
          onCompositionEnd={() => {
            window.setTimeout(() => { composingRef.current = false }, 10)
          }}
          onKeyDown={(e) => {
            // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
            // oxlint-disable-next-line typescript/no-deprecated
            const composing = composingRef.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229
            if (e.key === 'Enter' && !composing) sendFollowUp()
          }}
        />
        {view?.running && childSessionId !== undefined
          ? (
            <Button variant="ghost" onClick={() => { void injected.stopChildSession(childSessionId) }}>
              {t('window.stop')}
            </Button>
          )
          : (
            <Button
              variant="primary"
              disabled={win.phase === 'creating' || win.phase === 'deleting' || win.phase === 'cleanup-error'}
              onClick={sendFollowUp}
            >
              <IconSendOutline16 />
              {t('window.send')}
            </Button>
          )}
      </div>
      {!win.fullscreen && (
        <button
          type="button"
          className={css.resizeHandle}
          aria-label={t('window.resize')}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
        />
      )}
    </div>
  )
}

/** The selection sub-windows layer and its minimized dock. */
export function SubWindows({
  useStore, useChildViews, useMode, useRestorableSelections, actions, ...injected
}: SubWindowsProps) {
  const windows = useStore(s => s.windows)
  const documents = useStore(s => s.documents)
  const highlights = useStore(s => s.highlights)
  const childViews = useChildViews(views => views)
  const mode = useMode(value => value)
  const restorable = useRestorableSelections(value => value)
  const readText = injected.readText
  const t = injected.t
  const deleting = useRef(new Set<string>())
  const restoring = useRef(new Set<string>())
  const restoredDocuments = useRef(new Set<string>())

  useEffect(() => {
    if (mode !== 'files') return
    for (const selection of restorable.items) actions.restoreSelection(selection)
    if (restorable.phase === 'ready') {
      actions.reconcileRestorableSelections(restorable.items.map(selection => selection.sessionId))
    }
  }, [actions, mode, restorable])

  useEffect(() => {
    if (mode !== 'files') return
    for (const selection of restorable.items) {
      if (documents[selection.path] !== undefined
        || restoring.current.has(selection.path)
        || restoredDocuments.current.has(selection.path)) continue
      restoring.current.add(selection.path)
      restoredDocuments.current.add(selection.path)
      void readText(selection.path).then((read) => {
        actions.restoreDocument({
          path: read.path,
          content: read.content,
          version: read.version,
          workspaceId: selection.workspaceId,
          previewKind: 'markdown',
          draft: read.content,
          dirty: false,
          viewMode: 'preview',
        })
      }).catch((error: unknown) => {
        actions.setWindowError(
          selection.id,
          error instanceof Error ? error.message : String(error),
        )
      }).finally(() => {
        restoring.current.delete(selection.path)
      })
    }
  }, [actions, documents, mode, readText, restorable.items])

  const onDelete = useCallback((win: SubWindowRecord) => {
    if (deleting.current.has(win.id)) return
    if (win.sessionId === undefined) {
      actions.removeSelection(win.id)
      return
    }
    deleting.current.add(win.id)
    actions.setWindowPhase(win.id, 'deleting')
    actions.clearWindowError(win.id)
    void injected.deleteSelectionSession({
      workspaceId: win.workspaceId,
      path: win.path,
      sessionId: win.sessionId,
    }).then(() => {
      actions.removeSelection(win.id)
    }).catch((error: unknown) => {
      actions.setWindowPhase(win.id, 'cleanup-error')
      actions.setWindowError(win.id, error instanceof Error ? error.message : String(error))
    }).finally(() => {
      deleting.current.delete(win.id)
    })
  }, [actions, injected])

  const onAccept = useCallback((win: SubWindowRecord, view: ChildSessionView) => {
    if (win.sessionId === undefined) return
    const highlight = highlights[win.id]
    const document = documents[win.path]
    if (highlight === undefined || document === undefined || document.path !== highlight.path) return
    const reply = [...view.messages].reverse().find(message => message.role === 'assistant')?.text
    const replacement = reply === undefined ? undefined : extractReplacement(reply)
    if (replacement === undefined) {
      actions.setWindowError(win.id, t('window.invalidReplacement'))
      return
    }
    const source = document.draft.slice(highlight.sourceStart, highlight.sourceEnd)
    if (source !== win.lineContext) {
      actions.setWindowError(win.id, t('window.sourceChanged'))
      return
    }
    if (!window.confirm(t('window.acceptConfirm'))) return
    actions.clearWindowError(win.id)
    const next = document.draft.slice(0, highlight.sourceStart)
      + replacement
      + document.draft.slice(highlight.sourceEnd)
    injected.writeText(document.path, next, document.version)
      .then((result) => {
        actions.markSaved(document.path, next, result.version)
        actions.removeHighlight(win.id)
        onDelete(win)
      })
      .catch((error: unknown) => {
        actions.setWindowError(win.id, error instanceof Error ? error.message : String(error))
      })
  }, [actions, documents, highlights, injected, onDelete, t])

  const open = Object.values(windows).filter(w => !w.minimized)
  const minimized = Object.values(windows).filter(w => w.minimized && !w.dockHidden)

  return createPortal((
    <div className={css.portalLayer}>
      {Object.values(windows).map(win => win.sessionId === undefined
        ? null
        : (
          <ChildSessionWatch
            key={`watch:${win.id}`}
            sessionId={win.sessionId}
            watch={injected.watchChildSession}
          />
        ))}
      {open.map(win => (
        <SubWindow
          key={win.id}
          window={win}
          injected={injected}
          view={win.sessionId === undefined ? undefined : childViews[win.sessionId]}
          actions={actions}
          onAccept={onAccept}
          onDelete={onDelete}
          t={t}
        />
      ))}
      {minimized.length > 0 && (
        <div className={css.dock}>
          {minimized.map(win => (
            <div key={win.id} className={css.dockItem}>
              <button type="button" className={css.dockChip} onClick={() => { actions.raiseWindow(win.id) }}>
                <span
                  className={css.dockStatus}
                  data-running={win.sessionId !== undefined && childViews[win.sessionId]?.running || undefined}
                />
                <span>{win.title}</span>
              </button>
              <button
                type="button"
                className={css.dockHide}
                aria-label={t('window.hideDock')}
                title={t('window.hideDock')}
                onClick={() => { actions.hideWindowDock(win.id) }}
              >
                <span aria-hidden="true">−</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  ), globalThis.document.body)
}
