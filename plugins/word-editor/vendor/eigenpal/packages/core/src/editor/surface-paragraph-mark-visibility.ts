/** Keep Show/Hide out of document state and flush pending input before repainting. */
export function createParagraphMarkVisibility(
  initial: boolean,
  beforeChange: () => void,
  repaint: () => void
): { get(): boolean; set(next: boolean): void } {
  let visible = initial;
  return {
    get: () => visible,
    set(next) {
      if (next === visible) return;
      beforeChange();
      visible = next;
      repaint();
    },
  };
}
