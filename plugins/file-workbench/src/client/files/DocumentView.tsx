/**
 * The Markdown reader/editor pane. Preview mode renders through the shared
 * MarkdownText primitive and captures text selections from the live DOM;
 * highlights for existing selections are painted with the CSS Custom Highlight
 * API (ranges over text nodes, no DOM rewriting, so MarkdownText's output is
 * untouched). Transparent DOM buttons mirror each painted range's client rects,
 * so highlight clicks carry a stable id instead of reverse hit-testing pointer
 * coordinates. Edit mode is a plain source textarea.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { MarkdownText } from '../primitives/index.ts'
import type { MarkdownImageSources } from '../primitives/index.ts'
import type { HighlightRecord } from './stores.ts'
import {
  paintHighlights, readReadableSelection, resolveHighlightRanges, type HighlightPaintRequest,
} from './highlight-paint.ts'
import { localMarkdownImages } from './markdown-images.ts'
import css from './FileWorkspacePanel.module.css'

/** A visible-text selection captured from the rendered document. */
export interface CapturedSelection {
  /** Readable Markdown for the selection; formulas retain TeX delimiters. */
  text: string
  /** Exact start offset in the rendered document's readable-text projection. */
  visibleStart: number
  /** Which occurrence of that text within the document's visible text (0-based). */
  occurrence: number
  /** Viewport coordinates to anchor the action menu near. */
  anchorX: number
  anchorY: number
}

/** One clickable rectangle over a painted selection fragment. */
interface HighlightHitTarget {
  id: string
  key: string
  left: number
  top: number
  width: number
  height: number
}

/** The Markdown document view (preview or edit), with selection capture and highlight painting. */
export function DocumentView(props: {
  content: string
  path: string
  draft: string
  viewMode: 'preview' | 'edit'
  fontScale: number
  highlights: HighlightRecord[]
  onDraftChange: (text: string) => void
  onSelect: (selection: CapturedSelection) => void
  onHighlightClick: (id: string) => void
  readImage: (path: string) => Promise<{ dataUrl: string }>
  highlightLabel: string
}) {
  const {
    content, path, draft, viewMode, fontScale, highlights, onDraftChange, onSelect, onHighlightClick, readImage,
    highlightLabel,
  } = props
  const previewRef = useRef<HTMLDivElement | null>(null)
  const [imageSources, setImageSources] = useState<Record<string, string>>({})
  const [hitTargets, setHitTargets] = useState<HighlightHitTarget[]>([])

  useEffect(() => {
    let active = true
    const images = localMarkdownImages(path, content)
    setImageSources({})
    for (const image of images) {
      void readImage(image.path).then(({ dataUrl }) => {
        if (!active) return
        setImageSources(current => ({ ...current, [image.authoredUrl]: dataUrl }))
      }, () => {})
    }
    return () => { active = false }
  }, [content, path, readImage])

  const markdownImageSources = useMemo<MarkdownImageSources>(
    () => ({
      resolve: (url) => {
        const direct = imageSources[url]
        if (direct !== undefined) return direct
        try {
          return imageSources[decodeURIComponent(url)]
        } catch {
          return undefined
        }
      },
    }),
    [imageSources],
  )

  const handleMouseUp = useCallback(() => {
    const container = previewRef.current
    if (container === null) return
    const selection = window.getSelection()
    if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return
    const range = selection.getRangeAt(0)
    if (!container.contains(range.commonAncestorContainer)) return
    const readable = readReadableSelection(container, range)
    if (readable === undefined) return
    const rect = range.getBoundingClientRect()
    onSelect({ ...readable, anchorX: rect.left + rect.width / 2, anchorY: rect.top })
  }, [onSelect])

  // Paint highlights over the live preview text with the CSS Custom Highlight
  // API. Re-runs whenever the highlight set or the rendered content changes.
  const paintRequests = useMemo<HighlightPaintRequest[]>(
    () => highlights.map(h => ({
      id: h.id,
      text: h.text,
      visibleStart: h.visibleStart,
      occurrence: h.occurrence,
    })),
    [highlights],
  )
  useEffect(() => {
    if (viewMode !== 'preview') {
      setHitTargets([])
      return
    }
    const container = previewRef.current
    if (container === null) return
    const cleanup = paintHighlights(container, paintRequests)
    const updateTargets = (): void => {
      const bounds = container.getBoundingClientRect()
      const next = resolveHighlightRanges(container, paintRequests).flatMap(painted =>
        (typeof painted.range.getClientRects === 'function'
          ? Array.from(painted.range.getClientRects())
          : []
        ).map((rect, index) => ({
          id: painted.id,
          key: `${painted.id}:${index}`,
          left: rect.left - bounds.left + container.scrollLeft,
          top: rect.top - bounds.top + container.scrollTop,
          width: rect.width,
          height: rect.height,
        })))
      setHitTargets(current => sameHitTargets(current, next) ? current : next)
    }
    updateTargets()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(updateTargets)
    observer?.observe(container)
    container.addEventListener('scroll', updateTargets)
    globalThis.addEventListener('resize', updateTargets)
    return () => {
      cleanup()
      observer?.disconnect()
      container.removeEventListener('scroll', updateTargets)
      globalThis.removeEventListener('resize', updateTargets)
    }
  }, [viewMode, paintRequests, content, markdownImageSources, fontScale])

  if (viewMode === 'edit') {
    return (
      <div className={css.docContent} style={{ '--dsh-file-font-scale': fontScale } as CSSProperties}>
        <textarea
          className={css.editor}
          value={draft}
          spellCheck={false}
          onChange={(e) => { onDraftChange(e.target.value) }}
        />
      </div>
    )
  }
  return (
    <div
      ref={previewRef}
      className={css.docContent}
      style={{ '--dsh-file-font-scale': fontScale } as CSSProperties}
      onMouseUp={handleMouseUp}
    >
      <div className={css.rendered}>
        <MarkdownText text={content} imageSources={markdownImageSources} />
      </div>
      <div className={css.highlightHitLayer}>
        {hitTargets.map(target => (
          <button
            key={target.key}
            type="button"
            className={css.highlightHit}
            data-highlight-id={target.id}
            aria-label={highlightLabel}
            style={{
              left: target.left,
              top: target.top,
              width: target.width,
              height: target.height,
            }}
            onPointerDown={(event) => {
              event.preventDefault()
              event.stopPropagation()
            }}
            onMouseUp={(event) => { event.stopPropagation() }}
            onClick={(event) => {
              event.preventDefault()
              event.stopPropagation()
              onHighlightClick(target.id)
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** Avoid a render loop when ResizeObserver reports unchanged range geometry. */
function sameHitTargets(current: HighlightHitTarget[], next: HighlightHitTarget[]): boolean {
  if (current.length !== next.length) return false
  return current.every((target, index) => {
    const candidate = next[index]
    return candidate !== undefined
      && target.id === candidate.id
      && target.key === candidate.key
      && target.left === candidate.left
      && target.top === candidate.top
      && target.width === candidate.width
      && target.height === candidate.height
  })
}
