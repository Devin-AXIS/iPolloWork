/** Optional recipient selection contributed to the native share dialog. */
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { CreateShareRequest } from '../share-api-types.ts'

/** One selection prepares native access fields immediately before creation. */
export interface ShareAudienceSelection {
  /** Reason that blocks creation until the recipient selection is ready. */
  readonly blockedReason?: string
  /** Localized explanation when recipient preparation fails. */
  readonly failureMessage: string
  /**
   * Prepare recipient access fields without changing native session permissions.
   * @param request - Native choices for the share being created.
   * @returns The access mode and recipients to add to that request.
   */
  readonly prepare: (request: CreateShareRequest) => Promise<Pick<CreateShareRequest, 'accessMode' | 'allowedSubjectIds'>>
}

/** Values passed to the optional recipient contribution. */
export interface ShareAudienceProps {
  /** Session being shared, including when opened from the share manager. */
  readonly shareSessionId: SessionId
  /** Whether native prerequisites or an in-flight creation disable editing. */
  readonly disabled: boolean
  /**
   * Publish a selection and clear it when the contribution unmounts.
   * @param selection - Current recipient preparation, or undefined after disposal.
   */
  readonly onChange: (selection: ShareAudienceSelection | undefined) => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Optional application-specific recipients in the native share dialog. */
    'liveshare.share.audience': { kind: 'single'; scope: 'session'; owner: ShareAudienceProps }
  }
}
