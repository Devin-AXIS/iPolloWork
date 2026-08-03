export type PreviewCleanup = () => void;

export interface PreviewStartContext {
  signal: AbortSignal;
  isCurrent: () => boolean;
}

export type PreviewStarter = (context: PreviewStartContext) => Promise<PreviewCleanup | undefined>;

interface ActivePreview {
  id: string;
  generation: number;
  abortController: AbortController;
  cleanup?: PreviewCleanup;
}

function runCleanup(cleanup: PreviewCleanup | undefined): void {
  try {
    cleanup?.();
  } catch {
    // Preview cleanup is best-effort and must never break another card.
  }
}

/**
 * Coordinates the catalog's transient previews. It owns only preview resources;
 * installed timeline blocks remain outside this lifecycle.
 */
export class PreviewController {
  private active: ActivePreview | null = null;
  private generation = 0;
  private disposed = false;

  get activeId(): string | null {
    return this.active?.id ?? null;
  }

  start(id: string, starter: PreviewStarter): void {
    if (this.disposed) return;
    if (this.active?.id === id) return;
    this.stop();

    const active: ActivePreview = {
      id,
      generation: ++this.generation,
      abortController: new AbortController(),
    };
    this.active = active;

    const isCurrent = () =>
      this.active === active &&
      this.generation === active.generation &&
      !active.abortController.signal.aborted;

    void starter({ signal: active.abortController.signal, isCurrent })
      .then((cleanup) => {
        if (!cleanup) return;
        if (!isCurrent()) {
          runCleanup(cleanup);
          return;
        }
        active.cleanup = cleanup;
      })
      .catch(() => {
        if (isCurrent()) this.stop(id);
      });
  }

  stop(id?: string): boolean {
    const active = this.active;
    if (!active || (id && active.id !== id)) return false;

    this.active = null;
    this.generation += 1;
    active.abortController.abort();
    runCleanup(active.cleanup);
    active.cleanup = undefined;
    return true;
  }

  dispose(): void {
    this.stop();
    this.disposed = true;
  }
}
