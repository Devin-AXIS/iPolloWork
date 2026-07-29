export function removeComposerDesignSelectionToken(value: string, contextId: string) {
  return value.replace(`[[design-ai:${contextId}]]`, "").trim();
}
