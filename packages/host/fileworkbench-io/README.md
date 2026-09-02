# @deepseek-ai/dsh-host-fileworkbench-io

English | [中文](README.zh.md)

The **file-workbench Host backend**. It mounts one dedicated [Connection RPC channel](../../client/connection/README.md) (`/rpc-fileworkbench`) whose endpoints — `listDir`, `readText`, `readImage`, `startSelectionSession`, `deleteSelectionSession`, `writeText`, `createEntry`, `deleteEntry`, `copyEntry`, `renameEntry` — list, read, edit, and reorganize files and own file-parent/selection-child Session lifecycles. File IO uses **absolute paths through Node's stdlib**, not sandbox-confined `ctx.fs`; selection endpoints additionally verify the named Workspace owns the path. The browser half that consumes this channel is [ui-file-workspace](../../client/ui-file-workspace/README.md).

Behavior facts: paths on the wire are **absolute host paths**; a relative or blank path, or a name that is not a single path segment, is refused with `workspace-invalid-path` before any filesystem call. `listDir` returns one directory level — child directories first, then files, name-sorted — with an `editable` flag on each file (`.md`, `.markdown`, `.txt`). `readText` returns and caches the content, absolute path as `fileIndex`, ISO `updatedAt`, and an opaque freshness `version` (nanosecond mtime plus size). `writeText` takes the version back as `expectedVersion` and refuses a stale overwrite, or writes unconditionally when omitted, reporting `create` or `update` and refreshing the cache. `readImage` accepts PNG, JPEG, WebP, and GIF files up to 16 MiB and returns a complete data URL for an explicitly trusted Markdown consumer. `startSelectionSession` validates Workspace ownership, checks current metadata against the cached version without rereading the body, ensures the stable file parent, forks the selection child, attaches both to the Workspace, and sends the first question. Ask and modify reject a missing non-blank instruction before creating a Session. `deleteSelectionSession` verifies lineage, stops the owned Agent when live, detaches the child, and permanently deletes its durable log. File creation, deletion, copying, and renaming retain their existing semantics. A text read/write above 8 MiB is refused. Typed failures fold into the shared RPC error vocabulary; the channel never throws a business error across the wire. The channel's trust fence is **loopback-only by default** (`authority`, `loopback` | `trusted-host`).

## Security boundary

This backend reads, writes, creates, deletes, copies, and renames files at **arbitrary absolute paths the browser names** — ordinary file endpoints are not confined to a workspace root, because the file workspace's purpose is to open folders the operator picks. That access is **as sensitive as shell access**. The channel is loopback-only by default for this reason; widening `authority` to `trusted-host` exposes host file operations to the deployment's declared LAN authorities and is a deliberate decision. Selection Session endpoints do require the file to remain inside the named Workspace before they create or delete context.

## Model Experience

### File-parent selection context

#### What the model sees

`startSelectionSession` keeps one stable parent Session per Workspace-and-file pair. The parent owns only the tree identity, title, preset composition, and one model-free activation turn; it never stores document content. Each selection child starts with no inherited events, retains `parentSession` for the Workspace tree, and admits exactly one cached complete-file snapshot followed by its independent selection instruction in the first model turn. The snapshot uses the fixed field order `file_index`, `last_updated`, `version`, then `content`. An unchanged file therefore gives sibling children byte-identical file-context messages without rereading the Markdown body, while a changed file produces a new versioned context only for later children. The first explicit question or modification request becomes the child title; both durable opening inputs remain in the log for replay but the compact floating window hides them. Modify prompts require exactly one `markdown` or `md` fenced block and recommend four backticks when the replacement itself contains triple-backtick fences. The pre-step listener preserves the other listeners' final result and orders runtime context, the single file context, then the selection instruction.

#### Token effect

Conditional and data-dependent: every child stores one complete-file context followed by its focused question and follow-ups. Sibling contexts are byte-identical while the cached file version is unchanged, but no child can accumulate a second file context. Other file operations add no model tokens.

#### KV Cache effect

Repeated selections over the same unchanged Workspace-owned file keep the same system/preset prefix and receive a byte-identical file-context message at the same child-local position. A write changes the metadata and therefore the file-context suffix for later children.

## Known Limitations and Deferred Work

- **Editable set is fixed to Markdown and plain text** — `.md`, `.markdown`, and `.txt` are readable/writable; other files list but do not open in the editor. A deployment that needs another text type waits for a config field rather than a hardcoded widening.
- **No move across directories in one call** — `renameEntry` renames in place and `copyEntry` copies; a move is copy-then-delete by the client.
- **No path-prefix sandbox** — access is bounded by loopback trust and the operator's picked folders, not by a configured root allowlist; a deployment needing a hard root fence waits for that config.
