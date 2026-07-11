/** @jsxImportSource react */
import {
  createContext,
  use,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import type { iPolloWorkServerStore } from "./ipollowork-server-store";

const iPolloWorkServerContext = createContext<iPolloWorkServerStore | null>(null);

export function iPolloWorkServerProvider(props: {
  store: iPolloWorkServerStore;
  children: ReactNode;
}) {
  return (
    <iPolloWorkServerContext.Provider value={props.store}>
      {props.children}
    </iPolloWorkServerContext.Provider>
  );
}

export function useiPolloWorkServer() {
  const store = use(iPolloWorkServerContext);
  if (!store) {
    throw new Error("useiPolloWorkServer must be used within an iPolloWorkServerProvider");
  }

  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

  return store;
}
