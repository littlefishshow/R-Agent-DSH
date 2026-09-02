/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-layout-workbench`.
 * @module @deepseek-ai/dsh-client-ui-layout-workbench/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-layout-workbench'

/** Cordis companion plugin name. */
export const name = 'client-ui-layout-workbench-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the frame's three-column concession solve is a pure
 * function asserted by this package's columns spec; the shared mode observable
 * is owned entirely by its controller and emits no cordis events.
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
