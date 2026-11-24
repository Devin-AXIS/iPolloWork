import { trapTabWithin } from '@docx-editor.dev/core/editor';
import { useDocxEditor } from './context';
import { deferredNotifier } from './useEditorState';
import {
  Children,
  Fragment,
  cloneElement,
  createContext,
  isValidElement,
  useContext,
  useLayoutEffect,
  useEffect,
  useCallback,
  useSyncExternalStore,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, KeyboardEvent, ReactElement, ReactNode, RefObject } from 'react';
import { Slot } from './toolbar/Slot';
import { useChromeDark } from './color-mode-context';
import type { DocxEditorChildren } from '../docx-editor-children';

/**
 * Presentation overrides for a dialog part. @public
 *
 * Anything beyond these members reaches the rendered element, so a part takes an `id`,
 * an `aria-*` label or a `data-*` test hook. The part's own wiring wins every collision:
 * a host cannot replace Apply's handler or its `data-docx-part` marker by passing one.
 * To own the element and its handler outright, pass `asChild` and supply your own.
 */
export interface DialogPartProps {
  className?: string;
  style?: CSSProperties;
  hidden?: boolean;
  asChild?: boolean;
  children?: DocxEditorChildren;
  id?: string;
  title?: string;
  'aria-label'?: string;
  [attribute: `data-${string}`]: unknown;
}

/** Layout customization for a packaged dialog. @public */
export interface DialogCustomizationProps {
  className?: string;
  style?: CSSProperties;
  /** Render the default arrangement, replacing named children in place. Defaults to true. */
  preset?: boolean;
  children?: DocxEditorChildren;
}

/** State shared by a dialog's controls. @public */
export interface UseDialogReturn<Fields extends object> {
  readonly values: Fields;
  setValue<K extends keyof Fields>(name: K, value: Fields[K]): void;
  readonly errors: Readonly<Partial<Record<keyof Fields | 'form', string>>>;
  readonly isEnabled: boolean;
  apply(): void;
  cancel(): void;
}

type NodeProps = Record<string, unknown> & { children?: ReactNode };
const marker = (props: NodeProps): string | null => {
  const part = props['data-docx-part'];
  return typeof part === 'string'
    ? part === 'field'
      ? `field:${props['data-docx-field']}`
      : part
    : null;
};

/** Adapter-local renderer; document state remains in the dialog controller. */
export function createDialogParts<Name extends string, State>() {
  const Context = createContext<{
    defaults: Map<string, ReactElement<NodeProps>>;
    overrides: Map<string, ReactElement<DialogPartProps>>;
    state: State;
  } | null>(null);
  const identities = new Map<unknown, string>();
  const keyOf = (node: ReactElement<NodeProps>) => {
    const part = identities.get(node.type);
    return part === 'field' ? `field:${node.props.name}` : part;
  };
  function visit(nodes: ReactNode, callback: (node: ReactElement<NodeProps>) => void) {
    Children.forEach(nodes, (node) => {
      if (!isValidElement<NodeProps>(node)) return;
      callback(node);
      visit(node.props.children, callback);
    });
  }
  function useState(): State {
    const context = useContext(Context);
    if (!context)
      throw new globalThis.Error('Dialog controls must be rendered inside their dialog.');
    return context.state;
  }
  function replace(
    nodes: ReactNode,
    overrides: Map<string, ReactElement<DialogPartProps>>
  ): ReactNode {
    return Children.map(nodes, (node) => {
      if (!isValidElement<NodeProps>(node)) return node;
      const key = marker(node.props);
      if (key && overrides.has(key)) return overrides.get(key);
      return node.props.children === undefined
        ? node
        : cloneElement(node, {
            children: replace(node.props.children, overrides),
          });
    });
  }
  function makePart(part: string) {
    function Part(props: DialogPartProps & { name?: Name }) {
      const context = useContext(Context);
      if (!context || props.hidden) return null;
      const key = part === 'field' ? `field:${props.name}` : part;
      const original = context.defaults.get(key);
      if (!original) return props.children ?? null;
      // `hidden` and `name` steer this component; they are not element attributes.
      const { children, asChild, className, style, hidden: _hidden, name: _name, ...rest } = props;
      const shared = {
        ...rest,
        // The part's own wiring outranks anything the host passed, so a stray `onClick`
        // or `data-docx-part` cannot silently detach the control from the dialog.
        ...original.props,
        className: [original.props.className, className].filter(Boolean).join(' '),
        style: { ...(original.props.style as CSSProperties), ...style },
      };
      if (asChild) {
        // The host owns the element's look: forward the wiring and the host's own
        // presentation props, never the packaged `docx-dialog__*` classes, so a design
        // system button styled by single-class utilities is not outranked by the defaults.
        const {
          children: _defaultChildren,
          className: _presetClassName,
          style: _presetStyle,
          ...wiring
        } = shared;
        return (
          <Slot {...wiring} {...(className ? { className } : {})} {...(style ? { style } : {})}>
            {children}
          </Slot>
        );
      }
      return cloneElement(
        original,
        shared,
        children === undefined ? replace(original.props.children, context.overrides) : children
      );
    }
    identities.set(Part, part);
    return Part;
  }
  const Header = makePart('header');
  const Title = makePart('title');
  const Body = makePart('body');
  const Footer = makePart('footer');
  const Apply = makePart('apply');
  const Cancel = makePart('cancel');
  const Reset = makePart('reset');
  const Error = makePart('error');
  const Field = makePart('field') as (props: DialogPartProps & { name: Name }) => ReactNode;
  function Composition({
    defaults,
    children,
    preset = true,
    state,
  }: {
    defaults: ReactNode;
    children?: ReactNode;
    preset?: boolean;
    state: State;
  }) {
    const defaultMap = new Map<string, ReactElement<NodeProps>>();
    visit(defaults, (node) => {
      const key = marker(node.props);
      if (key) defaultMap.set(key, node);
    });
    const overrides = new Map<string, ReactElement<DialogPartProps>>();
    visit(children, (node) => {
      const key = keyOf(node);
      if (key) overrides.set(key, node as ReactElement<DialogPartProps>);
    });
    const flatten = (nodes: ReactNode): ReactNode[] =>
      Children.toArray(nodes).flatMap((node) =>
        isValidElement<NodeProps>(node) && node.type === Fragment
          ? flatten(node.props.children)
          : [node]
      );
    const extras = flatten(children).filter(
      (node) => !isValidElement<NodeProps>(node) || !keyOf(node)
    );
    return (
      <Context.Provider value={{ defaults: defaultMap, overrides, state }}>
        {preset ? (
          <>
            {replace(defaults, overrides)}
            {extras}
          </>
        ) : (
          children
        )}
      </Context.Provider>
    );
  }
  return {
    Header,
    Title,
    Body,
    Footer,
    Apply,
    Cancel,
    Reset,
    Error,
    Field,
    Composition,
    useState,
    /** A dialog-specific part, matched to the default element with this `data-docx-part`. */
    part: (name: string) => makePart(name) as (props: DialogPartProps) => ReactNode,
  };
}

/** Native modal lifecycle shared by packaged dialog renderers. */
export function DialogFrame({
  kind,
  role = 'dialog',
  className,
  style,
  label,
  onClose,
  onKeyDown,
  panelRef,
  children,
  dismissOutside = true,
  sessionSignal,
  restoreFocus = true,
  describedBy,
  busy,
}: {
  kind:
    | 'revisionMarkup'
    | 'compareDocuments'
    | 'pageSetup'
    | 'paragraph'
    | 'watermark'
    | 'bookmark'
    | 'splitCell'
    | 'textFormField'
    | 'invalidTextFormField'
    | 'imageInsertError'
    | 'export'
    | 'print'
    | 'openFailure';
  role?: 'dialog' | 'alertdialog';
  className?: string;
  style?: CSSProperties;
  label: string;
  onClose(): void;
  children: ReactNode;
  onKeyDown?: (event: KeyboardEvent<HTMLDialogElement>) => void;
  panelRef?: RefObject<HTMLDialogElement | null>;
  dismissOutside?: boolean;
  sessionSignal?: AbortSignal;
  restoreFocus?: boolean;
  /** The id of the element that describes the dialog, such as an alert's message. */
  describedBy?: string;
  /** True while the dialog works, such as during a compare. */
  busy?: boolean;
}) {
  const ownRef = useRef<HTMLDialogElement | null>(null);
  const ref = panelRef ?? ownRef;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // Rendered through `className`, not `classList.add`: React rewrites `class` whenever the
  // host's `className` changes, such as on a colour-mode switch, and would drop it.
  const [ownScope, setOwnScope] = useState(false);
  const chromeDark = useChromeDark();
  useLayoutEffect(() => {
    const panel = ref.current;
    if (!panel) return;
    setOwnScope(!panel.parentElement?.closest('.docx-editor'));
    // The page itself is no opener: restoring it would take focus from the editor.
    const active = panel.ownerDocument.activeElement as HTMLElement | null;
    const opener = active === panel.ownerDocument.body ? null : active;
    const closeNative = () => {
      if (panel.open) panel.close?.();
    };
    sessionSignal?.addEventListener('abort', closeNative);
    if (typeof panel.showModal === 'function') panel.showModal();
    else panel.setAttribute('open', ''); // DOM test environments; browsers use native modality.
    // A link takes focus only when the dialog has no control, such as an alert whose one
    // action is a support link.
    (
      panel.querySelector<HTMLElement>(
        'input:not([disabled]),select:not([disabled]),button:not([disabled]),[tabindex="0"]'
      ) ?? panel.querySelector<HTMLElement>('a[href]')
    )?.focus({ preventScroll: true });
    return () => {
      sessionSignal?.removeEventListener('abort', closeNative);
      if (typeof panel.close === 'function' && panel.open) panel.close();
      if (restoreFocus && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [ref, sessionSignal, restoreFocus]);
  return (
    <dialog
      ref={ref}
      role={role}
      aria-modal="true"
      aria-label={label}
      aria-describedby={describedBy}
      // A styling hook only: aria-busy on the whole modal would hold back its live regions.
      data-docx-busy={busy ? '' : undefined}
      className={`docx-dialog${ownScope ? ` docx-editor${chromeDark ? ' dark' : ''}` : ''}${className ? ` ${className}` : ''}`}
      style={style}
      data-docx-dialog={kind}
      onCancel={(event) => {
        event.preventDefault();
        closeRef.current();
      }}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        if (dismissOutside && event.target === event.currentTarget) {
          const rect = event.currentTarget.getBoundingClientRect();
          if (
            event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom
          )
            closeRef.current();
        }
        event.stopPropagation();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.nativeEvent.isComposing) {
          event.preventDefault();
          closeRef.current();
        } else if (trapTabWithin(event.currentTarget, event.nativeEvent)) event.preventDefault();
        else if (!event.nativeEvent.isComposing && !event.defaultPrevented) onKeyDown?.(event);
        event.stopPropagation();
      }}
    >
      {children}
    </dialog>
  );
}

/** Prevent a retained draft from editing a replacement document. */
export function useDialogDocument(open: boolean, onClose: () => void): () => boolean {
  const editor = useDocxEditor();
  const generation = useEditorMountGeneration();
  const draft = useRef<number | null>(null);
  useEffect(() => {
    if (!open) {
      draft.current = null;
      return;
    }
    if (!editor?.surface) return;
    if (draft.current === null) draft.current = editor.mountGeneration;
    else if (draft.current !== editor.mountGeneration) onClose();
  }, [open, editor, generation, onClose]);
  return () => !!editor?.surface && draft.current === editor.mountGeneration;
}

/** Mount identity is independent of equal public snapshots after a reload. */
export function useEditorMountGeneration(): number {
  const editor = useDocxEditor();
  const subscribe = useCallback(
    (changed: () => void) => {
      if (!editor) return () => {};
      let active = true;
      const notify = deferredNotifier(() => {
        if (active) changed();
      });
      const off = [
        editor.on('change', notify),
        editor.on('selectionChange', notify),
        editor.on('error', notify),
      ];
      return () => {
        active = false;
        off.forEach((dispose) => dispose());
      };
    },
    [editor]
  );
  return useSyncExternalStore(
    subscribe,
    () => editor?.mountGeneration ?? 0,
    () => 0
  );
}
