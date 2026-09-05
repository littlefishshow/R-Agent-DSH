/**
 * Map a selection made in rendered Markdown back to a range in the raw source.
 * The rendered document hides Markdown syntax — heading/list/quote prefixes,
 * emphasis and code delimiters, and math delimiters (`$$`, `\[`, `\]`, `\(`,
 * `\)`) — so the visible text a user selects does not line up with source
 * offsets. This module normalizes the source into its visible text while
 * keeping, for every visible character, the source offset it came from, then
 * locates the selection in that normalized text and translates the match back
 * to a source range. Ported from the R-Agent Cockpit selection normalizer.
 *
 * These are pure functions over strings so they are unit-testable without a DOM.
 */

/** A visible-text string paired with the source offset of each visible character. */
export interface VisibleTextMap {
  /** The source reduced to what a reader sees, with runs of whitespace collapsed to one space. */
  text: string
  /** For each index in {@link text}, the offset in the original source it maps to. */
  offsets: number[]
}

/** A resolved source range for a located selection. */
export interface SourceRange {
  /** Inclusive start offset in the source. */
  start: number
  /** Exclusive end offset in the source. */
  end: number
}

// Line-leading Markdown structure removed from the visible text: heading
// hashes, blockquote markers, and unordered/ordered list bullets.
const LINE_PREFIX = /^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/
// Inline emphasis/code delimiters removed from the visible text.
const INLINE_DELIMITER = /^(?:\*\*\*|\*\*|\*|___|__|_|~~|`+)/
// Math delimiters removed from the visible text (block and inline).
const MATH_DELIMITER = /^(?:\$\$|\\\[|\\\]|\\\(|\\\))/

/** Mark a source span as syntax hidden by the settled Markdown renderer. */
function ignoreSpan(ignored: boolean[], start: number, end: number): void {
  for (let index = start; index < end; index += 1) ignored[index] = true
}

/**
 * Mark link/image syntax while preserving the visible link label. This is a
 * deliberately narrow scanner for the CommonMark forms whose destinations
 * disappear from the rendered DOM.
 */
function markLinkSyntax(source: string, ignored: boolean[]): void {
  const definitions = /^[ \t]{0,3}\[[^\]\n]+\]:[^\n]*(?:\n|$)/gm
  for (const match of source.matchAll(definitions)) {
    const start = match.index
    ignoreSpan(ignored, start, start + match[0].length)
  }

  const inline = /(!?)\[([^\]\n]+)\]\((?:\\.|[^)\n])*\)/g
  for (const match of source.matchAll(inline)) {
    const start = match.index
    const label = match[2] ?? ''
    if (match[1] === '!') {
      ignoreSpan(ignored, start, start + match[0].length)
      continue
    }
    const labelStart = start + 1
    ignoreSpan(ignored, start, labelStart)
    ignoreSpan(ignored, labelStart + label.length, start + match[0].length)
  }

  const reference = /(!?)\[([^\]\n]+)\]\s*\[[^\]\n]*\]/g
  for (const match of source.matchAll(reference)) {
    const start = match.index
    const label = match[2] ?? ''
    if (match[1] === '!') {
      ignoreSpan(ignored, start, start + match[0].length)
      continue
    }
    const labelStart = start + 1
    ignoreSpan(ignored, start, labelStart)
    ignoreSpan(ignored, labelStart + label.length, start + match[0].length)
  }
}

/** Mark paired single-dollar inline-math delimiters without hiding currency. */
function markInlineMathSyntax(source: string, ignored: boolean[]): void {
  const inlineMath = /(?<![\\$])\$(?!\$)([^$\n]+?)(?<![\\$])\$(?!\$)/g
  for (const match of source.matchAll(inlineMath)) {
    const start = match.index
    ignored[start] = true
    ignored[start + match[0].length - 1] = true
  }
}

/**
 * Reduce Markdown source to its visible text while recording, per visible
 * character, the source offset it came from. Whitespace runs collapse to a
 * single space so a selection that crosses a soft line break still matches.
 * @param source - raw Markdown source.
 * @returns the visible text and its per-character source-offset map.
 */
export function normalizeMarkdownVisibleText(source: string): VisibleTextMap {
  const text: string[] = []
  const offsets: number[] = []
  const ignored = new Array<boolean>(source.length).fill(false)
  markLinkSyntax(source, ignored)
  markInlineMathSyntax(source, ignored)
  let i = 0
  let atLineStart = true
  let pendingSpace = false
  const pushChar = (ch: string, at: number): void => {
    if (pendingSpace) {
      // A collapsed whitespace run only becomes a visible space between two
      // visible characters, never leading.
      if (text.length > 0) {
        text.push(' ')
        offsets.push(at)
      }
      pendingSpace = false
    }
    text.push(ch)
    offsets.push(at)
  }
  while (i < source.length) {
    if (ignored[i]) {
      i += 1
      continue
    }
    if (atLineStart) {
      const prefix = LINE_PREFIX.exec(source.slice(i))
      if (prefix !== null) {
        i += prefix[0].length
        atLineStart = false
        continue
      }
      atLineStart = false
    }
    const ch = source.charAt(i)
    if (ch === '\n') {
      pendingSpace = true
      atLineStart = true
      i += 1
      continue
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      pendingSpace = true
      i += 1
      continue
    }
    const rest = source.slice(i)
    const math = MATH_DELIMITER.exec(rest)
    if (math !== null) {
      i += math[0].length
      continue
    }
    const delimiter = INLINE_DELIMITER.exec(rest)
    if (delimiter !== null) {
      i += delimiter[0].length
      continue
    }
    pushChar(ch, i)
    i += 1
  }
  return { text: text.join(''), offsets }
}

/**
 * Locate a visible-text selection in Markdown source and return its source
 * range. Tries an exact source substring first (the common case for a
 * selection with no hidden syntax inside it), then falls back to matching
 * against the whitespace-collapsed visible text so a selection spanning
 * emphasis, code, or math delimiters still resolves.
 * @param source - raw Markdown source.
 * @param selected - the visible text the user selected.
 * @param occurrence - which match to take when the selection is not unique (0-based, default 0).
 * @returns the source range, or undefined when the selection cannot be located.
 */
export function locateMarkdownSource(
  source: string,
  selected: string,
  occurrence = 0,
): SourceRange | undefined {
  const exact = nthIndexOf(source, selected, occurrence)
  if (exact >= 0) return { start: exact, end: exact + selected.length }

  const query = normalizeMarkdownVisibleText(selected).text
  if (query === '') return undefined
  const map = normalizeMarkdownVisibleText(source)
  const hay = map.text
  let from = 0
  let seen = 0
  for (;;) {
    const at = hay.indexOf(query, from)
    if (at < 0) return undefined
    if (seen === occurrence) {
      const start = map.offsets[at]
      // The last matched visible char maps to a source offset; the source range
      // ends one source character past it.
      const lastVisible = map.offsets[at + query.length - 1]
      /* v8 ignore next -- a match found in the normalized text is always within the offset map; the guard narrows the index type. */
      if (start === undefined || lastVisible === undefined) return undefined
      return { start, end: lastVisible + 1 }
    }
    seen += 1
    from = at + 1
  }
}

/**
 * Index of the nth occurrence of a substring, or -1.
 * @param haystack - the string to search.
 * @param needle - the substring to find (empty returns -1).
 * @param n - 0-based occurrence.
 * @returns the index of the nth occurrence, or -1.
 */
export function nthIndexOf(haystack: string, needle: string, n: number): number {
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
 * Expand a source range to whole lines: the start moves back to its line start
 * and the end moves forward to its line end. A modify branch replaces whole
 * source lines, so the range it targets must be line-aligned.
 * @param source - raw Markdown source.
 * @param range - the located source range.
 * @returns the line-aligned source range and the source text it covers.
 */
export function expandToLines(source: string, range: SourceRange): { range: SourceRange; text: string } {
  let start = range.start
  while (start > 0 && source[start - 1] !== '\n') start -= 1
  let end = range.end
  while (end < source.length && source[end] !== '\n') end += 1
  return { range: { start, end }, text: source.slice(start, end) }
}
