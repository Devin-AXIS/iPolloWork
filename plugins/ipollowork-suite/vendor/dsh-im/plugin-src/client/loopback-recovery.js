const TRANSPORT_FORBIDDEN = /^transport failure for \/[A-Za-z0-9._~-]+\/[A-Za-z0-9_$./~-]+: HTTP 403$/;

export const LOOPBACK_RECOVERY_ERROR_CODE = 'loopback-recovery-required';
export const LOOPBACK_RECOVERY_ERROR_MESSAGE =
  '当前地址与浏览器的本机请求校验不兼容。请使用上方按钮改用 localhost 重新打开。';

function isIpv4Loopback(hostname) {
  const parts = hostname.split('.');
  return parts.length === 4
    && parts[0] === '127'
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

/**
 * Return a safe localhost navigation target for the known loopback transport failure.
 */
export function createLoopbackRecovery(error, location) {
  if (!TRANSPORT_FORBIDDEN.test(error?.message ?? '')) return null;
  if (typeof location?.href !== 'string') return null;

  try {
    const current = new URL(location.href);
    if (current.protocol !== 'http:' || !isIpv4Loopback(current.hostname)) return null;
    current.hostname = 'localhost';
    return Object.freeze({
      url: current.href,
      origin: current.origin,
    });
  } catch {
    return null;
  }
}

/**
 * Decorate one IM RPC caller with a narrowly scoped localhost recovery signal.
 */
export function createLoopbackAwareRpcCall(rpcCall, {
  location,
  onRecovery,
} = {}) {
  if (typeof rpcCall !== 'function') throw new TypeError('rpcCall must be a function');
  return async (...args) => {
    try {
      return await rpcCall(...args);
    } catch (error) {
      const recovery = createLoopbackRecovery(error, location);
      if (!recovery) throw error;
      onRecovery?.(recovery);
      const presented = new Error(LOOPBACK_RECOVERY_ERROR_MESSAGE);
      presented.code = LOOPBACK_RECOVERY_ERROR_CODE;
      presented.cause = error;
      presented.recoveryUrl = recovery.url;
      throw presented;
    }
  };
}

/**
 * Apply the same recovery behavior to every RPC caller in the combined settings page.
 */
export function createLoopbackAwareRpcCalls(rpcCalls, options) {
  return Object.freeze(Object.fromEntries(
    Object.entries(rpcCalls).map(([name, rpcCall]) => [
      name,
      typeof rpcCall === 'function'
        ? createLoopbackAwareRpcCall(rpcCall, options)
        : rpcCall,
    ]),
  ));
}

/** Navigate without leaving the known-broken loopback address in browser history. */
export function replacePageLocation(url, location = globalThis.location) {
  location?.replace?.(url);
}
