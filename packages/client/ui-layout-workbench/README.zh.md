# @deepseek-ai/dsh-client-ui-layout-workbench

[English](README.md) | 中文

**工作台外壳插件**：一个三列 `WorkbenchAppFrame`（侧边栏 | 中栏 | 详情，与基座相同的列几何），它**替换**基座 [ui-layout](../ui-layout/README.zh.md) 框架并新增按模式切换的中栏。原始 `sidebar` 在两种模式下始终保持挂载；`chat` 模式的中栏渲染 `conversation`，`files` 模式渲染 `workbench`。两个中栏子树都保持挂载，因此切换模式绝不会重挂会话、其状态得以保留。一次 `register()` 调用把该框架贡献进运行时内置的 `root` slot 并声明其子 slot（原样承接基座 `sidebar`、`conversation`、`details`、`shell.overlay`，外加 `workbench`），安置工作台布局 store，并同时提供 `ctx.layout`（ui-sidebar/ui-conversation 注入的基座面板动作契约）与 `ctx.workbenchLayout`（共享模式）。

行为事实：本框架与基座三列框架**从不共存** —— 二者都占据 `root` 并声明相同的基座子 slot，因此组合包会禁用基座 `ui-layout` 行，由本框架独占外壳。中栏模式由 `WorkbenchLayoutController` 拥有（而非每实例的布局 store），因为两个独立插件共享它 —— [ui-file-workspace](../ui-file-workspace/README.zh.md) 中的侧栏切换与本框架 —— 且它自持久化到 `localStorage`（`dsh.workbench.mode.v1`），使用户离开时所在的界面跨刷新保持选中。详情列只在 `chat` 模式打开；`files` 模式使用整个中栏。列求解器（[`columns.ts`](src/client/columns.ts)）是基座三列让位链：通过先收缩详情、再自动关闭它来保持中栏 `>= CENTER_MIN`；侧边栏从不让位。

## Model Experience

None, as 此插件只排布浏览器外壳；这里没有任何内容进入模型请求。

#### KV Cache effect

无；此包既不组装也不发送 provider 请求。

## Known Limitations and Deferred Work

- **是对基座框架的分叉而非组合** —— 该框架复制了基座的拖拽手柄与让位求解结构，因为布局列集合固定在框架处，而非一个扩展点。若出现第三种布局变体，一个共享的列框架原语可消除这份重复。
- **仅两种中栏模式** —— `chat` 与 `files`；框架不承载第三种中栏界面。
- **详情仅限 chat** —— 文件工作区使用整个中栏；不建模文件阅读器旁的详情面板。
