/** @jsxImportSource react */
import {
  createContext,
  use,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { iPolloWalkServerStore } from "./ipollowalk-server-store";

const iPolloWalkServerContext = createContext<iPolloWalkServerStore | null>(null);

export function iPolloWalkServerProvider(props: {
  store: iPolloWalkServerStore;
  children: ReactNode;
}) {
  return (
    <iPolloWalkServerContext.Provider value={props.store}>
      {props.children}
    </iPolloWalkServerContext.Provider>
  );
}

export function useiPolloWalkServer() {
  const store = use(iPolloWalkServerContext);
  if (!store) {
    throw new Error("useiPolloWalkServer must be used within an iPolloWalkServerProvider");
  }

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store;
}
