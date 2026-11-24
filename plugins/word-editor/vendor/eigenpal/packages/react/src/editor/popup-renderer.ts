import { createElement, Fragment, type ComponentType } from 'react';
import type { DocxEditorChildren } from '../docx-editor-children';

/** A render callback for an automatic popup. `false` disables automatic rendering. @public */
export type DocxEditorPopup<Props extends object> =
  false | ((props: Props) => DocxEditorChildren | null);

/**
 * Register an ordinary component in the `popups` map while preserving its props and hooks.
 * Define the component outside the parent render function to keep its state on rerenders.
 * @public
 */
export function definePopup<Props extends object>(
  component: ComponentType<Props>
): (props: Props) => DocxEditorChildren {
  return (props) => createElement(component, props);
}

const sessionKeys = new WeakMap<object, number>();
let nextSessionKey = 0;

/** @internal Reset custom drafts for new sessions, preserving state during ordinary rerenders. */
export function renderPopup<Props extends object>(
  popup: DocxEditorPopup<Props>,
  props: Props,
  session?: object
): DocxEditorChildren {
  if (popup === false) return null;
  const content = popup(props);
  if (!session) return content;
  let key = sessionKeys.get(session);
  if (key === undefined) sessionKeys.set(session, (key = ++nextSessionKey));
  return createElement(Fragment, { key }, content);
}
