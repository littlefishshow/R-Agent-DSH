# 4. 事件

[English](04-events.md) | 中文

服务支持直接调用；**事件**让插件无需知道有哪些插件正在监听，就能发出通知。harness 使用事件处理工具结果、模型请求和审批决定等交互。

## 声明、发出与监听

创建 `stats.ts`，将它放在 `tmp/cordis-tutorial` 中。它是一项负责计数并在每次变化时发出通知的服务：

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

`interface Events` 合并与第 3 章的 `interface Context` 合并在事件系统中相互对应：它声明事件名称及其监听器签名，因此 `ctx.emit` 和 `ctx.on` 都具有完整类型。`namespace/action` 命名约定让扁平的事件命名空间保持易读。

创建 `reporter.ts`：

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

`import type {} from './stats.ts'` 行不会在运行时导入任何内容；它的作用是让 TypeScript 看到声明合并。组合并运行：

```yaml
- name: './stats.ts'
- name: './reporter.ts'
```

```
[stats] tool_call -> 1
[stats] tool_call -> 2
[stats] prompt -> 1
```

因为 `ctx.on()` 属于 effect，监听器会随插件一同消失，绝不需要手动维护 `removeListener`。

## 分发模式

`emit` 是 5 种分发模式之一。分发模式不是监听器自己选择的，而是发出事件的一方通过 `ctx.emit()`、`ctx.parallel()` 等调用方式选择的；它决定 Cordis 如何调用已经注册的监听器，以及调用方会不会等待它们完成、读取它们的返回值，或允许其中一个监听器提前结束整次分发。

| 模式 | 调用 | 语义 |
|---|---|---|
| emit | `ctx.emit(name, ...args)` | 同步广播；不会等待或收集返回的 promise 与值。 |
| parallel | `await ctx.parallel(name, ...args)` | 所有监听器并发运行，并一同等待。 |
| serial | `await ctx.serial(name, ...args)` | 监听器按顺序运行并等待；第一个非 `null`/`false`/`undefined` 返回值胜出，并停止后续监听器。 |
| bail | `ctx.bail(name, ...args)` | serial 的同步版本。 |
| waterfall（瀑布式事件） | `ctx.waterfall(name, ...args, next)` | 环绕中间件，见下文。 |

通俗地说，先看发出事件的一方想要什么结果：

- `emit` 像“通知一下”：告诉所有监听器发生了某事，然后立刻继续往下执行。它适合日志、统计、状态广播这类不需要结果的事件。
- `parallel` 像“请大家同时处理，并等大家都做完”：监听器可以是异步函数，Cordis 会并发启动它们，并等待全部完成。它适合多个互不依赖的异步副作用。
- `serial` 像“按顺序问，谁给出有效答案就用谁的”：Cordis 会等待第一个监听器完成，再调用下一个；只要某个监听器返回非 `null`、非 `false`、非 `undefined` 的值，就停止后面的监听器，并把这个值返回给调用方。
- `bail` 是 `serial` 的同步版本：规则一样，但监听器不能靠 `await` 排队完成异步工作。
- `waterfall` 像一层层包装的中间件：每个监听器决定是否调用 `next()` 继续往里走。下一节会专门展开。

下面这个例子只展示 `emit` 和 `parallel` 的差别。两个监听器都返回 promise 时，`emit` 不会等它们完成；`parallel` 会等两个 promise 都完成后再继续：

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

`emit returned` 会先打印，因为 `emit` 只负责触发监听器，不等待异步结果；`parallel returned` 会在两个监听器都打印之后才出现。`serial` 和 `bail` 关注的是“按顺序找第一个有效返回值”，所以更常用于决策类事件，而不是普通广播。

每个 harness 事件都会在其所属[子系统页面](../subsystems/core.zh.md)自动生成的参考文档中记录其模式。

## waterfall：转换或短路

waterfall 是实现拦截的模式。每个监听器都会收到参数和一个 `next()` continuation；它可以转换 `next()` 的返回值，也可以不调用 `next()` 就直接返回，从而短路链条的其余部分。Cordis 文档把后一种行为称为否决。创建 `waterfall-demo.ts`：

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

让 `cordis.yml` 只指向该文件并运行：

```
HELLO
** BLOCKED **
```

按顺序看第二行如何产生：监听器 1 先运行并调用 `next()`，从而调用监听器 2；监听器 2 看到 `blocked` 后直接返回而不调用 `next()`，因此最内层默认逻辑（传给 `ctx.waterfall` 的函数）从未运行；返回途中，监听器 1 再把替换消息转换为大写。

由此得到一项纪律：**只负责观察或标注的 waterfall 监听器必须调用 `next()`**；不调用就直接返回代表有意短路。如果日志监听器忘记调用 `next()`，会悄无声息地吞掉所有下游的默认行为。这是本仓库的常设规则（[waterfall 语义](../cordis-primer.zh.md#cordis-waterfall-semantics)）。

harness 使用 waterfall 处理协作插件可以包装或回答的决策：[`agent/request`](../subsystems/core.zh.md#agentrequest--waterfall) 允许插件替换模型调用配置，[`approval/request`](../subsystems/approval.zh.md#approvalrequest--waterfall) 允许策略代替用户作答。

下一章：[配置](05-config.zh.md)：来自 `cordis.yml` 的插件选项。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
