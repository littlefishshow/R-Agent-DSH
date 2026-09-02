/** Absolute-path helper tests (POSIX and Windows forms). */
import { describe, expect, it } from 'vitest'
import {
  basename, isSameOrDescendant, parentDir, resolveDocumentAssetPath, rewritePathPrefix,
} from '../src/client/path.ts'

describe('basename', () => {
  it('returns the final segment of a POSIX path', () => {
    expect(basename('/a/b/c.md')).toBe('c.md')
    expect(basename('/a/b/')).toBe('b')
    expect(basename('/root')).toBe('root')
  })

  it('returns the final segment of a Windows path', () => {
    expect(basename('C:\\a\\b\\c.md')).toBe('c.md')
    expect(basename('C:\\a\\b\\')).toBe('b')
  })

  it('returns a bare name with no separator unchanged', () => {
    expect(basename('name')).toBe('name')
  })
})

describe('parentDir', () => {
  it('returns the parent of a POSIX path', () => {
    expect(parentDir('/a/b/c.md')).toBe('/a/b')
    expect(parentDir('/a/b/')).toBe('/a')
  })

  it('keeps the root at the top', () => {
    expect(parentDir('/top')).toBe('/')
  })

  it('returns a bare name unchanged when it has no separator', () => {
    expect(parentDir('name')).toBe('name')
  })

  it('returns the parent of a Windows path', () => {
    expect(parentDir('C:\\a\\b\\c.md')).toBe('C:\\a\\b')
  })
})

describe('path tree helpers', () => {
  it('recognizes a path and its POSIX or Windows descendants', () => {
    expect(isSameOrDescendant('/a/b', '/a/b')).toBe(true)
    expect(isSameOrDescendant('/a/b/c.md', '/a/b')).toBe(true)
    expect(isSameOrDescendant('C:\\a\\b\\c.md', 'C:\\a\\b')).toBe(true)
    expect(isSameOrDescendant('/a/bee', '/a/b')).toBe(false)
  })

  it('rewrites only the matching path prefix', () => {
    expect(rewritePathPrefix('/a/b/c.md', '/a/b', '/x/y')).toBe('/x/y/c.md')
    expect(rewritePathPrefix('/a/other.md', '/a/b', '/x/y')).toBe('/a/other.md')
  })
})

describe('resolveDocumentAssetPath', () => {
  it('normalizes relative POSIX and Windows image paths', () => {
    expect(resolveDocumentAssetPath('/a/content/guide.md', '../img/a.png')).toBe('/a/img/a.png')
    expect(resolveDocumentAssetPath('C:\\a\\content\\guide.md', '..\\img\\a.png')).toBe('C:\\a\\img\\a.png')
  })

  it('ignores non-local image destinations and malformed escapes', () => {
    expect(resolveDocumentAssetPath('/a/readme.md', 'https://example.com/a.png')).toBeUndefined()
    expect(resolveDocumentAssetPath('/a/readme.md', 'data:image/png;base64,AQ==')).toBeUndefined()
    expect(resolveDocumentAssetPath('/a/readme.md', '#figure')).toBeUndefined()
    expect(resolveDocumentAssetPath('/a/readme.md', '/private/image.png')).toBeUndefined()
    expect(resolveDocumentAssetPath('C:\\a\\readme.md', 'D:\\private\\image.png')).toBeUndefined()
    expect(resolveDocumentAssetPath('/a/readme.md', '%E0%A4%A')).toBeUndefined()
  })
})
