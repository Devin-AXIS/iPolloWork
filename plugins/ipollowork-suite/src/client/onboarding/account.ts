/** Account facts needed by the first-run introduction; credentials remain in the Host. */
export interface AccountSnapshot {
  view: { status: 'credential-stored' | 'signed-out' } | undefined
  onboardingCredit?: boolean
  failed: boolean
}
