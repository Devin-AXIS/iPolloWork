import type { DrawingProjection } from './drawing-projection.ts';
import type { ImageResourceState } from './image-resources.ts';
import type { ImageResourceLimits } from '../runtime/limits.ts';
import type {
  ValidatedImageBytesRegistry,
  ValidatedImageBytesReleaseToken,
} from './validated-image-bytes.ts';
import { sha256FontBytes } from './sha256.ts';
import type { LegacyGraphicProjection } from './legacy-vml-shapes.ts';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!,
      b = bytes[i + 1] ?? 0,
      c = bytes[i + 2] ?? 0;
    chunk +=
      alphabet[a >> 2]! +
      alphabet[((a & 3) << 4) | (b >> 4)]! +
      (i + 1 < bytes.length ? alphabet[((b & 15) << 2) | (c >> 6)]! : '=') +
      (i + 2 < bytes.length ? alphabet[c & 63]! : '=');
    if (chunk.length >= 8192) {
      chunks.push(chunk);
      chunk = '';
    }
  }
  chunks.push(chunk);
  return chunks.join('');
}

/** Composite previews are derived resources, never new package parts or relationships. */
export function createLegacyGraphicResolver(options: {
  readonly resolveEmbedded: (owner: string, id: string) => Promise<ImageResourceState>;
  readonly registry: ValidatedImageBytesRegistry;
  readonly limits: ImageResourceLimits;
  readonly ensureActive: () => void;
}): (projection: DrawingProjection) => Promise<ImageResourceState> {
  const retained = new Map<string, ValidatedImageBytesReleaseToken>();
  const cached = new WeakMap<
    LegacyGraphicProjection,
    { contentId: string; state: ImageResourceState }
  >();
  const refused = (reason: 'resource-limit' | 'unsupported-format'): ImageResourceState =>
    Object.freeze({ kind: 'unrenderable', partName: null, mime: 'image/svg+xml', reason });
  return async (projection) => {
    options.ensureActive();
    const graphic = projection.legacyGraphic;
    if (!graphic || graphic.fragments.length > 128) return refused('unsupported-format');
    // One picture alone is that picture: no composite, so every output paints its pixels.
    if (graphic.soleImageRelationshipId)
      return options.resolveEmbedded(projection.ownerPartName, graphic.soleImageRelationshipId);
    const pixelWidth = Math.ceil((graphic.width * 96) / 72),
      pixelHeight = Math.ceil((graphic.height * 96) / 72);
    const { limits, registry } = options;
    if (
      ![pixelWidth, pixelHeight].every(
        (n) => Number.isSafeInteger(n) && n > 0 && n <= limits.maxDimension
      ) ||
      pixelWidth * pixelHeight > limits.maxPixels ||
      pixelWidth * pixelHeight * 4 > limits.maxDecodedBytes
    )
      return refused('resource-limit');
    const pieces = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${pixelWidth}" height="${pixelHeight}" viewBox="0 0 ${graphic.width} ${graphic.height}" preserveAspectRatio="none">`,
    ];
    let length = pieces[0]!.length;
    for (const fragment of graphic.fragments) {
      let value: string;
      if (typeof fragment === 'string') value = fragment;
      else {
        // The normal relationship resolver refuses externals without fetching;
        // every embedded member must pass the existing byte/header/decode gates.
        const state = await options.resolveEmbedded(
          projection.ownerPartName,
          fragment.relationshipId
        );
        options.ensureActive();
        if (state.kind !== 'ready') return state;
        const bytes = registry.mint(state.validatedHandle, state.contentId);
        if (!bytes) return refused('unsupported-format');
        if (
          length +
            fragment.before.length +
            fragment.after.length +
            Math.ceil(bytes.length / 3) * 4 +
            64 >
          limits.maxEncodedBytes
        )
          return refused('resource-limit');
        value = fragment.before + `data:${state.mime};base64,` + base64(bytes) + fragment.after;
      }
      length += value.length;
      if (length + 6 > limits.maxEncodedBytes) return refused('resource-limit');
      pieces.push(value);
    }
    pieces.push('</svg>');
    const bytes = new TextEncoder().encode(pieces.join(''));
    if (bytes.length > limits.maxEncodedBytes) return refused('resource-limit');
    const contentId = sha256FontBytes(bytes);
    const previous = cached.get(graphic);
    if (
      previous?.contentId === contentId &&
      previous.state.kind === 'ready' &&
      previous.state.partName === projection.ownerPartName &&
      previous.state.resourceKey ===
        `${projection.ownerPartName}\0legacy:${projection.drawingNodeId}:${contentId}\0${contentId}` &&
      registry.mint(previous.state.validatedHandle, contentId)
    ) {
      const ownerKey = `${projection.ownerPartName}\0${projection.drawingNodeId}`;
      const current = retained.get(ownerKey);
      if (current?.resourceKey !== previous.state.resourceKey) {
        const token = registry.retain(previous.state.validatedHandle);
        if (current) registry.release(current);
        retained.set(ownerKey, token);
      }
      return previous.state;
    }
    // The source XML part is provenance, not a fabricated media part. Include
    // content in the derived resource base so a new preview cannot invalidate
    // already-retained photo handles while a paint frame still owns them.
    const resourceKey = `${projection.ownerPartName}\0legacy:${projection.drawingNodeId}:${contentId}\0${contentId}`;
    const validatedHandle = registry.acquire(resourceKey, contentId, bytes);
    const token = registry.retain(validatedHandle);
    const ownerKey = `${projection.ownerPartName}\0${projection.drawingNodeId}`;
    const previousToken = retained.get(ownerKey);
    if (previousToken) registry.release(previousToken);
    retained.set(ownerKey, token);
    const state: ImageResourceState = Object.freeze({
      kind: 'ready',
      partName: projection.ownerPartName,
      contentId,
      resourceKey,
      validatedHandle,
      mime: 'image/svg+xml',
      pixelWidth,
      pixelHeight,
      dpiX: 96,
      dpiY: 96,
    });
    cached.set(graphic, { contentId, state });
    return state;
  };
}
