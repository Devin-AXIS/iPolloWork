const bindingLocks = new WeakMap();
export const SESSION_BINDING_STATE_IDENTITY = Symbol('session-binding-state-identity');

function stateLocks(state) {
  let locks = bindingLocks.get(state);
  if (!locks) {
    locks = new Map();
    bindingLocks.set(state, locks);
  }
  return locks;
}

/**
 * Serialize the short Session binding transaction for one conversation.
 * The caller must keep long-running Session work, such as ask(), outside.
 */
export async function withSessionBindingLock(state, key, operation) {
  const stateType = typeof state;
  if ((stateType !== 'object' && stateType !== 'function') || state === null) {
    throw new TypeError('state is required');
  }
  if (typeof key !== 'string' || !key) throw new TypeError('conversation key is required');
  if (typeof operation !== 'function') throw new TypeError('operation is required');

  state = state[SESSION_BINDING_STATE_IDENTITY] ?? state;
  const locks = stateLocks(state);
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  locks.set(key, current);

  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (locks.get(key) === current) {
      locks.delete(key);
      if (locks.size === 0) bindingLocks.delete(state);
    }
  }
}
