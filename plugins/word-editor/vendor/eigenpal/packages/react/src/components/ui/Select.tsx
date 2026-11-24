/**
 * Select Component (Radix UI + Tailwind)
 *
 * A minimal, accessible select dropdown using Radix UI primitives.
 */

import * as React from 'react';
import * as SelectPrimitive from '@radix-ui/react-select';
import { cn } from '../../lib/utils';
import { hostDocumentOf } from '@docx-editor.dev/core/editor';
import { useChromeDark } from '../../editor/color-mode-context';

/**
 * The open trigger, so the portal lands in the trigger's own document: a select inside an
 * editor in a pop-out window or an iframe must not open its list in the opener.
 */
const SelectTriggerContext = React.createContext<{
  readonly trigger: HTMLButtonElement | null;
  readonly setTrigger: (element: HTMLButtonElement | null) => void;
} | null>(null);

function Select(props: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Root>) {
  const [trigger, setTrigger] = React.useState<HTMLButtonElement | null>(null);
  const value = React.useMemo(() => ({ trigger, setTrigger }), [trigger]);
  return (
    <SelectTriggerContext.Provider value={value}>
      <SelectPrimitive.Root {...props} />
    </SelectTriggerContext.Provider>
  );
}
const SelectGroup = SelectPrimitive.Group;
const SelectValue = SelectPrimitive.Value;

function SelectTrigger({
  className,
  children,
  onMouseDown,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>) {
  const setTrigger = React.useContext(SelectTriggerContext)?.setTrigger;
  return (
    <SelectPrimitive.Trigger
      ref={setTrigger}
      className={cn(
        'flex h-8 items-center justify-between gap-1 rounded px-2 py-1',
        'text-sm text-foreground bg-transparent',
        'hover:bg-muted/80 focus:outline-none focus:bg-muted/80',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'transition-colors duration-150',
        '[&>span]:truncate',
        className
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon asChild>
        <ChevronDownIcon className="h-4 w-4 text-muted-foreground shrink-0" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectContent({
  className,
  children,
  position = 'popper',
  onCloseAutoFocus,
  onKeyDown,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Content>) {
  // Radix renders into a portal outside the editor's `.docx-editor.dark` subtree,
  // so the wrapper must re-assert the theme for tokens to resolve in dark mode.
  const trigger = React.useContext(SelectTriggerContext)?.trigger ?? null;
  const doc =
    typeof globalThis.document === 'undefined' && !trigger ? null : hostDocumentOf(trigger);
  // This editor's theme, not any editor's on the page: the enclosing Root's resolved mode, or
  // a dark scope anywhere around the trigger (a host can still wrap the editor in `.dark`).
  const chromeDark = useChromeDark();
  const isDark = chromeDark || !!trigger?.closest('.docx-editor.dark');
  return (
    <SelectPrimitive.Portal {...(doc?.body ? { container: doc.body } : {})}>
      {/* Wrap in .docx-editor so Tailwind scoped utilities apply inside the portal */}
      <div className={cn('docx-editor', isDark && 'dark')}>
        <SelectPrimitive.Content
          className={cn(
            'relative z-50 max-h-72 min-w-[8rem] overflow-hidden',
            'rounded-lg border border-border bg-popover text-popover-foreground shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
            'data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2',
            position === 'popper' &&
              'data-[side=bottom]:translate-y-1 data-[side=top]:-translate-y-1',
            className
          )}
          position={position}
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            onCloseAutoFocus?.(e);
          }}
          onKeyDown={(e) => {
            onKeyDown?.(e);
            if (!e.defaultPrevented) moveOptionFocus(e);
          }}
          {...props}
        >
          <SelectPrimitive.Viewport
            className={cn(
              'p-1',
              position === 'popper' &&
                'h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]'
            )}
            onMouseDown={(e) => e.preventDefault()}
          >
            {children}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </div>
    </SelectPrimitive.Portal>
  );
}

const OPTION_KEYS = new Set(['ArrowDown', 'ArrowUp', 'Home', 'End']);

/**
 * Arrow, Home and End for a list in ANOTHER window (a pop-out, an iframe). Radix reads focus
 * from the script's global `document`, which is the opener there, so its own handling skips
 * options. Prevented here, Radix's handler stands down; in the script's window it runs as-is.
 */
function moveOptionFocus(event: React.KeyboardEvent<HTMLDivElement>): void {
  const content = event.currentTarget;
  if (content.ownerDocument === globalThis.document || !OPTION_KEYS.has(event.key)) return;
  event.preventDefault();
  const options = Array.from(
    content.querySelectorAll<HTMLElement>('[role="option"]:not([data-disabled])')
  );
  if (options.length === 0) return;
  // Radix's open focus also reads the opener, so focus can still be on the list itself: start
  // from the selected option then, as Radix does in its own window.
  const focused = options.indexOf(content.ownerDocument.activeElement as HTMLElement);
  const at =
    focused >= 0 ? focused : options.findIndex((option) => option.dataset.state === 'checked');
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? options.length - 1
        : event.key === 'ArrowDown'
          ? Math.min(options.length - 1, at + 1)
          : Math.max(0, at < 0 ? 0 : at - 1);
  options[next]!.focus({ preventScroll: false });
}

function SelectLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Label>) {
  return (
    <SelectPrimitive.Label
      className={cn('px-2 py-1.5 text-xs font-medium text-muted-foreground', className)}
      {...props}
    />
  );
}

function SelectItem({
  className,
  children,
  onMouseDown,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item
      className={cn(
        'relative flex w-full cursor-pointer select-none items-center',
        'rounded px-2 py-1.5 text-sm text-foreground outline-none',
        'hover:bg-muted focus:bg-muted',
        'data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className
      )}
      onMouseDown={(e) => {
        e.preventDefault();
        onMouseDown?.(e);
      }}
      {...props}
    >
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
      <span className="absolute right-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <CheckIcon className="h-4 w-4" />
        </SelectPrimitive.ItemIndicator>
      </span>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>) {
  return (
    <SelectPrimitive.Separator className={cn('-mx-1 my-1 h-px bg-muted', className)} {...props} />
  );
}

// Icons
function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
        clipRule="evenodd"
      />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
    >
      <path
        fillRule="evenodd"
        d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
};
