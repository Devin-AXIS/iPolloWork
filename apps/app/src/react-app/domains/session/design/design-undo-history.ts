export type DesignUndoSnapshot = {
  html: string;
  tokenCss: string;
  restoreTokenCss?: boolean;
};

export type DesignUndoResult = {
  previous: DesignUndoSnapshot | undefined;
  history: DesignUndoSnapshot[];
};

function isSameDesignUndoSnapshot(left: DesignUndoSnapshot | undefined, right: DesignUndoSnapshot) {
  return left?.html === right.html && left.tokenCss === right.tokenCss;
}

function wouldRestoreDesignUndoSnapshot(snapshot: DesignUndoSnapshot, current: DesignUndoSnapshot) {
  return snapshot.html !== current.html
    || Boolean(snapshot.restoreTokenCss && snapshot.tokenCss !== current.tokenCss);
}

export function pushDesignUndoHistory(history: readonly DesignUndoSnapshot[], snapshot: DesignUndoSnapshot) {
  return isSameDesignUndoSnapshot(history.at(-1), snapshot)
    ? [...history.slice(0, -1), snapshot]
    : [...history, snapshot];
}

export function popDesignUndoHistory(
  history: readonly DesignUndoSnapshot[],
  current: DesignUndoSnapshot,
): DesignUndoResult {
  const remaining = [...history];
  let candidate = remaining.at(-1);
  while (candidate && !wouldRestoreDesignUndoSnapshot(candidate, current)) {
    remaining.pop();
    candidate = remaining.at(-1);
  }
  return { previous: remaining.pop(), history: remaining };
}

export function shouldHydrateDesignSource(pageChanged: boolean, source: string, current: string) {
  return pageChanged || source !== current;
}
