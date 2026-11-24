// Opaque validated raster bytes bound to a content hash (typed-drawings-and-images task 10).
//
// Paint minting retrieves bytes only when the expected contentId matches the validated
// snapshot — package mutation or stale cache cannot swap bytes under a ready resource.
// Registries are scoped per lookup/editor bundle so one dispose cannot invalidate another.

/** Opaque handle — bytes are reachable only through {@link mintValidatedImageBytes}. */
export interface ValidatedImageBytesHandle {
  readonly registryId: number;
  readonly resourceKey: string;
  readonly contentId: string;
  readonly generation: number;
}

/** Per-consumer release token returned from {@link ValidatedImageBytesRegistry.retain}. */
export interface ValidatedImageBytesReleaseToken {
  readonly registryId: number;
  readonly resourceKey: string;
  readonly contentId: string;
  readonly generation: number;
  readonly retainId: number;
}

interface ValidatedImageBytesSlot {
  contentId: string;
  bytes: Uint8Array;
  generation: number;
  refCount: number;
}

interface RegistryState {
  generation: number;
  readonly slots: Map<string, ValidatedImageBytesSlot>;
  readonly retainIds: Set<number>;
  nextRetainId: number;
  disposed: boolean;
}

export interface ValidatedImageBytesRegistry {
  acquire(resourceKey: string, contentId: string, bytes: Uint8Array): ValidatedImageBytesHandle;
  retain(handle: ValidatedImageBytesHandle): ValidatedImageBytesReleaseToken;
  release(token: ValidatedImageBytesReleaseToken): void;
  mint(handle: ValidatedImageBytesHandle, expectedContentId: string): Uint8Array | null;
  dispose(): void;
}

let nextRegistryId = 1;
const registries = new Map<number, RegistryState>();

function slotKey(resourceKey: string, contentId: string): string {
  return `${resourceKey}\0${contentId}`;
}

/** Owner part + media part prefix from a full resource key (`owner\0part\0contentId`). */
function mediaResourceBase(resourceKey: string): string {
  const parts = resourceKey.split('\0');
  if (parts.length >= 2) return `${parts[0]}\0${parts[1]}`;
  return resourceKey;
}

function mintFromState(
  state: RegistryState,
  handle: ValidatedImageBytesHandle,
  expectedContentId: string
): Uint8Array | null {
  if (state.disposed) return null;
  if (handle.contentId !== expectedContentId) return null;
  if (handle.generation !== state.generation) return null;
  const slot = state.slots.get(slotKey(handle.resourceKey, expectedContentId));
  if (!slot || slot.contentId !== expectedContentId || slot.generation !== handle.generation) {
    return null;
  }
  if (slot.refCount <= 0) return null;
  return slot.bytes;
}

function buildRegistry(registryId: number, state: RegistryState): ValidatedImageBytesRegistry {
  const acquire = (
    resourceKey: string,
    contentId: string,
    bytes: Uint8Array
  ): ValidatedImageBytesHandle => {
    if (state.disposed) throw new Error('ValidatedImageBytesRegistry disposed');
    const base = mediaResourceBase(resourceKey);
    for (const [key, slot] of [...state.slots.entries()]) {
      if (!key.startsWith(`${base}\0`)) continue;
      if (slot.contentId === contentId) continue;
      state.slots.delete(key);
      state.generation += 1;
    }

    const key = slotKey(resourceKey, contentId);
    const existing = state.slots.get(key);
    if (existing) {
      existing.bytes = new Uint8Array(bytes);
    } else {
      state.slots.set(key, {
        contentId,
        bytes: new Uint8Array(bytes),
        generation: state.generation,
        refCount: 0,
      });
    }
    const slot = state.slots.get(key)!;
    return Object.freeze({
      registryId,
      resourceKey,
      contentId,
      generation: slot.generation,
    });
  };

  const retain = (handle: ValidatedImageBytesHandle): ValidatedImageBytesReleaseToken => {
    if (handle.registryId !== registryId || state.disposed) {
      throw new Error('ValidatedImageBytesRegistry stale handle');
    }
    const key = slotKey(handle.resourceKey, handle.contentId);
    const slot = state.slots.get(key);
    if (!slot || slot.generation !== handle.generation) {
      throw new Error('ValidatedImageBytesRegistry stale handle');
    }
    slot.refCount += 1;
    const retainId = state.nextRetainId;
    state.nextRetainId += 1;
    state.retainIds.add(retainId);
    return Object.freeze({
      registryId,
      resourceKey: handle.resourceKey,
      contentId: handle.contentId,
      generation: handle.generation,
      retainId,
    });
  };

  const release = (token: ValidatedImageBytesReleaseToken): void => {
    if (token.registryId !== registryId || !state.retainIds.has(token.retainId)) return;
    state.retainIds.delete(token.retainId);
    const key = slotKey(token.resourceKey, token.contentId);
    const slot = state.slots.get(key);
    if (!slot || slot.generation !== token.generation) return;
    slot.refCount -= 1;
    if (slot.refCount <= 0) {
      state.slots.delete(key);
    }
  };

  return Object.freeze({
    acquire,
    retain,
    release,
    mint: (handle: ValidatedImageBytesHandle, expectedContentId: string) =>
      mintFromState(state, handle, expectedContentId),
    dispose: () => {
      if (state.disposed) return;
      state.disposed = true;
      state.generation += 1;
      state.slots.clear();
      state.retainIds.clear();
      registries.delete(registryId);
    },
  });
}

export function createValidatedImageBytesRegistry(): ValidatedImageBytesRegistry {
  const registryId = nextRegistryId;
  nextRegistryId += 1;
  const state: RegistryState = {
    generation: 0,
    slots: new Map(),
    retainIds: new Set(),
    nextRetainId: 1,
    disposed: false,
  };
  registries.set(registryId, state);
  return buildRegistry(registryId, state);
}

export function mintValidatedImageBytes(
  handle: ValidatedImageBytesHandle,
  expectedContentId: string
): Uint8Array | null {
  const state = registries.get(handle.registryId);
  if (!state) return null;
  return mintFromState(state, handle, expectedContentId);
}

export function retainValidatedImageBytes(
  handle: ValidatedImageBytesHandle
): ValidatedImageBytesReleaseToken | null {
  const state = registries.get(handle.registryId);
  if (!state) return null;
  try {
    return buildRegistry(handle.registryId, state).retain(handle);
  } catch {
    return null;
  }
}

export function releaseValidatedImageBytesToken(token: ValidatedImageBytesReleaseToken): void {
  const state = registries.get(token.registryId);
  if (!state) return;
  buildRegistry(token.registryId, state).release(token);
}

let ephemeralRegistry = createValidatedImageBytesRegistry();

/** @deprecated Prefer registry-scoped {@link ValidatedImageBytesRegistry.acquire}. */
export function registerValidatedImageBytes(
  resourceKey: string,
  contentId: string,
  bytes: Uint8Array
): ValidatedImageBytesHandle {
  const handle = ephemeralRegistry.acquire(resourceKey, contentId, bytes);
  ephemeralRegistry.retain(handle);
  return handle;
}

/** @deprecated Prefer {@link releaseValidatedImageBytesToken}. */
export function releaseValidatedImageBytes(handle: ValidatedImageBytesHandle): void {
  const state = registries.get(handle.registryId);
  if (!state) return;
  const key = slotKey(handle.resourceKey, handle.contentId);
  const slot = state.slots.get(key);
  if (!slot || slot.generation !== handle.generation) return;
  slot.refCount -= 1;
  if (slot.refCount <= 0) {
    state.slots.delete(key);
  }
}

/** @deprecated Test helper — resets the ephemeral fallback registry. */
export function clearValidatedImageBytesRegistry(): void {
  ephemeralRegistry.dispose();
  ephemeralRegistry = createValidatedImageBytesRegistry();
}
