import * as React from 'react';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  side?: 'top' | 'bottom' | 'left' | 'right';
  delayMs?: number;
}

export function Tooltip({ content, children, side = 'bottom', delayMs = 400 }: TooltipProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const triggerRef = React.useRef<HTMLElement>(null);
  // The handle and the window that issued it: a trigger in a pop-out window owns its timer.
  const timeoutRef = React.useRef<{ win: Window; handle: number } | null>(null);

  const handleMouseEnter = React.useCallback(() => {
    const win = hostWindowOf(triggerRef.current);
    const handle = win.setTimeout(() => {
      if (triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = side === 'top' ? rect.top - 8 : rect.bottom + 8;
        setPosition({ x, y });
      }
      setIsOpen(true);
    }, delayMs);
    timeoutRef.current = { win, handle };
  }, [delayMs, side]);

  const handleMouseLeave = React.useCallback(() => {
    if (timeoutRef.current) {
      timeoutRef.current.win.clearTimeout(timeoutRef.current.handle);
      timeoutRef.current = null;
    }
    setIsOpen(false);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        timeoutRef.current.win.clearTimeout(timeoutRef.current.handle);
      }
    };
  }, []);

  // Type the child props for React 19 compatibility
  type ChildProps = {
    ref?: React.Ref<HTMLElement>;
    onMouseEnter?: (e: React.MouseEvent) => void;
    onMouseLeave?: (e: React.MouseEvent) => void;
  };
  const childProps = children.props as ChildProps;

  const child = React.cloneElement(children as React.ReactElement<ChildProps>, {
    ref: triggerRef,
    onMouseEnter: (e: React.MouseEvent) => {
      handleMouseEnter();
      childProps.onMouseEnter?.(e);
    },
    onMouseLeave: (e: React.MouseEvent) => {
      handleMouseLeave();
      childProps.onMouseLeave?.(e);
    },
  });

  return (
    <>
      {child}
      {isOpen && (
        <div
          className="fixed z-50 px-2 py-1 text-xs font-medium text-white bg-foreground dark:bg-muted dark:text-foreground rounded-md shadow-lg"
          style={{
            left: position.x,
            top: position.y,
            transform:
              side === 'top'
                ? 'translate(-50%, -100%)'
                : side === 'bottom'
                  ? 'translate(-50%, 0)'
                  : undefined,
          }}
        >
          {content}
        </div>
      )}
    </>
  );
}
