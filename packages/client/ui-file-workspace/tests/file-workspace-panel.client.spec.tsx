// @vitest-environment jsdom
/** Markdown reader controls and local-image integration tests. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FileWorkspacePanel } from '../src/client/FileWorkspacePanel.tsx'
import { SubWindows } from '../src/client/SubWindows.tsx'
import type { FileWorkspacePanelProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'
import { createFileWorkspaceStore } from '../src/client/stores.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('FileWorkspacePanel', () => {
  it('previews source text, images, and unsupported binary files without Markdown rendering', () => {
    const store = createFileWorkspaceStore().create()
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    const view = render(<FileWorkspacePanel {...props} />)

    act(() => {
      store.actions.openDocument({
        path: '/workspace/script.py',
        content: 'print("hello")',
        version: 'v1',
        workspaceId: 'workspace',
        previewKind: 'text',
        draft: 'print("hello")',
        dirty: false,
        viewMode: 'preview',
      })
    })
    expect(screen.getByText('print("hello")')).toBeTruthy()

    act(() => {
      store.actions.openDocument({
        path: '/workspace/diagram.png',
        content: 'data:image/png;base64,AQ==',
        version: '',
        workspaceId: 'workspace',
        previewKind: 'image',
        draft: 'data:image/png;base64,AQ==',
        dirty: false,
        viewMode: 'preview',
      })
    })
    expect(screen.getByRole('img', { name: 'diagram.png' }).getAttribute('src'))
      .toBe('data:image/png;base64,AQ==')

    act(() => {
      store.actions.openDocument({
        path: '/workspace/paper.pdf',
        content: '',
        version: '',
        workspaceId: 'workspace',
        previewKind: 'unsupported',
        draft: '',
        dirty: false,
        viewMode: 'preview',
      })
    })
    expect(screen.getByText('Preview is not available for this file type.')).toBeTruthy()
    view.unmount()
  })

  it('restores a durable highlight after reload and opens its minimized child window', async () => {
    const store = createFileWorkspaceStore().create()
    const mode = createSnapshotStore<'chat' | 'files'>('files')
    const restorableSelections = createSnapshotStore({
      phase: 'ready' as const,
      items: [{
        id: 'restored',
        sessionId: 'child-session' as SessionId,
        workspaceId: 'workspace',
        path: '/workspace/readme.md',
        fileVersion: 'v1',
        selectedText: 'Persistent selection',
        lineContext: '# Persistent selection',
        action: 'explain' as const,
        visibleStart: 0,
        occurrence: 0,
        sourceStart: 0,
        sourceEnd: 22,
        colorIndex: 2,
        title: 'Explain · Persistent selection',
        branchStartSeq: -1,
      }],
    })
    const childViews = createSnapshotStore({
      'child-session': {
        messages: [{ role: 'assistant' as const, text: 'restored answer', seq: 3 }],
        running: false,
      },
    })
    const readText = vi.fn(async () => ({
      path: '/workspace/readme.md',
      content: '# Persistent selection',
      version: 'v1',
      fileIndex: '/workspace/readme.md',
      updatedAt: '2026-09-02T00:00:00.000Z',
    }))
    const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
    const originalBoundingRect = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'getBoundingClientRect')
    Range.prototype.getClientRects = () => [{
      bottom: 30, height: 20, left: 10, right: 160, top: 10, width: 150, x: 10, y: 10,
      toJSON: () => ({}),
    }] as unknown as DOMRectList
    HTMLElement.prototype.getBoundingClientRect = () => ({
      bottom: 300, height: 300, left: 0, right: 600, top: 0, width: 600, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readText,
      readImage: vi.fn(),
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    try {
      render(
        <>
          <FileWorkspacePanel {...props} />
          <SubWindows
            {...props}
            useChildViews={bindSnapshotSelector(childViews)}
            useMode={bindSnapshotSelector(mode)}
            useRestorableSelections={bindSnapshotSelector(restorableSelections)}
            sendFollowUp={vi.fn()}
            stopChildSession={vi.fn()}
            deleteSelectionSession={vi.fn()}
            watchChildSession={vi.fn(() => vi.fn())}
          />
        </>,
      )

      await waitFor(() => {
        expect(readText).toHaveBeenCalledWith('/workspace/readme.md')
        expect(store.getSnapshot().windows.restored).toMatchObject({ minimized: true })
      })
      const highlight = await screen.findByRole('button', { name: 'Open linked selection conversation' })
      fireEvent.click(highlight)
      expect(store.getSnapshot().windows.restored).toMatchObject({ minimized: false })
      expect(screen.getByText('restored answer')).toBeTruthy()
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

  it('keeps multiple open documents as selectable, closable tabs', () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/one.md',
      content: '# One',
      version: 'v1',
      workspaceId: 'workspace',
      draft: '# One',
      dirty: false,
      viewMode: 'preview',
    })
    store.actions.openDocument({
      path: '/workspace/two.md',
      content: '# Two',
      version: 'v2',
      workspaceId: 'workspace',
      draft: '# Two',
      dirty: false,
      viewMode: 'preview',
    })
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en, params?: Record<string, unknown>) =>
        en[key].replace('{name}', typeof params?.name === 'string' ? params.name : ''),
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    render(<FileWorkspacePanel {...props} />)

    expect(screen.getByRole('tablist', { name: 'Open files' })).toBeTruthy()
    expect(screen.getByRole('tab', { name: 'one.md' }).querySelector('svg')).toBeNull()
    expect(screen.getByRole('tab', { name: 'two.md' }).querySelector('svg')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Two' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: 'one.md' }))
    expect(screen.getByRole('heading', { name: 'One' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close one.md' }))
    expect(screen.queryByRole('tab', { name: 'one.md' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Two' })).toBeTruthy()
  })

  it('changes the reading scale and resolves relative Markdown images through host IO', async () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/docs/readme.md',
      content: '# Guide\n\n![diagram](../assets/diagram.png)',
      version: 'v1',
      workspaceId: 'workspace',
      draft: '# Guide\n\n![diagram](../assets/diagram.png)',
      dirty: false,
      viewMode: 'preview',
    })
    const readImage = vi.fn(async (path: string) => ({
      path,
      mediaType: 'image/png' as const,
      dataUrl: 'data:image/png;base64,AQ==',
    }))
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage,
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps

    const childViews = createSnapshotStore({})
    render(
      <>
        <FileWorkspacePanel {...props} />
        <SubWindows
          {...props}
          useChildViews={bindSnapshotSelector(childViews)}
          useMode={bindSnapshotSelector(createSnapshotStore<'chat' | 'files'>('files'))}
          useRestorableSelections={bindSnapshotSelector(createSnapshotStore({
            phase: 'ready' as const,
            items: [],
          }))}
          sendFollowUp={vi.fn()}
          stopChildSession={vi.fn()}
          deleteSelectionSession={vi.fn()}
          watchChildSession={vi.fn(() => vi.fn())}
        />
      </>,
    )
    expect(screen.getByText('100%')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'A+' }))
    expect(screen.getByText('110%')).toBeTruthy()

    await waitFor(() => {
      expect(readImage).toHaveBeenCalledWith('/workspace/assets/diagram.png')
      expect(screen.getByRole('img', { name: 'diagram' }).getAttribute('src'))
        .toBe('data:image/png;base64,AQ==')
    })
  })

  it.each([
    ['Ask', 'ask', 'Enter your specific question…', 'What does this mean?'],
    ['Modify', 'modify', 'Describe the requested change…', 'Make it shorter.'],
  ] as const)('highlights immediately and waits for explicit input before %s starts', async (
    label,
    action,
    placeholder,
    instruction,
  ) => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/readme.md',
      content: '# Selected paragraph',
      version: 'v1',
      workspaceId: 'workspace',
      draft: '# Selected paragraph',
      dirty: false,
      viewMode: 'preview',
    })
    const startSelectionSession = vi.fn(async (_input: Parameters<FileWorkspacePanelProps['startSelectionSession']>[0]) => ({
      sessionId: 'child-session' as SessionId,
      branchStartSeq: 4,
      title: instruction,
    }))
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession,
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    const view = render(
      <>
        <FileWorkspacePanel {...props} />
        <SubWindows
          {...props}
          useChildViews={bindSnapshotSelector(createSnapshotStore({}))}
          useMode={bindSnapshotSelector(createSnapshotStore<'chat' | 'files'>('files'))}
          useRestorableSelections={bindSnapshotSelector(createSnapshotStore({
            phase: 'ready' as const,
            items: [],
          }))}
          sendFollowUp={vi.fn()}
          stopChildSession={vi.fn()}
          deleteSelectionSession={vi.fn()}
          watchChildSession={vi.fn(() => vi.fn())}
        />
      </>,
    )
    const heading = screen.getByRole('heading', { name: 'Selected paragraph' })
    const textNode = heading.firstChild
    if (textNode === null) throw new Error('heading text node missing')
    const range = document.createRange()
    range.selectNodeContents(textNode)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 120, height: 20 }),
    })
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)

    fireEvent.mouseUp(heading)
    expect(Object.values(store.getSnapshot().highlights)).toHaveLength(1)
    expect(Object.values(store.getSnapshot().highlights)[0]?.visibleStart).toBe(0)
    expect(Object.values(store.getSnapshot().windows)).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: label }))

    expect(Object.values(store.getSnapshot().windows)).toHaveLength(1)
    expect(Object.values(store.getSnapshot().highlights)).toHaveLength(1)
    expect(screen.getByText(`${label} · Selected paragraph`)).toBeTruthy()
    expect(startSelectionSession).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value: instruction } })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(screen.getByText('Creating branch…')).toBeTruthy()
    expect(startSelectionSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace',
      path: '/workspace/readme.md',
      fileVersion: 'v1',
      selectedText: 'Selected paragraph',
      lineContext: '# Selected paragraph',
      action,
      instruction,
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 0,
      sourceEnd: 20,
      colorIndex: 0,
    }))
    expect(startSelectionSession.mock.calls[0]?.[0].selectionId).toMatch(/^sel-/)
    await waitFor(() => {
      expect(Object.values(store.getSnapshot().windows)[0]).toMatchObject({
        sessionId: 'child-session',
        branchStartSeq: 4,
        title: instruction,
      })
    })
    view.unmount()
  })

  it('opens a modify draft window for a selection spanning a Markdown link', () => {
    const content = 'English | [中文](README.zh.md)'
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/readme.md',
      content,
      version: 'v1',
      workspaceId: 'workspace',
      draft: content,
      dirty: false,
      viewMode: 'preview',
    })
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    render(
      <>
        <FileWorkspacePanel {...props} />
        <SubWindows
          {...props}
          useChildViews={bindSnapshotSelector(createSnapshotStore({}))}
          useMode={bindSnapshotSelector(createSnapshotStore<'chat' | 'files'>('files'))}
          useRestorableSelections={bindSnapshotSelector(createSnapshotStore({
            phase: 'ready' as const,
            items: [],
          }))}
          sendFollowUp={vi.fn()}
          stopChildSession={vi.fn()}
          deleteSelectionSession={vi.fn()}
          watchChildSession={vi.fn(() => vi.fn())}
        />
      </>,
    )
    const paragraph = screen.getByText((_, element) =>
      element?.tagName === 'P' && element.textContent === 'English | 中文')
    const textNodes = [...paragraph.childNodes].flatMap((node) => {
      if (node.nodeType === Node.TEXT_NODE) return [node]
      return [...node.childNodes].filter(child => child.nodeType === Node.TEXT_NODE)
    })
    const first = textNodes[0]
    const last = textNodes[textNodes.length - 1]
    if (first === undefined || last === undefined) throw new Error('link-spanning text nodes missing')
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(last, last.textContent?.length ?? 0)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 120, height: 20 }),
    })
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.mouseUp(paragraph)
    fireEvent.click(screen.getByRole('button', { name: 'Modify' }))

    expect(screen.getByText('Modify · English | 中文')).toBeTruthy()
    expect(screen.getByPlaceholderText('Describe the requested change…')).toBeTruthy()
  })

  it('starts Explain immediately after the highlighted selection chooses the action', async () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/readme.md',
      content: '# Selected paragraph',
      version: 'v1',
      workspaceId: 'workspace',
      draft: '# Selected paragraph',
      dirty: false,
      viewMode: 'preview',
    })
    const startSelectionSession = vi.fn(async (_input: Parameters<FileWorkspacePanelProps['startSelectionSession']>[0]) => ({
      sessionId: 'child-session' as SessionId,
      branchStartSeq: 4,
      title: 'Explain · Selected paragraph',
    }))
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession,
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    render(<FileWorkspacePanel {...props} />)
    const heading = screen.getByRole('heading', { name: 'Selected paragraph' })
    const textNode = heading.firstChild
    if (textNode === null) throw new Error('heading text node missing')
    const range = document.createRange()
    range.selectNodeContents(textNode)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 120, height: 20 }),
    })
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.mouseUp(heading)
    fireEvent.click(screen.getByRole('button', { name: 'Explain' }))

    expect(startSelectionSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace',
      path: '/workspace/readme.md',
      fileVersion: 'v1',
      selectedText: 'Selected paragraph',
      lineContext: '# Selected paragraph',
      action: 'explain',
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 0,
      sourceEnd: 20,
      colorIndex: 0,
    }))
    expect(startSelectionSession.mock.calls[0]?.[0].selectionId).toMatch(/^sel-/)
  })

  it('uses the reader text rather than a divergent native selection string', async () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/readme.md',
      content: 'source text',
      version: 'v1',
      workspaceId: 'workspace',
      draft: 'source text',
      dirty: false,
      viewMode: 'preview',
    })
    const startSelectionSession = vi.fn(async () => ({
      sessionId: 'child-session',
      branchStartSeq: -1,
      title: 'Why is this rendered differently?',
    }))
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession,
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    render(
      <>
        <FileWorkspacePanel {...props} />
        <SubWindows
          {...props}
          useChildViews={bindSnapshotSelector(createSnapshotStore({}))}
          useMode={bindSnapshotSelector(createSnapshotStore<'chat' | 'files'>('files'))}
          useRestorableSelections={bindSnapshotSelector(createSnapshotStore({
            phase: 'ready' as const,
            items: [],
          }))}
          sendFollowUp={vi.fn()}
          stopChildSession={vi.fn()}
          deleteSelectionSession={vi.fn()}
          watchChildSession={vi.fn(() => vi.fn())}
        />
      </>,
    )

    const content = screen.getByText('source text')
    const textNode = content.firstChild
    if (textNode === null) throw new Error('document text node missing')
    const range = document.createRange()
    range.selectNodeContents(textNode)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 120, height: 20 }),
    })
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      rangeCount: 1,
      getRangeAt: () => range,
      toString: () => 'rendered-only text',
      removeAllRanges: vi.fn(),
    } as unknown as Selection)

    fireEvent.mouseUp(content)
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }))

    expect(Object.values(store.getSnapshot().windows)).toHaveLength(1)
    expect(screen.getByText('Ask · source text')).toBeTruthy()
    expect(startSelectionSession).not.toHaveBeenCalled()
    fireEvent.change(screen.getByPlaceholderText('Enter your specific question…'), {
      target: { value: 'Why is this rendered differently?' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(startSelectionSession).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId: 'workspace',
      fileVersion: 'v1',
      selectedText: 'source text',
      lineContext: 'source text',
      action: 'ask',
      instruction: 'Why is this rendered differently?',
    }))
  })

  it('dismisses an unchosen selection menu and its temporary highlight on outside pointer down', () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/readme.md',
      content: '# Temporary selection',
      version: 'v1',
      workspaceId: 'workspace',
      draft: '# Temporary selection',
      dirty: false,
      viewMode: 'preview',
    })
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    render(<FileWorkspacePanel {...props} />)
    const heading = screen.getByRole('heading', { name: 'Temporary selection' })
    const textNode = heading.firstChild
    if (textNode === null) throw new Error('heading text node missing')
    const range = document.createRange()
    range.selectNodeContents(textNode)
    Object.defineProperty(range, 'getBoundingClientRect', {
      value: () => ({ left: 100, top: 100, width: 120, height: 20 }),
    })
    window.getSelection()?.removeAllRanges()
    window.getSelection()?.addRange(range)

    fireEvent.mouseUp(heading)
    expect(screen.getByRole('button', { name: 'Ask' })).toBeTruthy()
    expect(Object.values(store.getSnapshot().highlights)).toHaveLength(1)

    fireEvent.pointerDown(document.body)

    expect(screen.queryByRole('button', { name: 'Ask' })).toBeNull()
    expect(Object.values(store.getSnapshot().highlights)).toHaveLength(0)
  })

  it('restores the linked minimized window when its highlighted text is clicked', () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/readme.md',
      content: '# Persistent selection',
      version: 'v1',
      workspaceId: 'workspace',
      draft: '# Persistent selection',
      dirty: false,
      viewMode: 'preview',
    })
    store.actions.addHighlight({
      id: 'selection',
      path: '/workspace/readme.md',
      text: 'Persistent selection',
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 2,
      sourceEnd: 22,
      colorIndex: 0,
    })
    store.actions.openSelectionWindow({
      id: 'selection',
      sessionId: 'child-session' as SessionId,
      path: '/workspace/readme.md',
      workspaceId: 'workspace',
      fileVersion: 'v1',
      selectedText: 'Persistent selection',
      title: 'Why does this persist?',
      lineContext: '# Persistent selection',
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 2,
      sourceEnd: 22,
      action: 'ask',
      phase: 'ready',
      x: 96,
      y: 96,
      width: 560,
      height: 620,
      fullscreen: false,
      minimized: true,
      dockHidden: true,
      branchStartSeq: 2,
      tab: 'chat',
      zIndex: 1,
      colorIndex: 0,
    })
    const props = {
      useStore: bindSnapshotSelector(store),
      actions: store.actions,
      writeText: vi.fn(),
      readImage: vi.fn(),
      startSelectionSession: vi.fn(),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      useWorkspaces: vi.fn(),
    } as unknown as FileWorkspacePanelProps
    const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
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
    try {
      render(<FileWorkspacePanel {...props} />)
      fireEvent.click(screen.getByRole('button', { name: 'Open linked selection conversation' }))
      expect(store.getSnapshot().windows.selection).toMatchObject({
        minimized: false,
        dockHidden: false,
      })
    } finally {
      if (originalRects === undefined) delete (Range.prototype as { getClientRects?: unknown }).getClientRects
      else Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
    }
  })
})
