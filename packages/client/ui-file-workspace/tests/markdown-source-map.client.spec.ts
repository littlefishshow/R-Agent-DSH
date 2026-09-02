/** Markdown visible-text → source-range mapping tests (DOM-free, pure). */
import { describe, expect, it } from 'vitest'
import {
  expandToLines,
  locateMarkdownSource,
  normalizeMarkdownVisibleText,
  nthIndexOf,
} from '../src/client/markdown-source-map.ts'

describe('normalizeMarkdownVisibleText', () => {
  it('strips a heading prefix and maps offsets back to source', () => {
    const source = '# Title here'
    const map = normalizeMarkdownVisibleText(source)
    expect(map.text).toBe('Title here')
    // The first visible char 'T' sits at source offset 2 (after "# ").
    expect(map.offsets[0]).toBe(2)
  })

  it('strips emphasis and code delimiters', () => {
    const map = normalizeMarkdownVisibleText('a **bold** and `code` end')
    expect(map.text).toBe('a bold and code end')
  })

  it('strips block and inline math delimiters', () => {
    const map = normalizeMarkdownVisibleText('see $$x+y$$ and \\(z\\) now')
    expect(map.text).toBe('see x+y and z now')
  })

  it('collapses soft line breaks and list bullets to visible text', () => {
    const map = normalizeMarkdownVisibleText('- one\n- two')
    expect(map.text).toBe('one two')
  })

  it('drops leading whitespace before the first visible character', () => {
    const map = normalizeMarkdownVisibleText('   leading')
    expect(map.text).toBe('leading')
    expect(map.offsets[0]).toBe(3)
  })

  it('keeps link labels while removing destinations and image syntax', () => {
    const source = 'English | [中文](README.zh.md)\n\n![diagram](assets/diagram.png)\n\nAfter'
    const map = normalizeMarkdownVisibleText(source)
    expect(map.text).toBe('English | 中文 After')
  })

  it('removes reference definitions and keeps reference-link labels', () => {
    const source = '[Guide][docs]\n\n[docs]: https://example.com/guide\n\nNext'
    const map = normalizeMarkdownVisibleText(source)
    expect(map.text).toBe('Guide Next')
  })
})

describe('nthIndexOf', () => {
  it('finds the nth occurrence or returns -1', () => {
    expect(nthIndexOf('a.a.a', 'a', 0)).toBe(0)
    expect(nthIndexOf('a.a.a', 'a', 2)).toBe(4)
    expect(nthIndexOf('a.a.a', 'a', 3)).toBe(-1)
    expect(nthIndexOf('abc', '', 0)).toBe(-1)
  })
})

describe('locateMarkdownSource', () => {
  it('locates a plain selection by exact source substring', () => {
    const source = 'The quick brown fox'
    const range = locateMarkdownSource(source, 'quick brown')
    expect(range).toEqual({ start: 4, end: 15 })
    expect(source.slice(range!.start, range!.end)).toBe('quick brown')
  })

  it('locates a selection that spans hidden emphasis delimiters', () => {
    const source = 'make it **really** clear'
    // The reader selected the visible text "it really clear".
    const range = locateMarkdownSource(source, 'it really clear')
    expect(range).toBeDefined()
    expect(source.slice(range!.start, range!.end)).toBe('it **really** clear')
  })

  it('locates a selection under a heading prefix', () => {
    const source = '## Section Two'
    const range = locateMarkdownSource(source, 'Section Two')
    expect(source.slice(range!.start, range!.end)).toBe('Section Two')
  })

  it('locates a selection spanning plain text and a Markdown link label', () => {
    const source = 'English | [中文](README.zh.md)'
    const range = locateMarkdownSource(source, 'English | 中文')
    expect(range).toBeDefined()
    expect(source.slice(range!.start, range!.end)).toBe('English | [中文')
  })

  it('locates normalized readable math against TeX delimiter variants', () => {
    const source = 'Before \\(x^2 + y^2\\) after'
    const range = locateMarkdownSource(source, '$x^2 + y^2$')
    expect(range).toBeDefined()
    expect(source.slice(range!.start, range!.end)).toBe('x^2 + y^2')
  })

  it('honors the occurrence index for a repeated selection', () => {
    const source = 'red green red green'
    const first = locateMarkdownSource(source, 'red', 0)
    const second = locateMarkdownSource(source, 'red', 1)
    expect(first).toEqual({ start: 0, end: 3 })
    expect(second).toEqual({ start: 10, end: 13 })
  })

  it('locates a later occurrence through the normalized fallback path', () => {
    // Both occurrences carry hidden emphasis, so only the normalized path
    // matches; occurrence 1 exercises the fallback's occurrence loop.
    const source = 'take **it** now and take **it** later'
    const range = locateMarkdownSource(source, 'take it', 1)
    expect(range).toBeDefined()
    expect(source.slice(range!.start, range!.end)).toBe('take **it')
  })

  it('returns undefined when the requested occurrence is beyond the matches', () => {
    const source = 'make **it** clear'
    expect(locateMarkdownSource(source, 'make it', 5)).toBeUndefined()
  })

  it('returns undefined when the selection is absent', () => {
    expect(locateMarkdownSource('hello world', 'absent phrase')).toBeUndefined()
    expect(locateMarkdownSource('hello world', '   ')).toBeUndefined()
  })
})

describe('expandToLines', () => {
  it('expands a mid-line range to whole source lines', () => {
    const source = 'line one\nline two here\nline three'
    const range = locateMarkdownSource(source, 'two')!
    const expanded = expandToLines(source, range)
    expect(expanded.text).toBe('line two here')
    expect(source.slice(expanded.range.start, expanded.range.end)).toBe('line two here')
  })

  it('handles a range on the first and last line', () => {
    const source = 'only line'
    const range = locateMarkdownSource(source, 'only')!
    const expanded = expandToLines(source, range)
    expect(expanded.text).toBe('only line')
  })
})
