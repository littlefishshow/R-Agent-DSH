# 6. Composition and HMR

English | [中文](06-composition-and-hmr.zh.md)

Every capability built so far is a plugin, and `cordis.yml` selects the application's plugin tree. This chapter changes that composition, hot-reloads a plugin, and diagnoses a plugin that never loads.

## Entries are more than a name

A config entry is easiest to read as one fixed position in the list: `name` says which plugin to load, `config` is passed to that plugin, and the remaining metadata tells the loader how to manage that position. The most common fields are `id` and `disabled`:

```yaml
- id: greeter          # stable identity for this entry
  name: './greeter.ts'
- id: consumer
  name: './consumer.ts'
  disabled: true       # keep the entry, skip mounting it
```

Treat `id` as the entry's stable label. When `cordis.yml` is saved, the loader first matches old and new entries by `id`; it does not start by comparing `name`. Suppose this was the original entry:

```yaml
- id: greeter
  name: './greeter.ts'
```

If you change only the plugin implementation to `./greeter-v2.ts` and keep `id: greeter`, the loader treats it as the same entry with changed contents. Because `name` changed, the old plugin instance is unloaded and the new one starts; the entry identity is still `greeter`, so id-based lookup, disabling, or diagnosis still refers to that same entry.

```yaml
- id: greeter
  name: './greeter-v2.ts'
```

If you change the `id` at the same time, the loader can no longer see the old `greeter` entry. It treats the old entry as deleted and `greeter-v2` as newly added. The running plugin may still end up being `./greeter-v2.ts`, but to the loader it is another entry: the old entry's state is finished, and the new id is the name to use for lookup, disabling, or diagnosis.

```yaml
- id: greeter-v2
  name: './greeter-v2.ts'
```

Use this rule when editing config: keep the same `id` when the plugin still has the same responsibility; choose a new `id` only when it is a different entry in the composition. Explicit `id`s matter especially for HMR: an entry without one gets a generated value on every read, so after any config-file save the loader cannot prove it is the same entry as before.

`disabled: true` is for temporarily turning off a plugin while keeping its place in the config file. The loader unmounts that plugin; when `disabled` becomes `false` or the field is removed, it mounts again. If other plugins were PENDING because they depended on a service it provides, those plugins load again after the service returns.

Groups nest a sub-list of entries that load and unload as one unit, and `isolate` gives a group its own instance of a service name — two groups can each see a differently configured `shell` provider without affecting each other. The [Cordis primer](../cordis-primer.md) and the [service isolation example](../user/develop/framework/service.md#service-isolation) cover the details.

## Hot module replacement

HMR (Hot Module Replacement) here means saving a file replaces the affected plugin without restarting the whole process. Cordis already knows how to unload a plugin and release its effects ([chapter 2](02-lifecycle-and-effects.md)), and how to load plugins according to service dependencies ([chapter 3](03-services.md)), so the HMR plugin supplies the coordination in between: it watches file changes, decides which plugins are affected, and triggers unload plus reload.

In `tmp/cordis-tutorial`, write `cordis.yml`:

```yaml
- id: logger
  name: '@deepseek-ai/cordis-plugin-logger-console'
- id: timer
  name: '@deepseek-ai/cordis-plugin-timer'
- id: hmr
  name: '@deepseek-ai/cordis-plugin-hmr'
  config:
    root: ['.']
- id: hello
  name: './hello.ts'
```

This list has three HMR-related entries, but they do different jobs. `@deepseek-ai/cordis-plugin-hmr` is the plugin that actually performs hot reload: it watches the directory named by `root: ['.']` and triggers reload when files change.

The other two plugins provide runtime capabilities HMR needs. `@deepseek-ai/cordis-plugin-logger-console` sends Cordis logs to the terminal; without it, HMR may still work, but you will not see `watching`, `reload plugin`, or failure messages. `@deepseek-ai/cordis-plugin-timer` provides `ctx.debounce()`, which HMR uses to merge several file events from one save into one reload; HMR declares a dependency on the `timer` service, so without that plugin HMR itself stays PENDING and file watching never starts. That silence is the subject of the next section.

HMR reads Node's loader internals through the Loader's native helper. Run Cordis under tsx:

```sh
node --import tsx ../../vendor/cordis/bin.js
```

Now edit `hello.ts` — change the log message — and save:

```
hello from my first plugin
2026-07-22 15:44:36 [I] hmr watching [ '.' ]
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

The old instance unloaded (all its effects unwound), the new code loaded, `apply` ran again. Stop the process with Ctrl-C. Editing `cordis.yml` itself is also picked up: the loader diffs entries by `id` and mounts, unmounts, or reconfigures only what changed. This is why the entries above carry explicit `id`s — an entry without one gets a generated id on every read, so after any config-file edit it counts as removed-plus-added and remounts even if its own lines did not change.

## Diagnosing a plugin that never loads

The flip side of dependency-driven loading: a plugin whose `inject` names a service nobody provides waits forever, printing nothing. No error — PENDING is a legitimate state, since the provider may be mounted later.

You can see the states directly. Every context can enumerate the plugin registry; create `diagnose.ts`:

```ts
import { FiberState, type Context } from '@deepseek-ai/cordis'

export const name = 'diagnose'

export function apply(ctx: Context) {
  setTimeout(() => {
    for (const runtime of ctx.registry.values()) {
      for (const fiber of runtime.fibers) {
        if (fiber.state === FiberState.PENDING) {
          console.log(`${fiber.name} is PENDING — a required service is missing`)
        }
      }
    }
  }, 500)
}
```

And a plugin with an unsatisfiable dependency, `needs-timer.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'

export const name = 'needs-timer'
export const inject = ['timer']

export function apply(ctx: Context) {
  console.log('needs-timer loaded')
}
```

```yaml
- name: './needs-timer.ts'
- name: './diagnose.ts'
```

Run it (plain `node --import tsx ../../vendor/cordis/bin.js`; stop with Ctrl-C):

```
needs-timer is PENDING — a required service is missing
```

`inject: ['timer']` has no provider. Add `- name: '@deepseek-ai/cordis-plugin-timer'` to the list and the plugin loads. When a plugin does nothing and reports nothing, inspect its fiber state. Iterating without the PENDING filter also shows the loader's own plugins (Loader, Include) as ACTIVE fibers because plugins mount the config file itself.

Next: [Into the harness](07-into-the-harness.md) — the same patterns against real harness services.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
