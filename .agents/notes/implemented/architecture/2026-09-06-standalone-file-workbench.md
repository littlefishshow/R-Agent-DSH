# Agent Note: Standalone R-Agent file workbench bundle

Status: implemented

English | [中文](2026-09-06-standalone-file-workbench.zh.md)

## Problem

R-Agent-DSH's file workbench spans new plugins and edits to shared presentation, persistence and workspace packages. Its source bundle therefore depends on the fork's workspace. Installing its feature package into stock DSH does not reproduce permanent child-session deletion, background conversation observation or the complete interface. Users need one distributable package that preserves those behaviors without editing the host source.

## Decision

The independent [file-workbench package](../../../../plugins/file-workbench/README.md) targets the published, unmodified DSH `0.1.1-rc.2` Web profile with JSONL storage. It carries the R-Agent feature implementation from `c5b7365c705f13f993b0ca0a03c566b69761f5b7`, with private presentation modules and extended JSONL and Workspace providers. The enclosing checkout retains the common upstream source at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. Its Agent, LLM, tools, API and main client runtime are supplied by the installed DSH.

The profile patch disables the standard provider rows and four exclusive UI rows, then inserts three bundle entries. The persistence entry reads and evaluates the disabled original entry's configuration in its original Loader context, preserving custom roots, compression and cache options. Providers reuse original service and error identities and persist original-format data. Windows locking reuses the native dependency already supplied by the stock JSONL package.

The browser artifact registers one DSH module factory. It includes the file UI, layout, sidebar, workspace tree, trajectory, Markdown enhancements, CSS and font data. Shared runtime, React, Cordis and slot identities remain external. A single version-specific adapter calls the original binding's concrete `Session.open()` to observe background sessions without changing the primary selection; no runtime method is patched.

File parents remain stable per workspace and path. Each selection creates an independent child with a full-file snapshot, selection metadata and an action-specific instruction. Window closure stops and deletes that child through the selected persistence coordinator, including pending writes and cached state. This preserves R-Agent semantics rather than adopting the local v2 workbench's different context and note features.

## Alternatives considered

**Publish packages that depend on the fork's changed shared packages.** This retains the source-workspace dependency and cannot deliver the requested installation onto stock DSH.

**Copy the local v2 feature implementation.** Its packaging pattern is suitable, but its context, notes and child-session behavior differ from R-Agent. The bundle adopts the installation pattern and retains R-Agent's feature implementation.

**Delete session files directly or mutate original service instances.** Direct deletion bypasses write retirement and caches, while runtime patching couples behavior to installation order. Bundle-owned providers keep those lifecycle operations together and allow uninstall to restore the original providers.

## Consequences

Users install and remove one tarball with the standard DSH plugin command. Source edits and a host rebuild are unnecessary. Uninstall restores the standard composition and retains data; child deletion requested by closing a selection window remains permanent. Private copies of provider and presentation code introduce maintenance work when the host evolves.

Compatibility is restricted to the verified DSH version and standard JSONL composition. SQLite, custom providers and other versions require separate adapters and verification. Legacy logs needing R-Agent's repeated-empty-turn projection repair are not migrated by this package. New selection sessions use the original runtime without that repair. Real model quality and other operating systems are separate from the Windows installation and local-model acceptance evidence.

## Verification

Unit and client tests exercise file operations, selection semantics, background-session observation, window behavior, write coordination and deletion. The built-artifact test loads the complete browser factory using published DSH dependencies. The [installation acceptance script](../../../../plugins/file-workbench/scripts/verify-install.mjs) installs the tarball into a fresh profile, runs an assembled local-model transcript, restarts the host, uninstalls the package and checks that stock DSH can read surviving sessions. It leaves evidence in the isolated test home and stops its servers.
