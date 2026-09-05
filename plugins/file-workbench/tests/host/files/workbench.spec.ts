/** FileWorkbench backend tests over a real temp filesystem (absolute paths). */
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileWorkbench, toResult } from '../../../src/host/files/index.ts'

let dir: string
let workbench: FileWorkbench

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-workbench-'))
  workbench = new FileWorkbench()
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('FileWorkbench.listDir', () => {
  it('lists every directory and regular file with directories first', async () => {
    await writeFile(join(dir, 'notes.md'), '# n')
    await writeFile(join(dir, 'guide.MARKDOWN'), '# g')
    await writeFile(join(dir, 'data.json'), '{}')
    await writeFile(join(dir, 'notes.txt'), 'n')
    await mkdir(join(dir, 'docs', 'nested'), { recursive: true })
    await writeFile(join(dir, 'docs', 'nested', 'deep.md'), '# deep')
    await mkdir(join(dir, 'assets'))
    await writeFile(join(dir, 'assets', 'diagram.png'), 'image')
    await mkdir(join(dir, 'empty'))

    const { entries } = await workbench.listDir(dir)
    expect(entries.map(e => e.name)).toEqual([
      'assets', 'docs', 'empty', 'data.json', 'guide.MARKDOWN', 'notes.md', 'notes.txt',
    ])
    expect(entries.find(e => e.name === 'docs')).toMatchObject({ kind: 'directory', editable: false })
    expect(entries.find(e => e.name === 'notes.md')).toMatchObject({ kind: 'file', editable: true })
    expect(entries.find(e => e.name === 'guide.MARKDOWN')).toMatchObject({ kind: 'file', editable: true })
    expect(entries.find(e => e.name === 'data.json')).toMatchObject({ kind: 'file', editable: true })
    expect(entries.find(e => e.name === 'diagram.png')).toBeUndefined()
    expect(entries[0]!.path).toBe(join(dir, 'assets'))

    const nested = await workbench.listDir(join(dir, 'docs'))
    expect(nested.entries.map(e => e.name)).toEqual(['nested'])
  })

  it('rejects a relative path', async () => {
    await expect(workbench.listDir('relative/dir')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reports an unreadable directory', async () => {
    await expect(workbench.listDir(join(dir, 'missing'))).rejects.toMatchObject({
      result: { error: { code: 'directory-unreadable' } },
    })
  })
})

describe('FileWorkbench.readText / writeText', () => {
  it('reads common source documents with a version and rejects binary formats', async () => {
    await writeFile(join(dir, 'a.md'), '# hi')
    const read = await workbench.readText(join(dir, 'a.md'))
    expect(read.content).toBe('# hi')
    expect(read.version.length).toBeGreaterThan(0)
    expect(read.fileIndex).toBe(join(dir, 'a.md'))
    expect(Number.isNaN(Date.parse(read.updatedAt))).toBe(false)
    await writeFile(join(dir, 'script.py'), 'print("hi")')
    await expect(workbench.readText(join(dir, 'script.py'))).resolves.toMatchObject({
      content: 'print("hi")',
    })
    await writeFile(join(dir, 'document.pdf'), '%PDF')
    await expect(workbench.readText(join(dir, 'document.pdf'))).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reuses the exact opened snapshot for a selection after a metadata-only freshness check', async () => {
    const path = join(dir, 'cached.md')
    await writeFile(path, '# cached')
    const opened = await workbench.readText(path)

    await expect(workbench.selectionSnapshot(path, opened.version)).resolves.toBe(opened)
    await expect(workbench.selectionSnapshot(path, 'stale-version')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('creates then updates, guarding a stale version', async () => {
    const create = await workbench.writeText(join(dir, 'new.md'), '# v1', undefined)
    expect(create.operation).toBe('create')
    await expect(workbench.selectionSnapshot(join(dir, 'new.md'), create.version))
      .resolves.toMatchObject({ content: '# v1', version: create.version })
    const read = await workbench.readText(join(dir, 'new.md'))
    const update = await workbench.writeText(join(dir, 'new.md'), '# v2', read.version)
    expect(update.operation).toBe('update')
    expect(await readFile(join(dir, 'new.md'), 'utf8')).toBe('# v2')
    await expect(workbench.writeText(join(dir, 'new.md'), '# v3', read.version)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reports a missing file on read', async () => {
    await expect(workbench.readText(join(dir, 'gone.md'))).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('rejects an editable-named directory as a text file', async () => {
    await mkdir(join(dir, 'folder.md'))
    await expect(workbench.readText(join(dir, 'folder.md'))).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
    await expect(workbench.writeText(join(dir, 'folder.md'), 'x', undefined)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reads common extension-less text files', async () => {
    await writeFile(join(dir, 'README'), 'x')
    const { entries } = await workbench.listDir(dir)
    expect(entries.find(e => e.name === 'README')).toMatchObject({ editable: true })
    await expect(workbench.readText(join(dir, 'README'))).resolves.toMatchObject({ content: 'x' })
  })

  it('refuses writing a binary extension', async () => {
    await expect(workbench.writeText(join(dir, 'document.pdf'), '%PDF', undefined)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('rejects a guarded write when the previously read file disappeared', async () => {
    const path = join(dir, 'gone.md')
    await writeFile(path, '# v1')
    const read = await workbench.readText(path)
    await rm(path)
    await expect(workbench.writeText(path, '# v2', read.version)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reports writing into a missing parent directory', async () => {
    await expect(workbench.writeText(join(dir, 'missing', 'x.md'), 'x', undefined)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })
})

describe('FileWorkbench.readImage', () => {
  it('returns a supported image as a data URL', async () => {
    await writeFile(join(dir, 'diagram.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    await expect(workbench.readImage(join(dir, 'diagram.png'))).resolves.toEqual({
      path: join(dir, 'diagram.png'),
      mediaType: 'image/png',
      dataUrl: 'data:image/png;base64,iVBORw==',
    })
  })

  it('rejects unsupported image extensions', async () => {
    await writeFile(join(dir, 'diagram.svg'), '<svg/>')
    await expect(workbench.readImage(join(dir, 'diagram.svg'))).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })
})

describe('FileWorkbench.createEntry / deleteEntry', () => {
  it('creates a file and a directory, then rejects a duplicate', async () => {
    const file = await workbench.createEntry(dir, 'note.md', 'file')
    expect(file.entry).toMatchObject({ name: 'note.md', kind: 'file', editable: true })
    const folder = await workbench.createEntry(dir, 'docs', 'directory')
    expect(folder.entry.kind).toBe('directory')
    await expect(workbench.createEntry(dir, 'note.md', 'file')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('rejects a non-segment name', async () => {
    await expect(workbench.createEntry(dir, 'a/b', 'file')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
    await expect(workbench.createEntry(dir, '..', 'directory')).rejects.toBeDefined()
  })

  it('deletes a file and a directory recursively', async () => {
    await mkdir(join(dir, 'tree', 'inner'), { recursive: true })
    const path = join(dir, 'tree', 'inner', 'x.md')
    await writeFile(path, 'x')
    const snapshot = await workbench.readText(path)
    await workbench.deleteEntry(join(dir, 'tree'))
    await expect(stat(join(dir, 'tree'))).rejects.toBeDefined()
    await expect(workbench.selectionSnapshot(path, snapshot.version)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reports deleting a missing path', async () => {
    await expect(workbench.deleteEntry(join(dir, 'nope'))).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reports a create under a missing parent', async () => {
    await expect(workbench.createEntry(join(dir, 'missing-parent'), 'x.md', 'file')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })
})

describe('FileWorkbench.copyEntry / renameEntry', () => {
  it('copies a file into a destination parent with a new name', async () => {
    await writeFile(join(dir, 'src.md'), 'body')
    await mkdir(join(dir, 'dest'))
    const copy = await workbench.copyEntry(join(dir, 'src.md'), join(dir, 'dest'), 'copy.md')
    expect(copy.entry).toMatchObject({ name: 'copy.md', kind: 'file' })
    expect(await readFile(join(dir, 'dest', 'copy.md'), 'utf8')).toBe('body')
  })

  it('copies a directory recursively, defaulting the name to the source basename', async () => {
    await mkdir(join(dir, 'a', 'b'), { recursive: true })
    await writeFile(join(dir, 'a', 'b', 'f.md'), 'f')
    await mkdir(join(dir, 'out'))
    const copy = await workbench.copyEntry(join(dir, 'a'), join(dir, 'out'), undefined)
    expect(copy.entry).toMatchObject({ name: 'a', kind: 'directory' })
    expect(await readFile(join(dir, 'out', 'a', 'b', 'f.md'), 'utf8')).toBe('f')
  })

  it('rejects a copy onto an existing target', async () => {
    await writeFile(join(dir, 's.md'), 's')
    await writeFile(join(dir, 'd.md'), 'd')
    await expect(workbench.copyEntry(join(dir, 's.md'), dir, 'd.md')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('reports a copy into a missing destination parent', async () => {
    await writeFile(join(dir, 's.md'), 's')
    await expect(workbench.copyEntry(join(dir, 's.md'), join(dir, 'no-dest'), 'x.md')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('rejects copying a directory into itself', async () => {
    await mkdir(join(dir, 'src', 'inner'), { recursive: true })
    await expect(workbench.copyEntry(join(dir, 'src'), join(dir, 'src', 'inner'), undefined)).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
  })

  it('renames a file in place', async () => {
    await writeFile(join(dir, 'old.md'), 'x')
    const snapshot = await workbench.readText(join(dir, 'old.md'))
    const renamed = await workbench.renameEntry(join(dir, 'old.md'), 'new.md')
    expect(renamed.entry.name).toBe('new.md')
    expect(await readFile(join(dir, 'new.md'), 'utf8')).toBe('x')
    await expect(workbench.selectionSnapshot(join(dir, 'new.md'), snapshot.version))
      .resolves.toMatchObject({ path: join(dir, 'new.md'), fileIndex: join(dir, 'new.md'), content: 'x' })
    await expect(stat(join(dir, 'old.md'))).rejects.toBeDefined()
  })

  it('renames a directory and reports it as a directory entry', async () => {
    await mkdir(join(dir, 'olddir'))
    const renamed = await workbench.renameEntry(join(dir, 'olddir'), 'newdir')
    expect(renamed.entry).toMatchObject({ name: 'newdir', kind: 'directory' })
  })

  it('rejects renaming onto an existing name and rejects a missing source', async () => {
    await writeFile(join(dir, 'one.md'), '1')
    await writeFile(join(dir, 'two.md'), '2')
    await expect(workbench.renameEntry(join(dir, 'one.md'), 'two.md')).rejects.toMatchObject({
      result: { error: { code: 'workspace-invalid-path' } },
    })
    await expect(workbench.renameEntry(join(dir, 'gone.md'), 'x.md')).rejects.toBeDefined()
  })
})

describe('toResult', () => {
  it('maps an Error to an internal fault with its message', () => {
    expect(toResult(new Error('boom'))).toMatchObject({ ok: false, error: { code: 'internal', message: 'boom' } })
  })

  it('stringifies a non-Error throw', () => {
    expect(toResult('bare')).toMatchObject({ ok: false, error: { code: 'internal', message: 'bare' } })
  })
})
