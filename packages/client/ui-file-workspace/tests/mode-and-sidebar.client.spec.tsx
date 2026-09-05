// @vitest-environment jsdom
/** User-visible mode switch and Files-sidebar behavior. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createSnapshotStore, type WorkspaceListState, type WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { FileSidebar } from '../src/client/FileSidebar.tsx'
import type { FileSidebarProps } from '../src/client/contract/slots.ts'
import { en } from '../src/client/locales.ts'
import { ModeSegment } from '../src/client/ModeToggle.tsx'
import { createFileWorkspaceStore } from '../src/client/stores.ts'

afterEach(cleanup)

describe('ModeSegment', () => {
  it('marks the active mode and switches through the matching button', () => {
    const setMode = vi.fn()
    const view = render(
      <ModeSegment wide mode="chat" setMode={setMode} chatLabel="Chat" filesLabel="Files" />,
    )
    const tabs = screen.getAllByRole('tab')
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true')
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false')
    expect(view.container.querySelector('[role="tablist"]')?.getAttribute('data-mode')).toBe('chat')

    fireEvent.click(screen.getByRole('tab', { name: /Files/ }))
    expect(setMode).toHaveBeenCalledWith('files')

    view.rerender(
      <ModeSegment wide mode="files" setMode={setMode} chatLabel="Chat" filesLabel="Files" />,
    )
    expect(screen.getAllByRole('tab')[1]?.getAttribute('aria-selected')).toBe('true')
    expect(view.container.querySelector('[role="tablist"]')?.getAttribute('data-mode')).toBe('files')
  })
})

describe('FileSidebar', () => {
  const workspace = {
    workspaceId: 'workspace-id',
    path: '/workspace',
    title: 'Shared Workspace',
    sessionIds: [],
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:00:00.000Z',
  } as unknown as WorkspaceView

  function workspaceState(items: readonly WorkspaceView[]): WorkspaceListState {
    return {
      items,
      archivedSessionIds: [],
      state: 'idle',
      phase: 'ready',
      error: null,
      baselinesReady: true,
      recentWorkspaceId: items[0]?.workspaceId,
    }
  }

  function props(overrides: Partial<FileSidebarProps> = {}): FileSidebarProps {
    const instance = createFileWorkspaceStore().create()
    const mode = createSnapshotStore<'chat' | 'files'>('files')
    const listDir = vi.fn(() => Promise.resolve([
      { name: 'docs', path: '/workspace/docs', kind: 'directory' as const, editable: false },
      { name: 'README.md', path: '/workspace/README.md', kind: 'file' as const, editable: true },
      { name: 'script.py', path: '/workspace/script.py', kind: 'file' as const, editable: true },
      { name: 'diagram.png', path: '/workspace/diagram.png', kind: 'file' as const, editable: false },
      { name: 'paper.pdf', path: '/workspace/paper.pdf', kind: 'file' as const, editable: false },
    ]))
    const noopAsync = () => Promise.resolve(undefined)
    return {
      wide: true,
      expandSidebar: vi.fn(),
      useStore: bindSnapshotSelector(instance),
      actions: instance.actions,
      useMode: bindSnapshotSelector(mode),
      useWorkspaces: bindSnapshotSelector(createSnapshotStore(workspaceState([workspace]))),
      listDir,
      readText: vi.fn(async (path: string) => ({
        path,
        content: 'print("hello")',
        version: 'v1',
        fileIndex: path,
        updatedAt: '2026-09-02T00:00:00.000Z',
      })),
      readImage: vi.fn(async (path: string) => ({
        path,
        mediaType: 'image/png' as const,
        dataUrl: 'data:image/png;base64,AQ==',
      })),
      writeText: vi.fn(),
      createEntry: vi.fn(),
      deleteEntry: vi.fn(noopAsync),
      copyEntry: vi.fn(),
      renameEntry: vi.fn(),
      pickDirectory: vi.fn(() => Promise.resolve(null)),
      createWorkspace: vi.fn(),
      removeWorkspace: vi.fn(noopAsync),
      startSelectionSession: vi.fn(),
      deleteSelectionSession: vi.fn(noopAsync),
      sendFollowUp: vi.fn(noopAsync),
      stopChildSession: vi.fn(noopAsync),
      watchChildSession: vi.fn(() => vi.fn()),
      useChildViews: bindSnapshotSelector(createSnapshotStore({})),
      t: (key: keyof typeof en) => en[key],
      useSessions: vi.fn(),
      ...overrides,
    } as unknown as FileSidebarProps
  }

  it('loads each shared Workspace path as a filesystem root in Files mode', async () => {
    const componentProps = props()
    render(<FileSidebar {...componentProps} />)

    expect(screen.getByText('Workspaces')).toBeTruthy()
    expect(screen.getByText('Shared Workspace')).toBeTruthy()
    await waitFor(() => { expect(componentProps.listDir).toHaveBeenCalledWith('/workspace') })
    await waitFor(() => { expect(screen.getByText('README.md')).toBeTruthy() })
    expect(screen.getByText('script.py')).toBeTruthy()
    expect(screen.getByText('diagram.png')).toBeTruthy()
    expect(screen.getByText('paper.pdf')).toBeTruthy()
  })

  it('opens source text, images, and unsupported binary files with distinct preview kinds', async () => {
    const componentProps = props()
    render(<FileSidebar {...componentProps} />)
    await screen.findByText('script.py')

    fireEvent.click(screen.getByRole('button', { name: 'script.py' }))
    await waitFor(() => {
      expect(componentProps.readText).toHaveBeenCalledWith('/workspace/script.py')
    })

    fireEvent.click(screen.getByRole('button', { name: 'diagram.png' }))
    await waitFor(() => {
      expect(componentProps.readImage).toHaveBeenCalledWith('/workspace/diagram.png')
    })

    fireEvent.click(screen.getByRole('button', { name: 'paper.pdf' }))
    expect(componentProps.readText).not.toHaveBeenCalledWith('/workspace/paper.pdf')
    expect(componentProps.readImage).not.toHaveBeenCalledWith('/workspace/paper.pdf')
  })

  it('dismisses a file action menu when the next pointer interaction lands outside its row', async () => {
    const componentProps = props()
    render(<FileSidebar {...componentProps} />)
    await waitFor(() => { expect(screen.getByText('README.md')).toBeTruthy() })

    fireEvent.click(screen.getAllByRole('button', { name: '⋯' })[0]!)
    expect(screen.getByRole('menuitem', { name: 'New file' })).toBeTruthy()
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menuitem', { name: 'New file' })).toBeNull()
  })

  it('adds a picked directory to the shared Workspace registry without browsing it', async () => {
    const picked: WorkspaceView = { ...workspace, path: '/picked', title: 'Picked' }
    const pickDirectory = vi.fn(() => Promise.resolve('/picked'))
    const createWorkspace = vi.fn(() => Promise.resolve(picked))
    const componentProps = props({ pickDirectory, createWorkspace })
    render(<FileSidebar {...componentProps} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add workspace' }))
    await waitFor(() => { expect(pickDirectory).toHaveBeenCalledOnce() })
    await waitFor(() => { expect(createWorkspace).toHaveBeenCalledWith('/picked') })
    await waitFor(() => { expect(componentProps.listDir).toHaveBeenCalledWith('/picked') })
  })

  it('renders nothing over the conversation Workspace browser in Chat mode', () => {
    const componentProps = props({
      useMode: bindSnapshotSelector(createSnapshotStore<'chat' | 'files'>('chat')),
    })
    const view = render(<FileSidebar {...componentProps} />)
    expect(view.container.childElementCount).toBe(0)
    expect(componentProps.listDir).not.toHaveBeenCalled()
  })
})
