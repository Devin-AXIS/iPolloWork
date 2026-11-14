/** Optional application sign-in before the native share dialog opens. */

/** Outcome of preparing the current owner's sharing connection. */
export interface OwnerSharePreparation {
  /** True when an application verified its managed connection. */
  readonly connected?: boolean
  /** Localized recovery message; present only when preparation failed. */
  readonly error?: string
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * Prepare application-managed sharing credentials before opening the native dialog.
     * @param signal - Cancelled when the action or its owning plugin is disposed.
     * @param next - Prepare remaining providers before returning their result.
     * @returns A localized failure or an empty successful result; no provider preserves native setup.
     * @mode waterfall
     */
    'liveshare/prepare-owner'(signal: AbortSignal, next: () => Promise<OwnerSharePreparation>): Promise<OwnerSharePreparation>
  }
}
