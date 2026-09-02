# Agent Note: File-workbench GUI (document editing with selection sub-sessions)

Status: implemented

[English](2026-08-30-file-workbench-gui.md) | 中文

## Problem

Web GUI 只把 Workspace 投影为其中的对话；它不能把同一 Workspace 切换成完整文件树、阅读和编辑 Markdown，也不能针对一段选中文字提问或改写而不手工复制到聊天。所需界面遵循 R-Agent Cockpit：左侧有对话 / 文件模式切换；对话模式保留原始会话界面；文件模式以 VSCode 式文件阅读器替换中栏；选区打开聚焦子会话；子窗口最小化后保持高亮；改写可直接采纳回文件。该能力**以可安装插件方式**带入 dsh，复用 dsh 自己的会话、压缩、会话日志与轨迹，而不是另建 agent 运行时。

## Decision

三个可选插件包加一个可安装组合包（bundle），叠加在已发布的 Web 组合之上；组合包未安装时基座 UI 保持默认行为与呈现。

- **`packages/host/fileworkbench-io`**（host）挂载一条通用 [Connection RPC 通道](../../../../packages/client/connection/README.zh.md) `/rpc-fileworkbench`，提供文件 IO、`startSelectionSession` 与 `deleteSelectionSession`，且不触碰共享 apiproxy `RpcMethodMap`。文件端点通过 Node 文件系统操作绝对路径，而非受沙箱限定的 `ctx.fs`；选区端点还要求命名 Workspace 拥有该路径。宿主为每个 Workspace 与文件组合持有一个稳定父 Agent/Session。`readText` 会缓存已经返回给浏览器的精确文档快照；启动选区动作时只用当前文件元数据核对缓存 version，不会重新读取 Markdown 正文。稳定父会话不包含文件正文，只作为文件的可见树根并持有共享 preset 组合。每段选区创建一个普通 child，通过 `parentSession` 指向该根节点，不继承父事件，并在选区 instruction 之前写入且仅写入一条固定 `<file_context>`。pre-step listener 会拒绝缺失或重复文件上下文。文件未变化时，兄弟 child 会得到字节完全一致的上下文；文件变化只影响后续 child。操作者输入的第一句问题或修改意见成为 child 标题。关闭或采纳已创建 child 时会停止 Agent、从 Workspace 脱离并调用通用 `SessionPersistence.delete()`。任意文件访问与 shell 一样敏感，因此通道默认仅回环。
- **`packages/client/ui-layout-workbench`**（web）保留基座三列几何，但**替换** `ui-layout` 以新增按模式切换的中栏。原始 `sidebar` 在两种模式中始终保持挂载。对话渲染 `conversation`；文件渲染 `workbench`；两个中栏子树都保持挂载，因此切换模式不会丢失会话。它原样重新提供 `ctx.layout`，并提供共享、持久化的 `ctx.workbenchLayout` 模式。
- **`packages/client/ui-file-workspace`**（web）提供带动画的对话 / 文件分段切换，仅在文件模式用文件系统投影覆盖原侧栏 Workspace 区域，占据 `workbench` 中栏阅读器，并通过 `shell.overlay` 提供选区子窗口。文件系统根目录直接来自 `ctx.workspaces.list.items`；添加使用宿主原生选择器后调用 `ctx.workspaces.create()`，移除调用 `ctx.workspaces.delete()` 且不删除目录。根目录渲染为懒加载文件树，沿用基础侧栏的行高、字体、文件夹状态、选中颜色和共享 Menu 组件，并支持新建、删除、复制、粘贴和重命名。Markdown 阅读器采用与对话相同的 748px 内容宽度，以带曲线边框和激活过渡的浏览器式标签页同时保留多个文档，支持 80%–180% 字号缩放，并通过 `readImage` 显式解析相对本地图片，不改变共享渲染器默认安全策略。选中文本会在动作选择前立即创建页面内高亮；点击其他区域会关闭未选择动作的菜单并清理临时高亮。每段高亮会记录精确可读文本偏移，并组合 CSS Custom Highlight 绘制与同位置、携带高亮 id 的 DOM 命中层，因此重复文本和被 Markdown 行内节点拆分的文本仍能直接点击。可读文本投影会把每个 KaTeX 子树替换为唯一一份 TeX annotation，并包装成 Markdown 后发送给 child 或在可滚动的选区卡片中渲染。提问与修改打开待输入窗口，操作者提供具体要求前不会发送任何内容；解释与概括立即开始。紧凑浮窗隐藏持久化的文件上下文和分支起始消息，把操作者第一句要求作为标题，并继续显示后续追问。对话页只渲染 Assistant 的文本块，reasoning 保留在原生轨迹页。修改回复只要包含且仅包含一个 `markdown` 或 `md` 围栏代码块且捕获的源码范围仍逐字符匹配即可采纳；围栏外说明会被忽略而不会写回。每个 child 在 portal 到 `document.body` 的可移动、可调整大小窗口中驱动流式对话和 `ui-trajectory` 完整轨迹渲染器，因此全屏会覆盖完整应用。观察 child 时会先调用 `SessionRuntime.ensureOpen()` 再读取快照，因此历史和实时回复会直接在文件模式更新，而不会改变主对话的当前会话；重连时所有已打开 child 都会参与 resync。窗口最小化到底部状态栏不会释放投影或高亮，点击已绘制范围会再次抬起窗口。关闭时只有宿主删除 Session 成功后才移除高亮；采纳修改会写回浮窗所属源标签，即使当前激活的是另一个标签也不会误写，文件写入后移除高亮，若 Session 删除失败则留下只能重试关闭的清理窗口。基座侧栏会在开始新会话前发出事件，使本插件先选中对话模式，再执行未改变的新会话动作。
- **`packages/bundle/file-workbench`**（`@deepseek-ai/dsh-file-workbench`）是可安装单元：一个 `dsh.bundle`，其 `cordis.patch.yml` 禁用基座 `ui-layout` 并插入三个功能行。它**依赖**这些包以及兼容的 `client-runtime`、`ui-sidebar`、`ui-workspace`、`ui-trajectory` 与 `ui-primitives` 版本，提供本功能扩展的后台 Session API 与客户端契约，使 `dsh plugin add` 把完整功能链接进 profile，让浏览器 roster 扫描器按名解析。安装：`dsh plugin --profile web add @deepseek-ai/dsh-file-workbench`。

宿主创建并持有文件父会话与选区 child 的 `AgentHandle`。稳定文件 id 可跨浏览器刷新，并在宿主重启后恢复。父子使用当前默认模型与同一 agent preset generation；child 保留持久 `parentSession`，但不继承父事件。父会话提供树身份与 preset 组合，child 拥有自己的唯一文件上下文和独立对话。浏览器从紧凑浮窗视图中过滤两条隐藏开场消息。完整 child 日志仍供压缩、持久化、重载、Workspace 树以及原生对话和轨迹视图使用。文件工作台扩展会保留普通 fork lineage 展示，因此分组与单列表都会把每个选区 child 显示在稳定文件父 Session 下。

文件快照与选区 instruction 仍是两条独立的 child 持久消息。child 追加一条插件来源文件上下文和一条模型侧仍为 user role 的 instruction，二者都不进入紧凑浮窗消息流。file-workbench 的 `agent/pre-step` listener 调用 `next()`，要求 child 首个 step 恰好一条文件上下文、后续 step 不再出现，并把最终领取批次稳定分组为 runtime context、文件快照、选区输入。因此模型请求会看到 agent preset 的 system prompt、当前 step 的 runtime context、唯一文件上下文、选区 instruction。同一未修改文档的兄弟选区会在相同请求位置获得字节一致的上下文，各自问题保留在独立 child Session 中。

## Alternatives considered

**向共享的 apiproxy `RpcMethodMap` 添加 `host.readFile`/`host.writeFile`。** 拒绝：这会为一个功能的文件 IO 拓宽每个客户端与线上 schema 共享的契约。通用 `ctx.connection.rpc` 通道本就带信任栅栏，并让插件拥有自己的端点，保持共享面不变。

**分叉整个 web-app bundle 并编辑一份拷贝的 UI（字面意义的「备份 UI」理解）。** 拒绝：dsh 由独立 slot 插件组合 UI，因此物理拷贝会与基座分叉且无法跟随它。可叠加插件加一个 bundle overlay 使基座运行时保持原封不动，功能保持可选。

**通过编辑 `dsh-web-app` 的依赖来分发功能，或以 `examples/*/cordis.yml` 的 `--patch` overlay 分发。** 拒绝：编辑基座 bundle 会把已发布默认耦合到一个可选功能，而 example overlay 是开发期快速起步、不是可分发单元——它的 `--patch` 路径按名引用的包，外部 harness 没有理由已安装。按 [docs/user/develop/basic/publish.zh.md](../../../../docs/user/develop/basic/publish.zh.md) 的可安装 `dsh.bundle` 才是被认可的机制：它携带自己的依赖，因此 `dsh plugin add` 会把它们链接进目标 profile 的扁平（`nodeLinker: hoisted`）`node_modules`，让浏览器 roster 扫描器能解析。本地 `link:` 源码安装会把 bundle 的 `workspace:` 依赖嵌套，扫描器就找不到；发布或 `pnpm pack` 安装则把这些范围改写为真实版本，并通过 profile 的 hoisted 布局解析。

**在 Session 存储之外另建选区上下文树。** 拒绝：这会复制事件日志、压缩状态、lineage、回放、删除和轨迹的所有权，并在重载后产生同步负担。原生 Session lineage 已提供所需树结构：每个文件拥有一个父 Session，每段选中文字成为其持久 child，浮窗只是 child 的过滤投影。

**常驻的第四列。** 用户审阅后拒绝：它把文件工作区和对话工作区同时分隔成两个块，而目标是互斥的对话 / 文件模式。布局 fork 现在保留基座三列并切换中栏内容，同时让隐藏的会话子树保持挂载。

**第二份持久化文件夹注册表。** 用户审阅后拒绝：它给同一目录赋予两套无关身份，并使文件根目录的添加依赖可选的 browse 能力。Workspace 注册表是唯一权威；对话从中投影会话，文件从每个 `WorkspaceView.path` 投影目录内容。宿主原生选择器仍是唯一添加交互。

**通过改写 MarkdownText 的 DOM 实现高亮。** 拒绝：包裹渲染节点会与流式 Markdown 渲染器冲突。CSS Custom Highlight API 在活动文本上绘制范围而不做结构编辑；不支持它的引擎回退到坞/徽标形态。

## Consequences

组合包未安装进 profile 时基座 Web UI 不变；功能是真正的可选层。对话保留完整原功能，并在文件模式活动时继续保持挂载。两种模式共享 Workspace 身份、顺序、添加与移除；切换只改变侧栏投影会话还是文件系统内容。`ui-workspace` 提供默认关闭、采用引用计数的展示控制器；本插件 retain 后，文件父会话和选区 child 只在插件生命周期内按 lineage 显示。文件操作使用任意宿主绝对路径，刻意放弃 `ctx.fs` 限定，因此默认仅回环。每个选区子窗口都是普通 dsh Session，其压缩、持久历史、lineage、删除与轨迹无需新上下文存储即可工作。`ui-trajectory` 使插件窗口渲染与主标签页相同的完整轨迹实现。代价：`ui-layout-workbench` 仍复制基座框架的拖拽手柄与让位结构；每个活动文件父 Session 会向 child 提供完整文件内容；高亮绘制需要 CSS Custom Highlight API。纯逻辑、共享 Workspace 投影、模式交接、child-session 生命周期、永久删除、窗口控制、Markdown 图片授权、上下文顺序与绝对路径文件操作都有专项覆盖。
