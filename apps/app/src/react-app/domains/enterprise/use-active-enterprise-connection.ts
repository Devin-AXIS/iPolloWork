/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  enterpriseConnectionsChangedEvent,
  refreshEnterpriseConnection,
  type EnterpriseConnection,
} from "@/app/lib/enterprise-connections";
import { readActiveEnterpriseConnection, workContextChangedEvent } from "@/app/lib/work-context";

let pendingRefresh: { connectionId: string; promise: Promise<EnterpriseConnection> } | null = null;

function refreshConnection(connection: EnterpriseConnection) {
  if (pendingRefresh?.connectionId === connection.id) return pendingRefresh.promise;
  const promise = refreshEnterpriseConnection(connection).finally(() => {
    if (pendingRefresh?.promise === promise) pendingRefresh = null;
  });
  pendingRefresh = { connectionId: connection.id, promise };
  return promise;
}

export function useActiveEnterpriseConnection(): EnterpriseConnection | null {
  const [connection, setConnection] = useState<EnterpriseConnection | null>(() => readActiveEnterpriseConnection());

  useEffect(() => {
    let disposed = false;
    const readStoredConnection = () => setConnection(readActiveEnterpriseConnection());
    const refreshActiveConnection = () => {
      const activeConnection = readActiveEnterpriseConnection();
      setConnection(activeConnection);
      if (!activeConnection) return;
      void refreshConnection(activeConnection)
        .then((refreshed) => {
          if (!disposed && readActiveEnterpriseConnection()?.id === refreshed.id) setConnection(refreshed);
        })
        .catch(() => undefined);
    };
    window.addEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
    window.addEventListener(workContextChangedEvent, refreshActiveConnection);
    refreshActiveConnection();
    return () => {
      disposed = true;
      window.removeEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
      window.removeEventListener(workContextChangedEvent, refreshActiveConnection);
    };
  }, []);

  return connection;
}
