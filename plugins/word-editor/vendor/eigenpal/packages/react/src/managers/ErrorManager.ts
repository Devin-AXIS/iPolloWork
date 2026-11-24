/**
 * ErrorManager
 *
 * Framework-agnostic pub/sub error notification system.
 * Replaces React's `componentDidCatch` + context pattern for error notifications.
 *
 * Usage with React:
 * ```ts
 * const { notifications } = useSyncExternalStore(manager.subscribe, manager.getSnapshot);
 * ```
 */

import { Subscribable } from './Subscribable';
import type { ErrorManagerSnapshot, ErrorNotification, ErrorSeverity } from './types';

export class ErrorManager extends Subscribable<ErrorManagerSnapshot> {
  private notifications: ErrorNotification[] = [];
  private idCounter = 0;
  private timers = new Set<ReturnType<typeof globalThis.setTimeout>>();

  constructor() {
    super({ notifications: [] });
  }

  /** Show an error notification (persistent, not auto-dismissed). */
  showError(message: string, details?: string): string {
    return this.addNotification(message, 'error', details);
  }

  /** Show a warning notification (auto-dismissed after 5s). */
  showWarning(message: string, details?: string): string {
    return this.addNotification(message, 'warning', details);
  }

  /** Show an info notification (auto-dismissed after 5s). */
  showInfo(message: string, details?: string): string {
    return this.addNotification(message, 'info', details);
  }

  /** Dismiss a notification by ID. */
  dismiss(id: string): void {
    this.notifications = this.notifications.map((n) =>
      n.id === id ? { ...n, dismissed: true } : n
    );
    this.emitSnapshot();

    // Remove from list after animation delay
    const timer = globalThis.setTimeout(() => {
      this.timers.delete(timer);
      this.notifications = this.notifications.filter((n) => n.id !== id);
      this.emitSnapshot();
    }, 300);
    this.timers.add(timer);
  }

  /** Clear all notifications and cancel pending timers. */
  clearAll(): void {
    this.notifications = [];
    for (const timer of this.timers) globalThis.clearTimeout(timer);
    this.timers.clear();
    this.emitSnapshot();
  }

  /** Destroy the manager and clean up all timers. */
  destroy(): void {
    for (const timer of this.timers) globalThis.clearTimeout(timer);
    this.timers.clear();
    this.notifications = [];
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private addNotification(message: string, severity: ErrorSeverity, details?: string): string {
    const id = `error-${++this.idCounter}-${Date.now()}`;
    const notification: ErrorNotification = {
      id,
      message,
      severity,
      details,
      timestamp: Date.now(),
    };

    this.notifications = [...this.notifications, notification];
    this.emitSnapshot();

    // Auto-dismiss after 5 seconds for info/warning
    if (severity !== 'error') {
      const timer = globalThis.setTimeout(() => {
        this.timers.delete(timer);
        this.dismiss(id);
      }, 5000);
      this.timers.add(timer);
    }

    return id;
  }

  private emitSnapshot(): void {
    this.setSnapshot({ notifications: this.notifications });
  }
}
