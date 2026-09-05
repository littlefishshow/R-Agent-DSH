import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../../src/host/profile-persistence.ts'
import Jsonl from '../../src/host/jsonl/index.ts'

describe('profile persistence selection', () => {
  it('evaluates the disabled original entry in its own scope and keeps user configuration', () => {
    const config = { root: { __jsExpr: 'chosenRoot' }, compression: 'none', preparedSessionCacheSize: 2 }
    const source = { options: { id: 'session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl', config }, context: { chosenRoot: '/custom/session/root' }, disabled: true }
    const plugin = vi.fn()
    apply({ loader: { entries: () => [source] }, plugin } as unknown as Context)
    expect(plugin).toHaveBeenCalledWith(Jsonl, { root: '/custom/session/root', compression: 'none', preparedSessionCacheSize: 2 })
    expect(config.root).toEqual({ __jsExpr: 'chosenRoot' })
  })

  it('refuses an active original provider or a custom provider under the same id', () => {
    for (const source of [undefined, { disabled: false, options: { id: 'session-persistence-jsonl', name: '@deepseek-ai/dsh-session-persistence-jsonl' } }, { disabled: true, options: { id: 'session-persistence-jsonl', name: 'custom-backend' } }]) {
      const plugin = vi.fn()
      expect(() => apply({ loader: { entries: () => source ? [source] : [] }, plugin } as unknown as Context)).toThrow('standard JSONL')
      expect(plugin).not.toHaveBeenCalled()
    }
  })
})
