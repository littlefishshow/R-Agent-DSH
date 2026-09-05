// @vitest-environment jsdom
/** Persistent rendered-selection hit testing. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DocumentView } from '../../../src/client/files/DocumentView.tsx'

class ResizeObserverStub {
  observe(): void {}
  disconnect(): void {}
  unobserve(): void {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('DocumentView highlights', () => {
  it('extracts a selected KaTeX expression as readable Markdown source', () => {
    const onSelect = vi.fn()
    render(
      <DocumentView
        content="Value $x^2 + y^2$ done"
        path="/workspace/readme.md"
        draft="Value $x^2 + y^2$ done"
        viewMode="preview"
        fontScale={1}
        highlights={[]}
        onDraftChange={vi.fn()}
        onSelect={onSelect}
        onHighlightClick={vi.fn()}
        readImage={vi.fn()}
        highlightLabel="Open linked selection conversation"
      />,
    )
    const katex = document.querySelector('.katex')
    if (katex === null) throw new Error('KaTeX element missing')
    const range = document.createRange()
    range.selectNode(katex)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 120, height: 20 }),
    })
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.mouseUp(katex)

    expect(onSelect).toHaveBeenCalledWith({
      text: '$x^2 + y^2$',
      visibleStart: 6,
      occurrence: 0,
      anchorX: 160,
      anchorY: 100,
    })
  })

  it('opens the linked sub-window through a real highlight hit target', async () => {
    const onHighlightClick = vi.fn()
    const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    const originalBoundingRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    Range.prototype.getClientRects = () => [{
      bottom: 30,
      height: 20,
      left: 10,
      right: 160,
      top: 10,
      width: 150,
      x: 10,
      y: 10,
      toJSON: () => ({}),
    }] as unknown as DOMRectList
    HTMLElement.prototype.getBoundingClientRect = () => ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    try {
      render(
        <DocumentView
          content="# Persistent selection"
          path="/workspace/readme.md"
          draft="# Persistent selection"
          viewMode="preview"
          fontScale={1}
          highlights={[{
            id: 'selection',
            path: '/workspace/readme.md',
            text: 'Persistent selection',
            visibleStart: 0,
            occurrence: 0,
            sourceStart: 2,
            sourceEnd: 22,
            colorIndex: 0,
          }]}
          onDraftChange={vi.fn()}
          onSelect={vi.fn()}
          onHighlightClick={onHighlightClick}
          readImage={vi.fn()}
          highlightLabel="Open linked selection conversation"
        />,
      )

      const hit = await screen.findByRole('button', { name: 'Open linked selection conversation' })
      expect(hit.getAttribute('data-highlight-id')).toBe('selection')
      await waitFor(() => {
        expect(hit.getAttribute('style')).toContain('left: 10px')
      })
      fireEvent.click(hit)
      expect(onHighlightClick).toHaveBeenCalledWith('selection')
    } finally {
      if (originalRects === undefined) delete (Range.prototype as { getClientRects?: unknown }).getClientRects
      else Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
      if (originalBoundingRect === undefined) {
        delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
      } else {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalBoundingRect)
      }
    }
  })

  it('uses the exact visible offset when the selected text appears more than once', async () => {
    const onHighlightClick = vi.fn()
    const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    const originalBoundingRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    Range.prototype.getClientRects = function getClientRects() {
      const left = this.startOffset === 7 ? 120 : 10
      return [{
        bottom: 30,
        height: 20,
        left,
        right: left + 60,
        top: 10,
        width: 60,
        x: left,
        y: 10,
        toJSON: () => ({}),
      }] as unknown as DOMRectList
    }
    HTMLElement.prototype.getBoundingClientRect = () => ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    })
    try {
      render(
        <DocumentView
          content="repeat repeat"
          path="/workspace/readme.md"
          draft="repeat repeat"
          viewMode="preview"
          fontScale={1}
          highlights={[{
            id: 'second',
            path: '/workspace/readme.md',
            text: 'repeat',
            visibleStart: 7,
            occurrence: 0,
            sourceStart: 7,
            sourceEnd: 13,
            colorIndex: 0,
          }]}
          onDraftChange={vi.fn()}
          onSelect={vi.fn()}
          onHighlightClick={onHighlightClick}
          readImage={vi.fn()}
          highlightLabel="Open linked selection conversation"
        />,
      )

      const hit = await screen.findByRole('button', { name: 'Open linked selection conversation' })
      await waitFor(() => {
        expect(hit.getAttribute('style')).toContain('left: 120px')
      })
      fireEvent.click(hit)
      expect(onHighlightClick).toHaveBeenCalledWith('second')
    } finally {
      if (originalRects === undefined) delete (Range.prototype as { getClientRects?: unknown }).getClientRects
      else Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
      if (originalBoundingRect === undefined) {
        delete (HTMLElement.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect
      } else {
        Object.defineProperty(HTMLElement.prototype, 'getBoundingClientRect', originalBoundingRect)
      }
    }
  })
})
