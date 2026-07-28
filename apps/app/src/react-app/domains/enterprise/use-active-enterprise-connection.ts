/** @jsxImportSource react */
import { useEffect, useState } from "react";

import {
  enterpriseConnectionsChangedEvent,
  type EnterpriseConnection,
} from "@/app/lib/enterprise-connections";
import { readActiveEnterpriseConnection, workContextChangedEvent } from "@/app/lib/work-context";

export function useActiveEnterpriseConnection(): EnterpriseConnection | null {
  const [connection, setConnection] = useState<EnterpriseConnection | null>(() => readActiveEnterpriseConnection());

  useEffect(() => {
    const refresh = () => setConnection(readActiveEnterpriseConnection());
    window.addEventListener(enterpriseConnectionsChangedEvent, refresh);
    window.addEventListener(workContextChangedEvent, refresh);
    return () => {
      window.removeEventListener(enterpriseConnectionsChangedEvent, refresh);
      window.removeEventListener(workContextChangedEvent, refresh);
    };
  }, []);

  return connection;
}
