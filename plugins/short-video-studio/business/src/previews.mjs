const cacheLimit = 48 * 1024 * 1024;
const thumbnailLimit = 8 * 1024 * 1024;
const mediaLimit = 256 * 1024 * 1024;

// Large media can still be played explicitly. Keep only one such preview and
// suspend thumbnail preloads until it is released.
export function createPreviews(readChunk, evicted) {
  const entries = new Map();
  const largeThumbnails = new Set();
  let bytes = 0, lifetime = new AbortController(), tail = Promise.resolve();

  function release(id) {
    const entry = entries.get(id);
    if (!entry) return;
    entries.delete(id);
    bytes -= entry.size;
    URL.revokeObjectURL(entry.url);
    evicted(id);
  }

  async function load(projectId, assetId, automatic, signal) {
    if (signal.aborted) return;
    const cached = entries.get(assetId);
    if (cached) {
      entries.delete(assetId);
      entries.set(assetId, cached);
      return cached.url;
    }
    if (automatic && (bytes > cacheLimit || largeThumbnails.has(assetId))) return;

    const chunks = [];
    let offset = 0, size, mime;
    while (size === undefined || offset < size) {
      const part = await readChunk({ projectId, assetId, offset }, signal);
      if (signal.aborted) return;
      if (size === undefined) {
        ({ size, mime } = part);
        if (!Number.isSafeInteger(size) || size < 1 || size > mediaLimit) throw new Error('素材大小无效');
        if (automatic && size > thumbnailLimit) { largeThumbnails.add(assetId); return; }
        while (entries.size && (entries.size >= 24 || bytes + size > cacheLimit)) release(entries.keys().next().value);
      }
      if (part.size !== size || part.mime !== mime || !Number.isSafeInteger(part.nextOffset)
        || part.nextOffset <= offset || part.nextOffset > size) throw new Error('素材读取未前进');
      const chunk = Uint8Array.from(atob(part.data), c => c.charCodeAt(0));
      if (chunk.byteLength !== part.nextOffset - offset) throw new Error('素材读取不完整');
      chunks.push(chunk);
      offset = part.nextOffset;
    }
    const url = URL.createObjectURL(new Blob(chunks, { type: mime }));
    entries.set(assetId, { url, size });
    bytes += size;
    return url;
  }

  return {
    get: id => entries.get(id)?.url,
    load(projectId, assetId, automatic = false) {
      const { signal } = lifetime;
      const request = tail.then(() => load(projectId, assetId, automatic, signal)).catch(error => {
        if (!signal.aborted) throw error;
      });
      tail = request.catch(() => {});
      return request;
    },
    clear() {
      lifetime.abort();
      lifetime = new AbortController();
      for (const id of entries.keys()) release(id);
      largeThumbnails.clear();
    },
  };
}
