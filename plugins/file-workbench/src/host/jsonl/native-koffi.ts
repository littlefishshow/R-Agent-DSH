/** Reuse the native dependency of the installed standard DSH JSONL backend. */
import { createRequire } from 'node:module'

// Resolved only by the Windows helper's lazy import. Keeping the installation
// anchor on the official backend avoids introducing a plugin postinstall step.
const koffi: typeof import('koffi').default = createRequire(
  import.meta.resolve('@deepseek-ai/dsh-session-persistence-jsonl'),
)('koffi')

export default koffi
