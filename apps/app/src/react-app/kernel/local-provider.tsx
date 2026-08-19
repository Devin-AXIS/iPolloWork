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
import { DEFAULT_ENGINE_ID } from "@ipollowork/types/workspace";

import { THINKING_PREF_KEY } from "../../app/constants";
import type { ModelRef, SettingsTab, View } from "../../app/types";
import {
  DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE,
  isDesktopNotificationPreference,
  type DesktopNotificationPreference,
} from "./desktop-notification-preferences";
import { LOCAL_PREFERENCES_KEY } from "./local-preferences-storage";
import { readStoredDefaultModel } from "./model-config";

export type LocalUIState = {
  view: View;
  tab: SettingsTab;
};

export type LocalPreferences = {
  showThinking: boolean;
  enginePreferences: Record<string, EnginePreferences>;
  featureFlags: {
    microsandboxCreateSandbox: boolean;
    /**
     * Memory Bank preview. Client-only, per-device, never synced. Gates desktop
     * UI surfacing (the management panel + copy-prompt affordance); the routes
     * stay callable (owner-scoped + authz'd). Off by default — opt-in preview.
     */
    memory: boolean;
  };
  /**
   * Set to true after the user completes the welcome/onboarding flow
   * (creates or connects their first workspace). When false and the
   * workspace list is empty, the app stays on the current space error state.
   */
  hasCompletedOnboarding: boolean;
  /**
   * Anonymous product analytics (PostHog). On by default with a visible
   * opt-out in Settings -> Preferences. Never includes message content.
   */
  analyticsEnabled: boolean;
  /**
   * Native OS notifications from the desktop app. Off by default so upgrading
   * users are not surprised by system popups.
   */
  desktopNotifications: DesktopNotificationPreference;
};

export type EnginePreferences = {
  model: ModelRef | null;
  modelVariant: string | null;
  mode: string | null;
};

type LocalContextValue = {
  ui: LocalUIState;
  setUi: (updater: (previous: LocalUIState) => LocalUIState) => void;
  prefs: LocalPreferences;
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  ready: boolean;
};

const LocalContext = createContext<LocalContextValue | undefined>(undefined);

const UI_STORAGE_KEY = "ipollowork.ui";
export const DEFAULT_SHOW_THINKING = true;

const INITIAL_UI: LocalUIState = { view: "settings", tab: "preferences" };
const INITIAL_PREFS: LocalPreferences = {
  showThinking: DEFAULT_SHOW_THINKING,
  enginePreferences: {},
  featureFlags: { microsandboxCreateSandbox: true, memory: false },
  hasCompletedOnboarding: false,
  analyticsEnabled: true,
  desktopNotifications: DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE,
};

const EMPTY_ENGINE_PREFERENCES: EnginePreferences = {
  model: null,
  modelVariant: null,
  mode: null,
};

export function getEnginePreferences(
  preferences: LocalPreferences,
  engineId?: string | null,
): EnginePreferences {
  const resolvedEngineId = engineId?.trim() || DEFAULT_ENGINE_ID;
  const enginePreferences = preferences.enginePreferences[resolvedEngineId]
    ?? EMPTY_ENGINE_PREFERENCES;
  const sharedModelPreferences = preferences.enginePreferences[DEFAULT_ENGINE_ID]
    ?? EMPTY_ENGINE_PREFERENCES;
  return {
    ...enginePreferences,
    model: sharedModelPreferences.model,
    modelVariant: sharedModelPreferences.modelVariant,
  };
}

export function updateEnginePreferences(
  preferences: LocalPreferences,
  engineId: string | null | undefined,
  updater: (previous: EnginePreferences) => EnginePreferences,
): LocalPreferences {
  const resolvedEngineId = engineId?.trim() || DEFAULT_ENGINE_ID;
  const previousEngine = getEnginePreferences(preferences, resolvedEngineId);
  const next = updater(previousEngine);
  const previousShared = preferences.enginePreferences[DEFAULT_ENGINE_ID]
    ?? EMPTY_ENGINE_PREFERENCES;
  return {
    ...preferences,
    enginePreferences: {
      ...preferences.enginePreferences,
      [DEFAULT_ENGINE_ID]: {
        ...previousShared,
        model: next.model,
        modelVariant: next.modelVariant,
      },
      [resolvedEngineId]: {
        ...(preferences.enginePreferences[resolvedEngineId] ?? EMPTY_ENGINE_PREFERENCES),
        ...(resolvedEngineId === DEFAULT_ENGINE_ID
          ? { model: next.model, modelVariant: next.modelVariant }
          : {}),
        mode: next.mode,
      },
    },
  };
}

function normalizeModelRef(value: unknown): ModelRef | null {
  if (!value || typeof value !== "object") return null;
  const model = value as Partial<ModelRef>;
  return typeof model.providerID === "string" && typeof model.modelID === "string"
    ? { providerID: model.providerID, modelID: model.modelID }
    : null;
}

function normalizeEnginePreferences(value: unknown): Record<string, EnginePreferences> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([engineId, selection]) => {
      if (!selection || typeof selection !== "object" || Array.isArray(selection)) return [];
      const record = selection as Partial<EnginePreferences>;
      return [[engineId, {
        model: normalizeModelRef(record.model),
        modelVariant: typeof record.modelVariant === "string" ? record.modelVariant : null,
        mode: typeof record.mode === "string" ? record.mode : null,
      }]];
    }),
  );
}

function readPersisted<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      return { ...fallback, ...(parsed as Record<string, unknown>) } as T;
    }
    return fallback;
  } catch {
    return fallback;
  }
}

function writePersisted(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore quota errors
  }
}

type LocalProviderProps = {
  children: ReactNode;
};

export function LocalProvider({ children }: LocalProviderProps) {
  const [ui, setUiRaw] = useState<LocalUIState>(() =>
    readPersisted(UI_STORAGE_KEY, INITIAL_UI),
  );
  const [prefs, setPrefsRaw] = useState<LocalPreferences>(() => {
    const persisted = readPersisted(LOCAL_PREFERENCES_KEY, INITIAL_PREFS) as LocalPreferences & {
      defaultModel?: unknown;
      modelVariant?: unknown;
      selectedAgent?: unknown;
    };
    delete (persisted as { releaseChannel?: unknown }).releaseChannel;
    delete (persisted as { providerStepCompleted?: unknown }).providerStepCompleted;
    persisted.desktopNotifications = isDesktopNotificationPreference(persisted.desktopNotifications)
      ? persisted.desktopNotifications
      : DEFAULT_DESKTOP_NOTIFICATION_PREFERENCE;
    const enginePreferences = normalizeEnginePreferences(persisted.enginePreferences);
    const openCodePreferences = enginePreferences[DEFAULT_ENGINE_ID] ?? EMPTY_ENGINE_PREFERENCES;
    const firstConfiguredModel = Object.values(enginePreferences).find((selection) => selection.model)?.model
      ?? null;
    const firstConfiguredVariant = Object.values(enginePreferences).find(
      (selection) => selection.modelVariant,
    )?.modelVariant ?? null;
    enginePreferences[DEFAULT_ENGINE_ID] = {
      model: openCodePreferences.model
        ?? firstConfiguredModel
        ?? normalizeModelRef(persisted.defaultModel)
        ?? readStoredDefaultModel(),
      modelVariant: openCodePreferences.modelVariant
        ?? firstConfiguredVariant
        ?? (typeof persisted.modelVariant === "string" ? persisted.modelVariant : null),
      mode: openCodePreferences.mode
        ?? (typeof persisted.selectedAgent === "string" ? persisted.selectedAgent : null),
    };
    delete persisted.defaultModel;
    delete persisted.modelVariant;
    delete persisted.selectedAgent;
    return { ...persisted, enginePreferences };
  });
  const ready = true;
  const migratedThinkingRef = useRef(false);

  useEffect(() => {
    writePersisted(UI_STORAGE_KEY, ui);
  }, [ui]);

  useEffect(() => {
    writePersisted(LOCAL_PREFERENCES_KEY, prefs);
  }, [prefs]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (migratedThinkingRef.current) return;
    migratedThinkingRef.current = true;

    const raw = window.localStorage.getItem(THINKING_PREF_KEY);
    if (raw == null) return;

    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed === "boolean") {
        setPrefsRaw((previous) => ({ ...previous, showThinking: parsed }));
      }
    } catch {
      // ignore invalid legacy values
    }

    try {
      window.localStorage.removeItem(THINKING_PREF_KEY);
    } catch {
      // ignore
    }
  }, []);

  const setUi = useCallback(
    (updater: (previous: LocalUIState) => LocalUIState) => {
      setUiRaw(updater);
    },
    [],
  );

  const setPrefs = useCallback(
    (updater: (previous: LocalPreferences) => LocalPreferences) => {
      setPrefsRaw(updater);
    },
    [],
  );

  const value = useMemo<LocalContextValue>(
    () => ({ ui, setUi, prefs, setPrefs, ready }),
    [prefs, ready, setPrefs, setUi, ui],
  );

  return <LocalContext.Provider value={value}>{children}</LocalContext.Provider>;
}

export function useLocal(): LocalContextValue {
  const context = use(LocalContext);
  if (!context) {
    throw new Error("Local context is missing");
  }
  return context;
}
