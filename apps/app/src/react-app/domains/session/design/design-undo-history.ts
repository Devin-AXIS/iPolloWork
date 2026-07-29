export type DesignUndoResult = {
  previous: string | undefined;
  history: string[];
};

export function pushDesignUndoHistory(history: readonly string[], snapshot: string) {
  return history.at(-1) === snapshot ? [...history] : [...history, snapshot];
}

export function popDesignUndoHistory(history: readonly string[], current: string): DesignUndoResult {
  const remaining = [...history];
  while (remaining.at(-1) === current) remaining.pop();
  return { previous: remaining.pop(), history: remaining };
}

export function shouldHydrateDesignSource(pageChanged: boolean, source: string, current: string) {
  return pageChanged || source !== current;
}
