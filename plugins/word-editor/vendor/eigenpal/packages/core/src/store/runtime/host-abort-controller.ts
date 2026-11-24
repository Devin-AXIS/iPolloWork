/** Structurally access the AbortController supplied by every supported browser and Node host. */
export function createHostAbortController(): {
  readonly signal: AbortSignal;
  abort(reason?: unknown): void;
} {
  const HostAbortController = (
    globalThis as unknown as {
      readonly AbortController: new () => {
        readonly signal: AbortSignal;
        abort(reason?: unknown): void;
      };
    }
  ).AbortController;
  return new HostAbortController();
}
