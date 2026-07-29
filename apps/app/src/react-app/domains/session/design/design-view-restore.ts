export type DesignViewRestore = {
  id: string;
  targetSource: string;
  previewRevision: number;
  frameLoaded: boolean;
  frameRestored: boolean;
  deckRestored: boolean;
  deckIndex: number | null;
  frameScrollX: number;
  frameScrollY: number;
  panLeft: number;
  panTop: number;
};

export function expectsDesignRestoreFrame(
  pending: DesignViewRestore | null,
  source: string,
  previewRevision: number,
) {
  return Boolean(pending && pending.targetSource === source && previewRevision >= pending.previewRevision);
}

export function acceptsDesignDeckMessage(
  pending: DesignViewRestore | null,
  message: { index: number; viewRevision: string },
) {
  if (!pending) return true;
  if (!pending.frameLoaded || message.viewRevision !== pending.id) return false;
  return pending.deckIndex === null || pending.deckIndex === message.index;
}

export function shouldIgnoreDesignDraftMessage(pending: DesignViewRestore | null) {
  return Boolean(pending && !pending.frameLoaded);
}
