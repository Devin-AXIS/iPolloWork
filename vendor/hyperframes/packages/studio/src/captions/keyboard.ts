const CAPTION_NUDGE_KEYS = new Set(["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]);

type CaptionNudgeKeyEvent = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "key">;

export function shouldHandleCaptionNudgeKey(event: CaptionNudgeKeyEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  return CAPTION_NUDGE_KEYS.has(event.key);
}
