/**
 * Package-owned invariant companion for the file-workbench IO backend.
 * @module @deepseek-ai/dsh-host-fileworkbench-io/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import type { UserMessage } from '@deepseek-ai/dsh-llm'

const PACKAGE_NAME = '@deepseek-ai/dsh-host-fileworkbench-io'
const CHILD_PREFIX = 'file-selection-'
const PARENT_PREFIX = 'file-workbench-'
const FILE_CONTEXT_PLUGIN = 'host-fileworkbench-io'

/** Cordis companion plugin name. */
export const name = 'host-fileworkbench-io-invariant'
/** Services required before the companion can register lifecycle checks. */
export const inject = ['invariants']

/** Count admitted file-context messages in one selection child. */
function fileContextCount(session: Session): number {
  return session.events.filter(event =>
    event.type === 'user/message'
    && event.data.source.kind === 'plugin'
    && event.data.source.plugin === FILE_CONTEXT_PLUGIN).length
}

/** Validate lineage and restored context cardinality for one selection child. */
function validateSelectionSession(
  session: Session,
  fail: Parameters<InvariantInstaller>[1],
): void {
  if (!String(session.id).startsWith(CHILD_PREFIX)) return
  const parent = session.header.parentSession
  if (parent === undefined || !String(parent).startsWith(PARENT_PREFIX)) {
    fail(`selection session "${session.id}" must name a file-workbench parent session`)
  }
  if (session.header.seedLength !== 0) return
  const count = fileContextCount(session)
  if (count > 1 || session.events.some(event => event.type === 'turn/end') && count !== 1) {
    fail(`selection session "${session.id}" must restore with exactly one file context; got ${count}`)
  }
}

/** Every selection child has file-parent lineage and exactly one admitted file context. */
const install: InvariantInstaller = Object.assign((ctx: Context, fail: Parameters<InvariantInstaller>[1]) => {
  for (const session of ctx.sessions.list()) validateSelectionSession(session, fail)
  ctx.on('internal/dispatch', (_mode, eventName, args) => {
    if (eventName !== 'session/event') return
    const [session, event] = args as [Session, SessionEvent]
    const fileParent = String(session.id).startsWith(PARENT_PREFIX)
    const selectionChild = String(session.id).startsWith(CHILD_PREFIX) && session.header.seedLength === 0
    if (!fileParent && !selectionChild) return
    if (event.type === 'user/message') {
      const message: UserMessage = event.data
      if (message.source.kind === 'plugin' && message.source.plugin === FILE_CONTEXT_PLUGIN
        && fileContextCount(session) !== 0) {
        fail(`${fileParent ? 'file parent' : 'selection'} session "${session.id}" cannot append a second file context`)
      }
    }
    if (selectionChild && event.type === 'turn/end' && fileContextCount(session) !== 1) {
      fail(`selection session "${session.id}" cannot complete its first turn without one file context`)
    }
  }, { global: true })
  ctx.on('session/created', (session) => { validateSelectionSession(session, fail) }, { global: true })
}, { inject: ['sessions'] })

/**
 * Register the file-workbench IO invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
