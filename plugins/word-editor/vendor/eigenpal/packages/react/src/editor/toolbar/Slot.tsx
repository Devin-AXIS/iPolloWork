import type { DocxEditorChildren } from '../../docx-editor-children';
// A minimal `asChild` slot — the Radix pattern, implemented in-tree.
//
// Deliberately NOT a new dependency: the repo does not carry `@radix-ui/react-slot`,
// and this file is the ~40 lines of it the toolbar needs. It clones its single child,
// merging the slot's props INTO the child's: className concatenates, style merges
// (child wins per property), event handlers compose child-first (the slot's handler is
// skipped when the child's called `preventDefault()`), refs fan out to both, and
// everything else — `disabled`, `data-*`, `aria-*` — forwards with the child's own
// value taking precedence.

import { Children, cloneElement, isValidElement } from 'react';
import type { CSSProperties, HTMLAttributes, ReactElement, Ref } from 'react';

type AnyProps = Record<string, unknown>;

function composeHandlers(
  childHandler: unknown,
  slotHandler: unknown
): ((event: Event & { defaultPrevented: boolean }) => void) | unknown {
  if (typeof slotHandler !== 'function') return childHandler;
  if (typeof childHandler !== 'function') return slotHandler;
  return (event: Event & { defaultPrevented: boolean }) => {
    childHandler(event);
    if (!event.defaultPrevented) (slotHandler as (e: unknown) => void)(event);
  };
}

function mergeProps(slotProps: AnyProps, childProps: AnyProps): AnyProps {
  const merged: AnyProps = { ...slotProps, ...childProps };
  for (const key of Object.keys(slotProps)) {
    if (/^on[A-Z]/.test(key)) {
      merged[key] = composeHandlers(childProps[key], slotProps[key]);
    } else if (key === 'className') {
      merged[key] = [slotProps[key], childProps[key]].filter(Boolean).join(' ');
    } else if (key === 'style') {
      merged[key] = { ...(slotProps[key] as object), ...(childProps[key] as object) };
    }
  }
  return merged;
}

export interface SlotProps extends HTMLAttributes<HTMLElement> {
  children?: DocxEditorChildren;
  /** Fanned out alongside the child's own ref. */
  ref?: Ref<unknown>;
  className?: string;
  style?: CSSProperties;
}

/** Renders its single child element with the slot's props merged in. */
export function Slot({ children, ...slotProps }: SlotProps) {
  const child = Children.only(children);
  if (!isValidElement(child)) return null;
  const childProps = child.props as AnyProps;
  const merged = mergeProps(slotProps as AnyProps, childProps);
  // Fan the child's own ref and any slot-level ref out to both consumers.
  const childRef = (child as ReactElement & { ref?: Ref<unknown> }).ref;
  const slotRef = (slotProps as { ref?: Ref<unknown> }).ref;
  if (childRef || slotRef) {
    merged.ref = (node: unknown) => {
      for (const ref of [childRef, slotRef]) {
        if (typeof ref === 'function') ref(node);
        else if (ref && typeof ref === 'object') (ref as { current: unknown }).current = node;
      }
    };
  }
  return cloneElement(child, merged);
}
