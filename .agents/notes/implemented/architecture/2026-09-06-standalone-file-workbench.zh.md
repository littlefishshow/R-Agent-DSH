# Agent Note: 独立安装的 R-Agent 文件工作台 Bundle

Status: implemented

[English](2026-09-06-standalone-file-workbench.md) | 中文

## 问题

R-Agent-DSH 的文件工作台涉及新增插件以及共享界面、持久化和工作区包的修改，因此源码中的组合包依赖分叉仓库的 workspace。只向原版 DSH 安装功能包，无法还原子会话永久删除、后台会话观察和完整界面。用户需要一个可分发的安装包，在不编辑宿主源码的情况下保留这些行为。

## 决策

独立的 [file-workbench 包](../../../../plugins/file-workbench/README.zh.md) 面向已发布且未经修改的 DSH `0.1.1-rc.2` Web profile 与 JSONL 存储。它携带 R-Agent 提交 `c5b7365c705f13f993b0ca0a03c566b69761f5b7` 的功能实现，以及私有界面模块、扩展后的 JSONL 和 Workspace provider。外层 checkout 保持共同上游基线 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e` 的源码。Agent、LLM、工具、API 和主客户端 runtime 由安装目标的 DSH 提供。

profile patch 禁用标准 provider 行和四个互斥 UI 行，再插入三个 bundle 入口。持久化入口在原始 Loader context 中读取并求值被禁用行的配置，保留用户自定义根目录、压缩和缓存选项。provider 复用原版 service 与错误类型的身份，写入原版格式的数据。Windows 文件锁复用原版 JSONL 包已经提供的原生依赖。

浏览器产物注册一个 DSH 模块工厂，包含文件界面、布局、侧栏、工作区树、轨迹、Markdown 增强、CSS 和字体数据。共享 runtime、React、Cordis 和 slot 身份仍来自外部。唯一依赖具体版本的适配器调用原版 binding 的具体 `Session.open()` 方法，在不改变主会话选择的情况下观察后台会话；它不修改 runtime 方法。

每个工作区与路径组合拥有稳定的文件父会话。每次选区建立独立子会话，携带完整文件快照、选区元数据与相应动作指令。关闭浮窗会通过选定的持久化协调器停止并删除子会话，包括处理待写队列和缓存状态。这保留 R-Agent 的语义，没有采用本地 v2 工作台中不同的上下文与笔记功能。

## 考虑过的替代方案

**发布依赖分叉版共享包的功能包。** 这会保留对源码 workspace 的依赖，无法满足安装到原版 DSH 的要求。

**复制本地 v2 的功能实现。** 它的打包方式适合本任务，但上下文、笔记和子会话行为与 R-Agent 不同。本包采用相同的安装思路，保留 R-Agent 的功能实现。

**直接删除会话文件，或修改原版 service 实例。** 直接删除会绕过写入退役和缓存处理，运行时修改则使行为依赖安装顺序。由 bundle 自有 provider 统一管理这些生命周期操作，卸载后即可恢复原版 provider。

## 影响

用户通过标准 DSH 插件命令安装和删除一个 tarball，无须编辑源码或重新构建宿主。卸载恢复标准组合并保留数据；用户关闭选区浮窗所触发的子会话删除仍然是永久删除。私有 provider 和界面代码副本会带来随宿主升级而产生的维护工作。

兼容范围限于已验证的 DSH 版本和标准 JSONL 组合。SQLite、自定义 provider 和其他版本需要单独适配与验证。本包不迁移需要 R-Agent 重复空轮次投影修复的历史日志；新选区会话使用原版 runtime，无须该修复。真实模型质量和其他操作系统不属于 Windows 安装与本地模型验收所证明的范围。

## 验证

单元及客户端测试覆盖文件操作、选区语义、后台会话观察、浮窗行为、写入协调和删除。构建产物测试使用已发布的 DSH 依赖加载完整浏览器模块工厂。[安装验收脚本](../../../../plugins/file-workbench/scripts/verify-install.mjs) 向全新 profile 安装 tarball，执行完整应用的本地模型交互记录，重启宿主，卸载本包，并检查原版 DSH 能否读取保留会话。脚本在隔离测试目录中留下证据并停止自己的服务器。
