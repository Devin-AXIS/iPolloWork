import { ImagePromptError, imageDownloadLimitMessage } from '../shared/image-prompt.mjs';

const RESOURCE_CHUNK_BYTES = 8 * 1024 * 1024;

function headerValue(headers, name) {
  if (typeof headers?.get === 'function') return headers.get(name) ?? null;
  const key = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === name);
  return key ? headers[key] : null;
}

function checkLimit(size, maxBytes) {
  if (size > maxBytes) {
    throw new ImagePromptError(
      'image-too-large',
      `Feishu image exceeds ${maxBytes} bytes`,
      imageDownloadLimitMessage(maxBytes),
    );
  }
}

function contentLength(headers) {
  const value = headerValue(headers, 'content-length');
  if (value === null || value === undefined) return null;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Invalid Feishu resource Content-Length');
  }
  return Number(value);
}

function contentRange(headers, start, end, total) {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(headerValue(headers, 'content-range') ?? '');
  if (!match) throw new Error('Invalid Feishu resource Content-Range');
  const [first, last, size] = match.slice(1).map(Number);
  if (![first, last, size].every(Number.isSafeInteger)
    || first !== start || last < first || last > end || last >= size
    || (total !== null && size !== total)) {
    throw new Error('Inconsistent Feishu resource Content-Range');
  }
  return { size, length: last - first + 1 };
}

/** Stream sequential ranges; never buffer an ordinary file or publish a partial success. */
export async function* downloadFeishuResourceRanges(client, path, type, { signal, maxBytes } = {}) {
  let offset = 0;
  let total = null;
  do {
    signal?.throwIfAborted();
    const end = Math.min(
      offset + RESOURCE_CHUNK_BYTES - 1,
      (total ?? maxBytes ?? Number.MAX_SAFE_INTEGER) - 1,
    );
    let status;
    const response = await client.request({
      method: 'GET',
      url: `open-apis/im/v1/messages/${encodeURIComponent(path.message_id)}/resources/${encodeURIComponent(path.file_key)}`,
      params: { type },
      headers: { Range: `bytes=${offset}-${end}`, 'Accept-Encoding': 'identity' },
      responseType: 'stream',
      $return_headers: true,
      decompress: false,
      signal,
      // The SDK strips status from successful responses, including stream responses.
      validateStatus(value) {
        status = value;
        return value >= 200 && value < 300;
      },
    });
    const stream = response?.data;
    const abort = () => stream?.destroy?.(signal.reason);
    signal?.addEventListener('abort', abort, { once: true });
    try {
      signal?.throwIfAborted();
      if (!stream || typeof stream[Symbol.asyncIterator] !== 'function') {
        throw new Error('Feishu resource download returned no readable stream');
      }
      const encoding = headerValue(response.headers, 'content-encoding');
      if (encoding && encoding !== 'identity') {
        throw new Error('Unexpected Feishu resource Content-Encoding');
      }
      let length = contentLength(response.headers);
      if (status === 206) {
        const range = contentRange(response.headers, offset, end, total);
        total = range.size;
        checkLimit(total, maxBytes);
        if (length !== null && length !== range.length) {
          throw new Error('Feishu resource Content-Length disagrees with Content-Range');
        }
        length = range.length;
      } else if (status === 200 && offset === 0) {
        // A server may ignore the first Range. Read it once as a whole file.
        if (headerValue(response.headers, 'content-range') !== null) {
          throw new Error('Unexpected Feishu resource Content-Range on HTTP 200');
        }
        checkLimit(length, maxBytes);
      } else {
        throw new Error(`Unexpected Feishu resource range status: ${status}`);
      }
      let received = 0;
      for await (const chunk of stream) {
        signal?.throwIfAborted();
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        received += data.length;
        checkLimit(offset + received, maxBytes);
        if (length !== null && received > length) {
          throw new Error('Feishu resource body exceeds the declared length');
        }
        yield data;
      }
      signal?.throwIfAborted();
      if (length !== null && received !== length) {
        throw new Error('Feishu resource body does not match the declared length');
      }
      if (status === 200) return;
      offset += received;
    } finally {
      signal?.removeEventListener('abort', abort);
      stream?.destroy?.();
    }
  } while (offset < total);
}
