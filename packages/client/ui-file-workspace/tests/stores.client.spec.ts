/** Selection highlight and floating-window lifecycle tests. */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { createFileWorkspaceStore } from '../src/client/stores.ts'

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
      action: 'ask',
      phase: 'draft',
      x: 10,
      y: 20,
      width: 560,
      height: 620,
      fullscreen: false,
      minimized: false,
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
      fullscreen: false,
      sessionId: 'child',
      branchStartSeq: 42,
      title: 'Why is this important?',
      phase: 'ready',
    })

    store.actions.setWindowFullscreen('selection', true)
    expect(store.getSnapshot().highlights.selection).toBeDefined()
    expect(store.getSnapshot().windows.selection).toMatchObject({
      minimized: false,
      fullscreen: true,
    })

    store.actions.resizeWindow('selection', 720, 680)
    expect(store.getSnapshot().windows.selection).toMatchObject({ width: 720, height: 680 })

    store.actions.removeSelection('selection')
    expect(store.getSnapshot().highlights.selection).toBeUndefined()
    expect(store.getSnapshot().windows.selection).toBeUndefined()
  })
})
