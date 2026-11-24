import type { ReactNode } from 'react';
// The "⋯" control: everything the row could not hold, one press away.
//
// COMMAND ROWS REUSE ENGINE STATE. Each command row goes through `useEditorCommand` and
// the chrome registry for icon, label, enabled/active, and disabled reason — the same
// source as `ToolbarButton` and `Menu.Item`. They render as ordinary buttons inside a
// non-modal dialog popover so value-bearing controls (font pickers, steppers) can keep
// their combobox/input semantics and natural Tab traversal.
//
// VALUE CONTROLS STAY CONTROLS. Font family, size, colour splits, zoom, line spacing,
// the style picker and editing-mode pill render in labelled rows with their real parts.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  chromeSlotIsToggle,
  hasOpenNestedPopup,
  listenForOutsidePress,
  listenForPopupEscape,
  listenForPopupFocusLeave,
  type ChromeSlotId,
} from '@docx-editor.dev/core/editor';
import { useNavigationViewportElement } from '../navigation/navigation-layout';
import { useEditorCommand } from '../useEditorCommand';
import { usePlatformShortcut } from '../usePlatformShortcut';
import { useToolbarLabel } from './toolbar-context';
import { chromeControlForSlot, chromeIcon, guardToolbarMousedown } from './ToolbarButton';
import { MORE_ATTRIBUTE } from './useToolbarOverflow';
import { toolbarPanelPlacement, type ToolbarPanelPlacement } from '@docx-editor.dev/core/editor';

/**
 * `more_horiz`. Here rather than in the registry for the reason the context menu's icons
 * are: the trigger is not a chrome slot, and giving it one would put a dead control in the
 * default arrangement. Material Symbols (Google, Apache-2.0), viewBox "0 -960 960 960".
 */
export const MORE_PATHS: readonly string[] = [
  'M240-400q-33 0-56.5-23.5T160-480q0-33 23.5-56.5T240-560q33 0 56.5 23.5T320-480q0 33-23.5 56.5T240-400Zm240 0q-33 0-56.5-23.5T400-480q0-33 23.5-56.5T480-560q33 0 56.5 23.5T560-480q0 33-23.5 56.5T480-400Zm240 0q-33 0-56.5-23.5T640-480q0-33 23.5-56.5T720-560q33 0 56.5 23.5T800-480q0 33-23.5 56.5T720-400Z',
];

/** One collapsed group in the panel: the registry's label, and the group's rows. */
export interface ToolbarOverflowSection {
  readonly id: string;
  readonly labelKey: string;
  /** Display text that wins over `labelKey`, for a host group. */
  readonly label?: string;
  readonly children: ReactNode;
}

export interface ToolbarOverflowProps {
  readonly sections: readonly ToolbarOverflowSection[];
  readonly className?: string;
}

interface OverflowPanelContextValue {
  readonly close: (focusTrigger: boolean) => void;
}

const OverflowPanelContext = createContext<OverflowPanelContextValue>({
  close: () => {},
});

/**
 * Closes the "⋯" panel from a row inside it. `focusTrigger` returns focus to the trigger,
 * which a keyboard activation needs because the focused row unmounts.
 */
export function useToolbarOverflowClose(): (focusTrigger: boolean) => void {
  return useContext(OverflowPanelContext).close;
}

/** Focus the first tabbable control inside the panel. */
function focusFirstInteractive(panel: HTMLElement): void {
  const selector =
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  panel.querySelector<HTMLElement>(selector)?.focus();
}

/**
 * A labelled row for a control that shows a value: the part itself, with the name the
 * registry gives it, because a font picker with no label in a vertical list is a mystery.
 */
export function ToolbarOverflowControl({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="docx-toolbar__more-control">
      <span className="docx-toolbar__more-control-label">{label}</span>
      <span className="docx-toolbar__more-control-body">{children}</span>
    </div>
  );
}

/**
 * One chrome command in the overflow panel: ordinary button semantics, shared engine state.
 */
export function ToolbarOverflowItem({ slot }: { readonly slot: ChromeSlotId }) {
  const label = useToolbarLabel();
  const shortcut = usePlatformShortcut();
  const { close } = useContext(OverflowPanelContext);
  const { execute, isActive, isEnabled, disabledReason, value } = useEditorCommand(slot);
  const control = chromeControlForSlot(slot);
  // The same three answers the in-bar button renders, because on a narrow window this IS the
  // button: the toggle rule is the engine's (`chromeSlotIsToggle`), `data-value` is what
  // tells a locked format painter apart from an armed one, and the label is corrected for
  // this keyboard.
  const isToggle = chromeSlotIsToggle(slot);
  const text = shortcut(label(control?.labelKey ?? slot));

  return (
    <button
      type="button"
      className="docx-toolbar__more-command"
      data-slot={slot}
      disabled={!isEnabled}
      {...(disabledReason ? { title: disabledReason } : {})}
      {...(isToggle ? { 'aria-pressed': isActive } : {})}
      {...(isActive ? { 'data-active': '' } : {})}
      {...(value !== null ? { 'data-value': value } : {})}
      onMouseDown={guardToolbarMousedown}
      onClick={(event) => {
        execute();
        // Keyboard activation unmounts the focused row, so return focus to the trigger.
        // A pointer click keeps the editor selection focused through the mousedown guard.
        close(event.detail === 0);
      }}
    >
      <span className="docx-toolbar__more-command-icon" aria-hidden="true">
        {chromeIcon(control?.paths)}
      </span>
      <span className="docx-toolbar__more-command-label">{text}</span>
    </button>
  );
}

/** The trigger and its panel. Rendered by the toolbar only when something overflowed. */
export function ToolbarOverflow({ sections, className }: ToolbarOverflowProps) {
  const label = useToolbarLabel();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const focusOnOpenRef = useRef(false);
  const panelId = useId();
  const viewport = useNavigationViewportElement();
  const viewportRef = useRef(viewport);
  viewportRef.current = viewport;
  const text = label('formattingBar.more');

  const close = useCallback((focusTrigger: boolean) => {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }, []);

  const panelContext = useMemo<OverflowPanelContextValue>(() => ({ close }), [close]);

  // Capture before the surface cancels compatibility mouse events or stops propagation.
  useEffect(() => {
    if (!open) return undefined;
    const root = rootRef.current;
    // Escape in the capture phase, ahead of the surface: a click opens the panel with focus
    // left in the pages, and the surface would spend the key on its own mode first. An open
    // nested popup (a table menu, a picker) takes this Escape, and the panel stays open.
    const contains = (node: Node) =>
      rootRef.current?.contains(node) === true || panelRef.current?.contains(node) === true;
    const stopEscape = root
      ? listenForPopupEscape({
          popup: root,
          contains,
          chromeRoot: () => rootRef.current?.closest('.docx-editor'),
          editorElements: () => [viewportRef.current],
          skip: () => hasOpenNestedPopup(panelRef.current),
          close,
        })
      : undefined;
    // Focus that leaves the panel, such as Ctrl+F into the find field, closes it.
    const stopFocus = root
      ? listenForPopupFocusLeave({ popup: root, contains, close: () => setOpen(false) })
      : undefined;
    const stopPress = listenForOutsidePress({ popup: root, close: () => setOpen(false) });
    return () => {
      stopPress();
      stopEscape?.();
      stopFocus?.();
    };
  }, [open, close]);

  // Clamped into the viewport. The stylesheet lines the panel up with the trigger's end,
  // which runs off the left edge when the bar is centered or narrow. Measured in a layout
  // effect so the browser never paints the unclamped panel, and again on resize.
  const [placement, setPlacement] = useState<ToolbarPanelPlacement | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setPlacement(null);
      return undefined;
    }
    const place = (): void => {
      const root = rootRef.current;
      const panel = panelRef.current;
      const trigger = triggerRef.current;
      const view = root?.ownerDocument.defaultView;
      if (!root || !panel || !trigger || !view) return;
      const rect = trigger.getBoundingClientRect();
      const next = toolbarPanelPlacement({
        triggerLeft: rect.left,
        triggerRight: rect.right,
        panelWidth: panel.offsetWidth,
        viewportWidth: view.innerWidth,
      });
      // In the root's own coordinates, because the panel is positioned against it.
      const left = next.left - root.getBoundingClientRect().left;
      setPlacement((current) =>
        current &&
        current.left === left &&
        current.maxWidth === next.maxWidth &&
        current.anchor === next.anchor
          ? current
          : { ...next, left }
      );
    };
    place();
    const view = rootRef.current?.ownerDocument.defaultView;
    view?.addEventListener('resize', place);
    return () => view?.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    if (!open || !focusOnOpenRef.current) return;
    focusOnOpenRef.current = false;
    const panel = panelRef.current;
    if (panel) focusFirstInteractive(panel);
  }, [open]);

  const onPanelKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    close(true);
  };

  return (
    <div
      ref={rootRef}
      className={`docx-toolbar__more${className ? ` ${className}` : ''}`}
      {...{ [MORE_ATTRIBUTE]: '' }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="docx-toolbar__button docx-toolbar__more-trigger"
        data-slot="toolbar.more"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={text}
        title={text}
        {...(open ? { 'data-active': '' } : {})}
        onMouseDown={guardToolbarMousedown}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown') return;
          event.preventDefault();
          focusOnOpenRef.current = true;
          setOpen(true);
        }}
      >
        {chromeIcon(MORE_PATHS)}
      </button>
      {open ? (
        <OverflowPanelContext.Provider value={panelContext}>
          <div
            ref={panelRef}
            id={panelId}
            role="dialog"
            aria-label={text}
            className="docx-toolbar__more-panel"
            data-testid="toolbar-overflow-panel"
            {...(placement ? { 'data-anchor': placement.anchor } : {})}
            style={
              placement
                ? {
                    left: placement.left,
                    right: 'auto',
                    maxInlineSize: placement.maxWidth,
                  }
                : undefined
            }
            onKeyDown={onPanelKeyDown}
          >
            {sections.map((section) => (
              <div
                key={section.id}
                className="docx-toolbar__more-section"
                role="group"
                aria-label={section.label ?? label(section.labelKey)}
              >
                <span className="docx-toolbar__more-heading" aria-hidden="true">
                  {section.label ?? label(section.labelKey)}
                </span>
                {section.children}
              </div>
            ))}
          </div>
        </OverflowPanelContext.Provider>
      ) : null}
    </div>
  );
}
