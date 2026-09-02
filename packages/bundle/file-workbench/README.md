# @deepseek-ai/dsh-file-workbench

English | [中文](README.zh.md)

The **File Workbench** feature as an installable profile bundle. It is a patch layer over a web profile ([`dsh-base`](../base/README.md) + [`dsh-web-app`](../web-app/README.md)): [`cordis.patch.yml`](cordis.patch.yml) disables the base `ui-layout` row and inserts three rows — the host file IO backend and the two browser plugins — so the composed profile gains a sidebar **Chat / Files** switch. Chat preserves the original dsh conversation surface; Files replaces the center visually with a VSCode-like file workspace while the conversation subtree stays mounted. The bundle also pins compatible `ui-sidebar`, `ui-workspace`, `ui-trajectory`, and `ui-primitives` packages for the extension slots, fork-tree projection, trajectory snapshot, and local-image resolver it consumes.

Install it into a web profile and launch:

```sh
dsh plugin --profile web add @deepseek-ai/dsh-file-workbench
dsh --profile web
```

From source in this repository, install the local checkout and launch through the workspace CLI:

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

The extra ten paths are needed for this unpublished checkout: pnpm keeps a linked bundle's `workspace:` dependencies nested under that bundle, while the browser roster and base persistence row resolve packages from the profile root. A standalone bundle tarball resolves its rewritten dependency ranges from the registry, so it becomes a single-file install artifact only after the compatible package set is published. Use the source-link command above while testing an unpublished checkout.

## What it composes

- [`@deepseek-ai/dsh-host-fileworkbench-io`](../../host/fileworkbench-io/README.md) — a loopback-only host channel for listing directories and files, reading/writing text and supported Markdown images, and creating, deleting, copying, and renaming entries at operator-chosen absolute paths.
- [`@deepseek-ai/dsh-session-persistence`](../../session/session-persistence/README.md) and the default [`JSONL provider`](../../session/session-persistence-jsonl/README.md) — the compatible persistence API and provider carrying permanent non-live Session deletion.
- [`@deepseek-ai/dsh-client-ui-layout-workbench`](../../client/ui-layout-workbench/README.md) — a three-column shell with a mode-swapped center; the patch disables base `ui-layout` so this frame takes `root`, but the original conversation remains mounted in Chat mode.
- [`@deepseek-ai/dsh-client-ui-file-workspace`](../../client/ui-file-workspace/README.md) — the sidebar mode toggle, shared Workspace filesystem projection, lazy file tree with file operations, Markdown editor, and selection sub-windows.
- [`@deepseek-ai/dsh-client-ui-sidebar`](../../client/ui-sidebar/README.md) — the compatible sidebar shell version carrying the Workspace overlay seat and the pre-New-Session notification.
- [`@deepseek-ai/dsh-client-runtime`](../../client/runtime/README.md), [`@deepseek-ai/dsh-client-ui-workspace`](../../client/ui-workspace/README.md), `@deepseek-ai/dsh-client-ui-trajectory`, and `@deepseek-ai/dsh-client-ui-primitives` — compatible versions of the background Session window, grouped fork projection, native trajectory snapshot, and explicit Markdown image resolver consumed by the feature.

In the browser, Chat shows the existing Workspace/session projection and Files shows the same Workspace paths as filesystem trees. Use **Add workspace** to open the Host's native directory picker and register the selected path in the shared Workspace list; removing a root unregisters the Workspace without deleting its directory. Operations inside the tree are real filesystem operations. Expand folders lazily, create/delete/copy/paste/rename entries, and open an editable Markdown/text file in the reader. The reader offers 80%–180% text scaling and resolves supported relative local images. Selecting text immediately highlights it and offers **ask**, **modify**, **explain**, or **summarize**; clicking elsewhere before choosing removes the temporary highlight. Ask and modify wait for a concrete human instruction; explain and summarize start immediately. The Host keeps one stable file parent under the owning Workspace and places every selected passage beneath it; each child owns exactly one byte-stable file context while its question remains independent. Windows are resizable, portaled to the complete viewport for fullscreen, and dockable; minimize preserves the highlight, and clicking that highlight restores its window, while close or accepted modification permanently deletes the selection Session and removes the highlight. Clicking New Session while Files is active selects Chat before running the normal session action.

## Load order and overrides

A profile applies each bundle patch in `dsh.profile.bundles` order (base first, then each installed bundle), then the profile's own `cordis.patch.yml`, then `$DSH_HOME/cordis.patch.yml`, then each `--patch` overlay. A later layer wins by `id` and replaces the targeted row's whole `config`, so a user can override any row this bundle sets — including re-enabling the base `ui-layout` — from their profile without editing this package.

## Model Experience

Indirectly, through [`ui-file-workspace`](../../client/ui-file-workspace/README.md), which owns the conditional selection child prompt; this bundle is only a patch-list carrier.

#### KV Cache effect

The ordinary Chat conversation is unchanged. Sibling selections share the stable file-parent tree identity and receive one byte-identical child-local file context while the version is unchanged; each selection-specific question and its follow-ups remain independent.

## Known Limitations and Deferred Work

- **Web profiles only** — the bundle assumes the browser surface (it disables a web layout row and mounts browser plugins); it does nothing useful over a TUI or headless profile.
- **Arbitrary host filesystem access** — the host channel is intentionally outside `ctx.fs` confinement and therefore as sensitive as shell access; it stays loopback-only by default.
- **Unpublished installs need the documented source links** — a standalone bundle tarball resolves its companion package versions from the registry and therefore becomes directly installable only after that package set is published.
