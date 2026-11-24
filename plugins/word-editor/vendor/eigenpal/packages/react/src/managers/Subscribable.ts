/**
 * Subscribable Base Class
 *
 * Framework-agnostic base for manager classes that need to notify
 * UI frameworks of state changes.
 *
 * Compatible with:
 * - React: useSyncExternalStore(manager.subscribe, manager.getSnapshot)
 * - Vue: watchEffect(() => { manager.subscribe(triggerRef) })
 */

export abstract class Subscribable<TSnapshot> {
  private listeners = new Set<() => void>();
  private snapshot: TSnapshot;

  constructor(initialSnapshot: TSnapshot) {
    this.snapshot = initialSnapshot;
  }

  /**
   * Subscribe to state changes. Returns an unsubscribe function.
   * Bound method — safe to pass as `useSyncExternalStore(manager.subscribe, ...)`.
   */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /**
   * Get the current snapshot. Returns a stable reference unless state has changed.
   * Bound method — safe to pass as `useSyncExternalStore(..., manager.getSnapshot)`.
   */
  getSnapshot = (): TSnapshot => {
    return this.snapshot;
  };

  /**
   * Update the snapshot and notify all subscribers.
   * Subclasses should call this whenever their state changes.
   */
  protected setSnapshot(snapshot: TSnapshot): void {
    this.snapshot = snapshot;
    this.notify();
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}
