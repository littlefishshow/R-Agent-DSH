/**
 * Minimal absolute-path helpers for the file workspace. Paths on the wire are
 * absolute host paths (POSIX or Windows); these derive a basename and parent
 * directory without importing Node's path (this is browser code). Pure and
 * unit-testable.
 */

/**
 * Return the final segment of an absolute path, ignoring trailing separators.
 * @param path - POSIX or Windows absolute path.
 * @returns the final path segment.
 */
export function basename(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return slash < 0 ? trimmed : trimmed.slice(slash + 1)
}

/**
 * The parent directory of an absolute path. A filesystem root (no separator
 * before the last segment, or the path already being a root) returns itself.
 * @param path - POSIX or Windows absolute path.
 * @returns the parent directory, or the input root.
 */
export function parentDir(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const slash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  if (slash <= 0) return trimmed.slice(0, slash + 1) || trimmed
  return trimmed.slice(0, slash)
}

/**
 * Resolve a Markdown asset URL against its document without Node path APIs.
 * Absolute filesystem paths, absolute URLs, data URLs, fragments, and
 * protocol-relative URLs are not document-relative references and return
 * undefined.
 * @param documentPath - absolute path of the Markdown document.
 * @param authoredUrl - decoded-or-encoded URL authored in Markdown.
 * @returns an absolute local path, or undefined for a non-local URL.
 */
export function resolveDocumentAssetPath(documentPath: string, authoredUrl: string): string | undefined {
  const withoutSuffix = authoredUrl.split(/[?#]/u, 1)[0] ?? ''
  if (withoutSuffix === '' || withoutSuffix.startsWith('#') || withoutSuffix.startsWith('//')) return undefined
  if (/^[A-Za-z][A-Za-z\d+.-]*:/u.test(withoutSuffix)) return undefined
  let decoded: string
  try {
    decoded = decodeURIComponent(withoutSuffix)
  } catch {
    return undefined
  }
  if (decoded.startsWith('/') || decoded.startsWith('\\') || /^[A-Za-z]:[\\/]/u.test(decoded)) return undefined
  const windows = documentPath.includes('\\')
  const separator = windows ? '\\' : '/'
  const joined = `${parentDir(documentPath)}${separator}${decoded}`
  const prefix = windows && /^[A-Za-z]:/u.test(joined) ? joined.slice(0, 2) : joined.startsWith('/') ? '/' : ''
  const parts = joined.slice(prefix.length).split(/[\\/]+/u)
  const normalized: string[] = []
  for (const part of parts) {
    if (part === '' || part === '.') continue
    if (part === '..') normalized.pop()
    else normalized.push(part)
  }
  return `${prefix}${prefix !== '' && normalized.length > 0 && !prefix.endsWith(separator) ? separator : ''}${normalized.join(separator)}`
}

/**
 * Test whether a path is the target itself or a descendant of it.
 * @param path - candidate absolute path.
 * @param target - absolute file or directory path.
 * @returns whether the candidate is the target or lies below it.
 */
export function isSameOrDescendant(path: string, target: string): boolean {
  return path === target || path.startsWith(`${target}/`) || path.startsWith(`${target}\\`)
}

/**
 * Rewrite a path that is the source itself or a descendant of it.
 * @param path - candidate absolute path.
 * @param source - old absolute file or directory path.
 * @param destination - new absolute path.
 * @returns the rewritten path, or the unchanged candidate when outside source.
 */
export function rewritePathPrefix(path: string, source: string, destination: string): string {
  return isSameOrDescendant(path, source)
    ? `${destination}${path.slice(source.length)}`
    : path
}
