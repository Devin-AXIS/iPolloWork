export type DesignViewRestore = {
  id: string;
  targetSource: string;
  previewRevision: number;
  frameRevision: string;
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
  frameRevision?: string,
) {
  return Boolean(
    pending
      && pending.targetSource === source
      && previewRevision >= pending.previewRevision
      && (frameRevision === undefined || pending.frameRevision === frameRevision),
  );
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
  return Boolean(pending);
}
