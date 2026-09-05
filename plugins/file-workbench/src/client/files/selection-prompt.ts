/** One Markdown fence whose closing delimiter exactly matches its opener. */
const REPLACEMENT_FENCE = /(?:^|\r?\n)[ \t]*(`{3,})(?:markdown|md)[ \t]*\r?\n([\s\S]*?)\r?\n[ \t]*\1[ \t]*(?=\r?\n|$)/gi

/**
 * Extract the replacement Markdown a modify branch produced from an assistant
 * reply. Exactly one `markdown` or `md` fence must exist. Surrounding prose is
 * ignored, while multiple replacement fences and incomplete streaming output
 * are rejected.
 * @param reply - the assistant message text.
 * @returns the replacement text, or undefined.
 */
export function extractReplacement(reply: string): string | undefined {
  const matches = [...reply.matchAll(REPLACEMENT_FENCE)]
  return matches.length === 1 ? matches[0]?.[2] : undefined
}
