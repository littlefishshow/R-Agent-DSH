/** Extra operations implemented by the bundle's selected persistence and workspace providers. */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'

/** Delete only through a provider that owns write retirement, serialization and cache invalidation. */
export function deleteWorkbenchSession(ctx: Context, id: SessionId): Promise<boolean> {
  const provider = ctx.sessionPersistence as typeof ctx.sessionPersistence & {
    delete?: (id: SessionId) => Promise<boolean>
  }
  if (typeof provider.delete !== 'function') {
    throw new Error('dsh-file-workbench requires its persistence provider; apply its bundle patch after the base profile')
  }
  return provider.delete(id)
}

/** Restore file sessions archived by an earlier R-Agent installation. */
export function unarchiveWorkbenchSession(ctx: Context, id: SessionId): Promise<void> {
  const provider = ctx.workspaceRegistry as typeof ctx.workspaceRegistry & {
    unarchiveSession?: (id: SessionId) => Promise<void>
  }
  if (typeof provider.unarchiveSession !== 'function') {
    throw new Error('dsh-file-workbench requires its workspace provider; apply its bundle patch after the web profile')
  }
  return provider.unarchiveSession(id)
}
