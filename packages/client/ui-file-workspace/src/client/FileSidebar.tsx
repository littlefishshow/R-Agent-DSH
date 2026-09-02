/** Files-mode projection of the shared Workspace list as filesystem trees. */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, IconProjectAddOutline16, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { FileSidebarProps } from './contract/slots.ts'
import type { FileWorkbenchEntry } from './protocol.ts'
import { FileTree, type FileTreeAction, type FileTreeApi } from './FileTree.tsx'
import { isSameOrDescendant, parentDir } from './path.ts'
import css from './FileSidebar.module.css'

/** Render shared Workspaces as filesystem roots while Files mode is active. */
export function FileSidebar({
  wide,
  useStore,
  useSessions,
  useWorkspaces,
  useMode,
  actions,
  listDir,
  readText,
  createEntry,
  deleteEntry,
  copyEntry,
  renameEntry,
  pickDirectory,
  createWorkspace,
  removeWorkspace,
  t,
}: FileSidebarProps) {
  const workspaces = useWorkspaces(state => state.items)
  const workspacePhase = useWorkspaces(state => state.phase)
  const documents = useStore(state => state.documents)
  const activeDocumentPath = useStore(state => state.activeDocumentPath)
  const expanded = useStore(state => state.expanded)
  const entriesByPath = useStore(state => state.entriesByPath)
  const mode = useMode(value => value)
  useSessions(state => state.current)
  const [adding, setAdding] = useState(false)
  const [clipboard, setClipboard] = useState<string | null>(null)
  const [error, setError] = useState<string | undefined>(undefined)
  const loadingDirs = useRef(new Set<string>())

  const fail = useCallback((reason: unknown) => {
    setError(reason instanceof Error ? reason.message : String(reason))
  }, [])

  const loadDir = useCallback((path: string) => {
    if (loadingDirs.current.has(path)) return
    loadingDirs.current.add(path)
    listDir(path)
      .then((entries) => { actions.setEntries(path, entries) })
      .catch(fail)
      .finally(() => { loadingDirs.current.delete(path) })
  }, [actions, fail, listDir])

  const toggleDir = useCallback((path: string) => {
    const next = expanded[path] !== true
    actions.setExpanded(path, next)
    if (next && entriesByPath[path] === undefined) loadDir(path)
  }, [actions, entriesByPath, expanded, loadDir])

  useEffect(() => {
    if (mode !== 'files') return
    for (const { path } of workspaces) {
      actions.setExpanded(path, true)
      if (entriesByPath[path] === undefined) loadDir(path)
    }
  }, [actions, entriesByPath, loadDir, mode, workspaces])

  const openFile = useCallback((path: string) => {
    if (documents[path] !== undefined) {
      actions.activateDocument(path)
      return
    }
    const workspace = [...workspaces]
      .filter(item => isSameOrDescendant(path, item.path))
      .sort((left, right) => right.path.length - left.path.length)[0]
    if (workspace === undefined) {
      fail(new Error(`No Workspace owns ${path}`))
      return
    }
    readText(path).then((next) => {
      actions.openDocument({
        path: next.path,
        content: next.content,
        version: next.version,
        workspaceId: workspace.workspaceId,
        draft: next.content,
        dirty: false,
        viewMode: 'preview',
      })
      setError(undefined)
    }).catch(fail)
  }, [actions, documents, fail, readText, workspaces])

  const onAction = useCallback((action: FileTreeAction, entry: FileWorkbenchEntry) => {
    const refresh = (path: string): void => {
      actions.invalidateDir(path)
      if (expanded[path]) loadDir(path)
    }
    if (action === 'copy') { setClipboard(entry.path); return }
    if (action === 'paste') {
      if (clipboard === null) return
      copyEntry(clipboard, entry.path)
        .then(() => { actions.setExpanded(entry.path, true); refresh(entry.path) })
        .catch(fail)
      return
    }
    if (action === 'delete') {
      if (!window.confirm(t('tree.deleteConfirm', { name: entry.name }))) return
      deleteEntry(entry.path).then(() => {
        actions.closeDocumentsUnder(entry.path)
        refresh(parentDir(entry.path))
      }).catch(fail)
      return
    }
    if (action === 'rename') {
      const next = window.prompt(t('tree.namePrompt'), entry.name)
      if (next === null || next.trim() === '' || next === entry.name) return
      renameEntry(entry.path, next).then((result) => {
        actions.rewriteDocumentPaths(entry.path, result.entry.path)
        refresh(parentDir(entry.path))
      }).catch(fail)
      return
    }
    const kind = action === 'newFile' ? 'file' : 'directory'
    const name = window.prompt(t('tree.namePrompt'), kind === 'file' ? 'untitled.md' : 'new-folder')
    if (name === null || name.trim() === '') return
    createEntry(entry.path, name, kind)
      .then(() => { actions.setExpanded(entry.path, true); refresh(entry.path) })
      .catch(fail)
  }, [actions, clipboard, copyEntry, createEntry, deleteEntry, expanded, fail, loadDir, renameEntry, t])

  const workspaceIdByPath = useMemo(
    () => new Map(workspaces.map(workspace => [workspace.path, workspace.workspaceId])),
    [workspaces],
  )
  const roots: FileWorkbenchEntry[] = workspaces.map(workspace => ({
    name: workspace.title,
    path: workspace.path,
    kind: 'directory',
    editable: false,
  }))
  const api: FileTreeApi = {
    entriesOf: path => entriesByPath[path],
    isExpanded: path => expanded[path] === true,
    toggleDir,
    openFile,
    activePath: activeDocumentPath ?? undefined,
    onAction,
    removeRoot: (path) => {
      const workspaceId = workspaceIdByPath.get(path)
      if (workspaceId === undefined) return
      removeWorkspace(workspaceId).then(() => {
        actions.closeDocumentsUnder(path)
      }).catch(fail)
    },
    canPaste: clipboard !== null,
  }
  const labels = {
    newFile: t('tree.newFile'),
    newFolder: t('tree.newFolder'),
    rename: t('tree.rename'),
    delete: t('tree.delete'),
    copy: t('tree.copy'),
    paste: t('tree.paste'),
    remove: t('panel.removeFolder'),
  }

  if (mode !== 'files') return null
  return (
    <div className={css.root} data-wide={wide || undefined}>
      <div className={css.header}>
        <span>{t('panel.title')}</span>
        <Tooltip label={t('panel.addFolder')} side="bottom" delayMs={500}>
          <Button
            variant="ghost"
            disabled={adding}
            aria-label={t('panel.addFolder')}
            onClick={() => {
              setAdding(true)
              setError(undefined)
              void pickDirectory()
                .then(path => path === null ? undefined : createWorkspace(path))
                .then((workspace) => {
                  if (workspace === undefined) return
                  actions.setExpanded(workspace.path, true)
                  loadDir(workspace.path)
                })
                .catch(fail)
                .finally(() => { setAdding(false) })
            }}
          >
            <IconProjectAddOutline16 size={wide ? 16 : 18} />
            {wide && t('panel.addFolder')}
          </Button>
        </Tooltip>
      </div>
      {error !== undefined && <div className={css.error}>{t('panel.error')}{error}</div>}
      <div className={css.folders}>
        {workspacePhase !== 'ready'
          ? <div className={css.empty}>{t('panel.loading')}</div>
          : roots.length === 0
            ? <div className={css.empty}>{t('panel.empty')}</div>
            : <FileTree roots={roots} api={api} labels={labels} />}
      </div>
    </div>
  )
}
