// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import * as cordis from '@deepseek-ai/cordis'
import * as react from 'react'
import * as jsx from 'react/jsx-runtime'
import * as dom from 'react-dom'
import * as runtime from '@deepseek-ai/dsh-client-runtime/client'
import * as slots from '@deepseek-ai/dsh-client-ui-slots'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import { describe, expect, it } from 'vitest'

const modules: Record<string, unknown> = {
  '@deepseek-ai/cordis': cordis,
  react, 'react/jsx-runtime': jsx, 'react-dom': dom,
  '@deepseek-ai/dsh-client-runtime/client': runtime,
  '@deepseek-ai/dsh-client-ui-slots': slots,
  '@deepseek-ai/dsh-client-ui-primitives': primitives,
}

describe('distributable client bundle', () => {
  it('loads its complete composition and font assets through the DSH module factory', async () => {
    const manifest = JSON.parse(readFileSync(resolve('package.json'), 'utf8'))
    const code = readFileSync(resolve(manifest.exports['./client'].default), 'utf8')
    let handoff: { id: string; factory: (require: (name: string) => unknown) => { apply: (ctx: Context) => void; inject: string[] } } | undefined
    Function('window', code)({ __ModuleLoader__: { load: (value: typeof handoff) => { handoff = value } } })
    expect(handoff?.id).toBe('dsh-file-workbench')
    const plugin = handoff!.factory(name => {
      if (!(name in modules)) throw new Error(`unshipped client dependency: ${name}`)
      return modules[name]
    })
    const ctx = new Context()
    await ctx.plugin(runtime.SlotRegistry).await()
    await ctx.plugin(runtime.ConversationEventRegistry).await()
    await ctx.plugin(runtime.ConversationViewRegistry).await()
    ctx.provide('sessions', { list: runtime.createSnapshotStore({ phase: 'ready', ids: [], byId: {} }), binding: () => undefined } as never)
    ctx.provide('workspaces', { list: runtime.createSnapshotStore({ items: [], phase: 'ready' }) } as never)
    ctx.provide('locale', new LocaleRuntime(ctx))
    ctx.provide('connection', { rpc: { call: () => Promise.reject(new Error('no IO in composition check')) } } as never)
    ctx.provide('theme', { getTheme: () => ({ active: { colorScheme: 'light', tokens: {} } }) } as never)
    const fiber = ctx.plugin(plugin)
    await fiber.await()
    await Promise.resolve()
    const registry = ctx.get('slots') as runtime.SlotRegistry
    expect(registry.entries('root')).toHaveLength(1)
    expect(registry.entries('workbench')).toHaveLength(1)
    expect(registry.entries('sidebar.workspaces.overlay')).toHaveLength(1)
    expect(registry.entries('shell.overlay')).toHaveLength(1)
    expect(ctx.get('trajectoryPresentation')).toBeDefined()
    const css = [...document.querySelectorAll('style[data-plugin="dsh-file-workbench"]')].map(tag => tag.textContent).join('')
    expect(css).toContain('font/woff2;base64,')
    await fiber.dispose()
    expect(registry.entries('root')).toHaveLength(0)
    expect(ctx.get('trajectoryPresentation')).toBeUndefined()
  })
})
