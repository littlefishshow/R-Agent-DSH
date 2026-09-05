# @deepseek-ai/dsh-host-fileworkbench-io

[English](README.md) | 中文

**文件工作台宿主后端**。它挂载一条专用的 [Connection RPC 通道](../../client/connection/README.zh.md)（`/rpc-fileworkbench`），端点为 `listDir`、`readText`、`readImage`、`startSelectionSession`、`deleteSelectionSession`、`writeText`、`createEntry`、`deleteEntry`、`copyEntry`、`renameEntry`，负责文件读写重组以及文件父 Session / 选区 child Session 生命周期。文件 IO **通过 Node 标准库在绝对路径上操作**，而非受沙箱限定的 `ctx.fs`；选区端点还会验证命名 Workspace 确实拥有该路径。消费此通道的浏览器半侧是 [ui-file-workspace](../../client/ui-file-workspace/README.zh.md)。

行为事实：线上的路径是**绝对宿主路径**；相对或空路径、以及非单段的名称，会在任何文件系统调用之前以 `workspace-invalid-path` 拒绝。`listDir` 返回全部直接子目录和普通文件，先目录后文件，并按名称排序。`readText` 与 `writeText` 支持 Markdown、包括 Python 在内的常见源码/配置格式，以及 `README`、`LICENSE`、`Makefile`、`Dockerfile` 等常见无扩展名文本文件；`readText` 返回并缓存正文、作为 `fileIndex` 的绝对路径、ISO `updatedAt` 与不透明的新鲜度 `version`（纳秒 mtime 加大小）。`writeText` 将该 version 作为 `expectedVersion` 收回并拒绝过期覆盖，省略时无条件写入，报告 `create` 或 `update` 并刷新缓存。`readImage` 接受不超过 16 MiB 的 PNG、JPEG、WebP 与 GIF，并返回完整 data URL。`startSelectionSession` 会校验 Workspace 归属，只用当前文件元数据核对缓存 version 而不重新读取正文，随后确保稳定文件父 Session，fork 选区 child，把二者挂入 Workspace，再发送首个问题。插件启动和父会话复用时会从 Workspace 归档集合中移除历史 `file-workbench-*` root 与 `file-selection-*` child，使对话树显示文件 root 及其子分支。提问与修改在缺少非空具体要求时会在创建 Session 前拒绝。`deleteSelectionSession` 会验证 lineage，停止仍活动的受管 Agent，从 Workspace 脱离 child，并永久删除其日志。文件创建、删除、复制和重命名保持原有语义。超过 8 MiB 的文本读写会被拒绝。带类型的失败折叠进共享 RPC 错误词表；该通道从不跨线抛出业务错误。通道的信任栅栏**默认仅回环**（`authority`，`loopback` | `trusted-host`）。

## 安全边界

该后端在**浏览器命名的任意绝对路径**上读取、写入、创建、删除、复制、重命名文件 —— 普通文件端点不受工作区根限定，因为文件工作区的目的正是打开操作者选中的文件夹。这种访问**与 shell 访问一样敏感**。通道因此默认仅回环；把 `authority` 放宽到 `trusted-host` 会把宿主文件操作暴露给部署所声明的 LAN authority，是一个刻意的决定。选区 Session 端点则要求文件仍位于命名 Workspace 内，才会创建或删除上下文。

## Model Experience

### 文件父会话选区上下文

#### What the model sees

`startSelectionSession` 为每个 Workspace 与文件组合维护一个稳定父 Session。父会话持有树节点身份、`[File] <工作区内相对路径>` 标题、preset 组合，并在第一次选区对话启动时由 Agent 自己在一个不调用模型的 turn 中记录且仅记录一条缓存的完整文件快照；因此下一次真人输入会使用后续 turn 编号，不会重复激活 turn 的编号。每个选区 child 不继承父事件，但通过 `parentSession` 保留 Workspace 树关系，并在第一个模型 turn 中依次接纳且仅接纳一条 child 本地完整文件快照和自己的选区 instruction。快照字段顺序固定为 `file_index`、`last_updated`、`version`、`content`。隐藏 instruction 的 source 还会保存选区 id、源码与渲染偏移、动作、标题、文件 version 和颜色；`fileWorkbenchSelection` projection 折叠这些字段供浏览器刷新后恢复，且不会新增 Session 事件或模型可见消息。文件未变化时，父节点与兄弟 child 会得到字节完全一致的文件上下文且不会重新读取 Markdown 正文；零事件继承确保每次 child 请求仍只有一条文件上下文。文件变化后，只有后续 child 使用新的带版本上下文；父节点保留标记该 root 的首次对话快照。第一句明确问题或修改意见作为 child 标题；child 的两条持久开场输入仍保留在日志中供回放，但紧凑浮窗会隐藏。修改提示要求有且仅有一个 `markdown` 或 `md` 围栏代码块；替换内容自身含三反引号时优先使用四反引号。pre-step listener 会保留其他监听器的最终结果，并稳定排序为 runtime context、唯一 child 文件上下文、选区 instruction。

#### Token effect

有条件且取决于数据：稳定父 Session 会保存一条完整文件上下文，但不会因此发起模型请求；每个 child 保存一条完整文件上下文，再追加自己的聚焦问题与追问。文件 version 未变化时，兄弟 child 的上下文字节一致，但任何 child 都不会继承或累积第二条文件上下文。其他文件操作不会增加模型 token。

#### KV Cache effect

同一 Workspace 中未变化文件的重复选区会保留相同 system/preset 前缀，并在 child 本地同一位置获得字节一致的文件上下文。文件写入会改变元数据，因此后续 child 的文件上下文后缀会随之变化。

## Known Limitations and Deferred Work

- **文本识别基于扩展名** —— 常见源码/配置扩展名以及 `README`/`LICENSE`/`Makefile`/`Dockerfile` 会按 UTF-8 解码；其他类型仍显示在文件树中，但不会传入 `readText`。
- **不支持一次调用跨目录移动** —— `renameEntry` 原地重命名、`copyEntry` 复制；移动由客户端做复制再删除。
- **无路径前缀沙箱** —— 访问由回环信任与操作者选中的文件夹界定，而非配置的根白名单；需要硬性根栅栏的部署应等待该配置。
