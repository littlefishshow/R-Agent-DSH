// @vitest-environment jsdom
/** Built File Workbench composition smoke over the keyless Web fixture. */
import { resolve } from 'node:path'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { expect, it } from 'vitest'
import { installAssembledBootEnv, mountAssembledApp } from './assembled-boot.ts'

installAssembledBootEnv()

it('loads the File Workbench bundle and swaps the shared Workspace projection', async () => {
  mountAssembledApp('?fixture', [resolve('packages/bundle/file-workbench')])

  const files = await screen.findByRole('tab', { name: 'Files' }, { timeout: 10_000 })
  const chat = screen.getByRole('tab', { name: 'Chat' })
  expect([chat.getAttribute('aria-selected'), files.getAttribute('aria-selected')]).toMatchInlineSnapshot(`
    [
      "true",
      "false",
    ]
  `)

  fireEvent.click(files)
  await waitFor(() => {
    expect(screen.getAllByText('Workspaces')).toHaveLength(2)
    expect(screen.getByText('Choose a file from the file tree.')).toBeTruthy()
  })
  expect([chat.getAttribute('aria-selected'), files.getAttribute('aria-selected')]).toMatchInlineSnapshot(`
    [
      "false",
      "true",
    ]
  `)

  fireEvent.click(chat)
  expect(await screen.findByRole('tree', { name: 'Sessions' })).toBeTruthy()

  const styleOwners = [...document.head.querySelectorAll('style[data-plugin]')]
    .map(style => style.getAttribute('data-plugin'))
  expect(styleOwners).toEqual(expect.arrayContaining([
    '@deepseek-ai/dsh-client-ui-layout-workbench',
    '@deepseek-ai/dsh-client-ui-file-workspace',
  ]))
  expect(styleOwners).not.toContain('@deepseek-ai/dsh-client-ui-layout')
})
