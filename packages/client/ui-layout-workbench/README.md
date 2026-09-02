# @deepseek-ai/dsh-client-ui-layout-workbench

English | [中文](README.zh.md)

The **workbench shell plugin**: a three-column `WorkbenchAppFrame` (sidebar | center | details, the base column geometry) that **replaces** the base [ui-layout](../ui-layout/README.md) frame and adds a mode-swapped center. The original `sidebar` stays mounted in both modes. In `chat` mode the center renders `conversation`; in `files` mode it renders `workbench`. Both center subtrees stay mounted, so switching modes never remounts the conversation and its state survives. One `register()` call contributes the frame into the runtime's built-in `root` slot and declares its child slots (the base `sidebar`, `conversation`, `details`, and `shell.overlay`, plus `workbench`), seats the workbench layout store, and provides both `ctx.layout` (the base panel-action contract ui-sidebar/ui-conversation inject) and `ctx.workbenchLayout` (the shared mode).

Behavior facts: this frame and the base three-column frame **never coexist** — both occupy `root` and declare the same base child slots, so the bundle disables the base `ui-layout` row and this one owns the shell. The center mode is owned by `WorkbenchLayoutController` (not the per-entry layout store) because two independent plugins share it — the sidebar toggle in [ui-file-workspace](../ui-file-workspace/README.md) and the frame — and it self-persists to `localStorage` (`dsh.workbench.mode.v1`) so the surface a user left in stays selected across reloads. The details column opens only in `chat` mode; `files` mode uses the full center. The column solver ([`columns.ts`](src/client/columns.ts)) is the base three-column concession chain: keep center `>= CENTER_MIN` by shrinking details then auto-closing it; the sidebar never concedes.

## Model Experience

None, as this plugin only arranges the browser shell; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **Forks the base frame rather than composing it** — the frame duplicates the base drag-handle and concession-solve structure because the layout column set is fixed at the frame, not an extension point. A shared column-frame primitive would remove the duplication if a third layout variant appears.
- **Two center modes only** — `chat` and `files`; the frame does not host a third center surface.
- **Details is chat-only** — the file workspace uses the whole center; a details panel alongside the file reader is not modeled.
