# @deepseek-ai/dsh-client-ui-file-workspace

[English](README.md) | 中文

**文件工作区**插件：一个以第二种方式投影现有 dsh Workspace 注册表的 VSCode 式文件阅读/编辑器。侧栏包含带滑动动画的对话 / 文件分段切换。对话模式显示原始 Workspace/会话浏览器；文件模式在同一区域把相同的 `WorkspaceView.path` 展开为文件树，同时由 [ui-layout-workbench](../ui-layout-workbench/README.zh.md) 把中栏会话替换为 `workbench` 阅读器。选中文本发起的**修改/提问**子窗口由真正的 dsh 子会话支撑。文件与文件夹 IO 在**绝对路径**上走 [file-workbench Connection RPC 通道](../../host/fileworkbench-io/README.zh.md)；浏览器无法导入宿主包，因此 `src/client/protocol.ts` 镜像该线上契约。

行为事实：系统只有**一份共享 Workspace 列表**，没有第二份文件夹注册表。「添加工作区」调用 `ctx.workspaces.pickDirectory()`（宿主原生选择器），再通过 `ctx.workspaces.create()` 注册所选路径，因此新 Workspace 会同时出现在两种模式。「移除工作区」调用普通 Workspace 删除操作，绝不删除对应目录。文件模式显示每个 Workspace 下的全部直接子目录和普通文件，只有展开目录时才加载其子项。标题、顶部操作、列表边距、行高、字体、文件夹状态、悬停、选中与操作入口均沿用对话 Workspace 树的呈现。每个条目的新建文件、新建文件夹、重命名、删除、复制和粘贴操作都通过后端作用于真实文件系统。目录内容只在选中文件模式时载入。任一「新会话」入口都会先切到对话模式，再执行原始 `ctx.workspaces.startSession()` 动作。

打开文件会新增或激活一个紧凑的浏览器式标签页，标签只显示文件名，不再附加重复的文件图标；标签关闭前会分别保留每个文本文档的草稿、查看模式与新鲜度 version。Markdown 保留富文本渲染、相对本地图片、编辑和选区动作。包括 Python 在内的常见 UTF-8 源码/配置文件以可读的等宽源码打开，并可切换到编辑。PNG、JPEG、WebP 和 GIF 以自适应图片预览打开。PDF 与其他不支持的二进制格式仍显示在文件树中，打开时显示明确的不支持预览面板，而不会按文本解码。文档区域采用与对话相同的 748px 内容列，文本视图保留 80% 到 180% 字号缩放。在 Markdown 渲染预览中选中文本会立即绘制高亮并打开菜单 —— **修改**、**提问**、**解释**、**概括**。选择动作前点击其他区域会关闭菜单并移除临时高亮；文件树操作菜单遵循同一关闭规则。提问和修改只打开待输入窗口，在操作者输入具体问题或修改要求并发送前不会创建 Session；解释和概括使用固定聚焦指令立即开始。

宿主为每个 Workspace 与 Markdown 文件组合持有一个稳定父 Session。打开 Markdown 文档时会缓存正文、绝对文件 index、ISO 最后修改时间和新鲜度 version。启动该文件的第一段选区对话时只检查文件元数据是否仍匹配该 version，并复用缓存快照，不会再次读取 Markdown 正文。父 Session 在对话 Workspace 树中以 `[File] <工作区内相对路径>` 显示，并由 Agent 自己在一个不调用模型的 turn 中记录首次完整 `<file_context>`，因此 Agent 会在后续真人输入前同步推进自己的 turn 计数。每段选区创建一个独立 child，通过 `parentSession` 指向该文件行，不继承父事件，并在动作指令、选中文字和按源码行扩展的周围内容之前写入且仅写入一条固定 `<file_context>`。隐藏的开场 instruction 还会把选区 id、源码与渲染偏移、动作、标题、文件 version 和颜色作为持久 source 元数据保存；宿主把这些字段折叠进 `fileWorkbenchSelection` Session projection。浏览器刷新后，客户端扫描仍存在的 Session 摘要，只在进入文件模式后重读对应文档，并恢复一个最小化窗口及其可点击高亮；删除 child 会同时移除其摘要、projection、窗口与高亮。父节点副本使文件 root 可在对话模式中查看；child 不继承事件，因此一次 child 请求不会同时收到父节点和 child 的两份上下文。浮窗隐藏 child 的两条开场输入，并把操作者输入的第一句问题或修改意见用作 child 标题；后续追问仍正常显示。dsh 会保留完整父子日志与 lineage，供压缩、重载、Workspace 树和原生对话/轨迹投影使用。插件活动期间，无论工作区采用分组还是单列表展示，每个选区 child 都会显示在带文件标签的父 Session 下。插件启动时会从 Workspace 归档集合中移除历史 File Workbench root 和 child，从而修复这些行此前被隐藏的安装，同时不会改变普通归档会话。

子窗口沿用主对话的居中消息流、Markdown 回复、标签页和输入区语言。对话页只渲染 Assistant 的 `text` 块；私有 reasoning 不再混入回答正文，仍可在原生轨迹页中查看。轨迹页直接使用 `ui-trajectory` 的完整渲染器，包含 Overview、搜索、折叠、请求详情、token 用量、耗时、工具记录与更早历史加载。窗口可拖动、调整大小、通过 portal 覆盖完整应用视口，或最小化到底部状态栏。最小化与恢复期间，选区高亮和 child 投影都保持活动；每段绘制范围都有一个同位置、携带高亮 id 的 DOM 命中层，因此点击高亮文本可直接重新打开对应窗口，不需要反向推断坐标。选区提取使用统一的可读文本投影：普通 DOM 文本保持原样，一个 KaTeX 子树只贡献一次 TeX annotation，并转换为行内或块级 Markdown；同一份 Markdown 会发送给 child，并在选区卡片中重新渲染，从而避免 MathML 与视觉字形重复形成乱码。关闭已创建窗口时，宿主会停止 Agent、从 Workspace 脱离并永久删除 Session 日志，全部成功后才移除高亮。**修改**回复只要包含且仅包含一个 `markdown` 或 `md` 围栏代码块即可采纳；围栏外说明会被忽略且绝不会写回，多块或未闭合代码块会被拒绝。采纳前还会把当前草稿的待替换范围与窗口创建时保存的整行源码逐字符比较。合法替换会保留其他未保存草稿修改，并写回该窗口所属的源标签，即使用户已经切换到另一个标签，也不会误写当前文件；随后移除已采纳高亮并执行同样的 Session 删除。若删除失败，则留下只能重试关闭的清理窗口，不会再次应用替换。阅读器记录精确可见文本偏移用于恢复高亮；可见选区→源码范围映射（[`markdown-source-map.ts`](src/client/markdown-source-map.ts)）则在保留源码偏移的同时把 Markdown 归一化为可见文本。

最小化底部标签上的减号只在标签过多时隐藏该入口，不会删除 child Session、上下文或原文高亮；点击原文高亮会重新展开窗口，并恢复其底部标签。永久删除仍只通过窗口标题栏完成。

## Model Experience

### 选区子会话提示

#### What the model sees

操作者为一个文件启动第一次动作时，稳定父 Session 会在不调用模型的 turn 中记录一条完整 `<file_context>`。child 不继承父会话事件。它的第一个 step 包含且仅包含一条 child 本地 `<file_context>`，其中有绝对 `file_index`、ISO 最后修改时间、新鲜度 version 与正文，之后才是动作指令、选中文字和按源码行扩展的周围内容。提问与修改要求操作者提供非空的具体问题或修改要求；缺少时宿主会在创建父 Session 或 child 前拒绝。file-workbench 的 pre-step listener 会先委托既有监听链，再拒绝 child 缺失或重复文件上下文，并把当前 step 稳定排序为 runtime context、唯一文件上下文、选区问题。child 请求顺序是 system/preset context、当前 dsh runtime context、唯一文件上下文、选区问题。

#### Token effect

有条件且取决于数据：每个 child 提供一条完整文件上下文、自己的聚焦问题和之后的追问；后续 turn 不允许再加入第二条文件上下文。仅选择文本、切换对话 / 文件、浏览 Workspace 文件以及未启动选区动作的文件编辑不会增加模型 token。

#### KV Cache effect

普通对话保持不变。同一份未变化、属于同一 Workspace 的文档所创建的每个选区都指向同一个稳定文件父 Session，且不继承父事件；字节一致的 system/preset context 与 child 本地文件上下文构成选区专属问题之前的相同请求前缀。文件写入会改变 version 与最后修改时间，因此后续 child 的该后缀会随之变化。system prompt 与普通 dsh context 的组装仍由所选 agent preset 拥有，而不是本插件。

## Known Limitations and Deferred Work

- **高亮绘制需要 CSS Custom Highlight API** —— 不支持该 API 的引擎回退到坞/徽标形态。
- **添加依赖宿主原生选择器** —— 不提供 `native` 目录选择能力的 profile 无法从此界面添加 Workspace；已有 Workspace 仍可渲染为文件树。
- **复制/粘贴是复制进目录** —— 剪切/移动是复制再删除；没有跨目录的原地移动。
- **未绑定选区会话的文档状态仅存在于当前页面** —— 没有存活选区 child 的标签与草稿可在对话 / 文件模式切换时保留，但浏览器刷新后会清空；被存活 child 引用的文档会在首次进入文件模式时重新打开。
- **浮窗几何会在刷新后重置** —— 持久选区元数据会把每个存活 child 恢复成带可点击高亮的最小化窗口，但自定义位置、尺寸、全屏状态与当前窗口标签不会持久化。
- **PDF 会列出但不渲染** —— 当前仅回环通道提供文本与光栅图片读取，没有受大小约束的 PDF 字节/流式端点或 PDF viewer 依赖，因此 PDF 标签显示不支持预览提示。
- **修改要求唯一的源码匹配** —— Markdown 源码映射失败时，提问、解释与概括仍可使用已捕获的可见文本继续；修改会显示错误，不会冒险写入错误的源码范围。
