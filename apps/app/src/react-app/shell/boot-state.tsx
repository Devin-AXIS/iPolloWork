/** @jsxImportSource react */
import {
  createContext,
  useCallback,
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  BOOT_OVERLAY_FADE_MS,
  remainingBootOverlayHoldMs,
} from "./boot-overlay-timing";
import { workContextSwitchEvent } from "@/app/lib/work-context";

export type BootPhaseId =
  | "idle"
  | "bootstrapping-workspaces"
  | "starting-ipollowork-server"
  | "starting-engine"
  | "activating-workspace"
  | "ready"
  | "error";

export type BootStateSnapshot = {
  phase: BootPhaseId;
  message: string;
  detail: string | null;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
};

type BootStateContextValue = BootStateSnapshot & {
  routeReady: boolean;
  workContextSwitching: boolean;
  setPhase: (phase: BootPhaseId, detail?: string | null) => void;
  setError: (message: string | null) => void;
  markReady: () => void;
  markRouteReady: () => void;
};

const DEFAULT_STATE: BootStateSnapshot = {
  phase: "idle",
  message: "",
  detail: null,
  startedAt: null,
  completedAt: null,
  error: null,
};

const PHASE_MESSAGES: Record<BootPhaseId, string> = {
  idle: "",
  "bootstrapping-workspaces": "Loading your workspaces",
  "starting-ipollowork-server": "Starting the iPolloWork server",
  "starting-engine": "Preparing workspace",
  "activating-workspace": "Activating your workspace",
  ready: "Ready",
  error: "Something went wrong",
};

const BootStateContext = createContext<BootStateContextValue | null>(null);

export function BootStateProvider({ children }: { children: ReactNode }) {
  const [snapshot, setSnapshot] = useState<BootStateSnapshot>(DEFAULT_STATE);
  // Once the main route has finished its first successful refresh (workspaces
  // + sessions fetched), we consider the app "interactive". This is a one-way
  // latch so subsequent background refreshes never re-show the overlay.
  const [routeReady, setRouteReady] = useState(false);
  const [workContextSwitching, setWorkContextSwitching] = useState(false);
  const startedAtRef = useRef<number | null>(null);

  const setPhase = useCallback((phase: BootPhaseId, detail?: string | null) => {
    setSnapshot((current) => {
      const nextStartedAt =
        current.phase === "idle" && phase !== "idle"
          ? (startedAtRef.current = Date.now())
          : (startedAtRef.current ?? current.startedAt);
      return {
        ...current,
        phase,
        message: PHASE_MESSAGES[phase] ?? current.message,
        detail: detail ?? null,
        startedAt: nextStartedAt,
        completedAt: phase === "ready" ? Date.now() : null,
        error: phase === "error" ? current.error : null,
      };
    });
  }, []);

  const setError = useCallback((message: string | null) => {
    setSnapshot((current) => ({
      ...current,
      error: message,
      phase: message ? "error" : current.phase,
      message: message ? PHASE_MESSAGES.error : current.message,
    }));
  }, []);

  const markReady = useCallback(() => {
    setSnapshot((current) => ({
      ...current,
      phase: "ready",
      message: PHASE_MESSAGES.ready,
      detail: null,
      completedAt: Date.now(),
      error: null,
    }));
  }, []);

  const markRouteReady = useCallback(() => {
    setRouteReady(true);
  }, []);

  useEffect(() => {
    const handleSwitch = (event: Event) => {
      const phase = (event as CustomEvent<{ phase?: string }>).detail?.phase;
      if (phase === "start") setWorkContextSwitching(true);
      if (phase === "finish") setWorkContextSwitching(false);
    };
    window.addEventListener(workContextSwitchEvent, handleSwitch);
    return () => window.removeEventListener(workContextSwitchEvent, handleSwitch);
  }, []);

  const value = useMemo<BootStateContextValue>(
    () => ({ ...snapshot, routeReady, workContextSwitching, setPhase, setError, markReady, markRouteReady }),
    [markReady, markRouteReady, routeReady, setError, setPhase, snapshot, workContextSwitching],
  );

  return <BootStateContext.Provider value={value}>{children}</BootStateContext.Provider>;
}

export function useBootState(): BootStateContextValue {
  const value = use(BootStateContext);
  if (!value) {
    throw new Error("useBootState must be used inside <BootStateProvider>");
  }
  return value;
}

/**
 * Overlay stays up until BOTH the desktop boot hook has reported `ready` AND
 * the main route has completed its first refresh (`routeReady`). It also gets
 * a short minimum hold so a fast warm boot still shows the loading animation.
 */
export function useBootOverlayState(): { visible: boolean; fading: boolean } {
  const { phase, routeReady, workContextSwitching } = useBootState();
  // HMR can remount the provider while the route tree stays mounted. In that
  // state the boot phase falls back to `idle`, but the already-rendered route
  // is interactive and can mark itself ready again. Treat `idle + routeReady`
  // the same as `ready + routeReady` so the full-screen boot overlay never
  // becomes a permanent pointer-events blocker during development.
  const canHide = !workContextSwitching && routeReady && (phase === "ready" || phase === "idle");
  const [visible, setVisible] = useState(!canHide);
  const [fading, setFading] = useState(false);
  const mountedAtRef = useRef(Date.now());

  useEffect(() => {
    if (workContextSwitching) mountedAtRef.current = Date.now();
  }, [workContextSwitching]);

  useEffect(() => {
    if (canHide) {
      const holdMs = remainingBootOverlayHoldMs(Date.now() - mountedAtRef.current);
      const fadeHandle = window.setTimeout(() => setFading(true), holdMs);
      const hideHandle = window.setTimeout(() => setVisible(false), holdMs + BOOT_OVERLAY_FADE_MS);
      return () => {
        window.clearTimeout(fadeHandle);
        window.clearTimeout(hideHandle);
      };
    }
    setVisible(true);
    setFading(false);
    return undefined;
  }, [canHide]);

  return { visible, fading };
}

export function useBootOverlayVisible(): boolean {
  return useBootOverlayState().visible;
}
