/** Select the extended JSONL provider while retaining the original profile's configuration. */
import type { Context } from '@deepseek-ai/cordis'
import { interpolate } from '@deepseek-ai/cordis-plugin-loader'
import JsonlSessionPersistence from './jsonl/index.ts'

export const name = 'file-workbench-persistence'
export const inject = ['sessions']

/**
 * The original entry remains disabled in the same Loader tree. Evaluating its
 * configuration in its own context preserves user overrides and dshHomePath.
 * The entry and its options are read only; the provider runs in this fiber.
 */
export function apply(ctx: Context): void {
  const source = [...ctx.loader.entries()].find(entry => entry.options.id === 'session-persistence-jsonl')
  if (source === undefined || source.options.name !== '@deepseek-ai/dsh-session-persistence-jsonl' || !source.disabled) {
    throw new Error('dsh-file-workbench requires the standard JSONL profile entry to be present and disabled by its bundle patch')
  }
  ctx.plugin(JsonlSessionPersistence, interpolate(source.context, source.options.config))
}
