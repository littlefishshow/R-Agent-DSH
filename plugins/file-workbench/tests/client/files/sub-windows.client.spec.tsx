// @vitest-environment jsdom
/** Floating selection-window lifecycle and durable child projection tests. */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSnapshotStore, type SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { SubWindows } from '../../../src/client/files/SubWindows.tsx'
import type { SubWindowsProps } from '../../../src/client/files/contract/slots.ts'
import { en } from '../../../src/client/files/locales.ts'
import { createFileWorkspaceStore } from '../../../src/client/files/stores.ts'

afterEach(cleanup)

const CHILD_ID = 'child-session' as SessionId

/** Create one highlighted selection and its attached child window. */
function fixture(options: {
  action?: 'ask' | 'modify'
  assistantText?: string
  selectedText?: string
  deleteFailure?: Error
} = {}) {
  const action = options.action ?? 'ask'
  const selectedText = options.selectedText ?? 'selected text'
  const store = createFileWorkspaceStore().create()
  store.actions.openDocument({
    path: '/workspace/README.md',
    workspaceId: 'workspace',
    content: selectedText,
    draft: selectedText,
    version: 'v1',
    dirty: false,
    viewMode: 'preview',
  })
  store.actions.addHighlight({
    id: 'selection',
    path: '/workspace/README.md',
    text: selectedText,
    visibleStart: 0,
    occurrence: 0,
    sourceStart: 0,
    sourceEnd: selectedText.length,
    colorIndex: 0,
  })
  store.actions.openSelectionWindow({
    id: 'selection',
    sessionId: CHILD_ID,
    path: '/workspace/README.md',
    workspaceId: 'workspace',
    fileVersion: 'v1',
    selectedText,
    title: action === 'modify' ? 'Make it clearer.' : 'What does this mean?',
    lineContext: selectedText,
    visibleStart: 0,
    occurrence: 0,
    sourceStart: 0,
    sourceEnd: selectedText.length,
    action,
    phase: 'ready',
    x: 80,
    y: 90,
    width: 560,
    height: 620,
    fullscreen: false,
    minimized: false,
    dockHidden: false,
    branchStartSeq: 10,
    tab: 'chat',
    zIndex: 2,
    colorIndex: 0,
  })
  const release = vi.fn()
  const watchChildSession = vi.fn(() => release)
  const childViews = createSnapshotStore({
    [CHILD_ID]: {
      messages: [
        { role: 'user' as const, text: 'inherited', seq: 9 },
        { role: 'assistant' as const, text: options.assistantText ?? 'branch answer', seq: 12 },
        { role: 'user' as const, text: 'visible follow-up', seq: 13 },
      ],
      running: true,
      trajectory: [
        { seq: 8, kind: 'turn/end', label: 'inherited turn' },
        { seq: 12, kind: 'assistant/message', label: 'branch answer' },
      ],
    },
  })
  const mode = createSnapshotStore<'chat' | 'files'>('files')
  const restorableSelections = createSnapshotStore({
    phase: 'ready' as const,
    items: [],
  })
  const renderChildTrajectory = vi.fn(() =>
    <div data-testid="native-trajectory">native trajectory</div>)
  const deleteSelectionSession = vi.fn(async () => {
    if (options.deleteFailure !== undefined) throw options.deleteFailure
  })
  const writeText = vi.fn(async () => ({ operation: 'update' as const, version: 'v2' }))
  const props = {
    useStore: bindSnapshotSelector(store),
    actions: store.actions,
    useChildViews: bindSnapshotSelector(childViews),
    useMode: bindSnapshotSelector(mode),
    useRestorableSelections: bindSnapshotSelector(restorableSelections),
    listDir: vi.fn(),
    readText: vi.fn(),
    readImage: vi.fn(),
    writeText,
    createEntry: vi.fn(),
    deleteEntry: vi.fn(),
    copyEntry: vi.fn(),
    renameEntry: vi.fn(),
    pickDirectory: vi.fn(),
    createWorkspace: vi.fn(),
    removeWorkspace: vi.fn(),
    startSelectionSession: vi.fn(),
    deleteSelectionSession,
    sendFollowUp: vi.fn(async () => {}),
    stopChildSession: vi.fn(),
    watchChildSession,
    renderChildTrajectory,
    t: (key: keyof typeof en) => en[key],
    useSessions: vi.fn(),
  } as unknown as SubWindowsProps
  return {
    store, props, release, renderChildTrajectory, watchChildSession, deleteSelectionSession, writeText,
  }
}

describe('SubWindows', () => {
  it('shows only branch-local messages and supports fullscreen and minimize-to-dock', () => {
    const { store, props, watchChildSession } = fixture()
    render(<SubWindows {...props} />)

    expect(watchChildSession).toHaveBeenCalledWith(CHILD_ID)
    expect(screen.queryByText('inherited')).toBeNull()
    expect(screen.queryByText('branch prompt')).toBeNull()
    expect(screen.getByText('What does this mean?')).toBeTruthy()
    expect(screen.getByText('branch answer')).toBeTruthy()
    expect(screen.getByText('visible follow-up')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Fullscreen' }))
    expect(store.getSnapshot().windows.selection?.fullscreen).toBe(true)
    const restore = screen.getByRole('button', { name: 'Restore' })
    expect(restore).toBeTruthy()
    const portal = restore.closest('[class*="portalLayer"]')
    expect(portal?.parentElement).toBe(document.body)
    expect(restore.closest('[data-fullscreen]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Open full trajectory in main conversation' })).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: true,
      fullscreen: false,
    })
    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(screen.getByRole('button', { name: 'What does this mean?' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Hide minimized conversation' }))
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: true,
      dockHidden: true,
    })
    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(props.deleteSelectionSession).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'What does this mean?' })).toBeNull()

    act(() => { store.actions.raiseWindow('selection') })
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: false,
      dockHidden: false,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Minimize' }))
    fireEvent.click(screen.getByRole('button', { name: 'What does this mean?' }))
    expect(store.getSnapshot().windows.selection?.minimized).toBe(false)
    expect(screen.getByText('branch answer')).toBeTruthy()
  })

  it('deletes the durable child before releasing its projection and highlight', async () => {
    const { store, props, release, deleteSelectionSession } = fixture()
    render(<SubWindows {...props} />)

    expect(release).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(deleteSelectionSession).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      path: '/workspace/README.md',
      sessionId: CHILD_ID,
    })
    await waitFor(() => {
      expect(release).toHaveBeenCalledOnce()
      expect(store.getSnapshot().windows.selection).toBeUndefined()
      expect(store.getSnapshot().highlights.selection).toBeUndefined()
    })
  })

  it('keeps the window and highlight when durable child deletion fails', async () => {
    const failure = new Error('delete failed')
    const { store, props } = fixture({ deleteFailure: failure })
    render(<SubWindows {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    await waitFor(() => {
      expect(screen.getByText('delete failed')).toBeTruthy()
      expect(store.getSnapshot().windows.selection).toMatchObject({ phase: 'cleanup-error' })
      expect(store.getSnapshot().highlights.selection).toBeDefined()
    })
  })

  it('accepts a replacement, then deletes the child and removes the highlight', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { store, props, writeText, deleteSelectionSession } = fixture({
      action: 'modify',
      assistantText: 'Here is the replacement:\n```markdown\nnew text\n```',
    })
    render(<SubWindows {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }))

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('/workspace/README.md', 'new text', 'v1')
      expect(deleteSelectionSession).toHaveBeenCalledWith({
        workspaceId: 'workspace',
        path: '/workspace/README.md',
        sessionId: CHILD_ID,
      })
      expect(store.getSnapshot().highlights.selection).toBeUndefined()
      expect(store.getSnapshot().windows.selection).toBeUndefined()
    })
  })

  it('refuses prose or stale source instead of writing an unsafe replacement', async () => {
    const invalid = fixture({ action: 'modify', assistantText: 'new text without the required fence' })
    render(<SubWindows {...invalid.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }))
    expect(await screen.findByText(/reply must contain exactly one markdown code block/)).toBeTruthy()
    expect(invalid.writeText).not.toHaveBeenCalled()
    cleanup()

    const stale = fixture({ action: 'modify', assistantText: '````markdown\nnew text\n````' })
    stale.store.actions.setDraft('changed elsewhere')
    stale.store.actions.markSaved('/workspace/README.md', 'changed elsewhere', 'v2')
    render(<SubWindows {...stale.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Accept change' }))
    expect(await screen.findByText(/source text to replace has changed/)).toBeTruthy()
    expect(stale.writeText).not.toHaveBeenCalled()
  })

  it('renders the complete shared trajectory presentation', () => {
    const { props, renderChildTrajectory } = fixture()
    render(<SubWindows {...props} />)

    fireEvent.click(screen.getByRole('button', { name: 'Trajectory' }))
    expect(screen.getByTestId('native-trajectory')).toBeTruthy()
    expect(renderChildTrajectory).toHaveBeenCalledWith(CHILD_ID)
  })

  it('renders a selected TeX source as readable math in the window context', () => {
    const { props } = fixture({ selectedText: '$x^2 + y^2$' })
    render(<SubWindows {...props} />)

    expect(document.querySelector('.katex annotation')?.textContent).toBe('x^2 + y^2')
  })

  it('does not send Enter while an IME composition is active or settling', () => {
    vi.useFakeTimers()
    try {
      const { props } = fixture()
      render(<SubWindows {...props} />)
      const input = screen.getByRole('textbox')
      fireEvent.change(input, { target: { value: 'pinyin' } })

      fireEvent.compositionStart(input)
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(props.sendFollowUp).not.toHaveBeenCalled()

      fireEvent.compositionEnd(input)
      fireEvent.keyDown(input, { key: 'Enter' })
      expect(props.sendFollowUp).not.toHaveBeenCalled()

      vi.advanceTimersByTime(20)
      fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
      fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 })
      expect(props.sendFollowUp).not.toHaveBeenCalled()

      fireEvent.keyDown(input, { key: 'Enter' })
      expect(props.sendFollowUp).toHaveBeenCalledWith(CHILD_ID, 'pinyin')
    } finally {
      vi.useRealTimers()
    }
  })
})
