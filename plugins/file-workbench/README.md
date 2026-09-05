# R-Agent File Workbench

[中文安装与实现说明](README.zh.md)

An installable bundle containing the R-Agent-DSH file workbench, its Host RPC, browser UI, styles and fonts. It targets the standard Web profile and JSONL backend of unmodified DeepSeek Harness `0.1.1-rc.2`, on Node `^22.19.0 || >=24.0.0`.

Stop DSH Web, install the tarball, and restart:

```sh
dsh plugin --profile web add /absolute/path/dsh-file-workbench-0.1.0.tgz
dsh --profile web --dump-config
dsh web
```

Source users can substitute `pnpm dsh`. No original source edits or DSH rebuild are needed. The package is not published to npm. Remove it with `dsh plugin --profile web remove dsh-file-workbench` and restart.

The bundle preserves R-Agent's files, Markdown/math/local images, selection actions, stable file parents, independent selection sessions, floating chat and trajectory windows, confirmed replacement, and deletion on close. It selects bundle-owned JSONL and Workspace providers using the existing configuration and data formats, and replaces the four exclusive presentation plugins through the profile patch. Agent execution and the main client runtime remain supplied by DSH. A single checked, version-pinned bridge calls the original concrete `Session.open()` to observe off-stage sessions. Other DSH versions, SQLite and custom storage providers require additional compatibility work.

Development is independent of the enclosing DSH workspace:

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm test:built
pnpm publint
pnpm pack --pack-destination ./artifacts
```

Artifacts are written to `artifacts/`. See [the Chinese documentation](README.zh.md) for retained behavior, limits and source provenance. Uninstalling retains data; closing a selection window permanently deletes its child session. No credentials are shipped.

The built-artifact test loads the actual browser factory against published DSH dependencies. Installation acceptance takes a separately installed stock `@deepseek-ai/dsh@0.1.1-rc.2` CLI, the tarball, and a new isolated home that does not yet exist. Port `3137` must be available. Do not pass a home containing everyday sessions.

```sh
node scripts/verify-install.mjs /absolute/path/to/dsh/lib/bin.js artifacts/dsh-file-workbench-0.1.0.tgz /absolute/path/to/new-test-home
```

The [acceptance script](scripts/verify-install.mjs) exercises normal installation, file operations, four selection actions, follow-up, cancellation, stale saves, deletion and restart recovery through the original Agent loop and a local mock model. It then uninstalls the bundle and checks that the original interface and readable session data survive. Evidence is written to `verification.json` in the isolated home. Real model quality, other operating systems, and legacy logs requiring R-Agent's repeated-empty-turn projection repair are outside this evidence.
