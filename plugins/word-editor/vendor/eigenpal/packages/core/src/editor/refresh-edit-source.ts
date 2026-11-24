// Marks the commit of an undoable document update, so its `change` event carries
// `source: 'refresh'` like a reload does. A host that starts processing on user edits must not
// treat the processor's own result as one, or each result would start the next job.

const active = new WeakSet<object>();

/** Run `apply`, one synchronous commit on `session`, as a document update. */
export function withRefreshEditSource<T>(session: object, apply: () => T): T {
  active.add(session);
  try {
    return apply();
  } finally {
    active.delete(session);
  }
}

/** Whether `session` is committing a document update right now. */
export const refreshEditActive = (session: object): boolean => active.has(session);
