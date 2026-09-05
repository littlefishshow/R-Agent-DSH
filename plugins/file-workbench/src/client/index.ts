/** Compose the workbench's presentation plugins through ordinary Cordis fibers. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import * as layout from './layout/index.ts'
import * as sidebar from './sidebar/index.ts'
import * as workspaces from './workspaces/index.ts'
import * as trajectory from './trajectory/index.ts'
import * as files from './files/index.ts'

export const name = 'file-workbench'
export const inject = ['slots', 'sessions', 'workspaces', 'connection', 'locale', 'theme']

/** Register children with their own injection and disposal lifetimes. */
export function apply(ctx: ClientContext): void {
  ctx.plugin(layout)
  ctx.plugin(sidebar)
  ctx.plugin(workspaces)
  ctx.plugin(trajectory)
  ctx.plugin(files)
}
