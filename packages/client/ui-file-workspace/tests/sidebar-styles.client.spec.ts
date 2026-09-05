/** Files-sidebar geometry kept aligned with the conversation Workspace browser. */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const sidebarCss = readFileSync(
  fileURLToPath(new URL('../src/client/FileSidebar.module.css', import.meta.url)),
  'utf8',
)
const treeCss = readFileSync(
  fileURLToPath(new URL('../src/client/FileWorkspacePanel.module.css', import.meta.url)),
  'utf8',
)

/**
 * Read one CSS rule into normalized property values.
 * @param source - CSS module source.
 * @param selector - exact selector within a comma-separated selector list.
 * @returns declarations for the selector, or undefined when absent.
 */
function declarationsFrom(source: string, selector: string): Map<string, string> | undefined {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, ' ')
  const found = new Map<string, string>()
  for (const [, selectorList = '', body = ''] of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!selectorList.split(',').map(value => value.trim()).includes(selector)) continue
    for (const part of body.split(';')) {
      const colon = part.indexOf(':')
      if (colon === -1) continue
      found.set(part.slice(0, colon).trim(), part.slice(colon + 1).trim().replace(/\s+/g, ' '))
    }
  }
  return found.size === 0 ? undefined : found
}

const sidebarDeclarations = (selector: string): Map<string, string> | undefined =>
  declarationsFrom(sidebarCss, selector)
const treeDeclarations = (selector: string): Map<string, string> | undefined =>
  declarationsFrom(treeCss, selector)

describe('Files sidebar styles', () => {
  it('matches the conversation section header and add-action geometry', () => {
    expect(sidebarDeclarations('.header')?.get('height')).toBe('36px')
    expect(sidebarDeclarations('.header')?.get('margin-bottom')).toBe('4px')
    expect(sidebarDeclarations('.header')?.get('color')).toBe('var(--dsw-alias-label-tertiary)')
    expect(sidebarDeclarations('.addButton')?.get('width')).toBe('28px')
    expect(sidebarDeclarations('.addButton')?.get('height')).toBe('28px')
    expect(sidebarDeclarations('.addButton')?.get('border-radius')).toBe('50%')
  })

  it('counts the stable scrollbar inside the sidebar trailing inset', () => {
    const root = sidebarDeclarations('.root')
    const folders = sidebarDeclarations('.folders')
    expect(root?.get('--dsh-file-list-edge-inset')).toBe('var(--dsh-sidebar-inline-padding)')
    expect(root?.get('--dsh-file-list-scrollbar-width')).toBe('8px')
    expect(root?.get('--dsh-file-list-scrollbar-offset')).toBe('2px')
    expect(root?.get('padding-left')).toBe('4px')
    expect(root?.get('padding-right')).toBe('var(--dsh-file-list-edge-inset)')
    expect(folders?.get('overflow-y')).toBe('auto')
    expect(folders?.get('margin-left')).toBe('-4px')
    expect(folders?.get('padding-left')).toBe('4px')
    expect(folders?.get('padding-right')).toBe([
      'calc(',
      'var(--dsh-file-list-edge-inset)',
      '- var(--dsh-file-list-scrollbar-width)',
      '- var(--dsh-file-list-scrollbar-offset)',
      ')',
    ].join(' '))
    expect(folders?.get('scrollbar-gutter')).toBe('stable')
  })

  it('matches Workspace and Session row rhythm', () => {
    expect(treeDeclarations('.treeDirectoryRow')?.get('height')).toBe('34px')
    expect(treeDeclarations('.treeFileRow')?.get('height')).toBe('32px')
    expect(treeDeclarations('.treeRow')?.get('border-radius')).toBe('8px')
    expect(treeDeclarations('.treeRow')?.get('font-size')).toBe('14px')
    expect(treeDeclarations('.treeRow + .treeRow')?.get('margin-top')).toBe('2px')
    expect(treeDeclarations(".treeRow[data-active='true']")?.get('background'))
      .toBe('var(--dsw-alias-interactive-bg-hover)')
  })
})
