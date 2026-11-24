/** Register cleanup only when a component/effect scope is active. @internal */
export function scopeDispose(cleanup: () => void): void {
  cleanup();
}
