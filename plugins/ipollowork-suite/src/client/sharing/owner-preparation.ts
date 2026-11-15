/** Optional application sign-in before the native share dialog opens. */

/** Outcome of preparing the current owner's sharing connection. */
export interface OwnerSharePreparation {
  /** True when an application verified its managed connection. */
  readonly connected?: boolean
  /** Localized recovery message; present only when preparation failed. */
  readonly error?: string
}
