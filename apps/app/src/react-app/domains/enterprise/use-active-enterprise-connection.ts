/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  enterpriseConnectionsChangedEvent,
  refreshEnterpriseConnection,
  saveEnterpriseConnection,
  type EnterpriseConnection,
} from "@/app/lib/enterprise-connections";
import { EnterpriseRequestError } from "@/app/lib/enterprise-client";
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
        .then(() => {
          if (!disposed) readStoredConnection();
        })
        .catch((error: unknown) => {
          const current = readActiveEnterpriseConnection();
          if (!disposed && error instanceof EnterpriseRequestError && error.status === 401
            && current?.id === activeConnection.id && current.membership.id === activeConnection.membership.id
            && current.session.token === activeConnection.session.token) {
            saveEnterpriseConnection({ ...current, session: { ...current.session, expiresAt: new Date(0).toISOString() } });
          }
        });
    };
    const refreshVisibleConnection = () => { if (document.visibilityState === "visible") refreshActiveConnection(); };
    window.addEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
    window.addEventListener(workContextChangedEvent, refreshActiveConnection);
    window.addEventListener("focus", refreshActiveConnection);
    document.addEventListener("visibilitychange", refreshVisibleConnection);
    const interval = window.setInterval(refreshVisibleConnection, 15_000);
    refreshActiveConnection();
    return () => {
      disposed = true;
      window.removeEventListener(enterpriseConnectionsChangedEvent, readStoredConnection);
      window.removeEventListener(workContextChangedEvent, refreshActiveConnection);
      window.removeEventListener("focus", refreshActiveConnection);
      document.removeEventListener("visibilitychange", refreshVisibleConnection);
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!connection) return;
    const delay = Math.max(0, Math.min(Date.parse(connection.session.expiresAt) - Date.now(), 2_147_483_647));
    const timer = window.setTimeout(() => setConnection(readActiveEnterpriseConnection()), delay);
    return () => window.clearTimeout(timer);
  }, [connection]);

  return connection;
}
