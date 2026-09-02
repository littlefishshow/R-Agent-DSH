/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-file-workspace`.
 * @module @deepseek-ai/dsh-client-ui-file-workspace/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-file-workspace'

/** Cordis companion plugin name. */
export const name = 'client-ui-file-workspace-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the file panel's view state lives in a client store and
 * its documents/child sessions are owned by the host filesystem and the
 * sessions service; this package emits no cordis events of its own.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
