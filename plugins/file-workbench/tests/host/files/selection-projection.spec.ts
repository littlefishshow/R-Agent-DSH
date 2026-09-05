/** File Workbench selection restoration projection tests. */
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  FILE_WORKBENCH_SELECTION_SOURCE_FIELD,
  fileWorkbenchSelectionProjectionDefinition,
} from '../../../src/host/files/selection-projection.ts'

const selection = {
  id: 'selection',
  workspaceId: 'workspace',
  path: '/workspace/README.md',
  fileVersion: 'v1',
  selectedText: 'selected',
  lineContext: '# selected',
  action: 'explain' as const,
  visibleStart: 2,
  occurrence: 0,
  sourceStart: 0,
  sourceEnd: 10,
  colorIndex: 3,
  title: 'Explain · selected',
  branchStartSeq: -1,
}

/** Wrap one message in the event envelope consumed by the pure fold. */
function userEvent(message: ReturnType<typeof createUserMessage>): SessionEvent {
  return {
    type: 'user/message',
    seq: 0,
    time: 1,
    data: message,
    surfaceOp: 'append',
  }
}

describe('fileWorkbenchSelection projection', () => {
  it('folds metadata from the hidden opening prompt without another Session event', () => {
    const fold = fileWorkbenchSelectionProjectionDefinition.apply
    const event = userEvent(createUserMessage({
      content: [{ type: 'text', text: 'hidden prompt' }],
      source: {
        kind: 'plugin',
        plugin: 'host-fileworkbench-io:selection-prompt',
        form: 'instructions',
        [FILE_WORKBENCH_SELECTION_SOURCE_FIELD]: selection,
      },
    }))

    expect(fold(null, event)).toEqual(selection)
  })

  it('ignores ordinary file contexts and malformed restoration metadata', () => {
    const fold = fileWorkbenchSelectionProjectionDefinition.apply
    const initial = fileWorkbenchSelectionProjectionDefinition.init()
    const fileContext = userEvent(createUserMessage({
      content: [{ type: 'text', text: '<file_context />' }],
      source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
    }))
    const malformed = userEvent(createUserMessage({
      content: [{ type: 'text', text: 'hidden prompt' }],
      source: {
        kind: 'plugin',
        plugin: 'host-fileworkbench-io:selection-prompt',
        [FILE_WORKBENCH_SELECTION_SOURCE_FIELD]: { id: '' },
      },
    }))

    expect(fold(initial, fileContext)).toBe(initial)
    expect(fold(initial, malformed)).toBe(initial)
  })
})
