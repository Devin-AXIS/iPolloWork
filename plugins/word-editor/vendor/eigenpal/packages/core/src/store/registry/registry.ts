// The capability/runtime registry resolution engine (document-engine task 0.1).
//
// Feature bundles declare stable identity, version, dependencies, conflicts,
// required ports, and contributions. `resolve()` produces a deterministic,
// registration-order-independent resolved registry, or throws a typed
// RegistryError naming every responsible party. Selection NEVER uses array
// order — identity is (kind, id) plus version, and ties are broken only by
// declared policy.

import { assertValidId, type IdKind } from './ids.ts';
import { parseSemVer, satisfies } from './versions.ts';

/**
 * Why registry resolution failed.
 *
 * Every code names a declaration conflict a bundle author can fix — a missing dependency, an
 * unsatisfied version range, a duplicate contribution with no replacement policy.
 */
export type RegistryErrorCode =
  | 'invalid-id'
  | 'invalid-version'
  | 'duplicate-extension'
  | 'id-collision'
  | 'replacement-target-missing'
  | 'unauthorized-replacement'
  | 'replacement-version-mismatch'
  | 'ambiguous-replacement'
  | 'missing-dependency'
  | 'dependency-cycle'
  | 'conflict'
  | 'missing-port';

/**
 * A resolution failure naming every responsible party.
 *
 * Thrown rather than returned: an unresolvable registry is a build-time composition mistake, and
 * an engine running with a half-resolved registry would fail later in ways that do not point back
 * to the bundle that caused it.
 */
export class RegistryError extends Error {
  constructor(
    readonly code: RegistryErrorCode,
    message: string,
    /** Stable identities responsible for the failure (extensions, ids). */
    readonly responsible: readonly string[] = []
  ) {
    super(message);
    this.name = 'RegistryError';
  }
}

/** How a base contribution permits replacement by other bundles. */
export type ReplacementPolicy =
  | { readonly kind: 'none' } // default: any competing replacement fails
  | { readonly kind: 'single' } // exactly one authorized replacer allowed
  | { readonly kind: 'priority' }; // highest unique `replaces.priority` wins

/** One thing a bundle contributes: a command, a query, a schema, a port, keyed by `(kind, id)`. */
export interface Contribution {
  readonly kind: Exclude<IdKind, 'extension' | 'origin' | 'result'>;
  readonly id: string;
  readonly version: string;
  /** If set, this contribution replaces an existing base contribution. */
  readonly replaces?: {
    readonly targetId: string;
    readonly targetRange: string;
    readonly priority?: number;
  };
  /** Policy this contribution exposes to would-be replacers (default `none`). */
  readonly replaceable?: ReplacementPolicy;
  readonly payload?: unknown;
}

/**
 * A unit of engine functionality: its identity, version, dependencies, conflicts, required ports,
 * and contributions.
 *
 * The registry's whole input. Everything a bundle needs and everything it offers is DECLARED, so
 * resolution can be deterministic and order-independent.
 */
export interface FeatureBundle {
  readonly id: string;
  readonly version: string;
  readonly dependencies?: readonly string[];
  readonly conflicts?: readonly string[];
  readonly requiredPorts?: readonly string[];
  readonly contributions: readonly Contribution[];
}

/** The resolved result: every contribution selected, indexed by `(kind, id)`. */
export interface ResolvedRegistry {
  readonly extensions: ReadonlyMap<string, FeatureBundle>;
  readonly contributions: ReadonlyMap<string, Contribution>;
  get(kind: Contribution['kind'], id: string): Contribution | undefined;
}

const contribKey = (kind: string, id: string): string => `${kind}:${id}`;

/** How resolution treats optional bundles and replacement policies. */
export interface ResolveOptions {
  /** Runtime port ids available in this environment (design D9 / task 0.3). */
  readonly availablePorts?: readonly string[];
}

/**
 * Resolve a set of bundles into one registry, or throw.
 *
 * Deterministic and registration-order independent: selection is by `(kind, id)` plus version,
 * and ties break only on declared policy. Array order never decides anything.
 *
 * @throws RegistryError naming every bundle responsible for the failure.
 */
export function resolve(
  bundles: readonly FeatureBundle[],
  options: ResolveOptions = {}
): ResolvedRegistry {
  // 1. Validate identity and version; reject duplicate extensions.
  const extensions = new Map<string, FeatureBundle>();
  for (const b of bundles) {
    assertValidId(b.id, 'extension');
    parseSemVerOrThrow(b.version, b.id);
    if (extensions.has(b.id)) {
      throw new RegistryError('duplicate-extension', `duplicate extension id ${b.id}`, [b.id]);
    }
    extensions.set(b.id, b);
    for (const c of b.contributions) {
      assertValidId(c.id, c.kind);
      parseSemVerOrThrow(c.version, `${b.id} → ${c.id}`);
      if (c.replaces)
        parseRangeOrThrow(c.replaces.targetRange, `${b.id} → replaces ${c.replaces.targetId}`);
    }
  }

  // 2. Missing dependencies + conflicts (deterministic, sorted messages).
  for (const b of bundles) {
    for (const dep of b.dependencies ?? []) {
      if (!extensions.has(dep)) {
        throw new RegistryError('missing-dependency', `${b.id} requires missing extension ${dep}`, [
          b.id,
          dep,
        ]);
      }
    }
    for (const conflict of b.conflicts ?? []) {
      if (extensions.has(conflict)) {
        const pair = [b.id, conflict].sort();
        throw new RegistryError('conflict', `extensions ${pair[0]} and ${pair[1]} conflict`, pair);
      }
    }
  }

  // 3. Dependency cycle detection (order-independent DFS over sorted edges).
  detectCycle(extensions);

  // 4. Required ports must be available.
  const providedPorts = new Set<string>(options.availablePorts ?? []);
  for (const b of bundles) {
    for (const c of b.contributions) {
      if (c.kind === 'runtimePort') providedPorts.add(c.id);
    }
  }
  for (const b of bundles) {
    for (const port of b.requiredPorts ?? []) {
      if (!providedPorts.has(port)) {
        throw new RegistryError('missing-port', `${b.id} requires unavailable port ${port}`, [
          b.id,
          port,
        ]);
      }
    }
  }

  // 5. Partition contributions into base and replacements; owning extension per id.
  const owner = new Map<string, string>(); // contribKey -> extension id
  const base = new Map<string, Contribution>(); // contribKey -> base contribution
  const replacers = new Map<string, { ext: string; c: Contribution }[]>(); // targetKey -> replacers

  for (const b of bundles) {
    for (const c of b.contributions) {
      const key = contribKey(c.kind, c.id);
      if (c.replaces) {
        const targetKey = contribKey(c.kind, c.replaces.targetId);
        const list = replacers.get(targetKey) ?? [];
        list.push({ ext: b.id, c });
        replacers.set(targetKey, list);
        continue;
      }
      // Non-replacement contribution: collision if the (kind,id) already exists.
      if (base.has(key)) {
        const pair = [owner.get(key)!, b.id].sort();
        throw new RegistryError(
          'id-collision',
          `${c.kind} id ${c.id} registered by both ${pair[0]} and ${pair[1]}`,
          pair
        );
      }
      base.set(key, c);
      owner.set(key, b.id);
    }
  }

  // 6. Resolve replacements against their targets.
  const resolved = new Map<string, Contribution>(base);
  for (const [targetKey, list] of replacers) {
    const target = base.get(targetKey);
    if (!target) {
      const first = list[0];
      throw new RegistryError(
        'replacement-target-missing',
        `${first.ext} replaces missing target ${first.c.replaces!.targetId}`,
        [first.ext, first.c.replaces!.targetId]
      );
    }
    const policy = target.replaceable ?? { kind: 'none' };

    for (const { ext, c } of list) {
      if (!satisfies(target.version, c.replaces!.targetRange)) {
        throw new RegistryError(
          'replacement-version-mismatch',
          `${ext} replaces ${c.replaces!.targetId}@${target.version} outside range ${c.replaces!.targetRange}`,
          [ext, c.replaces!.targetId]
        );
      }
      if (policy.kind === 'none') {
        throw new RegistryError(
          'unauthorized-replacement',
          `${c.replaces!.targetId} does not authorize replacement (attempted by ${ext})`,
          [ext, c.replaces!.targetId]
        );
      }
    }

    const winner = pickReplacementWinner(target, list);
    resolved.set(targetKey, winner);
  }

  const registry: ResolvedRegistry = {
    extensions,
    contributions: resolved,
    get: (kind, id) => resolved.get(contribKey(kind, id)),
  };
  return registry;
}

function pickReplacementWinner(
  target: Contribution,
  list: { ext: string; c: Contribution }[]
): Contribution {
  const policy = target.replaceable ?? { kind: 'none' };
  if (list.length === 1) return list[0].c;

  if (policy.kind === 'priority') {
    const ranked = [...list].sort(
      (a, b) => (b.c.replaces!.priority ?? 0) - (a.c.replaces!.priority ?? 0)
    );
    const top = ranked[0].c.replaces!.priority ?? 0;
    const tied = ranked.filter((r) => (r.c.replaces!.priority ?? 0) === top);
    if (tied.length > 1) {
      const names = tied.map((r) => r.ext).sort();
      throw new RegistryError(
        'ambiguous-replacement',
        `multiple replacers of ${target.id} share top priority ${top}: ${names.join(', ')}`,
        names
      );
    }
    return ranked[0].c;
  }

  // policy 'single' (or default) with >1 replacer is ambiguous.
  const names = list.map((r) => r.ext).sort();
  throw new RegistryError(
    'ambiguous-replacement',
    `multiple replacers of ${target.id}: ${names.join(', ')}`,
    names
  );
}

function detectCycle(extensions: Map<string, FeatureBundle>): void {
  const WHITE = 0;
  const GREY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const stack: string[] = [];

  const visit = (id: string): void => {
    color.set(id, GREY);
    stack.push(id);
    const deps = [...(extensions.get(id)?.dependencies ?? [])].sort();
    for (const dep of deps) {
      const c = color.get(dep) ?? WHITE;
      if (c === GREY) {
        const from = stack.indexOf(dep);
        const cycle = [...stack.slice(from), dep];
        throw new RegistryError(
          'dependency-cycle',
          `dependency cycle: ${cycle.join(' -> ')}`,
          cycle
        );
      }
      if (c === WHITE) visit(dep);
    }
    stack.pop();
    color.set(id, BLACK);
  };

  for (const id of [...extensions.keys()].sort()) {
    if ((color.get(id) ?? WHITE) === WHITE) visit(id);
  }
}

function parseSemVerOrThrow(version: string, who: string): void {
  try {
    parseSemVer(version);
  } catch {
    throw new RegistryError(
      'invalid-version',
      `invalid version ${JSON.stringify(version)} in ${who}`,
      [who]
    );
  }
}

function parseRangeOrThrow(range: string, who: string): void {
  try {
    // `satisfies` parses the range; use a throwaway version to force parsing.
    satisfies('0.0.0', range);
  } catch {
    throw new RegistryError(
      'invalid-version',
      `invalid version range ${JSON.stringify(range)} in ${who}`,
      [who]
    );
  }
}
