/** Optional per-bot card delivery. A registration is not a delivery receipt:
 * the coordinator must await the renderer before suppressing final text. */
const renderers = new Map();

function botKey({ channel, botId }) {
  return JSON.stringify([channel, botId]);
}

export function registerSessionSyncMirror(target, render) {
  const key = botKey(target);
  const entry = { render };
  renderers.set(key, entry);
  return () => {
    if (renderers.get(key) === entry) renderers.delete(key);
  };
}

export async function deliverSessionSyncMirror(target, sessionId, turn, text) {
  const entry = renderers.get(botKey(target));
  if (!entry) return false;
  return await entry.render({ target, sessionId, turn, text }) === true;
}
