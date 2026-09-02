/** Local image discovery for a Markdown document. */
import { resolveDocumentAssetPath } from './path.ts'

const INLINE_IMAGE = /!\[[^\]]*\]\((?:<([^>\n]+)>|([^)\s]+))(?:\s+["'][^"']*["'])?\)/g
const IMAGE_REFERENCE = /!\[[^\]]*\]\[([^\]]*)\]/g
const DEFINITION = /^\s{0,3}\[([^\]]+)\]:\s*(?:<([^>\n]+)>|(\S+))/gm

/** One authored image URL and its resolved absolute local path. */
export interface LocalMarkdownImage {
  authoredUrl: string
  path: string
}

/**
 * Discover unique local image references in inline and reference syntax.
 * @param documentPath - absolute path of the Markdown document.
 * @param source - Markdown source to scan.
 * @returns authored URLs paired with their resolved absolute local paths.
 */
export function localMarkdownImages(documentPath: string, source: string): LocalMarkdownImage[] {
  const definitions = new Map<string, string>()
  for (const match of source.matchAll(DEFINITION)) {
    const id = match[1]?.trim().toUpperCase()
    const url = match[2] ?? match[3]
    if (id !== undefined && id !== '' && url !== undefined) definitions.set(id, url)
  }
  const authored = new Set<string>()
  for (const match of source.matchAll(INLINE_IMAGE)) {
    const url = match[1] ?? match[2]
    if (url !== undefined) authored.add(url)
  }
  for (const match of source.matchAll(IMAGE_REFERENCE)) {
    const id = match[1]?.trim().toUpperCase()
    const url = id === undefined ? undefined : definitions.get(id)
    if (url !== undefined) authored.add(url)
  }
  return [...authored].flatMap((authoredUrl) => {
    const path = resolveDocumentAssetPath(documentPath, authoredUrl)
    return path === undefined ? [] : [{ authoredUrl, path }]
  })
}
