# R-Agent 文件工作台 Bundle

把 R-Agent-DSH 的文件工作台安装到未修改的 DeepSeek Harness。包名为 `dsh-file-workbench`，一个安装包同时携带 Host、浏览器界面、样式、字体和配置 patch。

## 安装

适用于 DSH `0.1.1-rc.2` 的标准 `web` profile、JSONL 会话存储。Node.js 要求与 DSH 相同：`^22.19.0 || >=24.0.0`。自定义 profile 必须保留标准 patch 中的行 ID；其他 DSH 版本、SQLite 或自定义存储尚不在本包的兼容范围内。

先停止要安装的 DSH Web 进程，再执行：

```powershell
dsh plugin --profile web add D:\Downloads\dsh-file-workbench-0.1.0.tgz
dsh --profile web --dump-config
dsh web
```

从 DSH 源码启动的用户将 `dsh` 替换为 `pnpm dsh`。不需要复制源码、修改原版文件或重新构建 DSH。本包尚未发布到 npm；请分发 `artifacts/dsh-file-workbench-0.1.0.tgz`。安装后需要重启 Web 并刷新页面。

卸载并重启可恢复原版界面和原版 provider：

```powershell
dsh plugin --profile web remove dsh-file-workbench
dsh web
```

卸载不删除会话或文件。会话仍采用原版 JSONL 格式，工作区仍采用原版 storage domain；插件关闭选区浮窗时执行的会话删除则是永久删除。

## 保留的 R-Agent 功能

- Chat/Files 切换、可调整布局、工作区目录树和多文件标签。
- 文本读取、编辑、保存，以及文件/目录的新建、复制、重命名、删除。
- Markdown 预览、代码高亮、数学公式、本地相对路径图片和独立图片预览。
- 选区提问、解释、总结、修改；提问和修改等待用户指令，解释和总结立即开始。
- 每个工作区文件有稳定父会话；每次选区建立独立子会话，携带文件快照与选区元数据。
- 多个浮窗并行展示、拖动、缩放、最小化、全屏、继续追问、停止和完整轨迹视图。
- 修改结果经确认写回对应文件；保留文件版本检查、选区高亮和会话恢复。
- 关闭浮窗时停止并删除对应子会话，文件会话树保持分组关系。

这延续 R-Agent `c5b7365c705f13f993b0ca0a03c566b69761f5b7` 的功能。PDF、v2 的本地笔记和上下文策略等并非 R-Agent 原有功能，没有并入本包。

## 实现边界

`cordis.patch.yml` 在原版启动配置上选择本包提供的 JSONL 与 Workspace provider，禁用四个互斥的原版界面插件行，并注册本包。配置仍保留用户已有的 JSONL 根目录、压缩和缓存选项。Agent、LLM、工具执行、主 SessionRuntime 和 API 使用原版包。

`src/host/files` 是文件与选区逻辑；`src/client/files` 是工作台；布局、侧栏、会话树、轨迹及 Markdown 增量渲染在相邻目录。原版没有永久删除和取消归档的公开接口，因此 `src/host/persistence`、`jsonl`、`workspaces` 在插件内维护对应 provider 扩展，避免在原版实例上打补丁或绕过写入队列直接删文件。

后台会话唯一依赖具体版本的方法集中在 `src/client/background-session.ts`：调用原版 binding 所保留的 `Session.open()`，不改变主会话选择，也不替换 runtime 方法。升级 DSH 时必须重新验证这一方法和 provider 的数据格式。

文件 RPC 默认只接受本机浏览器；受信主机部署可配置本包的 `authority: trusted-host`，沿用 DSH 的连接授权设置。请在目标机器上安装并配置其模型，Bundle 不携带密钥。

## 构建与验证

本目录是独立 pnpm 项目，不属于上层 DSH workspace。

```powershell
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:built
pnpm publint
pnpm pack --pack-destination ./artifacts
```

测试使用 npm 发布的原版 DSH 运行时与服务。少量 renderer 和字典测试夹具来自共同基线 `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`，用于补齐原版测试包引用但未发布的文件；它们不进入安装包。`test:built` 还会构建并通过 DSH 模块工厂加载实际浏览器产物。

安装验收以独立安装的原版 `@deepseek-ai/dsh@0.1.1-rc.2` 为宿主。下面三个路径依次是原版 CLI、刚构建的 tarball、尚不存在的隔离测试目录；不要传入日常使用的 DSH_HOME。脚本需要本机端口 `3137` 空闲。

```powershell
node scripts/verify-install.mjs /absolute/path/to/dsh/lib/bin.js artifacts/dsh-file-workbench-0.1.0.tgz /absolute/path/to/new-test-home
```

[验收脚本](scripts/verify-install.mjs) 使用标准安装命令、原版 Agent 循环和本地模拟模型，验证文件操作、四种选区动作、追问、取消、版本冲突、永久删除和重启恢复；随后卸载 bundle，检查原版界面恢复及会话仍可读取。结果保存在隔离目录的 `verification.json`。真实模型回答质量、其他操作系统及需要旧版重复空轮次修复的历史日志，不在这些测试的证明范围内。
