/** The one version-pinned runtime bridge used by simultaneous selection windows. */
import type { Session, SessionFace } from '@deepseek-ai/dsh-client-runtime/client'

/**
 * DSH 0.1.1-rc.2 bindings retain the concrete Session object. Its public class
 * method opens history without selecting the main stage. The narrower feature
 * interface omits this method, so this capability is checked at this single
 * plugin boundary. No runtime method or prototype is replaced.
 */
export function openBackgroundSession(session: SessionFace): Promise<void> {
  const window = session as SessionFace & Partial<Pick<Session, 'open'>>
  if (typeof window.open !== 'function') {
    throw new Error('dsh-file-workbench: unsupported DSH runtime; expected 0.1.1-rc.2 Session.open()')
  }
  return window.open()
}
