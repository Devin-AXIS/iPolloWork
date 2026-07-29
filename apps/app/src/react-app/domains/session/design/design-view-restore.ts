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

function isCurrentOrHydratedDesignFrame(frameRevision: string, baseline: string) {
  const frameSeparator = frameRevision.lastIndexOf(":");
  const baselineSeparator = baseline.lastIndexOf(":");
  if (frameSeparator < 1 || baselineSeparator < 1) return frameRevision === baseline;
  const framePath = frameRevision.slice(0, frameSeparator);
  const baselinePath = baseline.slice(0, baselineSeparator);
  const frameVersion = Number(frameRevision.slice(frameSeparator + 1));
  const baselineVersion = Number(baseline.slice(baselineSeparator + 1));
  return framePath === baselinePath
    && Number.isSafeInteger(frameVersion)
    && Number.isSafeInteger(baselineVersion)
    && frameVersion >= baselineVersion;
}

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
      && (frameRevision === undefined || isCurrentOrHydratedDesignFrame(frameRevision, pending.frameRevision)),
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
