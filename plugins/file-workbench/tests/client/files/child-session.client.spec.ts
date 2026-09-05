/** Child-session conversation-snapshot projection tests. */
import { describe, expect, it } from 'vitest'
import type { ConversationSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { childSessionView } from '../../../src/client/files/child-session.ts'

/** A minimal ConversationSnapshot carrying only the fields the projection reads. */
function snapshot(partial: Partial<ConversationSnapshot>): ConversationSnapshot {
  return {
    nodes: [],
    partial: null,
    running: false,
    views: { get: () => undefined },
    ...partial,
  } as unknown as ConversationSnapshot
}

describe('childSessionView', () => {
  it('projects user and assistant text messages in order', () => {
    const view = childSessionView(snapshot({
      nodes: [
        { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'explain this' }], source: null },
        { kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'sure, it means…' }] },
      ] as unknown as ConversationSnapshot['nodes'],
    }))
    expect(view.messages).toEqual([
      { role: 'user', text: 'explain this', seq: 1 },
      { role: 'assistant', text: 'sure, it means…', seq: 2 },
    ])
  })

  it('keeps assistant reasoning out of the compact chat projection', () => {
    const view = childSessionView(snapshot({
      nodes: [{
        kind: 'assistant',
        seq: 2,
        time: 0,
        turn: 1,
        step: 1,
        blocks: [
          { kind: 'reasoning', text: 'private chain of thought' },
          { kind: 'text', text: 'visible answer' },
        ],
      }] as unknown as ConversationSnapshot['nodes'],
      partial: {
        turn: 2,
        step: 1,
        blocks: [
          { kind: 'reasoning', text: 'streamed private thought' },
          { kind: 'text', text: 'streamed visible answer' },
        ],
      },
    }))
    expect(view.messages).toEqual([
      { role: 'assistant', text: 'visible answer', seq: 2 },
      { role: 'assistant', text: 'streamed visible answer', seq: 2.5, streaming: true },
    ])
  })

  it('keeps the complete file snapshot out of the compact chat projection', () => {
    const view = childSessionView(snapshot({
      nodes: [
        {
          kind: 'context',
          seq: 1,
          time: 0,
          content: [{ type: 'text', text: '<file_context>\nfile_index: /a.md\n</file_context>' }],
          source: { kind: 'plugin', plugin: 'host-fileworkbench-io' },
        },
        { kind: 'user', seq: 2, time: 0, content: [{ type: 'text', text: 'explain this' }], source: null },
      ] as unknown as ConversationSnapshot['nodes'],
    }))
    expect(view.messages).toEqual([
      { role: 'user', text: 'explain this', seq: 2 },
    ])
  })

  it('hides the selection-opening instruction but keeps later user follow-ups', () => {
    const view = childSessionView(snapshot({
      nodes: [
        {
          kind: 'context',
          seq: 2,
          time: 0,
          content: [{ type: 'text', text: 'internal selection prompt' }],
          source: { kind: 'plugin', plugin: 'host-fileworkbench-io:selection-prompt', form: 'instructions' },
        },
        {
          kind: 'user',
          seq: 4,
          time: 0,
          content: [{ type: 'text', text: 'visible follow-up' }],
          source: { kind: 'user' },
        },
      ] as unknown as ConversationSnapshot['nodes'],
    }))
    expect(view.messages).toEqual([
      { role: 'user', text: 'visible follow-up', seq: 4 },
    ])
  })

  it('keeps unrelated plugin context visible', () => {
    const view = childSessionView(snapshot({
      nodes: [{
        kind: 'context',
        seq: 2,
        time: 0,
        content: [{ type: 'text', text: 'runtime context' }],
        source: { kind: 'plugin', plugin: 'other-plugin' },
      }] as unknown as ConversationSnapshot['nodes'],
    }))
    expect(view.messages).toEqual([
      { role: 'context', text: 'runtime context', seq: 2 },
    ])
  })

  it('keeps durable sequence ids while trajectory stays on the native Session view', () => {
    const view = childSessionView(snapshot({
      nodes: [
        { kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'q' }], source: null },
        { kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'text', text: 'a1' }] },
        { kind: 'assistant', seq: 3, time: 0, turn: 1, step: 2, blocks: [{ kind: 'text', text: 'a2' }] },
      ] as unknown as ConversationSnapshot['nodes'],
      views: {
        get: () => ({
          eventNodes: [{ kind: 'turn/end', seq: 4 }],
          requests: [{
            startSeq: 5,
            purpose: 'assistant',
            provenance: { provider: 'deepseek', model: 'chat' },
          }],
        }),
      } as unknown as ConversationSnapshot['views'],
    }))
    expect(view.messages.map(message => message.seq)).toEqual([1, 2, 3])
    expect(snapshot({
      views: {
        get: () => ({
          eventNodes: [{ kind: 'turn/end', seq: 4 }],
          requests: [{ startSeq: 5, purpose: 'assistant' }],
        }),
      } as unknown as ConversationSnapshot['views'],
    }).views.get('trajectory')).toBeDefined()
  })

  it('projects the transient assistant partial separately while the child runs', () => {
    const view = childSessionView(snapshot({
      nodes: [{ kind: 'user', seq: 1, time: 0, content: [{ type: 'text', text: 'q' }], source: null }] as unknown as ConversationSnapshot['nodes'],
      partial: { turn: 1, step: 1, blocks: [{ kind: 'text', text: 'partial answer' }] },
      running: true,
    }))
    expect(view.running).toBe(true)
    expect(view.messages.at(-1)).toEqual({
      role: 'assistant',
      text: 'partial answer',
      seq: 1.5,
      streaming: true,
    })
  })

  it('skips non-text nodes and empty messages', () => {
    const view = childSessionView(snapshot({
      nodes: [
        { kind: 'tool-result', content: [] } as unknown,
        { kind: 'user', seq: 1, time: 0, content: [{ type: 'image' }], source: null },
        { kind: 'assistant', seq: 2, time: 0, turn: 1, step: 1, blocks: [{ kind: 'image' }] },
      ] as unknown as ConversationSnapshot['nodes'],
    }))
    expect(view.messages).toEqual([])
  })
})
