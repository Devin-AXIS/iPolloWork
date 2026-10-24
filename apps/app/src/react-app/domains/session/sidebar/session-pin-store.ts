import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

type SessionPinStore = {
  pinnedIds: string[];
  togglePin: (sessionId: string) => void;
};

export const useSessionPinStore = create<SessionPinStore>()(
  persist(
    (set) => ({
      pinnedIds: [],
      togglePin: (sessionId) =>
        set((state) => ({
          pinnedIds: state.pinnedIds.includes(sessionId)
            ? state.pinnedIds.filter((id) => id !== sessionId)
            : [...state.pinnedIds, sessionId],
        })),
    }),
    {
      name: "ipollowork.react.sessionPins",
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

const EMPTY_PINNED = new Set<string>();

export function usePinnedSessionIds(): Set<string> {
  const ids = useSessionPinStore((state) => state.pinnedIds);
  return ids.length ? new Set(ids) : EMPTY_PINNED;
}
