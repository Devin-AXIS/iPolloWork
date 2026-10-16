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
  const connectionId = `${connection.id}:${connection.membership.id}:${connection.session.token}`;
  if (pendingRefresh?.connectionId === connectionId) return pendingRefresh.promise;
  const promise = refreshEnterpriseConnection(connection).finally(() => {
    if (pendingRefresh?.promise === promise) pendingRefresh = null;
  });
  pendingRefresh = { connectionId, promise };
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
    window.addEventListener("focus", refreshActiveConnection);
    const interval = window.setInterval(refreshActiveConnection, 60_000);
    refreshActiveConnection();
    return () => {
      disposed = true;
      window.removeEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
      window.removeEventListener(workContextChangedEvent, refreshActiveConnection);
      window.removeEventListener("focus", refreshActiveConnection);
      window.clearInterval(interval);
    };
  }, []);

  return connection;
}
