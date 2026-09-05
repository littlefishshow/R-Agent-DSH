/** Markdown-local image discovery tests. */
import { describe, expect, it } from 'vitest'
import { localMarkdownImages } from '../../../src/client/files/markdown-images.ts'

describe('localMarkdownImages', () => {
  it('resolves inline and reference images against the document directory', () => {
    const images = localMarkdownImages('/workspace/content/guide.md', [
      '![diagram](../assets/diagram.png)',
      '![logo][logo]',
      '[logo]: ./logo.webp',
    ].join('\n'))
    expect(images).toEqual([
      { authoredUrl: '../assets/diagram.png', path: '/workspace/assets/diagram.png' },
      { authoredUrl: './logo.webp', path: '/workspace/content/logo.webp' },
    ])
  })

  it('ignores remote, data, and fragment destinations', () => {
    expect(localMarkdownImages('/workspace/readme.md', [
      '![remote](https://example.com/a.png)',
      '![data](data:image/png;base64,AQ==)',
      '![fragment](#preview)',
    ].join('\n'))).toEqual([])
  })
})
