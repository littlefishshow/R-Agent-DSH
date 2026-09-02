/** Project one child Session's durable conversation and trajectory summaries. */
import type {
  AssistantBlock, ConversationSnapshot,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ChildSessionView } from './contract/slots.ts'

/** Join only an assistant node's user-visible text blocks into one string. */
function assistantText(blocks: readonly AssistantBlock[]): string {
  return blocks
    .filter((block): block is Extract<AssistantBlock, { kind: 'text' }> =>
      block.kind === 'text')
    .map(block => block.text)
    .join('')
    .trim()
}

/** Join a user node's text content blocks into one string. */
function userText(content: readonly unknown[]): string {
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null
      && (block as { type?: unknown }).type === 'text'
      && typeof (block as { text?: unknown }).text === 'string')
    .map(block => block.text)
    .join('')
    .trim()
}

/** Whether a context node is implementation-only File Workbench input. */
function isHiddenWorkbenchContext(source: unknown): boolean {
  if (typeof source !== 'object' || source === null) return false
  const plugin = (source as { plugin?: unknown }).plugin
  return plugin === 'host-fileworkbench-io' || plugin === 'host-fileworkbench-io:selection-prompt'
}

/**
 * Map a conversation snapshot to a sub-window child view.
 * @param snapshot - the child session's conversation snapshot.
 * @returns the compact message and running-state projection.
 */
export function childSessionView(snapshot: ConversationSnapshot): ChildSessionView {
  const messages: ChildSessionView['messages'] = []
  for (const node of snapshot.nodes) {
    if (node.kind === 'user') {
      const text = userText(node.content)
      if (text !== '') messages.push({ role: 'user', text, seq: node.seq })
      continue
    }
    if (node.kind === 'assistant') {
      const text = assistantText(node.blocks)
      if (text !== '') messages.push({ role: 'assistant', text, seq: node.seq })
      continue
    }
    if (node.kind === 'context') {
      const text = userText(node.content)
      if (text !== '' && !isHiddenWorkbenchContext(node.source)) {
        messages.push({ role: 'context', text, seq: node.seq })
      }
      continue
    }
    if (node.kind === 'tool-result') {
      const text = userText(node.content)
      if (text !== '') messages.push({ role: 'tool', text, seq: node.seq })
    }
  }
  const partialText = snapshot.partial === null ? '' : assistantText(snapshot.partial.blocks)
  if (partialText !== '') {
    messages.push({
      role: 'assistant',
      text: partialText,
      seq: (snapshot.nodes.at(-1)?.seq ?? -1) + 0.5,
      streaming: true,
    })
  }
  return {
    messages,
    running: snapshot.running,
  }
}
