async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Preserve the original download failure.
  }
}

function hostedByMessagingPlatform(target, allowedHosts) {
  return !Array.isArray(allowedHosts) || allowedHosts.some((rule) => (
    typeof rule === 'string'
    && (target.hostname === rule
      || (rule.startsWith('.')
        && (target.hostname === rule.slice(1) || target.hostname.endsWith(rule))))
  ));
}

/**
 * Open a channel-hosted ordinary file as a stream.
 *
 * This deliberately has no plugin-defined size, type, count, or download-time
 * limit. The caller owns cancellation through its AbortSignal and the channel
 * remains the authority for its own file limits.
 */
export async function fetchFileStream(url, {
  fetchImpl = fetch,
  headers,
  signal,
  allowedHosts,
} = {}) {
  const target = new URL(url);
  if (target.protocol !== 'https:') throw new Error('File download URL must use HTTPS');
  if (!hostedByMessagingPlatform(target, allowedHosts)) {
    throw new Error('File download URL is not hosted by the messaging platform');
  }

  const response = await fetchImpl(target, {
    method: 'GET',
    headers,
    signal,
    redirect: 'manual',
  });
  if (Number.isInteger(response?.status) && response.status >= 300 && response.status < 400) {
    await cancelResponseBody(response);
    const error = new Error(`File download redirect was blocked (HTTP ${response.status})`);
    error.code = 'file-redirect-blocked';
    throw error;
  }
  if (!response?.ok) {
    await cancelResponseBody(response);
    const error = new Error(`File download failed with HTTP ${response?.status ?? 'unknown'}`);
    error.code = 'file-http-error';
    error.status = response?.status;
    throw error;
  }
  if (response.body?.[Symbol.asyncIterator]) return { stream: response.body };
  if (typeof response.arrayBuffer === 'function') {
    const data = Buffer.from(await response.arrayBuffer());
    return {
      stream: (async function* fileBody() { yield data; }()),
    };
  }
  throw new Error('File download returned no readable body');
}
