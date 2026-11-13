/** @jsxImportSource react */
import { useEffect, useState, type FormEvent } from "react";
import { Plug } from "lucide-react";
import { enterpriseMcpInputSchema, enterpriseMcpResourceSchema, enterprisePageSchema, type EnterpriseMcpResource } from "@ipollowork/types/enterprise";
import type { McpDirectoryInfo } from "@/app/constants";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";
import { canManageEnterprise, enterpriseApi, enterpriseErrorMessage, enterpriseRequest } from "@/app/lib/enterprise-client";
import { readActiveEnterpriseConnection } from "@/app/lib/work-context";
import type { McpServerEntry, McpStatusMap } from "@/app/types";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardFooter, CardHeader, CardIcon, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { SearchField } from "@/components/ui/search-field";
import { EnterpriseResourceActionDialog, type EnterpriseResourceAction } from "@/react-app/domains/enterprise";
import { t } from "@/i18n";
import { SettingsNotice, SettingsStack } from "../settings-section";

const resourcePage = enterprisePageSchema(enterpriseMcpResourceSchema);

export type McpWorkspaceActions = {
  ready: boolean;
  installed: McpServerEntry[];
  statuses: McpStatusMap;
  install: (entry: McpDirectoryInfo) => Promise<boolean>;
  remove: (name: string) => Promise<boolean>;
};

type EnterpriseMcpViewProps = McpWorkspaceActions & { enterprise: EnterpriseConnection; embedded?: boolean };

export function EnterpriseMcpView({ enterprise, embedded, ready, installed, statuses, install, remove }: EnterpriseMcpViewProps) {
  const [items, setItems] = useState<EnterpriseMcpResource[]>([]);
  const [search, setSearch] = useState("");
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ item?: EnterpriseMcpResource } | null>(null);
  const [action, setAction] = useState<EnterpriseResourceAction | null>(null);
  const manager = enterprise.features?.mcpManagement === true && canManageEnterprise(enterprise, "mcp");
  const catalogPath = `/api/v1/resources?type=mcp&limit=50${manager ? "&view=manage" : ""}`;
  const prefix = `enterprise-${enterprise.id}-`;
  const reload = () => setRefresh(value => value + 1);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setLoadError(false);
    setItems([]);
    setNext(null);
    void enterpriseRequest(enterprise, catalogPath, resourcePage, { signal: controller.signal })
      .then(page => {
        if (controller.signal.aborted) return;
        setItems(page.items);
        setNext(page.nextCursor);
      })
      .catch(() => { if (!controller.signal.aborted) setLoadError(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [enterprise, refresh, catalogPath]);

  async function loadMore() {
    if (!next || loading) return;
    setLoading(true);
    setLoadError(false);
    try {
      const page = await enterpriseRequest(enterprise, catalogPath + "&cursor=" + encodeURIComponent(next), resourcePage);
      setItems(current => [...current, ...page.items]);
      setNext(page.nextCursor);
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }

  async function installResource(resource: EnterpriseMcpResource) {
    const name = prefix + resource.id;
    setBusy(name);
    setActionError(null);
    try {
      const current = readActiveEnterpriseConnection();
      if (current?.id !== enterprise.id || current.membership.id !== enterprise.membership.id) throw new Error();
      const approved = await enterpriseRequest(current, "/api/v1/resources/" + encodeURIComponent(resource.id), enterpriseMcpResourceSchema);
      const active = readActiveEnterpriseConnection();
      if (approved.id !== resource.id || active?.id !== current.id || active.session.token !== current.session.token) throw new Error();
      const success = await install({
        id: name, serverName: name, name: approved.name, description: approved.description ?? "",
        type: "remote", url: approved.mcpUrl, oauth: approved.mcpRequiresOAuth,
      });
      if (!success) setActionError(t("enterprise_mcp.install_error"));
    } catch {
      setActionError(t("enterprise_mcp.install_error"));
    } finally {
      setBusy(null);
    }
  }

  async function removeResource(name: string) {
    setBusy(name);
    setActionError(null);
    try {
      if (!await remove(name)) setActionError(t("mcp.remove_failed"));
    } catch {
      setActionError(t("mcp.remove_failed"));
    } finally {
      setBusy(null);
    }
  }

  const listed = new Set(items.map(item => prefix + item.id));
  const unlistedInstalls = !next && !loading && !loadError
    ? installed.filter(server => server.name.startsWith(prefix) && !listed.has(server.name))
    : [];
  const query = search.trim().toLowerCase();
  const visibleItems = items.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(query));
  const visibleUnlisted = query ? [] : unlistedInstalls;
  const Layout = embedded ? "div" : SettingsStack;
  return <Layout className={embedded ? "space-y-4" : undefined}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-ui-control text-dls-secondary">{t("enterprise_mcp.description")}</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={loading || busy !== null} onClick={reload}>{t("common.refresh")}</Button>
        {manager ? <Button size="sm" onClick={() => setEditor({})}>{t("enterprise_mcp.publish")}</Button> : null}
      </div>
    </div>
    {embedded ? <SearchField aria-label={t("mcp_library.search")} value={search} onValueChange={setSearch}
      clearLabel={t("mcp_library.clear_search")} placeholder={t("mcp_library.search")} /> : null}
    {!ready ? <SettingsNotice>{t("enterprise_mcp.local_project_required")}</SettingsNotice> : null}
    {loadError ? <SettingsNotice tone="error">{t("enterprise_mcp.load_error")}</SettingsNotice> : null}
    {actionError ? <SettingsNotice tone="error">{actionError}</SettingsNotice> : null}
    {loading && !items.length ? <SettingsNotice>{t("common.loading")}</SettingsNotice> : null}
    {!loading && !loadError && !visibleItems.length && !visibleUnlisted.length ? (
      <Empty><EmptyDescription>{t(query ? "mcp_library.no_matches" : "enterprise_mcp.empty")}</EmptyDescription></Empty>
    ) : null}
    <div className="space-y-2">
      {visibleItems.map(item => {
        const name = prefix + item.id;
        const configured = installed.find(server => server.name === name);
        const updated = configured && (configured.config.url !== item.mcpUrl
          || Boolean(configured.config.oauth) !== item.mcpRequiresOAuth);
        const connected = configured && statuses[name]?.status === "connected" && !updated;
        const resource = { id: item.id, name: item.name, type: "mcp" as const };
        return <Card key={item.id} variant="resource" layout="row" surface="plain" data-testid="enterprise-mcp-card">
          <CardHeader>
            <CardIcon><Plug /></CardIcon>
            <div className="min-w-0">
              <CardTitle as="h3">{item.name}</CardTitle>
              {item.description ? <CardDescription>{item.description}</CardDescription> : null}
              {item.status !== "published" ? <CardDescription>{t(item.status === "archived" ? "enterprise_mcp.archived" : "enterprise_mcp.draft")}</CardDescription> : null}
              {configured ? <CardDescription>{t(connected ? "mcp.connected" : "plugin_platform.status.installed")}</CardDescription> : null}
            </div>
          </CardHeader>
          <CardFooter className="flex flex-wrap gap-2">
            {configured ? <Button variant="ghost" disabled={!ready || busy !== null} onClick={() => void removeResource(name)}>{t("enterprise_mcp.uninstall")}</Button> : null}
            {!connected && item.status === "published" ? <Button variant="outline" disabled={!ready || busy !== null || loadError} onClick={() => void installResource(item)}>
              {busy === name ? t("common.loading") : t(updated ? "template_market.update" : configured ? "enterprise_mcp.reconnect" : "enterprise_connection.install_from_enterprise")}
            </Button> : null}
            {manager ? <>
              <Button variant="ghost" onClick={() => setEditor({ item })}>{t("enterprise_mcp.edit")}</Button>
              <Button variant="ghost" onClick={() => setAction({ resource, kind: "access" })}>{t("enterprise_mcp.assign_access")}</Button>
              <Button variant="ghost" onClick={() => setAction({ resource, kind: item.status === "published" ? "archive" : "restore" })}>
                {t(item.status === "published" ? "enterprise_mcp.archive" : "enterprise_mcp.restore")}
              </Button>
            </> : null}
          </CardFooter>
        </Card>;
      })}
      {visibleUnlisted.map(server => <Card key={server.name} variant="resource" layout="row" surface="plain">
        <CardHeader><CardIcon><Plug /></CardIcon><div className="min-w-0">
          <CardTitle as="h3">{t("enterprise_mcp.unlisted")}</CardTitle>
          {server.config.type === "remote" ? <CardDescription className="break-all">{server.config.url}</CardDescription> : null}
        </div></CardHeader>
        <CardFooter><Button variant="outline" disabled={!ready || busy !== null} onClick={() => void removeResource(server.name)}>{t("enterprise_mcp.uninstall")}</Button></CardFooter>
      </Card>)}
    </div>
    {next ? <Button variant="outline" className="self-start" disabled={loading} onClick={() => void loadMore()}>{t("enterprise_mcp.more")}</Button> : null}
    {manager && editor ? <McpEditor enterprise={enterprise} item={editor.item} onClose={() => setEditor(null)} onSaved={reload} /> : null}
    {manager && action ? <EnterpriseResourceActionDialog connection={enterprise} action={action} onClose={() => setAction(null)} onChanged={reload} /> : null}
  </Layout>;
}

function McpEditor({ enterprise, item, onClose, onSaved }: {
  enterprise: EnterpriseConnection;
  item?: EnterpriseMcpResource;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [oauth, setOAuth] = useState(item?.mcpRequiresOAuth ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const fields = new FormData(event.currentTarget);
    const input = enterpriseMcpInputSchema.safeParse({
      name: fields.get("name"), url: String(fields.get("url") ?? "").trim(),
      description: fields.get("description"), requiresOAuth: oauth,
    });
    if (!input.success) {
      setError(t("enterprise_mcp.invalid_config"));
      return;
    }
    setSaving(true);
    setError("");
    try {
      await enterpriseApi.saveMcp(enterprise, input.data, item?.id);
      onSaved();
      onClose();
    } catch (cause) {
      setError(enterpriseErrorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>{t(item ? "enterprise_mcp.edit" : "enterprise_mcp.publish")}</DialogTitle>
        <DialogDescription>{t(item ? "enterprise_mcp.edit_description" : "enterprise_mcp.publish_description")}</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={(event) => void save(event)}>
        <Field><FieldLabel htmlFor="enterprise-mcp-name">{t("mcp_library.name")}</FieldLabel><Input id="enterprise-mcp-name" name="name" defaultValue={item?.name} maxLength={96} disabled={saving} required /></Field>
        <Field><FieldLabel htmlFor="enterprise-mcp-url">{t("mcp_library.url")}</FieldLabel><Input id="enterprise-mcp-url" name="url" type="url" defaultValue={item?.mcpUrl} maxLength={2048} disabled={saving} required /></Field>
        <Field><FieldLabel htmlFor="enterprise-mcp-description">{t("enterprise_mcp.description_field")}</FieldLabel><Input id="enterprise-mcp-description" name="description" defaultValue={item?.description ?? ""} disabled={saving} maxLength={240} /></Field>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={oauth} onCheckedChange={setOAuth} disabled={saving} />{t("mcp_library.oauth")}</label>
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
        <DialogFooter><Button variant="outline" type="button" disabled={saving} onClick={onClose}>{t("common.cancel")}</Button>
          <Button type="submit" disabled={saving}>{t(saving ? "common.loading" : item ? "common.save" : "enterprise_mcp.publish")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
