/**
 * The file-workspace panel (the workbench frame's `workbench` center slot). It
 * shows the Markdown reader/editor for the document opened from the shared
 * Workspace file tree. Selecting text immediately records a durable UI
 * highlight and opens the four-action menu. Choosing an action opens the
 * linked sub-window; explain/summarize start immediately, while ask/modify wait
 * for explicit human input in that window. Absolute paths throughout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileWorkspacePanelProps } from './contract/slots.ts'
import type { SelectionAction } from './stores.ts'
import { locateMarkdownSource, expandToLines } from './markdown-source-map.ts'
import { DocumentView, type CapturedSelection } from './DocumentView.tsx'
import { basename } from './path.ts'
import css from './FileWorkspacePanel.module.css'

const MIN_FONT_SCALE = 0.8
const MAX_FONT_SCALE = 1.8
const FONT_SCALE_STEP = 0.1
const IMAGE_EXTENSIONS = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])

/** Lowercase filename extension, including the dot. */
function extension(path: string): string {
  const name = path.replaceAll('\\', '/').split('/').pop() ?? path
  const at = name.lastIndexOf('.')
  return at < 0 ? '' : name.slice(at).toLowerCase()
}

/** Renderer selected from the opened path. */
function documentKind(path: string): 'markdown' | 'text' | 'image' | 'unsupported' {
  const ext = extension(path)
  if (ext === '.md' || ext === '.markdown') return 'markdown'
  if (IMAGE_EXTENSIONS.has(ext)) return 'image'
  if (ext === '.pdf') return 'unsupported'
  return 'text'
}

/** The file-workspace center panel. */
export function FileWorkspacePanel({
  useStore,
  actions,
  writeText,
  readImage,
  startSelectionSession,
  t,
}: FileWorkspacePanelProps) {
  const documents = useStore(s => s.documents)
  const documentOrder = useStore(s => s.documentOrder)
  const activeDocumentPath = useStore(s => s.activeDocumentPath)
  const document = activeDocumentPath === null ? null : documents[activeDocumentPath] ?? null
  const kind = document === null ? null : document.previewKind ?? documentKind(document.path)
  const allHighlights = useStore(s => s.highlights)
  const nextColor = useStore(s => s.nextColor)
  const [status, setStatus] = useState<{ error?: string }>({})
  const [pending, setPending] = useState<(CapturedSelection & { id: string }) | null>(null)
  const [fontScale, setFontScale] = useState(1)
  const selectionMenuRef = useRef<HTMLDivElement | null>(null)

  const fail = useCallback((error: unknown) => {
    setStatus({ error: error instanceof Error ? error.message : String(error) })
  }, [])

  const save = useCallback(() => {
    if (document === null || kind === 'image' || kind === 'unsupported' || !document.dirty) return
    writeText(document.path, document.draft, document.version)
      .then((result) => { actions.markSaved(document.path, document.draft, result.version) })
      .catch(fail)
  }, [actions, document, fail, kind, writeText])

  const captureSelection = useCallback((selection: CapturedSelection) => {
    if (document === null || kind !== 'markdown') return
    if (pending !== null && allHighlights[pending.id] !== undefined) {
      actions.removeHighlight(pending.id)
    }
    const range = locateMarkdownSource(document.content, selection.text, selection.occurrence)
    const lines = range === undefined
      ? { range: { start: 0, end: 0 }, text: selection.text }
      : expandToLines(document.content, range)
    const id = `sel-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
    const colorIndex = nextColor
    setStatus({})
    actions.addHighlight({
      id, path: document.path, text: selection.text, occurrence: selection.occurrence,
      visibleStart: selection.visibleStart,
      sourceStart: lines.range.start, sourceEnd: lines.range.end, colorIndex,
    })
    setPending({ ...selection, id })
    window.getSelection()?.removeAllRanges()
  }, [actions, allHighlights, document, kind, nextColor, pending])

  useEffect(() => {
    if (pending === null) return
    const dismiss = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && selectionMenuRef.current?.contains(target)) return
      actions.removeHighlight(pending.id)
      setPending(null)
    }
    globalThis.document.addEventListener('pointerdown', dismiss)
    return () => { globalThis.document.removeEventListener('pointerdown', dismiss) }
  }, [actions, pending])

  const onMenuAction = useCallback((action: SelectionAction) => {
    if (pending === null || document === null) return
    const highlight = allHighlights[pending.id]
    if (highlight === undefined) return
    if (action === 'modify' && highlight.sourceStart === highlight.sourceEnd) {
      actions.removeHighlight(highlight.id)
      setPending(null)
      fail(new Error(t('selection.sourceNotFound')))
      return
    }
    const phase = action === 'ask' || action === 'modify' ? 'draft' : 'creating'
    actions.openSelectionWindow({
      id: highlight.id,
      sessionId: undefined,
      path: document.path,
      workspaceId: document.workspaceId,
      fileVersion: document.version,
      selectedText: pending.text,
      title: `${t(`selection.${action}`)} · ${pending.text.trim().slice(0, 80)}`,
      lineContext: highlight.sourceStart === highlight.sourceEnd
        ? pending.text
        : document.content.slice(highlight.sourceStart, highlight.sourceEnd),
      visibleStart: highlight.visibleStart,
      occurrence: highlight.occurrence,
      sourceStart: highlight.sourceStart,
      sourceEnd: highlight.sourceEnd,
      action,
      phase,
      x: 96,
      y: 96,
      width: 560,
      height: 620,
      fullscreen: false,
      minimized: false,
      dockHidden: false,
      branchStartSeq: -1,
      tab: 'chat',
      zIndex: 1,
      colorIndex: highlight.colorIndex,
    })
    setPending(null)
    if (phase === 'draft') return
    void startSelectionSession({
      workspaceId: document.workspaceId,
      path: document.path,
      fileVersion: document.version,
      selectedText: pending.text,
      lineContext: highlight.sourceStart === highlight.sourceEnd
        ? pending.text
        : document.content.slice(highlight.sourceStart, highlight.sourceEnd),
      action,
      selectionId: highlight.id,
      visibleStart: highlight.visibleStart,
      occurrence: highlight.occurrence,
      sourceStart: highlight.sourceStart,
      sourceEnd: highlight.sourceEnd,
      colorIndex: highlight.colorIndex,
    }).then((branch) => { actions.attachWindowBranch(highlight.id, branch) }).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      actions.setWindowPhase(highlight.id, 'cleanup-error')
      actions.setWindowError(highlight.id, message)
      fail(error)
    })
  }, [actions, allHighlights, document, fail, pending, startSelectionSession, t])

  const documentHighlights = useMemo(
    () => document === null ? [] : Object.values(allHighlights).filter(h => h.path === document.path),
    [allHighlights, document],
  )
  return (
    <div className={css.panel}>
      {status.error !== undefined && <div className={css.errorText}>{t('panel.error')}{status.error}</div>}
      <div className={css.body}>
        {documentOrder.length > 0 && (
          <div className={css.tabs} role="tablist" aria-label={t('doc.openFiles')}>
            {documentOrder.map((path) => {
              const tab = documents[path]
              if (tab === undefined) return null
              const active = path === activeDocumentPath
              return (
                <div key={path} className={css.tab} data-active={active || undefined}>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={active}
                    className={css.tabSelect}
                    title={path}
                    onClick={() => { actions.activateDocument(path) }}
                  >
                    <span className={css.tabTitle}>{basename(path)}</span>
                    {tab.dirty && <span className={css.tabDirty}>●</span>}
                  </button>
                  <button
                    type="button"
                    className={css.tabClose}
                    aria-label={t('doc.close', { name: basename(path) })}
                    onClick={() => {
                      if (tab.dirty && !window.confirm(t('doc.closeDirty', { name: basename(path) }))) return
                      actions.closeDocument(path)
                    }}
                  >
                    <IconCloseOutline16 size={14} />
                  </button>
                </div>
              )
            })}
          </div>
        )}
        <div className={css.documentStage}>
          {document === null
            ? <div className={css.empty}>{t('doc.empty')}</div>
            : (
              <div className={css.doc}>
                <div className={css.docBar}>
                  <span className={css.docPath} title={document.path}>{basename(document.path)}</span>
                  {document.dirty && <span className={css.dirtyDot}>● {t('doc.dirty')}</span>}
                  {(kind === 'markdown' || kind === 'text') && (
                    <div className={css.zoomControls} aria-label={t('doc.fontSize')}>
                      <Button
                        variant="ghost"
                        disabled={fontScale <= MIN_FONT_SCALE}
                        onClick={() => { setFontScale(value => Math.max(MIN_FONT_SCALE, value - FONT_SCALE_STEP)) }}
                      >
                        A−
                      </Button>
                      <span>{Math.round(fontScale * 100)}%</span>
                      <Button
                        variant="ghost"
                        disabled={fontScale >= MAX_FONT_SCALE}
                        onClick={() => { setFontScale(value => Math.min(MAX_FONT_SCALE, value + FONT_SCALE_STEP)) }}
                      >
                        A+
                      </Button>
                    </div>
                  )}
                  {(kind === 'markdown' || kind === 'text') && (
                    <>
                      <Button
                        variant="ghost"
                        onClick={() => { actions.setViewMode(document.viewMode === 'preview' ? 'edit' : 'preview') }}
                      >
                        {document.viewMode === 'preview' ? t('doc.edit') : t('doc.preview')}
                      </Button>
                      <Button variant="primary" disabled={!document.dirty} onClick={save}>{t('doc.save')}</Button>
                    </>
                  )}
                </div>
                {kind === 'markdown'
                  ? (
                    <DocumentView
                      content={document.content}
                      path={document.path}
                      draft={document.draft}
                      viewMode={document.viewMode}
                      fontScale={fontScale}
                      highlights={documentHighlights}
                      readImage={readImage}
                      onDraftChange={(text) => { actions.setDraft(text) }}
                      onSelect={captureSelection}
                      onHighlightClick={(id) => { actions.raiseWindow(id) }}
                      highlightLabel={t('selection.openConversation')}
                    />
                  )
                  : kind === 'text'
                    ? document.viewMode === 'edit'
                      ? (
                        <div className={css.docContent} style={{ '--dsh-file-font-scale': fontScale } as CSSProperties}>
                          <textarea
                            className={css.editor}
                            value={document.draft}
                            spellCheck={false}
                            onChange={(event) => { actions.setDraft(event.target.value) }}
                          />
                        </div>
                      )
                      : (
                        <pre
                          className={css.textPreview}
                          style={{ '--dsh-file-font-scale': fontScale } as CSSProperties}
                        >
                          {document.content}
                        </pre>
                      )
                    : kind === 'image'
                      ? (
                        <div className={css.imagePreview}>
                          <img src={document.content} alt={basename(document.path)} />
                        </div>
                      )
                      : <div className={css.unsupportedPreview}>{t('doc.unsupported')}</div>}
              </div>
            )}
        </div>
      </div>
      {pending !== null && (
        <div
          ref={selectionMenuRef}
          className={css.selectionMenu}
          style={{ left: pending.anchorX, top: Math.max(8, pending.anchorY - 44) }}
          onPointerDown={(event) => { event.stopPropagation() }}
          onMouseDown={(event) => { event.stopPropagation() }}
        >
          <Button variant="ghost" onClick={() => { onMenuAction('ask') }}>{t('selection.ask')}</Button>
          <Button variant="ghost" onClick={() => { onMenuAction('modify') }}>{t('selection.modify')}</Button>
          <Button variant="ghost" onClick={() => { onMenuAction('explain') }}>{t('selection.explain')}</Button>
          <Button variant="ghost" onClick={() => { onMenuAction('summarize') }}>{t('selection.summarize')}</Button>
        </div>
      )}
    </div>
  )
}
