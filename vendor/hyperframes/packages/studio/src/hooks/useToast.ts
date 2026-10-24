import { useState, useCallback, useRef } from "react";
import { useMountEffect } from "./useMountEffect";
import type { AppToast, ToastTone, ToastToneInput } from "../utils/studioHelpers";

interface ToastItem extends AppToast {
  id: number;
  /** True while the exit animation plays, just before removal. */
  leaving?: boolean;
}

const AUTO_DISMISS_MS = 4000;
const EXIT_MS = 160;
const MAX_TOASTS = 3;

let nextToastId = 1;

/**
 * Stacked status cards (max 3). Completed tasks briefly remain visible;
 * loading and error states persist until their owner dismisses them.
 */
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = useCallback((id: number) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  const removeToast = useCallback(
    (id: number) => {
      clearTimer(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    },
    [clearTimer],
  );

  const dismissToast = useCallback(
    (id: number) => {
      clearTimer(id);
      // Mark leaving so the exit animation plays, then remove.
      setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      const timer = setTimeout(() => removeToast(id), EXIT_MS);
      timersRef.current.set(id, timer);
    },
    [clearTimer, removeToast],
  );

  const showToast = useCallback(
    (message: string, tone: ToastToneInput = "error") => {
      const id = nextToastId++;
      const normalizedTone: ToastTone = tone === "info" || tone === "notice" ? "success" : tone;
      setToasts((prev) => {
        const next = [...prev, { id, message, tone: normalizedTone }];
        // Cap the stack; drop the oldest (and its pending timer).
        while (next.length > MAX_TOASTS) {
          const dropped = next.shift();
          if (dropped) clearTimer(dropped.id);
        }
        return next;
      });
      if (normalizedTone === "success") {
        const timer = setTimeout(() => dismissToast(id), AUTO_DISMISS_MS);
        timersRef.current.set(id, timer);
      }
      return id;
    },
    [clearTimer, dismissToast],
  );

  useMountEffect(() => () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
  });

  return { toasts, showToast, dismissToast };
}
