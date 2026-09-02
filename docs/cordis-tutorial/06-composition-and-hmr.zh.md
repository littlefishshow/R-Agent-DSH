# 6. 组合与 HMR（热模块替换）

[English](06-composition-and-hmr.md) | 中文

到目前为止构建的每项能力都是插件，`cordis.yml` 则选择应用的插件树。本章会改变这种组合、热重载一个插件，并诊断始终无法加载的插件。

## Cordis 配置项不只有名称

Cordis 配置项可以理解为列表里的一个固定位置：`name` 说明要加载哪个插件，`config` 传给插件，其他元数据则告诉 loader 如何管理这个位置。最常用的是 `id` 和 `disabled`：

```yaml
- id: greeter          # stable identity for this entry
  name: './greeter.ts'
- id: consumer
  name: './consumer.ts'
  disabled: true       # keep the entry, skip mounting it
```

把 `id` 当成这项配置的固定标签会更容易理解。保存 `cordis.yml` 时，loader 先用 `id` 配对新旧列表里的配置项，而不是先看 `name`。假设原来是这项配置：

```yaml
- id: greeter
  name: './greeter.ts'
```

如果只把插件实现改成 `./greeter-v2.ts`，但保留 `id: greeter`，loader 会把它当成同一项配置的内容变了。因为 `name` 变了，旧插件实例会卸载，新插件实例会启动；但配置项身份仍然是 `greeter`，按 id 查询、禁用或诊断时还是这同一项。

```yaml
- id: greeter
  name: './greeter-v2.ts'
```

如果同时把 `id` 也改掉，loader 就看不到原来的 `greeter` 了。它会把旧项当成被删除，把 `greeter-v2` 当成新增项。最后运行的插件可能同样是 `./greeter-v2.ts`，但对 loader 来说这是另一项配置：旧项的状态被结束，新的 id 要用新的名字查找、禁用或诊断。

```yaml
- id: greeter-v2
  name: './greeter-v2.ts'
```

实际写配置时，可以用一条规则判断：还是承担同一职责的插件，就保留 `id`；它已经是组合里的另一项职责，才换新的 `id`。显式写 `id` 对 HMR 尤其重要：没有 `id` 的配置项每次读取都会得到一个生成值，所以只要配置文件被保存，loader 就无法确认它还是原来的那一项。

`disabled: true` 适合临时关掉某个插件，但保留它在配置文件里的位置。loader 会卸载这个插件；把 `disabled` 改回 `false` 或删掉这一行后，它会重新挂载。若其他插件因为依赖它提供的服务而停在 PENDING，那些插件也会在服务回来后继续加载。

组可以嵌套一份 Cordis 配置项子列表，并将其作为一个单元加载和卸载；`isolate` 则为一个组提供某项服务名称的独立实例，因此两个组可以各自看到配置不同的 `shell` 提供方，互不影响。[Cordis 入门](../cordis-primer.zh.md)和[服务隔离示例](../user/develop/framework/service.zh.md#service-isolation)介绍了详细内容。

## 热模块替换

这里的 HMR 是 Hot Module Replacement（热模块替换）的缩写，指保存文件后，不重启整个进程，只替换受影响的插件。Cordis 已经知道如何卸载插件并释放 effect（[第 2 章](02-lifecycle-and-effects.zh.md)），也知道如何按服务依赖重新加载插件（[第 3 章](03-services.zh.md)），所以 HMR 插件只需要做中间的调度：监视文件变化，判断要替换哪些插件，然后触发卸载和重新加载。

在 `tmp/cordis-tutorial` 中编写 `cordis.yml`：

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

这份列表里有三个和 HMR 相关的配置项，但职责不同。`@deepseek-ai/cordis-plugin-hmr` 是真正执行热重载的插件：它监视 `root: ['.']` 指定的目录，并在文件变化时触发重载。

另外两个插件是 HMR 运行时需要的配套能力。`@deepseek-ai/cordis-plugin-logger-console` 把 Cordis 日志输出到终端；没有它，HMR 仍可能在工作，但你看不到 `watching`、`reload plugin` 或失败日志。`@deepseek-ai/cordis-plugin-timer` 提供 `ctx.debounce()`，HMR 用它把一次保存产生的多次文件事件合并成一次重载；HMR 声明了对 `timer` 服务的依赖，所以没有这个插件时，HMR 自己会停在 PENDING，连文件监听都不会开始。下一节就讨论这种静默状态。

HMR 通过 Loader 的原生辅助工具读取 Node 的 loader 内部结构。请在 tsx 下运行 Cordis：

```sh
node --import tsx ../../vendor/cordis/bin.js
```

现在编辑 `hello.ts`，修改日志消息并保存：

```
hello from my first plugin
2026-07-22 15:44:36 [I] hmr watching [ '.' ]
2026-07-22 15:44:39 [I] hmr reload plugin at hello.ts
hello from my EDITED plugin
```

旧实例先卸载（其所有 effect 都会回卷），新代码随后加载，`apply` 再次运行。按 Ctrl-C 停止进程。编辑 `cordis.yml` 本身也会触发更新：loader 按 `id` 比较 Cordis 配置项，只挂载、卸载或重新配置发生变化的部分。这就是上述 Cordis 配置项显式携带 `id` 的原因：不带该字段的 Cordis 配置项在每次读取时都会获得一个新生成的 id，所以只要配置文件发生任何编辑，即使自身文本未变，它也会被视为先删除再添加并重新挂载。

## 诊断始终无法加载的插件

依赖驱动加载也有另一面：如果插件的 `inject` 指定了无人提供的服务，它就会一直等待，不输出任何内容。这不是错误，因为 PENDING 是合法状态，提供方可能稍后才挂载。

你可以直接查看这些状态。每个上下文都能枚举插件注册表；创建 `diagnose.ts`：

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

再创建一个依赖无法满足的插件 `needs-timer.ts`：

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

运行它（直接执行 `node --import tsx ../../vendor/cordis/bin.js`，按 Ctrl-C 停止）：

```
needs-timer is PENDING — a required service is missing
```

`inject: ['timer']` 没有提供方。向列表添加 `- name: '@deepseek-ai/cordis-plugin-timer'` 后，插件就会加载。如果插件既不执行任何操作，也不报告任何内容，请检查其 fiber 状态。不加 PENDING 过滤条件进行迭代时，还会看到 loader 自身的插件（Loader、Include）处于 ACTIVE，因为配置文件本身也是通过插件挂载的。

下一章：[进入 harness](07-into-the-harness.zh.md)：把相同模式用于真实的 harness 服务。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
