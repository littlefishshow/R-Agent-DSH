/** Selection highlight and floating-window lifecycle tests. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createFileWorkspaceStore } from '../../../src/client/files/stores.ts'

describe('file workspace store', () => {
  it('keeps multiple documents in tab order and selects a neighbor after close', () => {
    const store = createFileWorkspaceStore().create()
    store.actions.openDocument({
      path: '/workspace/one.md',
      content: 'one',
      draft: 'one',
      version: 'v1',
      workspaceId: 'workspace',
      dirty: false,
      viewMode: 'preview',
    })
    store.actions.openDocument({
      path: '/workspace/two.md',
      content: 'two',
      draft: 'two',
      version: 'v2',
      workspaceId: 'workspace',
      dirty: false,
      viewMode: 'preview',
    })

    expect(store.getSnapshot()).toMatchObject({
      documentOrder: ['/workspace/one.md', '/workspace/two.md'],
      activeDocumentPath: '/workspace/two.md',
    })
    store.actions.activateDocument('/workspace/one.md')
    expect(store.getSnapshot().activeDocumentPath).toBe('/workspace/one.md')
    store.actions.closeDocument('/workspace/one.md')
    expect(store.getSnapshot()).toMatchObject({
      documentOrder: ['/workspace/two.md'],
      activeDocumentPath: '/workspace/two.md',
    })
  })

  it('keeps the highlight through minimize and fullscreen, then removes both records together', () => {
    const store = createFileWorkspaceStore().create()
    store.actions.addHighlight({
      id: 'selection',
      path: '/workspace/README.md',
      text: 'selected text',
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 0,
      sourceEnd: 13,
      colorIndex: 0,
    })
    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(store.getSnapshot().windows.selection).toBeUndefined()
    store.actions.openSelectionWindow({
      id: 'selection',
      sessionId: undefined,
      path: '/workspace/README.md',
      workspaceId: 'workspace',
      fileVersion: 'v1',
      selectedText: 'selected text',
      title: 'Ask · selected text',
      lineContext: 'selected text',
      visibleStart: 0,
      occurrence: 0,
      sourceStart: 0,
      sourceEnd: 13,
      action: 'ask',
      phase: 'draft',
      x: 10,
      y: 20,
      width: 560,
      height: 620,
      fullscreen: false,
      minimized: false,
      dockHidden: false,
      branchStartSeq: -1,
      tab: 'chat',
      zIndex: 1,
      colorIndex: 0,
    })
    store.actions.attachWindowBranch('selection', {
      sessionId: 'child' as SessionId,
      branchStartSeq: 42,
      title: 'Why is this important?',
    })
    store.actions.minimizeWindow('selection', true)

    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: true,
      dockHidden: false,
      fullscreen: false,
      sessionId: 'child',
      branchStartSeq: 42,
      title: 'Why is this important?',
      phase: 'ready',
    })

    store.actions.hideWindowDock('selection')
    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: true,
      dockHidden: true,
    })

    store.actions.raiseWindow('selection')
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: false,
      dockHidden: false,
    })
    store.actions.minimizeWindow('selection', true)
    store.actions.setWindowFullscreen('selection', true)
    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: false,
      dockHidden: false,
      fullscreen: true,
    })

    store.actions.resizeWindow('selection', 720, 680)
    expect(store.getSnapshot().windows.selection).toMatchObject({ width: 720, height: 680 })

    store.actions.removeSelection('selection')
    expect(store.getSnapshot().highlights.selection).toBeUndefined()
    expect(store.getSnapshot().windows.selection).toBeUndefined()
  })

  it('restores a durable selection idempotently and removes it when its child disappears', () => {
    const store = createFileWorkspaceStore().create()
    const selection = {
      id: 'restored',
      sessionId: 'child' as SessionId,
      workspaceId: 'workspace',
      path: '/workspace/README.md',
      fileVersion: 'v1',
      selectedText: 'selected text',
      lineContext: '# selected text',
      action: 'explain' as const,
      visibleStart: 2,
      occurrence: 0,
      sourceStart: 0,
      sourceEnd: 15,
      colorIndex: 4,
      title: 'Explain · selected text',
      branchStartSeq: -1,
    }

    store.actions.restoreSelection(selection)
    store.actions.restoreSelection(selection)

    expect(Object.keys(store.getSnapshot().highlights)).toEqual(['restored'])
    expect(store.getSnapshot().windows.restored).toMatchObject({
      sessionId: 'child',
      minimized: true,
      dockHidden: false,
      phase: 'ready',
    })
    expect(store.getSnapshot().nextColor).toBe(5)

    store.actions.reconcileRestorableSelections([])
    expect(store.getSnapshot().highlights.restored).toBeUndefined()
    expect(store.getSnapshot().windows.restored).toBeUndefined()
  })
})
