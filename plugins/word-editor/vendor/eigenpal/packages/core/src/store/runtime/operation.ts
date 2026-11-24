// Immutable per-operation resource/configuration snapshot (document-engine task
// 0.3 / design D6, D9). When an operation begins it captures a frozen snapshot of
// resolved limits and configuration plus its resolved ports, a root budget, and a
// cancellation controller. The snapshot is immutable for the operation's lifetime
// so cache reuse and replica agreement can key on an unchanging operation
// environment; a new operation always gets a fresh snapshot.

import { resolveLimits, type ResourceLimits } from './limits.ts';
import { Budget } from './budget.ts';
import { CancellationController } from './cancellation.ts';
import type { PortRegistry } from './ports.ts';

/** What one operation is started with. Only `ports` is required. */
export interface OperationInit {
  readonly ports: PortRegistry;
  readonly limits?: Partial<ResourceLimits>;
  readonly config?: Readonly<Record<string, unknown>>;
  /** Root budget capacity in abstract units (default: the byte decompression limit). */
  readonly capacity?: number;
  /** Operation identity (from IdentityPort in production); defaulted for tests. */
  readonly id?: string;
}

/**
 * The frozen environment of one operation: its limits, config, ports, root budget and
 * cancellation controller.
 *
 * IMMUTABLE for the operation's lifetime, which is what lets cache reuse and replica agreement
 * key on it. A new operation always gets a fresh snapshot rather than observing a mutated one.
 */
export interface OperationContext {
  readonly id: string;
  readonly limits: ResourceLimits;
  readonly config: Readonly<Record<string, unknown>>;
  readonly ports: PortRegistry;
  readonly budget: Budget;
  readonly cancellation: CancellationController;
}

/**
 * Begin an operation, capturing its immutable environment snapshot.
 *
 * Resolves and freezes limits and configuration, carves the root budget, and creates the
 * cancellation controller — everything downstream work needs, fixed for the operation's duration.
 */
export function beginOperation(init: OperationInit): OperationContext {
  const limits = resolveLimits(init.limits); // already frozen
  const config = Object.freeze({ ...(init.config ?? {}) });
  const capacity = init.capacity ?? limits.maxDecompressedBytes;
  const id = init.id ?? 'op';
  const ctx: OperationContext = {
    id,
    limits,
    config,
    ports: init.ports,
    budget: new Budget(`op:${id}`, capacity),
    cancellation: new CancellationController(),
  };
  return Object.freeze(ctx);
}

/** Release the operation's root budget (requires every child/reservation released). */
export function endOperation(ctx: OperationContext): void {
  ctx.budget.dispose();
}
