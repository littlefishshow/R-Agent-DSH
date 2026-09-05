/**
 * The lazy, multi-folder file tree. Each added Workspace is a root;
 * expanding a directory lazily lists its direct children through the store's
 * `entriesByPath` cache. Files open on click; a per-row action menu offers the
 * file operations (new file/folder, rename, delete, copy, paste).
 */
import { useState } from 'react'
import clsx from 'clsx'
import {
  IconCopyOutline16, IconEditOutline16, IconEllipsisOutline16, IconFileTextOutline16,
  IconFolderClose16, IconFolderOpen16, IconPlusOutline16, IconTrashOutline16,
  IconTriangleRightFill14, Menu, type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileWorkbenchEntry } from './protocol.ts'
import { isSameOrDescendant } from './path.ts'
import css from './FileWorkspacePanel.module.css'

/** The tree's callbacks and cache, supplied by the panel. */
export interface FileTreeApi {
  /** Direct children of an absolute directory, or undefined until loaded. */
  entriesOf: (path: string) => FileWorkbenchEntry[] | undefined
  /** Whether an absolute directory is expanded. */
  isExpanded: (path: string) => boolean
  /** Toggle a directory's expansion (loads children on first expand). */
  toggleDir: (path: string) => void
  /** Open a file in the appropriate preview. */
  openFile: (entry: FileWorkbenchEntry) => void
  /** The absolute path of the open document, for active highlighting. */
  activePath: string | undefined
  /** Run a file operation menu action on an entry (or a folder root). */
  onAction: (action: FileTreeAction, entry: FileWorkbenchEntry) => void
  /** Remove a root from the file-workspace set without deleting it on disk. */
  removeRoot: (path: string) => void
  /** Whether a paste target is available (something was copied). */
  canPaste: boolean
}

/** The file operations a tree row's menu offers. */
export type FileTreeAction = 'newFile' | 'newFolder' | 'rename' | 'delete' | 'copy' | 'paste'

/** Localized labels for the row menu. */
export interface FileTreeLabels {
  newFile: string
  newFolder: string
  rename: string
  delete: string
  copy: string
  paste: string
  remove: string
}

/** One tree node (directory or file) at an indent depth. */
function TreeNode(props: {
  entry: FileWorkbenchEntry
  depth: number
  root: boolean
  api: FileTreeApi
  labels: FileTreeLabels
}) {
  const { entry, depth, root, api, labels } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const indent = { paddingLeft: `${8 + depth * 18}px` }
  const expanded = entry.kind === 'directory' && api.isExpanded(entry.path)
  const containsActive = api.activePath !== undefined && isSameOrDescendant(api.activePath, entry.path)
  const selected = entry.kind === 'file' && entry.path === api.activePath
  const children = expanded ? api.entriesOf(entry.path) : undefined
  const menuItems: MenuEntry[] = [
    ...entry.kind === 'directory'
      ? [
        { id: 'newFile', label: labels.newFile, icon: <IconPlusOutline16 /> },
        { id: 'newFolder', label: labels.newFolder, icon: <IconFolderClose16 /> },
        ...api.canPaste ? [{ id: 'paste', label: labels.paste }] : [],
      ]
      : [],
    ...root
      ? [{ id: 'remove', label: labels.remove, icon: <IconTrashOutline16 />, danger: true }]
      : [
        { id: 'copy', label: labels.copy, icon: <IconCopyOutline16 /> },
        { id: 'rename', label: labels.rename, icon: <IconEditOutline16 /> },
        { id: 'delete', label: labels.delete, icon: <IconTrashOutline16 />, danger: true },
      ],
  ]

  const runAction = (action: FileTreeAction): void => {
    setMenuOpen(false)
    api.onAction(action, entry)
  }

  return (
    <>
      <div
        className={clsx(css.treeRow, entry.kind === 'directory' ? css.treeDirectoryRow : css.treeFileRow)}
        style={indent}
        data-active={selected || undefined}
        data-menu-open={menuOpen || undefined}
      >
        <button
          type="button"
          className={clsx(css.treeLabel, entry.kind === 'directory' && css.treeDir)}
          onClick={() => {
            if (entry.kind === 'directory') api.toggleDir(entry.path)
            else api.openFile(entry)
          }}
        >
          {entry.kind === 'directory'
            ? (
              <>
                <span
                  className={clsx(css.treeIcon, css.folderIcon, expanded && containsActive && css.folderIconActive)}
                  aria-hidden="true"
                >
                  {expanded ? <IconFolderOpen16 /> : <IconFolderClose16 />}
                </span>
                <span className={css.treeChevron} aria-hidden="true">
                  <IconTriangleRightFill14 className={clsx(css.treeArrow, expanded && css.treeArrowOpen)} />
                </span>
              </>
            )
            : (
              <span className={css.treeIcon} aria-hidden="true">
                <IconFileTextOutline16 size={16} />
              </span>
            )}
          <span className={css.treeTitle}>{entry.name}</span>
        </button>
        <Menu
          open={menuOpen}
          onClose={() => { setMenuOpen(false) }}
          items={menuItems}
          onSelect={(id) => {
            setMenuOpen(false)
            if (id === 'remove') {
              api.removeRoot(entry.path)
              return
            }
            if (id === 'newFile' || id === 'newFolder' || id === 'copy' || id === 'paste' || id === 'rename' || id === 'delete') {
              runAction(id)
            }
          }}
          align="end"
          portal
          compact
          anchor={(
            <button type="button" className={css.treeMenuButton} aria-label="⋯" onClick={() => { setMenuOpen(o => !o) }}>
              <IconEllipsisOutline16 />
            </button>
          )}
        />
      </div>
      {children?.map(child => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} root={false} api={api} labels={labels} />
      ))}
    </>
  )
}

/** The multi-folder file tree: one root per added folder. */
export function FileTree(props: { roots: FileWorkbenchEntry[]; api: FileTreeApi; labels: FileTreeLabels }) {
  return (
    <div className={css.tree}>
      {props.roots.map(root => (
        <TreeNode key={root.path} entry={root} depth={0} root api={props.api} labels={props.labels} />
      ))}
    </div>
  )
}
