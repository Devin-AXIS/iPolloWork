// Shared bounded tree walk for drawing projection — iterative stack, no recursive descent.

import { MC_NAMESPACE_URI } from './ooxml-shared.ts';
import type { OoxmlElement, OoxmlGenericElementNode, OoxmlNode } from './ooxml-tree.ts';

export interface DrawingProjectionLimits {
  readonly maxCompatibilityBranches: number;
  readonly maxVisitedElements: number;
  readonly maxDrawingDepth: number;
}

export interface DrawingDiagnostic {
  readonly code:
    | 'malformed-drawing'
    | 'unsupported-graphic'
    | 'unresolvable-frame'
    | 'invalid-geometry'
    | 'resource-refused'
    | 'wrap-polygon-over-limit'
    | 'wrap-polygon-malformed';
  readonly nodeId: string;
  readonly detail: string | null;
}

export interface WalkState {
  compatibilityBranches: number;
  visited: number;
  depth: number;
  refused: boolean;
  compatibilityBranchNodeId: string | null;
  readonly diagnostics: DrawingDiagnostic[];
}

export function createWalkState(): WalkState {
  return {
    compatibilityBranches: 0,
    visited: 0,
    depth: 0,
    refused: false,
    compatibilityBranchNodeId: null,
    diagnostics: [],
  };
}

/** @internal */
export function isElement(node: OoxmlNode): node is OoxmlElement {
  return node.kind !== 'textValue';
}

export function isMcAlternateContent(node: OoxmlNode): node is OoxmlGenericElementNode {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === MC_NAMESPACE_URI &&
    node.localName === 'AlternateContent'
  );
}

export function isMcChoice(node: OoxmlNode): boolean {
  return (
    node.kind === 'generic' && node.namespaceUri === MC_NAMESPACE_URI && node.localName === 'Choice'
  );
}

export function isMcFallback(node: OoxmlNode): boolean {
  return (
    node.kind === 'generic' &&
    node.namespaceUri === MC_NAMESPACE_URI &&
    node.localName === 'Fallback'
  );
}

/** Merge element-authored namespace bindings onto an inherited scope map. */
export function namespaceScopeForNode(
  inherited: ReadonlyMap<string, string>,
  node: OoxmlElement
): ReadonlyMap<string, string> {
  if (node.namespaceBindings.length === 0) return inherited;
  const next = new Map(inherited);
  for (const binding of node.namespaceBindings) {
    next.set(binding.prefix, binding.namespaceUri);
  }
  return next;
}

const EMPTY_SCOPE: ReadonlyMap<string, string> = new Map();

export function emptyNamespaceScope(): ReadonlyMap<string, string> {
  return EMPTY_SCOPE;
}

function visitNode(state: WalkState, limits: DrawingProjectionLimits): boolean {
  state.visited += 1;
  if (state.visited > limits.maxVisitedElements) {
    state.refused = true;
    return false;
  }
  return true;
}

type WalkAction = 'continue' | 'skip-children' | 'stop';

interface WalkFrame {
  readonly node: OoxmlElement;
  readonly depth: number;
}

/**
 * Iterative depth-first walk. Every element visit counts toward `maxVisitedElements`;
 * every descent increments depth against `maxDrawingDepth`.
 */
export function walkElementsBounded(
  roots: readonly OoxmlNode[],
  state: WalkState,
  limits: DrawingProjectionLimits,
  visit: (node: OoxmlElement, depth: number) => WalkAction
): void {
  const stack: WalkFrame[] = [];
  for (let index = roots.length - 1; index >= 0; index -= 1) {
    const root = roots[index];
    if (isElement(root)) stack.push({ node: root, depth: 0 });
  }
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (!visitNode(state, limits)) return;
    const action = visit(frame.node, frame.depth);
    if (action === 'stop') return;
    if (action === 'skip-children') continue;
    if (frame.depth >= limits.maxDrawingDepth) {
      state.refused = true;
      continue;
    }
    for (let index = frame.node.children.length - 1; index >= 0; index -= 1) {
      const child = frame.node.children[index];
      if (isElement(child)) stack.push({ node: child, depth: frame.depth + 1 });
    }
  }
}

/** Direct-child scan only — never crosses demotion boundaries. */
export function findDirectKind<T extends string>(
  nodes: readonly OoxmlNode[],
  kind: T
): Extract<OoxmlElement, { kind: T }> | null {
  for (const node of nodes) {
    if (!isElement(node)) continue;
    if (node.kind === kind) return node as Extract<OoxmlElement, { kind: T }>;
  }
  return null;
}

/** Bounded search for a typed kind under `root` (includes root). */
export function findTypedKindBounded(
  root: OoxmlElement,
  kind: string,
  state: WalkState,
  limits: DrawingProjectionLimits
): OoxmlElement | null {
  let found: OoxmlElement | null = null;
  walkElementsBounded([root], state, limits, (node) => {
    if (node.kind === kind) {
      found = node;
      return 'stop';
    }
    return 'continue';
  });
  return found;
}
