const peers = new WeakMap();

/** One caller identity shared by the Host's session and command gateways. */
export function harnessPeer(ctx) {
  const scope = ctx?.root ?? ctx;
  const cached = peers.get(scope);
  if (cached) return cached;
  const connection = ctx?.connection;
  if (typeof connection?.createPeer !== 'function') return undefined;
  // IM approvals and questions have their own listeners and response routing.
  const peer = connection.createPeer({ principal: { kind: 'owner' }, interactions: 'none' });
  peers.set(scope, peer);
  ctx.effect?.(() => () => {
    if (peers.get(scope) === peer) peers.delete(scope);
    return peer.dispose();
  }, 'dsh-im: shared Harness caller');
  return peer;
}
