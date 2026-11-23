type AuthorizationRuntime = {
  listConnections(): Promise<Array<{ accountId: string; methodId: string; status: string }>>;
  getCredential(methodId: string, accountId?: string): Promise<Readonly<Record<string, string>> | null>;
  readCredential(accountId: string, methodId: string): Promise<Readonly<Record<string, string>> | null>;
};

export default async function createAcmeService(runtime: {
  plugin: Readonly<{ id: string; version: string }>;
  authorization: AuthorizationRuntime;
}) {
  return {
    actions: {
      "connection-status": async () => {
        const connections = await runtime.authorization.listConnections();
        const active = connections.find((connection) => connection.methodId === "api-key");
        const credential = await runtime.authorization.getCredential("api-key");
        return {
          connected: Boolean(credential),
          accountId: active?.accountId ?? null,
          methodId: active?.methodId ?? null,
          pluginVersion: runtime.plugin.version,
        };
      },
      search: async (input: Record<string, unknown>) => {
        const query = typeof input.query === "string" ? input.query.trim() : "";
        if (!query) throw new Error("query is required");
        const credential = await runtime.authorization.getCredential("api-key");
        if (!credential?.apiKey) throw new Error("Connect Acme Research before searching");
        const response = await fetch("https://api.acme.example/v1/research/search", {
          method: "POST",
          headers: {
            authorization: `Bearer ${credential.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ query }),
        });
        if (!response.ok) throw new Error(`Acme search failed with HTTP ${response.status}`);
        return response.json();
      },
    },
  };
}
