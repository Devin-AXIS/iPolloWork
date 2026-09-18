import { createContext } from "react";
import type { LocalPreferences, LocalUIState } from "./local-provider";

export type LocalContextValue = {
  ui: LocalUIState;
  setUi: (updater: (previous: LocalUIState) => LocalUIState) => void;
  prefs: LocalPreferences;
  setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  ready: boolean;
};

// Keep identity outside the refreshable provider module. Vite may briefly load
// old and timestamped provider versions together after shared image types change.
export const LocalContext = createContext<LocalContextValue | undefined>(undefined);
