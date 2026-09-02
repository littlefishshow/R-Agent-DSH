# 4. Events

English | [中文](04-events.zh.md)

Services support direct calls; **events** let a plugin announce something without knowing which plugins listen. The harness uses events for interactions such as tool results, model requests, and approval decisions.

## Declare, emit, listen

Create `stats.ts` in `tmp/cordis-tutorial` — a service that counts things and announces each change:

```ts
import { Service, type Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Context {
    stats: StatsService
  }
  interface Events {
    'stats/report'(name: string, count: number): void
  }
}

export class StatsService extends Service {
  private counts = new Map<string, number>()

  constructor(ctx: Context) {
    super(ctx, 'stats')
  }

  bump(name: string) {
    const next = (this.counts.get(name) ?? 0) + 1
    this.counts.set(name, next)
    this.ctx.emit('stats/report', name, next)
  }
}

export const name = 'stats'

export function apply(ctx: Context) {
  ctx.plugin(StatsService)
}
```

The `interface Events` merge is the event-system twin of the `interface Context` merge from chapter 3: it declares the event name and its listener signature, so `ctx.emit` and `ctx.on` are fully typed. The `namespace/action` naming convention keeps the flat event namespace readable.

Create `reporter.ts`:

```ts ignore-check
import type { Context } from '@deepseek-ai/cordis'
import type {} from './stats.ts'

export const name = 'reporter'
export const inject = ['stats']

export function apply(ctx: Context) {
  ctx.on('stats/report', (name, count) => {
    console.log(`[stats] ${name} -> ${count}`)
  })
  ctx.stats.bump('tool_call')
  ctx.stats.bump('tool_call')
  ctx.stats.bump('prompt')
}
```

The `import type {} from './stats.ts'` line imports nothing at runtime; it exists so TypeScript sees the declaration merges. Compose and run:

```yaml
- name: './stats.ts'
- name: './reporter.ts'
```

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

Because `ctx.on()` is an effect, the listener disappears with the plugin — no manual `removeListener` bookkeeping, ever.

## Dispatch modes

`emit` is one of five dispatch modes. The listener does not choose the mode; the code that dispatches the event chooses it by calling `ctx.emit()`, `ctx.parallel()`, and so on. The mode decides how Cordis calls the registered listeners, whether the caller waits for them, whether return values are read, and whether one listener can stop the rest of the dispatch.

| Mode | Call | Semantics |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | Synchronous broadcast; returned promises and values are not awaited or collected. |
| parallel | `await ctx.parallel(name, ...args)` | All listeners run concurrently; awaited together. |
| serial | `await ctx.serial(name, ...args)` | Listeners run in order, awaited; the first non-`null`/`false`/`undefined` return wins and stops the rest. |
| bail | `ctx.bail(name, ...args)` | Synchronous version of serial. |
| waterfall | `ctx.waterfall(name, ...args, next)` | Around-middleware; see below. |

In plain terms, first ask what the dispatching code needs:

- `emit` is “tell everyone”: notify every listener that something happened, then continue immediately. It fits logs, counters, and status broadcasts where the caller does not need a result.
- `parallel` is “ask everyone to work at the same time, and wait until all are done”: listeners may be async, Cordis starts them concurrently, and the caller resumes after all of them settle. It fits independent async side effects.
- `serial` is “ask in order, and use the first meaningful answer”: Cordis waits for one listener before calling the next; when a listener returns something other than `null`, `false`, or `undefined`, Cordis stops and returns that value to the caller.
- `bail` is the synchronous version of `serial`: the stopping rule is the same, but listeners cannot line up async work with `await`.
- `waterfall` is layered middleware: each listener decides whether to call `next()` and continue inward. The next section covers it in detail.

This example shows only the difference between `emit` and `parallel`. When both listeners return promises, `emit` does not wait for them; `parallel` waits until both promises finish before continuing:

```ts ignore-check
ctx.on('demo/job', async (label) => {
  await wait(100)
  console.log(`${label}: slow listener`)
})

ctx.on('demo/job', async (label) => {
  await wait(10)
  console.log(`${label}: fast listener`)
})

ctx.emit('demo/job', 'emit')
console.log('emit returned')

await ctx.parallel('demo/job', 'parallel')
console.log('parallel returned')
```

`emit returned` prints first because `emit` only starts the listeners; it does not wait for async results. `parallel returned` appears only after both listeners have printed. `serial` and `bail` are about finding the first meaningful answer in order, so they are more common for decision events than for ordinary broadcasts.

Every harness event documents its mode in the generated reference on its owning [subsystem page](../subsystems/core.md).

## Waterfall: transform or short-circuit

Waterfall is the mode that powers interception. Each listener receives the arguments plus a `next()` continuation; it can transform what `next()` returns, or return without calling `next()` and short-circuit the rest of the chain — what the Cordis docs call the veto. Create `waterfall-demo.ts`:

```ts
import type { Context } from '@deepseek-ai/cordis'

declare module '@deepseek-ai/cordis' {
  interface Events {
    'demo/transform'(input: string, next: () => Promise<string>): Promise<string>
  }
}

export const name = 'waterfall-demo'

export function apply(ctx: Context) {
  // Listener 1: wrap the downstream result.
  ctx.on('demo/transform', async (input, next) => {
    const downstream = await next()
    return downstream.toUpperCase()
  })

  // Listener 2: short-circuit when it owns the decision.
  ctx.on('demo/transform', async (input, next) => {
    if (input.includes('blocked')) return '** blocked **'
    return next()
  })

  void (async () => {
    console.log(await ctx.waterfall('demo/transform', 'hello', async () => 'hello'))
    console.log(await ctx.waterfall('demo/transform', 'blocked words', async () => 'blocked words'))
  })()
}
```

Point `cordis.yml` at just this file and run:

```
HELLO
** BLOCKED **
```

Walk through the second line: listener 1 runs first, calls `next()`, which invokes listener 2; listener 2 sees `blocked` and returns without calling `next()` — the innermost default (the function passed to `ctx.waterfall`) never runs — and listener 1 uppercases the replacement message on the way out.

The discipline that follows: **a waterfall listener that only observes or annotates must call `next()`**; returning without it is a deliberate short-circuit. Forgetting `next()` in a logging listener silently swallows the default behavior for everyone downstream. It is a standing rule of this repository ([waterfall semantics](../cordis-primer.md#cordis-waterfall-semantics)).

The harness uses waterfalls for decisions that cooperating plugins may wrap or answer: [`agent/request`](../subsystems/core.md#agentrequest--waterfall) lets a plugin replace the model-call config, and [`approval/request`](../subsystems/approval.md#approvalrequest--waterfall) lets a policy answer instead of the user.

Next: [Configuration](05-config.md) — plugin options from `cordis.yml`.

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
