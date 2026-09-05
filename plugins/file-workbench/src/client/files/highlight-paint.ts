/**
 * Paint selection highlights over live rendered text using the CSS Custom
 * Highlight API. This locates each highlight's text (by occurrence) within the
 * container's flattened text nodes, builds a Range for it, and registers ALL of
 * them under one shared named highlight in the global `CSS.highlights` registry
 * (`dsh-fw-selection`, styled by highlight.css) — so the paint never rewrites
 * MarkdownText's DOM, one static `::highlight()` rule covers every selection,
 * and re-highlighting after a sub-window minimizes is just a re-run. Falls back
 * to a no-op cleanup when the API is unavailable (older engines), which the
 * chip strip covers.
 */
import './highlight.css'

/** One highlight to paint: its id, the visible text, and which occurrence to paint. */
export interface HighlightPaintRequest {
  /** Highlight id (used by the panel to resolve clicks; not part of the paint name). */
  id: string
  /** The visible text to paint. */
  text: string
  /** Exact start offset in the rendered document's flattened visible text. */
  visibleStart: number
  /** Which occurrence of the text within the container (0-based). */
  occurrence: number
}

/** One painted highlight's live DOM range, used for click hit-testing. */
export interface PaintedHighlight {
  /** Highlight/window identity. */
  id: string
  /** Live range over the rendered Markdown text. */
  range: Range
}

/** Readable selection extracted from the rendered Markdown DOM. */
export interface ReadableSelection {
  /** Plain readable text; a KaTeX subtree contributes its TeX annotation once. */
  text: string
  /** Exact start offset in the same flattened readable-text stream. */
  visibleStart: number
  /** Which occurrence of `text` begins at `visibleStart`. */
  occurrence: number
}

/** The single shared CSS highlight registry name every workbench selection paints under. */
const HIGHLIGHT_NAME = 'dsh-fw-selection'

/** Minimal shape of the CSS Custom Highlight API this module uses. */
interface HighlightApi {
  highlights: {
    set(name: string, highlight: object): void
    delete(name: string): void
  }
  Highlight: new (...ranges: Range[]) => object
}

/** Resolve the CSS Custom Highlight API when the engine supports it. */
function highlightApi(): HighlightApi | undefined {
  const css = (globalThis as { CSS?: { highlights?: unknown } }).CSS
  const Highlight = (globalThis as { Highlight?: unknown }).Highlight
  if (css?.highlights === undefined || typeof Highlight !== 'function') return undefined
  return { highlights: css.highlights as HighlightApi['highlights'], Highlight: Highlight as HighlightApi['Highlight'] }
}

interface TextSegment {
  kind: 'text'
  node: Text
  text: string
  start: number
}

interface MathSegment {
  kind: 'math'
  element: HTMLElement
  text: string
  start: number
}

type ReadableSegment = TextSegment | MathSegment

/** Flatten rendered Markdown while treating each KaTeX tree as one TeX source segment. */
function readableIndex(container: HTMLElement): ReadableSegment[] {
  const segments: ReadableSegment[] = []
  let offset = 0
  const visit = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (text !== '') {
        segments.push({ kind: 'text', node: node as Text, text, start: offset })
        offset += text.length
      }
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const element = node as HTMLElement
    if (element.classList.contains('katex')) {
      const source = element.querySelector('annotation')?.textContent ?? ''
      const text = element.closest('.katex-display') === null ? `$${source}$` : `$$\n${source}\n$$`
      if (text !== '') {
        segments.push({ kind: 'math', element, text, start: offset })
        offset += text.length
      }
      return
    }
    if (element.matches('script, style, svg, math') || element.getAttribute('aria-hidden') === 'true') return
    for (const child of element.childNodes) visit(child)
  }
  visit(container)
  return segments
}

/** Build a Range spanning [start, end) character offsets across flattened text nodes. */
function rangeForSpan(
  index: ReadableSegment[],
  start: number,
  end: number,
): Range | undefined {
  let startSegment: ReadableSegment | undefined
  let endSegment: ReadableSegment | undefined
  for (const entry of index) {
    const segmentEnd = entry.start + entry.text.length
    if (startSegment === undefined && start >= entry.start && start < segmentEnd) startSegment = entry
    if (end > entry.start && end <= segmentEnd) endSegment = entry
  }
  if (startSegment === undefined || endSegment === undefined) return undefined
  const range = document.createRange()
  if (startSegment.kind === 'text') range.setStart(startSegment.node, start - startSegment.start)
  else range.setStartBefore(startSegment.element)
  if (endSegment.kind === 'text') range.setEnd(endSegment.node, end - endSegment.start)
  else range.setEndAfter(endSegment.element)
  return range
}

/** Whether a DOM Range intersects a node in engines that implement Range.intersectsNode. */
function intersects(range: Range, node: Node): boolean {
  try {
    return range.intersectsNode(node)
  } catch {
    return false
  }
}

/**
 * Extract a stable, readable selection from rendered Markdown. KaTeX's visual
 * and MathML subtrees duplicate glyphs in native `Selection.toString()`; this
 * projection contributes the TeX annotation once instead.
 * @param container - rendered Markdown root.
 * @param range - live browser selection range.
 * @returns readable text and its offset, or undefined for an empty selection.
 */
export function readReadableSelection(container: HTMLElement, range: Range): ReadableSelection | undefined {
  const index = readableIndex(container)
  let selected = ''
  let firstStart: number | undefined
  for (const segment of index) {
    if (segment.kind === 'math') {
      if (!intersects(range, segment.element)) continue
      firstStart ??= segment.start
      selected += segment.text
      continue
    }
    if (!intersects(range, segment.node)) continue
    let from = 0
    let to = segment.text.length
    if (range.startContainer === segment.node) from = range.startOffset
    if (range.endContainer === segment.node) to = range.endOffset
    if (to <= from) continue
    firstStart ??= segment.start + from
    selected += segment.text.slice(from, to)
  }
  const leadingWhitespace = selected.length - selected.trimStart().length
  const text = selected.trim()
  if (text === '' || firstStart === undefined) return undefined
  const visibleStart = firstStart + leadingWhitespace
  const fullText = index.map(segment => segment.text).join('')
  return {
    text,
    visibleStart,
    occurrence: occurrenceBefore(fullText, text, visibleStart),
  }
}

/** Count matching occurrences that begin before an exact visible offset. */
function occurrenceBefore(source: string, text: string, offset: number): number {
  let occurrence = 0
  let from = 0
  for (;;) {
    const at = source.indexOf(text, from)
    if (at < 0 || at >= offset) return occurrence
    occurrence += 1
    from = at + 1
  }
}

/** Index of the nth occurrence of a substring (0-based), or -1. */
function nthIndexOf(haystack: string, needle: string, n: number): number {
  if (needle === '') return -1
  let from = 0
  let seen = 0
  for (;;) {
    const at = haystack.indexOf(needle, from)
    if (at < 0) return -1
    if (seen === n) return at
    seen += 1
    from = at + 1
  }
}

/**
 * Paint the requested highlights over the container's text and return a cleanup
 * that removes them from the registry. A request whose text cannot be located
 * (the document changed) is skipped; the rest still paint.
 * @param container - the rendered document element.
 * @param requests - the highlights to paint.
 * @returns a cleanup disposer removing every registered highlight.
 */
export function resolveHighlightRanges(
  container: HTMLElement,
  requests: HighlightPaintRequest[],
): PaintedHighlight[] {
  const index = readableIndex(container)
  const text = index.map(entry => entry.text).join('')
  const painted: PaintedHighlight[] = []
  for (const request of requests) {
    const exactStart = request.visibleStart
    const start = text.slice(exactStart, exactStart + request.text.length) === request.text
      ? exactStart
      : nthIndexOf(text, request.text, request.occurrence)
    if (start < 0) continue
    const range = rangeForSpan(index, start, start + request.text.length)
    if (range !== undefined) painted.push({ id: request.id, range })
  }
  return painted
}

/**
 * Paint the requested highlights over the container's text and return a cleanup
 * that removes them from the registry.
 * @param container - the rendered document element.
 * @param requests - the highlights to paint.
 * @returns a cleanup disposer removing every registered highlight.
 */
export function paintHighlights(container: HTMLElement, requests: HighlightPaintRequest[]): () => void {
  const api = highlightApi()
  if (api === undefined) return () => {}
  const ranges = resolveHighlightRanges(container, requests).map(item => item.range)
  if (ranges.length === 0) {
    api.highlights.delete(HIGHLIGHT_NAME)
    return () => {}
  }
  api.highlights.set(HIGHLIGHT_NAME, new api.Highlight(...ranges))
  return () => {
    api.highlights.delete(HIGHLIGHT_NAME)
  }
}
