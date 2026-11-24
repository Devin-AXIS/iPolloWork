/** One font origin can be replaced without replacing its document session. */
export function createFontResolutionLifetime() {
  let generation = 0;
  let controller = new AbortController();
  const capture = () => {
    const active = controller;
    return {
      generation,
      signal: active.signal,
      current: () => controller === active && !active.signal.aborted,
    };
  };
  return {
    get generation() {
      return generation;
    },
    capture,
    advance() {
      const previous = controller;
      controller = new AbortController();
      generation += 1;
      // Abort after the caller finishes its synchronous state transition. An
      // abort listener can synchronously load a document or replace fonts again.
      return { ...capture(), cancelPrevious: () => previous.abort() };
    },
    dispose: () => controller.abort(),
  };
}
