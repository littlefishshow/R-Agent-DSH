# @deepseek-ai/dsh-file-workbench

[English](README.md) | 中文

以可安装 profile 组合包（bundle）形式交付的**文件工作台**功能。它是 web profile（[`dsh-base`](../base/README.zh.md) + [`dsh-web-app`](../web-app/README.zh.md)）之上的一个 patch 层：[`cordis.patch.yml`](cordis.patch.yml) 禁用基座 `ui-layout` 行并插入三行 —— 宿主文件 IO 后端与两个浏览器插件 —— 使组合后的 profile 在侧边栏获得**对话 / 文件**切换。对话保留原生 dsh 会话界面；文件在视觉上替换中栏为 VSCode 式文件工作区，同时会话子树继续保持挂载。该组合包还固定兼容的 `ui-sidebar`、`ui-workspace`、`ui-trajectory` 与 `ui-primitives` 包，提供它所消费的扩展 slot、fork 树投影、轨迹快照与本地图片解析器。

装进一个 web profile 并启动:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-file-workbench
dsh --profile web
```

在本仓库中从源码安装本地 checkout 并通过工作区 CLI 启动:

```sh
pnpm dsh plugin --profile web add \
  ./packages/bundle/file-workbench \
  ./packages/client/ui-file-workspace \
  ./packages/client/ui-layout-workbench \
  ./packages/client/ui-primitives \
  ./packages/client/runtime \
  ./packages/client/ui-sidebar \
  ./packages/client/ui-trajectory \
  ./packages/client/ui-workspace \
  ./packages/host/fileworkbench-io \
  ./packages/session/session-persistence \
  ./packages/session/session-persistence-jsonl
pnpm dsh --profile web
```

当前未发布 checkout 需要额外十个路径：pnpm 会把链接 bundle 的 `workspace:` 依赖保留在 bundle 自己的 `node_modules` 下，而浏览器 roster 与基座 persistence 行从 profile 根解析包。单独的 bundle tarball 会从 registry 解析改写后的依赖版本，因此只有在兼容包全部发布后才是单文件安装产物。测试未发布 checkout 时，请使用上面的源码 link 命令。

## 它组合了什么

- [`@deepseek-ai/dsh-host-fileworkbench-io`](../../host/fileworkbench-io/README.zh.md) —— 一条默认仅回环的宿主通道，在操作者选择的绝对路径上列出目录和文件、读写文本与受支持的 Markdown 图片，并创建、删除、复制、重命名条目。
- [`@deepseek-ai/dsh-session-persistence`](../../session/session-persistence/README.zh.md) 与默认 [`JSONL provider`](../../session/session-persistence-jsonl/README.zh.md) —— 携带永久删除非活动 Session 能力的兼容 persistence API 与 provider。
- [`@deepseek-ai/dsh-client-ui-layout-workbench`](../../client/ui-layout-workbench/README.zh.md) —— 一个中栏模式切换的三列外壳；patch 禁用基座 `ui-layout` 使其占据 `root`，但原生会话在对话模式下保持挂载。
- [`@deepseek-ai/dsh-client-ui-file-workspace`](../../client/ui-file-workspace/README.zh.md) —— 侧栏模式切换、共享 Workspace 文件系统投影、带文件操作的懒加载文件树、Markdown 编辑器与选区子窗口。
- [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.zh.md) —— 携带 Workspace 覆盖 seat 与新会话前置通知的兼容侧栏外壳版本。
- [`@deepseek-ai/dsh-client-runtime`](../../client/runtime/README.zh.md)、[`@deepseek-ai/dsh-client-ui-workspace`](../../client/ui-workspace/README.zh.md)、`@deepseek-ai/dsh-client-ui-trajectory` 与 `@deepseek-ai/dsh-client-ui-primitives` —— 本功能所消费的后台 Session 窗口、分组 fork 投影、原生轨迹快照与显式 Markdown 图片解析器的兼容版本。

在浏览器中，对话模式显示现有 Workspace/会话投影，文件模式把同一组 Workspace 路径显示为文件系统树。使用**添加工作区**打开宿主原生目录选择器，并把所选路径注册到共享 Workspace 列表；移除根目录只注销 Workspace，不删除对应目录。树内操作是真实文件系统操作。懒加载展开目录，创建/删除/复制/粘贴/重命名条目，并在阅读器中打开可编辑的 Markdown/文本文件。阅读器支持 80%–180% 字号缩放，并解析受支持的相对本地图片。选中文本会立即高亮，并提供**提问**、**修改**、**解释**或**概括**；选择动作前点击其他区域会移除临时高亮。提问和修改等待操作者输入具体要求，解释和概括立即开始。宿主会在对应 Workspace 下为每个文件维护一个稳定父 Session，并把每段选区放在其下；每个 child 独占一条字节稳定的文件上下文，而问题彼此独立。浮窗可调整大小、通过 portal 覆盖完整视口并停靠；最小化保留高亮，点击该高亮会恢复对应窗口，关闭或采纳修改则永久删除选区 Session 并移除高亮。文件模式点击「新会话」会先切回对话，再执行普通新会话动作。

## 加载顺序与覆盖

profile 按 `dsh.profile.bundles` 顺序应用每个组合包 patch(先 base,再每个已安装组合包),然后是 profile 自己的 `cordis.patch.yml`,再是 `$DSH_HOME/cordis.patch.yml`,最后是每个 `--patch` overlay。后应用的层按 `id` 胜出并替换目标行的整个 `config`,因此用户可以从自己的 profile 覆盖本组合包设置的任意行 —— 包括重新启用基座 `ui-layout` —— 而无需改动本包。

## Model Experience

Indirectly, through [`ui-file-workspace`](../../client/ui-file-workspace/README.zh.md) 所拥有的有条件选区子会话提示；本组合包只是 patch 列表载体。

#### KV Cache effect

普通对话保持不变。文件 version 不变时，兄弟选区共享稳定文件父 Session 的树身份，并各自获得一条字节一致的 child 本地文件上下文；每个选区专属问题及其后续追问保持独立。

## Known Limitations and Deferred Work

- **仅限 web profile** —— 该组合包假定浏览器界面(它禁用一个 web 布局行并挂载浏览器插件);在 TUI 或 headless profile 上不会有任何用处。
- **任意宿主文件系统访问** —— 宿主通道刻意不受 `ctx.fs` 限定，因此与 shell 访问一样敏感；默认仅回环。
- **未发布安装需要文档中的源码 link** —— 单独的 bundle tarball 会从 registry 解析配套包版本，因此只有整组包发布后才能直接安装。
