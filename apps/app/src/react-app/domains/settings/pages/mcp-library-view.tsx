/** @jsxImportSource react */
import { useEffect, useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { Building2, Cloud, Plug, User } from "lucide-react";
import type { PublicMcp } from "@ipollowork/types/enterprise";
import { MCP_QUICK_CONNECT } from "@/app/constants";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { listPublicMcp } from "@/app/lib/mcp-catalog";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardIcon, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SettingsNotice, SettingsStack } from "../settings-section";
import { settingsPageDescriptionClass, settingsPageTitleClass } from "../shell/panel";
import { EnterpriseMcpView, type McpWorkspaceActions } from "./enterprise-mcp-view";

type Source = "personal" | "public" | "enterprise";
type Props = McpWorkspaceActions & {
  enterprise: EnterpriseConnection | null;
  refreshInstalled: () => Promise<void>;
};

export function McpLibraryView({ enterprise, refreshInstalled, ...workspace }: Props) {
  const location = useLocation();
  const [selectedSource, setSource] = useState<Source>(() =>
    new URLSearchParams(location.search).get("source") === "enterprise" ? "enterprise" : "personal");
  const source = selectedSource === "enterprise" && !enterprise ? "personal" : selectedSource;
  return <SettingsStack className="gap-y-5">
    <div>
      <h2 className={settingsPageTitleClass}>MCP</h2>
      <p className={settingsPageDescriptionClass}>{t("mcp_library.description")}</p>
    </div>
    <Tabs className="gap-5" value={source} onValueChange={(value) => {
      if (value === "personal" || value === "public" || value === "enterprise") setSource(value);
    }}>
      <TabsList aria-label={t("mcp_library.sources")} className="max-w-full">
        <TabsTrigger value="personal" className="flex-none shrink-0"><User className="size-4" />{t("mcp_library.personal")}</TabsTrigger>
        <TabsTrigger value="public" className="flex-none shrink-0"><Cloud className="size-4" />{t("mcp_library.public")}</TabsTrigger>
        {enterprise ? <TabsTrigger value="enterprise" className="min-w-0 max-w-64 flex-initial" title={enterprise.name}>
          <Building2 className="size-4 shrink-0" /><span className="truncate">{enterprise.name}</span>
        </TabsTrigger> : null}
      </TabsList>
      <TabsContent value={source}>
        {source === "enterprise" ? (
          !enterprise ? null : enterprise.features?.mcpResources !== true ? (
            <SettingsNotice>{t("enterprise_mcp.unsupported")}</SettingsNotice>
          ) : <EnterpriseMcpView key={JSON.stringify([enterprise.id, enterprise.membership.id, enterprise.membership.role, enterprise.features.mcpManagement])} embedded enterprise={enterprise} {...workspace} />
        ) : <PersonalPublicMcp key={source} source={source} refreshInstalled={refreshInstalled} {...workspace} />}
      </TabsContent>
    </Tabs>
  </SettingsStack>;
}

function publicMcpName(item: PublicMcp) {
  return `public-${item.id}`;
}

function PersonalPublicMcp({ source, ready, installed, statuses, install, remove, refreshInstalled }: McpWorkspaceActions & {
  source: "personal" | "public";
  refreshInstalled: () => Promise<void>;
}) {
  const [items, setItems] = useState<PublicMcp[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(source === "public");
  const [revision, setRevision] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState(false);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (source !== "public") return;
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    void listPublicMcp(controller.signal).then((next) => {
      if (!controller.signal.aborted) setItems(next);
    }).catch(() => {
      if (!controller.signal.aborted) setLoadError(true);
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [source, revision]);

  async function perform(action: () => Promise<boolean>, error: string) {
    setPending(true);
    setActionError("");
    try {
      const success = await action();
      if (!success) setActionError(error);
      return success;
    } catch {
      setActionError(error);
      return false;
    } finally {
      setPending(false);
    }
  }

  async function addConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!ready || pending) return;
    const fields = new FormData(event.currentTarget);
    const name = String(fields.get("name") ?? "").trim();
    const url = URL.parse(String(fields.get("url") ?? "").trim());
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(name) || /^(enterprise|public|ipollowork)-/u.test(name)
      || installed.some((entry) => entry.name === name) || MCP_QUICK_CONNECT.some((entry) => entry.serverName === name)) {
      setActionError(t("mcp_library.invalid_name"));
      return;
    }
    if (!url || !["https:", "http:"].includes(url.protocol) || url.username || url.password || url.hash) {
      setActionError(t("mcp_library.invalid_url"));
      return;
    }
    if (await perform(() => install({ id: name, serverName: name, name, description: "", url: url.href, type: "remote", oauth: fields.has("oauth") }),
      t("enterprise_mcp.install_error"))) setAdding(false);
  }

  const matches = (value: string) => value.toLowerCase().includes(search.trim().toLowerCase());
  const personal = installed.filter((entry) => !entry.name.startsWith("enterprise-")).map((entry) => {
    const name = entry.name.replace(/^public-/u, "");
    return { entry, title: MCP_QUICK_CONNECT.find((candidate) => candidate.serverName === name)?.name ?? name };
  }).filter(({ entry, title }) => matches(title + " " + entry.name));
  const visible = items.filter((item) => matches(item.name + " " + item.description));
  const empty = source === "personal" ? personal.length === 0 : visible.length === 0;
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      <div className="min-w-48 flex-1">
        <SearchField aria-label={t("mcp_library.search")} value={search} onValueChange={setSearch} clearLabel={t("mcp_library.clear_search")} placeholder={t("mcp_library.search")} />
      </div>
      <Button variant="outline" disabled={loading || pending} onClick={() => {
        if (source === "public") setRevision((value) => value + 1);
        else void perform(async () => { await refreshInstalled(); return true; }, t("mcp_library.load_error"));
      }}>{t("common.refresh")}</Button>
      {source === "personal" ? <Button disabled={!ready || pending} onClick={() => setAdding(!adding)}>{t("mcp_library.add")}</Button> : null}
    </div>
    {!ready ? <SettingsNotice>{t("enterprise_mcp.local_project_required")}</SettingsNotice> : null}
    {loadError ? <SettingsNotice tone="error">{t("mcp_library.load_error")}</SettingsNotice> : null}
    {actionError ? <SettingsNotice tone="error">{actionError}</SettingsNotice> : null}
    {adding ? <form onSubmit={(event) => void addConnection(event)} className="space-y-3 rounded-xl border border-dls-border p-4">
      <Field><FieldLabel htmlFor="personal-mcp-name">{t("mcp_library.name")}</FieldLabel><Input id="personal-mcp-name" name="name" maxLength={64} placeholder="my-mcp" required /></Field>
      <Field><FieldLabel htmlFor="personal-mcp-url">{t("mcp_library.url")}</FieldLabel><Input id="personal-mcp-url" name="url" type="url" maxLength={2048} required /></Field>
      <label className="flex items-center gap-2 text-sm"><input name="oauth" type="checkbox" />{t("mcp_library.oauth")}</label>
      <div className="flex justify-end gap-2">
        <Button variant="outline" type="button" disabled={pending} onClick={() => { setActionError(""); setAdding(false); }}>{t("common.cancel")}</Button>
        <Button type="submit" disabled={!ready || pending}>{t("mcp_library.add")}</Button>
      </div>
    </form> : null}
    {loading ? <SettingsNotice>{t("common.loading")}</SettingsNotice> : null}
    {!loading && !loadError && empty ? <Empty><EmptyDescription>
      {t(search.trim() ? "mcp_library.no_matches" : source === "personal" ? "mcp_library.personal_empty" : "mcp_library.public_empty")}
    </EmptyDescription></Empty> : null}
    <div className="space-y-2">
      {source === "personal" ? personal.map(({ entry, title }) => {
        const status = statuses[entry.name]?.status;
        return <Card key={entry.name} variant="resource" layout="row" surface="plain" data-mcp-name={entry.name}>
          <CardHeader><CardIcon><Plug /></CardIcon><div className="min-w-0">
            <CardTitle as="h3">{title}</CardTitle>
            <CardDescription>
              {entry.name.startsWith("public-") ? `${t("mcp_library.public")} · ` : ""}
              {t(status === "connected" ? "mcp.connected" : "plugin_platform.status.installed")}
            </CardDescription>
          </div></CardHeader>
          {entry.source === "config.remote" ? <CardFooter>
            <Button variant="outline" disabled={!ready || pending} onClick={() => void perform(() => remove(entry.name), t("mcp.remove_failed"))}>
              {t("enterprise_mcp.uninstall")}
            </Button>
          </CardFooter> : null}
        </Card>;
      }) : !loadError && visible.map((item) => {
        const name = publicMcpName(item);
        const configured = installed.find((entry) => entry.name === name)
          ?? installed.find((entry) => entry.name === item.id && entry.config.url === item.url);
        const connected = configured && statuses[configured.name]?.status === "connected";
        const builtIn = MCP_QUICK_CONNECT.find((entry) => entry.serverName === item.id);
        return <Card key={item.id} variant="resource" layout="row" surface="plain" data-testid="public-mcp-card">
          <CardHeader><CardIcon><Plug /></CardIcon><div className="min-w-0">
            <CardTitle as="h3">{item.name}</CardTitle>
            <CardDescription>{builtIn?.description ?? item.description}</CardDescription>
            {configured ? <CardDescription>{t(connected ? "mcp.connected" : "plugin_platform.status.installed")}</CardDescription> : null}
          </div></CardHeader>
          <CardFooter><Button variant="outline" disabled={!ready || loading || pending || connected} onClick={() => {
            const target = configured?.name ?? name;
            void perform(() => install({ ...item, id: target, serverName: target, type: "remote" }), t("enterprise_mcp.install_error"));
          }}>
            {t(connected ? "mcp.connected" : configured ? "enterprise_mcp.reconnect" : "enterprise_connection.install_from_enterprise")}
          </Button></CardFooter>
        </Card>;
      })}
    </div>
  </div>;
}
