/** @jsxImportSource react */
import { useLocation } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { settingsPageTitleClass, settingsPageDescriptionClass, settingsStandardContentClass } from "@/react-app/domains/settings/shell/panel";
import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { Building2, Cloud, Download, Loader2, Plus, RefreshCw, Sparkles, User } from "lucide-react";
import type { DenOrgSkillCard, HubSkillCard, HubSkillRepo, SkillCard } from "@/app/types";
import type { InstalledEnterpriseSkill } from "@ipollowork/types/skills";
import type { iPolloWorkPluginPackageItem, iPolloWorkServerClient, StandaloneSkillPackage } from "@/app/lib/ipollowork-server";
import { downloadBlobAsFile } from "@/app/lib/download";
import { downloadEnterpriseResource, listEnterpriseResources, type EnterpriseResource } from "@/app/lib/enterprise-connections";
import { canManageEnterprise, enterpriseApi, enterpriseErrorMessage, enterpriseSkillContext } from "@/app/lib/enterprise-client";
import { downloadPublicSkill, listPublicSkills, skillFileDigest, type PublicSkill } from "@/app/lib/skill-catalog";
import { EnterpriseResourceControls, EnterpriseResourceActionDialog, type EnterpriseResourceAction, useActiveEnterpriseConnection } from "@/react-app/domains/enterprise";
import { Card, CardHeader, CardTitle, CardDescription, CardIcon, CardFooter, CardActionsMenu } from "@/components/ui/card";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Button, ButtonStyleScopeProvider } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { SearchField } from "@/components/ui/search-field";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
type InstallResult = { ok: boolean; message: string };
type Source = "personal" | "public" | "enterprise";
export type ImportedCloudSkillRecord = {
  installedName: string;
  updatedAt?: string | null;
};

export type SkillsExtensionsStore = {
  skills: () => SkillCard[];
  skillsStatus: () => string | null;
  hubSkills: () => HubSkillCard[];
  hubSkillsStatus: () => string | null;
  cloudOrgSkills: () => DenOrgSkillCard[];
  cloudOrgSkillsStatus: () => string | null;
  importedCloudSkills: () => Record<string, ImportedCloudSkillRecord>;
  hubRepo: () => HubSkillRepo | null;
  hubRepos: () => HubSkillRepo[];
  ensureHubSkillsFresh: () => void | Promise<void>;
  ensureCloudOrgSkillsFresh: () => void | Promise<void>;
  refreshSkills: (options?: { force?: boolean }) => void | Promise<void>;
  refreshHubSkills: (options?: { force?: boolean }) => void | Promise<void>;
  refreshCloudOrgSkills: (options?: { force?: boolean }) => void | Promise<void>;
  setHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  addHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  removeHubRepo: (repo: HubSkillRepo) => void | Promise<void>;
  installSkillCreator: () => Promise<InstallResult>;
  installCloudOrgSkill: (skill: DenOrgSkillCard) => Promise<InstallResult>;
  installHubSkill: (name: string) => Promise<InstallResult>;
  importLocalSkill: () => void | Promise<void>;
  revealSkillsFolder: () => void | Promise<void>;
  readSkill: (name: string) => Promise<{ content: string } | null>;
  saveSkill: (input: {
    name: string;
    content: string;
    description?: string;
  }) => void | Promise<void>;
  uninstallSkill: (name: string) => void | Promise<void>;
};

export type SkillsViewProps = {
  client?: iPolloWorkServerClient | null;
  workspaceId?: string | null;
  workspaceName: string;
  busy: boolean;
  showHeader?: boolean;
  canInstallSkillCreator: boolean;
  canUseDesktopTools: boolean;
  accessHint?: string | null;
  extensions: SkillsExtensionsStore;
  onOpenLink: (url: string) => void;
  createSessionAndOpen: (initialPrompt?: string) => Promise<string | undefined> | string | void;
  showActions?: boolean;
};

export type SkillsViewHandle = {
  refresh: () => void;
  importLocal: () => void;
  createInChat: () => void;
};



export const SkillsView = forwardRef<SkillsViewHandle, SkillsViewProps>(function SkillsView(props, ref) {
  const connection = useActiveEnterpriseConnection();
  const location = useLocation();
  const fieldId = useId();
  const exportTrigger = useRef<HTMLButtonElement>(null);
  const [resourceAction, setResourceAction] = useState<EnterpriseResourceAction | null>(null);
  const [source, setSource] = useState<Source>(() => new URLSearchParams(location.search).get("source") === "enterprise" ? "enterprise" : "personal");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [pluginPackages, setPluginPackages] = useState<iPolloWorkPluginPackageItem[]>([]);
  const [personal, setPersonal] = useState<StandaloneSkillPackage[]>([]);
  const [installed, setInstalled] = useState<InstalledEnterpriseSkill[]>([]);
  const [enterprise, setEnterprise] = useState<EnterpriseResource[]>([]);
  const [publicItems, setPublicItems] = useState<PublicSkill[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState<StandaloneSkillPackage | null>(null);
  const [title, setTitle] = useState("");
  const [version, setVersion] = useState("1.0.0");
  const [details, setDetails] = useState<{ title: string; content: string; files?: string[]; editable?: StandaloneSkillPackage } | null>(null);
  const [content, setContent] = useState("");
  const [uninstalling, setUninstalling] = useState<StandaloneSkillPackage | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const epoch = useRef(0);
  const client = props.client;
  const workspaceId = props.workspaceId;
  const identity = `${workspaceId ?? ""}:${source}:${connection?.origin ?? ""}:${connection?.id ?? ""}:${connection?.membership.id ?? ""}`;
  const actor = useRef({ identity, client });
  if (actor.current.identity !== identity || actor.current.client !== client) actor.current = { identity, client };
  const ready = Boolean(client && workspaceId && !props.busy && !pending);
  const reload = useCallback(async (more = false) => {
    const request = ++epoch.current; setLoading(true); setError("");
    try {
      if (source === "public") {
        const result = await listPublicSkills({ search, cursor: more ? cursor : null });
        if (request !== epoch.current) return;
        if (more && result.nextCursor === cursor && cursor) throw new Error("公开技能分页无效，请联系云端管理员。");
        setPublicItems((items) => more ? [...new Map([...items, ...result.items].map((item) => [item.id, item])).values()].slice(0, 500) : result.items); setCursor(result.nextCursor);
      }
      if (client && workspaceId) {
        await client.setEnterpriseSkillContext(workspaceId, connection?.features?.skills ? enterpriseSkillContext(connection) : null);
        const [result, plugins] = await Promise.all([
          client.listSkillPackages(workspaceId),
          source === "personal" ? client.listPluginPackages(workspaceId).catch(() => ({ items: [] })) : Promise.resolve({ items: [] }),
        ]);
        if (request !== epoch.current) return;
        setPersonal(result.personal); setInstalled(result.enterprise); setPluginPackages(plugins.items);
        if (source === "enterprise" && connection) { const items = await listEnterpriseResources("skill", { connection }); if (request === epoch.current) setEnterprise(items); }
      } else if (source === "personal") {
        setPersonal(props.extensions.skills().map((item) => ({ ...item, scope: "project", description: item.description ?? "", pluginName: null, canExport: false, source: null })));
      }
    } catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "技能暂时无法加载。"); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [client, workspaceId, source, search, cursor, connection, props.extensions]);
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => {
    setResourceAction(null); setDetails(null); setExporting(null); setUninstalling(null); setPending(false); setError(""); setPersonal([]); setPluginPackages([]); setInstalled([]); setEnterprise([]); setCursor(null); setPublicItems([]);
    const timer = window.setTimeout(() => void reloadRef.current(), source === "public" ? 250 : 0);
    return () => { window.clearTimeout(timer); epoch.current += 1; };
  }, [client, workspaceId, source, source === "public" ? search : "", connection?.id, connection?.membership.id]);
  useEffect(() => { if (source === "enterprise" && !connection) setSource("personal"); }, [source, connection]);
  const perform = async (action: (isCurrent: () => boolean) => Promise<unknown>, message: string) => {
    const startedBy = actor.current;
    const isCurrent = () => actor.current === startedBy;
    setPending(true); setError("");
    try { await action(isCurrent); if (isCurrent()) { toast.success(message); await reloadRef.current(); } }
    catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : "操作未完成，请重试。"); }
    finally { if (isCurrent()) setPending(false); }
  };
  useImperativeHandle(ref, () => ({ refresh: () => void reloadRef.current(), importLocal: () => fileInput.current?.click(), createInChat: () => void props.createSessionAndOpen("帮我创建一个独立技能，包含标准 SKILL.md 和必要的配套文件。") }), [props.createSessionAndOpen]);
  const filtered = <T extends { name: string; description?: string | null }>(items: T[]) => items.filter((item) => `${item.name} ${item.description ?? ""}`.toLowerCase().includes(search.trim().toLowerCase()));
  const visiblePersonal = status !== "available" && status !== "update" ? filtered(personal) : [];
  const visiblePublic = publicItems.filter((item) => { const existing = personal.find((skill) => skill.source?.resourceId === item.id); return status === "all" || (status === "installed" ? Boolean(existing) : status === "available" ? !existing : existing && existing.source?.version !== item.latestVersion.version); });
  const visibleEnterprise = enterprise.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())).filter((item) => { const existing = installed.find((skill) => skill.resourceId === item.id); return status === "all" || (status === "installed" ? Boolean(existing) : status === "available" ? !existing : existing && existing.manifest.version !== item.latestVersion?.version); });
  const revokedEnterprise = installed.filter((item) => !enterprise.some((resource) => resource.id === item.resourceId));
  const empty = source === "personal" ? !visiblePersonal.length : source === "public" ? !visiblePublic.length : !visibleEnterprise.length && !revokedEnterprise.length;
  const savePackage = async (file: File) => downloadBlobAsFile(file.name, file);
  const exportPackage = async (submit: boolean) => {
    if (!exporting || !client || !workspaceId) return;
    await perform(async () => {
      const result = await client.exportSkillPackage(workspaceId, { name: exporting.name, title: title.trim(), version: version.trim() });
      const file = new File([result.data], result.filename ?? `${exporting.name}-${version}.ipollowork-skill`, { type: "application/vnd.ipollowork.skill+zip" });
      if (submit && connection) await enterpriseApi.submit(connection, "skill", file); else await savePackage(file);
      setExporting(null);
    }, submit ? "技能投稿已提交，等待审核。" : "技能包已导出。");
  };
  const openLocal = (item: StandaloneSkillPackage) => void perform(async (isCurrent) => {
    if (!client || !workspaceId) return;
    const result = await client.getSkill(workspaceId, item.name, { includeGlobal: true });
    if (!isCurrent()) return;
    setDetails({ title: item.name, content: result.content, ...(!item.pluginName && item.scope === "project" ? { editable: item } : {}) }); setContent(result.content);
  }, "技能内容已加载。");
  const installRemote = (item: PublicSkill) => void perform(async () => {
    if (!client || !workspaceId) return;
    const result = await downloadPublicSkill(item); await client.importSkillPackage(workspaceId, result.file, result.source); await props.extensions.refreshSkills({ force: true });
  }, "公开技能已安装。");
  const mutateEnterprise = (item: InstalledEnterpriseSkill, enabled: boolean | null) => void perform(async () => {
    if (!client || !workspaceId || !connection) return;
    await client.setEnterpriseSkillContext(workspaceId, enterpriseSkillContext(connection)); await client.updateEnterpriseSkill(workspaceId, item.resourceId, enabled);
  }, enabled === null ? "企业技能已卸载。" : enabled ? "企业技能已启用。" : "企业技能已停用。");
  return <ButtonStyleScopeProvider value="settings" flat><section className={`${settingsStandardContentClass} space-y-5`} data-testid="skills-catalog">
    {props.showHeader !== false ? <div><h2 className={settingsPageTitleClass}>技能</h2><p className={`${settingsPageDescriptionClass} max-w-[714px]`}>管理独立技能；插件内置技能随所属插件管理。</p></div> : null}
    <Tabs className="gap-5" value={source} onValueChange={(value) => { if (value === "personal" || value === "public" || value === "enterprise") setSource(value); }}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <TabsList aria-label="技能来源" className="max-w-full">
        <TabsTrigger value="personal" className="flex-none shrink-0"><User className="size-4" />个人</TabsTrigger>
        <TabsTrigger value="public" className="flex-none shrink-0"><Cloud className="size-4" />公开</TabsTrigger>
        {connection ? <TabsTrigger value="enterprise" className="min-w-0 max-w-64 flex-initial" title={connection.name}><Building2 className="size-4 shrink-0" /><span className="truncate">{connection.name}</span></TabsTrigger> : null}
      </TabsList>
      <div className="flex flex-wrap items-center gap-2">
        {source === "personal" && connection ? <EnterpriseResourceControls mode="submissions" key={`${connection.id}:${connection.membership.id}`} connection={connection} type="skill" onChanged={() => void reloadRef.current()} /> : null}
        {props.showActions !== false ? <>
          {source === "personal" ? <><Button size="sm" variant="outline" disabled={!ready} onClick={() => fileInput.current?.click()}><Download className="size-4" />导入技能</Button><Button size="sm" variant="outline" disabled={props.busy || !props.canInstallSkillCreator} onClick={() => void props.createSessionAndOpen("帮我创建一个独立技能，包含标准 SKILL.md 和必要的配套文件。") }><Plus className="size-4" />创建技能</Button></> : null}
          <Button size="icon-sm" variant="ghost" aria-label="刷新技能" disabled={loading || pending} onClick={() => void reloadRef.current()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
        </> : null}
      </div>
    </div>
    <TabsContent value={source} className="space-y-5">
    <input ref={fileInput} type="file" accept=".md,.ipollowork-skill" className="hidden" aria-label="导入独立技能包" onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file || !client || !workspaceId) return;
      void perform(async () => { const digest = await skillFileDigest(await file.arrayBuffer()); await client.importSkillPackage(workspaceId, file, { origin: "local", resourceId: "local", digest }); await props.extensions.refreshSkills({ force: true }); }, "技能包已导入。");
    }} />
    <div className="flex flex-wrap gap-3"><Field className="min-w-48 flex-1"><FieldLabel className="sr-only" htmlFor={`${fieldId}-search`}>搜索技能名称或说明</FieldLabel><SearchField id={`${fieldId}-search`} value={search} onValueChange={setSearch} clearLabel="清除技能搜索" placeholder="搜索技能名称或说明" containerClassName="bg-transparent hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent" /></Field><Select value={status} onValueChange={(value) => setStatus(value ?? "all")}><SelectTrigger className="w-32" aria-label="技能状态" data-testid="skills-status-filter"><SelectValue>{status === "all" ? "全部状态" : status === "installed" ? "已安装" : status === "available" ? "未安装" : "可更新"}</SelectValue></SelectTrigger><SelectContent>{[["all", "全部状态"], ["installed", "已安装"], ["available", "未安装"], ["update", "可更新"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    {error && !exporting ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
    {source === "enterprise" ? <p className="text-xs text-muted-foreground">企业技能仅在当前企业账号获授权时加载。撤权或离线后，后续任务停止加载，已下载文件另行管理。</p> : null}
    {loading ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在加载技能</div> : <div className="grid gap-3 lg:grid-cols-2">
      {source === "personal" && status !== "available" && status !== "update" ? visiblePersonal.map((item) => { const matches = item.pluginName ? pluginPackages.filter((plugin) => plugin.name === item.pluginName) : []; const plugin = matches.length === 1 ? matches[0] : undefined; const iconUrl = plugin ? resolveExtensionIconUrl({ pluginId: plugin.pluginId, iconSrc: plugin.manifest.icon?.src, iconSlug: plugin.manifest.icon?.simpleIconSlug }) : undefined; return <Card variant="resource" layout="row" surface="plain" key={item.path} data-testid="skill-card" data-source={source}><CardHeader><CardIcon>{iconUrl ? <img src={iconUrl} alt={item.pluginName ?? ""}  /> : <Sparkles />}</CardIcon><div className="min-w-0 flex-1 space-y-1"><CardTitle as="h3" title={`${item.name}${item.pluginName ? ` · 来自插件 ${item.pluginName}` : item.source?.origin === "local" ? " · 本地导入" : item.source ? " · 来自公开云端" : item.scope === "global" ? " · 设备全局技能" : " · 个人技能"}${item.source ? ` · v${item.source.version}` : plugin ? ` · v${plugin.version}` : ""}`} className="truncate">{item.name}</CardTitle><CardDescription title={item.description || "暂无说明"} className="line-clamp-1">{item.description || "暂无说明"}</CardDescription></div></CardHeader><CardFooter><CardActionsMenu label={`${item.name}的操作`}><DropdownMenuItem disabled={pending} onClick={() => openLocal(item)}>查看</DropdownMenuItem>{item.canExport ? <DropdownMenuItem disabled={!ready} onClick={() => { exportTrigger.current = document.querySelector<HTMLButtonElement>(`button[aria-label=${JSON.stringify(`${item.name}的操作`)}]`); setError(""); setExporting(item); setTitle(item.name); setVersion(item.source?.version ?? "1.0.0"); }}>导出 / 投稿</DropdownMenuItem> : null}{!item.pluginName && item.scope === "project" ? <DropdownMenuItem disabled={!ready} onClick={() => setUninstalling(item)}>卸载</DropdownMenuItem> : null}</CardActionsMenu></CardFooter></Card>; }) : null}
      {source === "public" ? visiblePublic.map((item) => { const existing = personal.find((skill) => skill.source?.resourceId === item.id); const current = existing?.source?.version === item.latestVersion.version; return <Card variant="resource" layout="row" surface="plain" key={item.id} data-testid="skill-card" data-source={source}><CardHeader><CardIcon><Sparkles /></CardIcon><div className="min-w-0 flex-1 space-y-1"><CardTitle as="h3" title={`${item.title} · ${item.authorName} · ${item.category} · v${item.latestVersion.version}`} className="truncate">{item.title}</CardTitle><CardDescription title={item.description} className="line-clamp-1">{item.description}</CardDescription></div></CardHeader><CardFooter><CardActionsMenu label={`${item.title}的操作`}><DropdownMenuItem disabled={pending} onClick={() => void perform(async () => { const result = await downloadPublicSkill(item); await savePackage(result.file); }, "技能包已下载。")}>下载</DropdownMenuItem><DropdownMenuItem disabled={!ready || current} onClick={() => installRemote(item)}>{current ? "已安装" : existing ? "更新" : "安装"}</DropdownMenuItem></CardActionsMenu></CardFooter></Card>; }) : null}
      {source === "enterprise" ? visibleEnterprise.map((item) => { const existing = installed.find((skill) => skill.resourceId === item.id); const current = existing?.manifest.version === item.latestVersion?.version; return <Card variant="resource" layout="row" surface="plain" key={item.id} data-testid="skill-card" data-source={source}><CardHeader><CardIcon><Sparkles /></CardIcon><div className="min-w-0 flex-1 space-y-1"><CardTitle as="h3" title={`${item.name} · ${item.enterpriseCategory}${item.latestVersion ? ` · v${item.latestVersion.version}` : ""}${existing ? existing.enabled ? " · 已启用" : " · 已停用" : ""}`} className="truncate">{item.name}</CardTitle><CardDescription title={item.description} className="line-clamp-1">{item.description}</CardDescription></div></CardHeader><CardFooter><CardActionsMenu label={`${item.name}的操作`}><DropdownMenuItem disabled={pending} onClick={() => void perform(async () => { if (connection) await savePackage(await downloadEnterpriseResource(item, { connection })); }, "技能包已下载。")}>下载</DropdownMenuItem><DropdownMenuItem disabled={pending || !item.latestVersion} onClick={() => void perform(async (isCurrent) => { if (!connection || !item.latestVersion) return; const result = await enterpriseApi.skill(connection, item.id, item.latestVersion.version); if (!isCurrent()) return; setDetails({ title: item.name, content: result.content, files: result.files }); setContent(result.content); }, "技能内容已加载。")}>查看</DropdownMenuItem>{existing ? <><DropdownMenuItem disabled={!ready} onClick={() => mutateEnterprise(existing, !existing.enabled)}>{existing.enabled ? "停用" : "启用"}</DropdownMenuItem><DropdownMenuItem disabled={!ready} onClick={() => mutateEnterprise(existing, null)}>卸载</DropdownMenuItem></> : null}{!current && item.latestVersion ? <DropdownMenuItem disabled={!ready} onClick={() => void perform(async () => { if (!client || !workspaceId || !connection || !item.latestVersion) return; await client.installEnterpriseSkill(workspaceId, { context: enterpriseSkillContext(connection), resourceId: item.id, version: item.latestVersion.version, digest: item.latestVersion.digest }); }, "企业技能已安装。")}>{existing ? "更新" : "安装"}</DropdownMenuItem> : null}{connection && canManageEnterprise(connection, "skill") ? <><DropdownMenuItem disabled={pending || !connection.features?.resourcePermissions} onClick={() => setResourceAction({ resource: item, kind: "access" })}>分配权限</DropdownMenuItem><DropdownMenuItem variant="destructive" disabled={pending} onClick={() => setResourceAction({ resource: item, kind: "archive" })}>下架</DropdownMenuItem></> : null}</CardActionsMenu></CardFooter></Card>; }) : null}
      {source === "enterprise" ? revokedEnterprise.map((item) => <Card variant="resource" layout="row" surface="plain" key={item.resourceId} data-testid="skill-card" data-source="revoked"><CardHeader><CardIcon><Sparkles /></CardIcon><div className="min-w-0 flex-1 space-y-1"><CardTitle as="h3" title={`${item.manifest.title} · v${item.manifest.version}`} className="truncate">{item.manifest.title}</CardTitle><CardDescription title="权限已撤销或资源已下架，后续任务不再加载。" className="line-clamp-1">权限已撤销或资源已下架，后续任务不再加载。</CardDescription></div></CardHeader><CardFooter><CardActionsMenu label={`${item.manifest.title}的操作`}><DropdownMenuItem disabled={!ready} onClick={() => mutateEnterprise(item, null)}>卸载本地副本</DropdownMenuItem></CardActionsMenu></CardFooter></Card>) : null}
    </div>}
    {!loading && !error && empty ? <Empty><EmptyDescription>{search.trim() || status !== "all" ? "没有匹配的技能。" : source === "personal" ? "暂无独立技能，可以创建或导入技能包。" : source === "public" ? "暂无公开技能。" : "暂无获授权的企业技能。"}</EmptyDescription>{search.trim() || status !== "all" ? <Button variant="outline" size="sm" onClick={() => { setSearch(""); setStatus("all"); }}>清除筛选</Button> : null}</Empty> : null}
    {source === "personal" ? <p className="text-xs text-muted-foreground">支持导入标准技能 .md（最大 1 MB）；含脚本、参考资料的技能请使用 .ipollowork-skill 包。</p> : null}
    {source === "public" && cursor && publicItems.length < 500 ? <Button variant="outline" disabled={loading} onClick={() => void reload(true)}>加载更多技能</Button> : null}
    </TabsContent>
    <Dialog open={Boolean(exporting)} onOpenChange={(open) => { if (!open && !pending) setExporting(null); }}><DialogContent finalFocus={exportTrigger} className="max-w-lg" data-testid="skill-export-dialog"><DialogHeader><DialogTitle>导出独立技能 / 企业投稿</DialogTitle><DialogDescription>包含 SKILL.md 和同目录配套文件。插件内置技能由所属插件管理。</DialogDescription></DialogHeader>{error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}<Field><FieldLabel htmlFor={`${fieldId}-title`}>技能名称</FieldLabel><Input id={`${fieldId}-title`} disabled={pending} value={title} maxLength={96} onChange={(event) => setTitle(event.target.value)} /></Field><Field><FieldLabel htmlFor={`${fieldId}-version`}>版本号</FieldLabel><Input id={`${fieldId}-version`} disabled={pending} value={version} maxLength={64} placeholder="1.0.0" onChange={(event) => setVersion(event.target.value)} /></Field><DialogFooter><Button variant="outline" disabled={pending || !title.trim()} onClick={() => void exportPackage(false)}>导出技能包</Button>{connection?.features?.skillPublishing ? <Button disabled={pending || !title.trim()} onClick={() => void exportPackage(true)}>提交到{connection.name}</Button> : null}</DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(details)} onOpenChange={(open) => { if (!open && !pending) setDetails(null); }}><DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{details?.title}</DialogTitle><DialogDescription>{details?.editable ? "编辑当前项目中的技能正文。" : "技能内容仅供查看，企业技能和插件技能由来源管理。"}</DialogDescription></DialogHeader><Textarea aria-label="技能正文" className="min-h-72 font-mono text-xs" value={content} readOnly={!details?.editable} onChange={(event) => setContent(event.target.value)} />{details?.files ? <details><summary className="cursor-pointer text-sm">配套文件（{details.files.length}）</summary><ul className="mt-2 text-xs text-muted-foreground">{details.files.map((file) => <li key={file}>{file}</li>)}</ul></details> : null}{details?.editable ? <DialogFooter><Button disabled={pending} onClick={() => void perform(async () => { if (!details.editable) return; await props.extensions.saveSkill({ name: details.editable.name, content, description: details.editable.description ?? "" }); setDetails(null); }, "技能已保存。")}>保存技能</Button></DialogFooter> : null}</DialogContent></Dialog>
    {connection && resourceAction ? <EnterpriseResourceActionDialog connection={connection} action={resourceAction} onClose={() => setResourceAction(null)} onChanged={() => void reloadRef.current()} /> : null}
    <ConfirmModal open={Boolean(uninstalling)} title="卸载技能" message={`将移除当前项目中的 ${uninstalling?.name ?? ""} 及其配套文件。`} confirmLabel="卸载" variant="danger" cancelLabel="取消" onCancel={() => setUninstalling(null)} onConfirm={() => void perform(async () => { if (uninstalling) await props.extensions.uninstallSkill(uninstalling.name); setUninstalling(null); }, "技能已卸载。") } />
    </Tabs>
  </section></ButtonStyleScopeProvider>;
});
