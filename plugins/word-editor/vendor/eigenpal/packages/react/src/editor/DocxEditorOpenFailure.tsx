// The refused-open dialog: what a person sees when the editor cannot open a file.
//
// A refused open leaves the pages blank, so without this part the person sees nothing. It
// reads `snapshot().openFailure`, the same pull state every other consumer reads, so it also
// covers a document passed at construction, before any listener could subscribe.
//
// The default text is generic on purpose. It explains the refusal and shows the stable code,
// and names no contact: the host adds its own support action through `actions`.

import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useCallback,
  useContext,
  useId,
  useState,
} from 'react';
import type { ButtonHTMLAttributes, CSSProperties, MouseEvent, ReactNode } from 'react';
import type {
  DocumentOpenFailure,
  DocumentOpenFailureReason,
  EditorSnapshot,
} from '@docx-editor.dev/core/contracts/editor';
import type { TFunction } from '@docx-editor.dev/i18n';
import type { DocxEditorChildren } from '../docx-editor-children';
import { useTranslation } from '../i18n';
import { isDevelopment } from '../lib/is-development';
import { DialogFrame } from './dialog-parts';
import { Slot } from './toolbar/Slot';
import { useEditorState } from './useEditorState';

const MESSAGE_KEYS = {
  damaged: 'openFailure.reasons.damaged',
  'not-docx': 'openFailure.reasons.notDocx',
  'too-large': 'openFailure.reasons.tooLarge',
  blocked: 'openFailure.reasons.blocked',
  unknown: 'openFailure.reasons.unknown',
} as const satisfies Record<DocumentOpenFailureReason, string>;

/**
 * Whether a `dismiss` argument names an older refusal. Anything that is not a failure, such as
 * the click event of `onClick={dismiss}`, means "the one on screen".
 */
function isStaleFailure(shown: unknown, current: DocumentOpenFailure | null): boolean {
  return typeof shown === 'object' && shown !== null && 'reason' in shown && shown !== current;
}

const selectOpenFailure = (snapshot: EditorSnapshot): DocumentOpenFailure | null =>
  snapshot.openFailure ?? null;

/** The current refused open, with the packaged message and a way to dismiss it. @public */
export interface UseOpenFailureReturn {
  /** The refused open, or `null` when there is none or the person dismissed it. */
  readonly failure: DocumentOpenFailure | null;
  /** The packaged, translated message for {@link UseOpenFailureReturn.failure}. */
  readonly message: string | null;
  /**
   * Hide this refusal. A later refusal shows again, even for the same file. Pass the failure
   * your UI showed, such as from a toast's close callback, so a late call cannot hide a newer
   * refusal. It also works as a click handler directly, such as `onClick={dismiss}`: an event
   * hides the refusal on screen.
   */
  dismiss(failure?: DocumentOpenFailure | Event | { readonly nativeEvent: Event }): void;
}

/** Options for {@link useOpenFailure}. @public */
export interface UseOpenFailureOptions {
  /** Translator override; defaults to the ambient locale context. */
  t?: TFunction;
}

/**
 * Reads the document the editor refused to open, for a host that shows it in its own UI,
 * such as a toast. Pair it with `openFailure={false}` on `<DocxEditor>`, so the packaged
 * dialog does not show as well. Call it inside a `DocxEditor.Root`.
 *
 * ```tsx
 * function OpenFailureToast() {
 *   const { failure, message, dismiss } = useOpenFailure();
 *   if (!failure) return null;
 *   return <Toast title={message} detail={failure.code} onClose={() => dismiss(failure)} />;
 * }
 * ```
 *
 * @public
 */
export function useOpenFailure(options: UseOpenFailureOptions = {}): UseOpenFailureReturn {
  const current = useEditorState(selectOpenFailure);
  const { t: ambient } = useTranslation();
  const t = options.t ?? ambient;
  // Each refusal is a new object, so remembering the dismissed one by reference lets the
  // next refusal of the same file show again.
  const [dismissed, setDismissed] = useState<DocumentOpenFailure | null>(null);
  const failure = current !== null && current !== dismissed ? current : null;
  const dismiss = useCallback(
    (failure?: DocumentOpenFailure | Event | { readonly nativeEvent: Event }) => {
      if (!isStaleFailure(failure, current)) setDismissed(current);
    },
    [current]
  );
  return { failure, message: failure ? t(MESSAGE_KEYS[failure.reason]) : null, dismiss };
}

/** What `actions` and `children` receive. @public */
export interface DocxEditorOpenFailureContext {
  /** The refused open: its stable `code` and its `reason`. */
  readonly failure: DocumentOpenFailure;
  /** The packaged, translated message for the failure. */
  readonly message: string;
  /** Close the dialog. It calls `onDismiss`, as **Close** does. */
  dismiss(): void;
}

const OpenFailureContext = createContext<DocxEditorOpenFailureContext | null>(null);

/** Props for `DocxEditor.OpenFailure.Action`. @public */
export interface DocxEditorOpenFailureActionProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> {
  /** `primary` is filled, `secondary` is outlined. Defaults to `secondary`. */
  variant?: 'primary' | 'secondary';
  /** Close the dialog after `onClick` runs, unless the handler called `preventDefault()`. */
  dismiss?: boolean;
  /** Render your own element, such as a link, with the button's classes and handler. */
  asChild?: boolean;
  children?: DocxEditorChildren;
}

/**
 * A button in the open-failure dialog, styled as the packaged **Close**. Use it in `actions`,
 * or in your own `children`. With `asChild`, it styles your own element instead, such as a
 * link to your support page:
 *
 * ```tsx
 * <DocxEditor.OpenFailure
 *   actions={({ failure }) => (
 *     <DocxEditor.OpenFailure.Action asChild>
 *       <a href={`/support?code=${failure.code}`}>Get help</a>
 *     </DocxEditor.OpenFailure.Action>
 *   )}
 * />
 * ```
 *
 * @public
 */
export function DocxEditorOpenFailureAction({
  variant = 'secondary',
  dismiss = false,
  asChild = false,
  className,
  onClick,
  children,
  type,
  ...rest
}: DocxEditorOpenFailureActionProps) {
  const context = useContext(OpenFailureContext);
  const classes = `docx-dialog__button${
    variant === 'primary' ? ' docx-dialog__button--primary' : ''
  }${className ? ` ${className}` : ''}`;
  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    onClick?.(event);
    if (dismiss && !event.defaultPrevented) context?.dismiss();
  };
  if (asChild) {
    return (
      <Slot {...rest} className={classes} onClick={handleClick as never}>
        {children}
      </Slot>
    );
  }
  return (
    <button {...rest} type={type ?? 'button'} className={classes} onClick={handleClick}>
      {children}
    </button>
  );
}

/**
 * A message for the open-failure dialog: text, content, or a function of the failure. It
 * renders in a `div`, so block content is valid.
 *
 * @public
 */
export type DocxEditorOpenFailureMessage =
  string | DocxEditorChildren | ((failure: DocumentOpenFailure) => string | DocxEditorChildren);

/** Props for `DocxEditor.OpenFailure`. @public */
export interface DocxEditorOpenFailureProps {
  /**
   * The dialog title. Defaults to the translated `openFailure.title`. It also names the dialog
   * for screen readers, including when your own content replaces the packaged one.
   */
  title?: string;
  /** Your own message in place of the packaged one, as content or per failure. */
  message?: DocxEditorOpenFailureMessage;
  /** Show the stable error code under the message. Defaults to `true`. */
  showCode?: boolean;
  /**
   * Your own buttons, before **Close**. Build them from `DocxEditor.OpenFailure.Action` so
   * they match the dialog. The dialog shows no contact of its own.
   */
  actions?: (context: DocxEditorOpenFailureContext) => DocxEditorChildren;
  /** The label of the **Close** button. Defaults to the translated `common.close`. */
  closeLabel?: string;
  /**
   * Show the packaged **Close** button. Defaults to `true`. Turn it off only when `actions`
   * gives a way out. Escape still closes the dialog.
   */
  showClose?: boolean;
  /** Called after the person closes the dialog, by any route. */
  onDismiss?: (failure: DocumentOpenFailure) => void;
  /**
   * Your own dialog content, in place of the packaged header, body and footer. The dialog
   * frame, its focus handling and Escape stay.
   */
  children?: (context: DocxEditorOpenFailureContext) => DocxEditorChildren;
  /** Appended after the load-bearing `docx-dialog` class. */
  className?: string;
  /** Inline styles for the dialog element. */
  style?: CSSProperties;
  /** Translator override; defaults to the ambient locale context. */
  t?: TFunction;
}

const warnedActions = new Set<'both' | 'disabled'>();

/**
 * Warn once, in development, when `renderOpenFailureActions` cannot do what it says: it
 * replaces `openFailure.actions`, and `openFailure={false}` renders no dialog for it.
 */
export function warnOpenFailureActions(
  openFailure: boolean | DocxEditorOpenFailureProps,
  hasRenderProp: boolean
): void {
  if (!hasRenderProp || !isDevelopment()) return;
  const kind =
    openFailure === false
      ? 'disabled'
      : typeof openFailure === 'object' && openFailure.actions
        ? 'both'
        : null;
  if (kind === null || warnedActions.has(kind)) return;
  warnedActions.add(kind);
  console.warn(
    kind === 'both'
      ? '[docx-editor] renderOpenFailureActions replaces openFailure.actions. Pass only one.'
      : '[docx-editor] renderOpenFailureActions is ignored with openFailure={false}, which ' +
          'renders no dialog.'
  );
}

/** Whether rendered actions hold anything: `null`, `false`, `[]` and empty fragments do not. */
function hasContent(node: DocxEditorChildren): boolean {
  return Children.toArray(node).some((child) =>
    isValidElement<{ children?: DocxEditorChildren }>(child) && child.type === Fragment
      ? hasContent(child.props.children)
      : true
  );
}

function DocxEditorOpenFailureImpl({
  title,
  message,
  showCode = true,
  actions,
  closeLabel,
  showClose = true,
  onDismiss,
  children,
  className,
  style,
  t: tProp,
}: DocxEditorOpenFailureProps) {
  const { t: ambient } = useTranslation();
  const t = tProp ?? ambient;
  const { failure, message: packaged, dismiss } = useOpenFailure({ t });
  const messageId = useId();
  if (!failure || packaged === null) return null;

  const close = () => {
    dismiss(failure);
    onDismiss?.(failure);
  };
  const context: DocxEditorOpenFailureContext = { failure, message: packaged, dismiss: close };
  const heading = title ?? t('openFailure.title');
  const body = typeof message === 'function' ? message(failure) : (message ?? packaged);
  const extra = actions?.(context);
  const hasExtra = hasContent(extra);
  return (
    <OpenFailureContext.Provider value={context}>
      <DialogFrame
        kind="openFailure"
        role="alertdialog"
        label={heading}
        className={className}
        style={style}
        onClose={close}
        // An alert asks for a decision: a stray click on the backdrop does not dismiss it.
        dismissOutside={false}
        {...(children ? {} : { describedBy: messageId })}
      >
        {children ? (
          children(context)
        ) : (
          <>
            <header className="docx-dialog__header">
              <h2 className="docx-dialog__title">{heading}</h2>
            </header>
            <div className="docx-dialog__body">
              <div id={messageId} className="docx-dialog__message">
                {body}
              </div>
              {showCode ? (
                <p className="docx-dialog__code">
                  {/* Interpolated locally too: a host bridging a bare `(key) => string` into
                      `t` must not show a literal placeholder. */}
                  {t('openFailure.code', { code: failure.code }).replace('{code}', failure.code)}
                </p>
              ) : null}
            </div>
            {hasExtra || showClose ? (
              <footer className="docx-dialog__footer">
                {extra}
                {showClose ? (
                  // Filled while it is the only button; outlined beside the host's own, so
                  // the host's action reads as the main one.
                  <DocxEditorOpenFailureAction variant={hasExtra ? 'secondary' : 'primary'} dismiss>
                    {closeLabel ?? t('common.close')}
                  </DocxEditorOpenFailureAction>
                ) : null}
              </footer>
            ) : null}
          </>
        )}
      </DialogFrame>
    </OpenFailureContext.Provider>
  );
}

/**
 * The open-failure part with its button attached as a static.
 *
 * @public
 */
export interface DocxEditorOpenFailureComponent {
  /** Renders the dialog while a refused open is waiting, and nothing otherwise. */
  (props: DocxEditorOpenFailureProps): ReactNode;
  /** A button styled for the dialog, for `actions` and custom `children`. */
  readonly Action: typeof DocxEditorOpenFailureAction;
}

/**
 * A dialog that explains why a file did not open. It shows nothing until the editor refuses a
 * document, and shows again for each later refusal. `<DocxEditor>` renders it by default;
 * compose it yourself inside a `DocxEditor.Root`:
 *
 * ```tsx
 * <DocxEditor.Root document={bytes}>
 *   <DocxEditor.OpenFailure
 *     actions={({ failure }) => (
 *       <DocxEditor.OpenFailure.Action variant="primary" onClick={() => report(failure.code)}>
 *         Report
 *       </DocxEditor.OpenFailure.Action>
 *     )}
 *   />
 *   <DocxEditor.Viewport>
 *     <DocxEditor.Content />
 *   </DocxEditor.Viewport>
 * </DocxEditor.Root>
 * ```
 *
 * The packaged message is generic and names no contact. For a toast or banner instead of a
 * dialog, use `useOpenFailure`.
 *
 * @public
 */
export const DocxEditorOpenFailure: DocxEditorOpenFailureComponent = Object.assign(
  DocxEditorOpenFailureImpl,
  { Action: DocxEditorOpenFailureAction }
);
