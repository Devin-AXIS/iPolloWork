/** @jsxImportSource react */
import { useLocation } from "react-router-dom";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { settingsPageTitleClass, settingsPageDescriptionClass } from "@/react-app/domains/settings/shell/panel";
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Building2, Cloud, Download, Loader2, Plus, RefreshCw, Search, Sparkles, User } from "lucide-react";
import type { DenOrgSkillCard, HubSkillCard, HubSkillRepo, SkillCard } from "@/app/types";
import type { InstalledEnterpriseSkill } from "@ipollowork/types/skills";
import type { iPolloWorkServerClient, StandaloneSkillPackage } from "@/app/lib/ipollowork-server";
import { downloadBlobAsFile } from "@/app/lib/download";
import { downloadEnterpriseResource, listEnterpriseResources, type EnterpriseResource } from "@/app/lib/enterprise-connections";
import { enterpriseApi, enterpriseErrorMessage, enterpriseSkillContext } from "@/app/lib/enterprise-client";
import { downloadPublicSkill, listPublicSkills, skillFileDigest, type PublicSkill } from "@/app/lib/skill-catalog";
import { EnterpriseResourceControls, useActiveEnterpriseConnection } from "@/react-app/domains/enterprise";
import { Button } from "@/components/ui/button";
import { SettingsResourceListItem, settingsResourceGridClassName } from "../settings-list";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/components/ui/sonner";
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
  const [source, setSource] = useState<Source>(() => new URLSearchParams(location.search).get("source") === "enterprise" ? "enterprise" : "personal");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
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
        const result = await client.listSkillPackages(workspaceId);
        if (request !== epoch.current) return;
        setPersonal(result.personal); setInstalled(result.enterprise);
        if (source === "enterprise" && connection) { const items = await listEnterpriseResources("skill", { connection }); if (request === epoch.current) setEnterprise(items); }
      } else if (source === "personal") {
        setPersonal(props.extensions.skills().map((item) => ({ ...item, scope: "project", description: item.description ?? "", pluginName: null, canExport: false, source: null })));
      }
    } catch (cause) { if (request === epoch.current) setError(cause instanceof Error ? cause.message : "技能暂时无法加载。"); }
    finally { if (request === epoch.current) setLoading(false); }
  }, [client, workspaceId, source, search, cursor, connection, props.extensions]);
  const reloadRef = useRef(reload); reloadRef.current = reload;
  useEffect(() => {
    setDetails(null); setExporting(null); setUninstalling(null); setPending(false); setError(""); setPersonal([]); setInstalled([]); setEnterprise([]); setCursor(null); setPublicItems([]);
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
  return <section className="mx-auto w-full max-w-[1280px] space-y-5" data-testid="skills-catalog">
    {props.showHeader !== false ? <div><h2 className={settingsPageTitleClass}>技能</h2><p className={`${settingsPageDescriptionClass} max-w-[714px]`}>管理独立技能；插件内置技能随所属插件管理。</p></div> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label="技能来源" className="flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-muted p-1">
        <Button size="sm" variant={source === "personal" ? "secondary" : "ghost"} aria-pressed={source === "personal"} onClick={() => setSource("personal")}><User className="size-4" />个人</Button>
        <Button size="sm" variant={source === "public" ? "secondary" : "ghost"} aria-pressed={source === "public"} onClick={() => setSource("public")}><Cloud className="size-4" />公开</Button>
        {connection ? <Button size="sm" className="max-w-64" variant={source === "enterprise" ? "secondary" : "ghost"} aria-pressed={source === "enterprise"} title={connection.name} onClick={() => setSource("enterprise")}><Building2 className="size-4 shrink-0" /><span className="truncate">{connection.name}</span></Button> : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {source === "enterprise" && connection ? <EnterpriseResourceControls key={`${connection.id}:${connection.membership.id}`} connection={connection} type="skill" onChanged={() => void reloadRef.current()} /> : null}
        {props.showActions !== false ? <>
          {source === "personal" ? <><Button size="sm" variant="outline" disabled={!ready} onClick={() => fileInput.current?.click()}><Download className="size-4" />导入技能</Button><Button size="sm" variant="outline" disabled={props.busy || !props.canInstallSkillCreator} onClick={() => void props.createSessionAndOpen("帮我创建一个独立技能，包含标准 SKILL.md 和必要的配套文件。") }><Plus className="size-4" />创建技能</Button></> : null}
          <Button size="icon-sm" variant="ghost" aria-label="刷新技能" disabled={loading || pending} onClick={() => void reloadRef.current()}><RefreshCw className={loading ? "size-4 animate-spin" : "size-4"} /></Button>
        </> : null}
      </div>
    </div>
    <input ref={fileInput} type="file" accept=".md,.ipollowork-skill" className="hidden" aria-label="导入独立技能包" onChange={(event) => {
      const file = event.target.files?.[0]; event.target.value = ""; if (!file || !client || !workspaceId) return;
      void perform(async () => { const digest = await skillFileDigest(await file.arrayBuffer()); await client.importSkillPackage(workspaceId, file, { origin: "local", resourceId: "local", digest }); await props.extensions.refreshSkills({ force: true }); }, "技能包已导入。");
    }} />
    <div className="flex flex-wrap gap-3"><div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索技能名称或说明" className="pl-9" /></div><Select value={status} onValueChange={(value) => setStatus(value ?? "all")}><SelectTrigger className="w-32" aria-label="技能状态" data-testid="skills-status-filter"><SelectValue>{status === "all" ? "全部状态" : status === "installed" ? "已安装" : status === "available" ? "未安装" : "可更新"}</SelectValue></SelectTrigger><SelectContent>{[["all", "全部状态"], ["installed", "已安装"], ["available", "未安装"], ["update", "可更新"]].map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select></div>
    {error ? <p role="alert" className="rounded-xl bg-feedback-error px-4 py-3 text-sm text-red-11">{error}</p> : null}
    {source === "enterprise" ? <p className="text-xs text-muted-foreground">企业技能仅在当前企业账号获授权时加载。撤权或离线后，后续任务停止加载，已下载文件另行管理。</p> : null}
    {loading ? <div role="status" className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />正在加载技能</div> : <div className={settingsResourceGridClassName}>
      {source === "personal" && status !== "available" && status !== "update" ? filtered(personal).map((item) => <SettingsResourceListItem key={item.path} testId="skill-resource-card" title={item.name} description={item.description || "暂无说明"} icon={<Sparkles className="size-5" />} onOpen={() => openLocal(item)} metadata={<>{item.pluginName ? `来自插件 ${item.pluginName}` : item.source?.origin === "local" ? "本地导入" : item.source ? "来自公开云端" : item.scope === "global" ? "设备全局技能" : "个人技能"}{item.source ? ` · v${item.source.version}` : ""}</>} actions={<><Button size="sm" variant="ghost" disabled={pending} onClick={() => openLocal(item)}>查看</Button>{item.canExport ? <Button size="sm" variant="outline" disabled={!ready} onClick={() => { setExporting(item); setTitle(item.name); setVersion(item.source?.version ?? "1.0.0"); }}>导出 / 投稿</Button> : null}{!item.pluginName && item.scope === "project" ? <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setUninstalling(item)}>卸载</Button> : null}</>} />) : null}
      {source === "public" ? publicItems.filter((item) => { const existing = personal.find((skill) => skill.source?.resourceId === item.id); return status === "all" || (status === "installed" ? Boolean(existing) : status === "available" ? !existing : existing && existing.source?.version !== item.latestVersion.version); }).map((item) => { const existing = personal.find((skill) => skill.source?.resourceId === item.id); const current = existing?.source?.version === item.latestVersion.version; return <SettingsResourceListItem key={item.id} testId="skill-resource-card" title={item.title} description={item.description} icon={<Sparkles className="size-5" />} metadata={<><span>v{item.latestVersion.version}</span><span>{item.authorName} · {item.category}</span></>} actions={<><Button size="sm" variant="ghost" disabled={pending} onClick={() => void perform(async () => { const result = await downloadPublicSkill(item); await savePackage(result.file); }, "技能包已下载。")}>下载</Button><Button size="sm" variant="outline" disabled={!ready || current} onClick={() => installRemote(item)}>{current ? "已安装" : existing ? "更新" : "安装"}</Button></>} />; }) : null}
      {source === "enterprise" ? enterprise.filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(search.toLowerCase())).filter((item) => { const existing = installed.find((skill) => skill.resourceId === item.id); return status === "all" || (status === "installed" ? Boolean(existing) : status === "available" ? !existing : existing && existing.manifest.version !== item.latestVersion?.version); }).map((item) => { const existing = installed.find((skill) => skill.resourceId === item.id); const current = existing?.manifest.version === item.latestVersion?.version; return <SettingsResourceListItem key={item.id} testId="skill-resource-card" title={item.name} description={item.description} icon={<Sparkles className="size-5" />} metadata={<><span>v{item.latestVersion?.version}</span><span>{item.enterpriseCategory}{existing ? existing.enabled ? " · 已启用" : " · 已停用" : ""}</span></>} actions={<><Button size="sm" variant="ghost" disabled={pending} onClick={() => void perform(async () => { if (connection) await savePackage(await downloadEnterpriseResource(item, { connection })); }, "技能包已下载。")}>下载</Button><Button size="sm" variant="ghost" disabled={pending || !item.latestVersion} onClick={() => void perform(async (isCurrent) => { if (!connection || !item.latestVersion) return; const result = await enterpriseApi.skill(connection, item.id, item.latestVersion.version); if (!isCurrent()) return; setDetails({ title: item.name, content: result.content, files: result.files }); setContent(result.content); }, "技能内容已加载。")}>查看</Button>{existing ? <><Button size="sm" variant="outline" disabled={!ready} onClick={() => mutateEnterprise(existing, !existing.enabled)}>{existing.enabled ? "停用" : "启用"}</Button><Button size="sm" variant="ghost" disabled={!ready} onClick={() => mutateEnterprise(existing, null)}>卸载</Button></> : null}{!current && item.latestVersion ? <Button size="sm" variant="outline" disabled={!ready} onClick={() => void perform(async () => { if (!client || !workspaceId || !connection || !item.latestVersion) return; await client.installEnterpriseSkill(workspaceId, { context: enterpriseSkillContext(connection), resourceId: item.id, version: item.latestVersion.version, digest: item.latestVersion.digest }); }, "企业技能已安装。")}>{existing ? "更新" : "安装"}</Button> : null}</>} />; }) : null}
      {source === "enterprise" ? installed.filter((item) => !enterprise.some((resource) => resource.id === item.resourceId)).map((item) => <SettingsResourceListItem key={item.resourceId} testId="skill-resource-card" title={item.manifest.title} description="权限已撤销或资源已下架，后续任务不再加载。" icon={<Sparkles className="size-5" />} metadata={<span>v{item.manifest.version}</span>} actions={<Button size="sm" variant="outline" disabled={!ready} onClick={() => mutateEnterprise(item, null)}>卸载本地副本</Button>} />) : null}
    </div>}
    {!loading && !error && (source === "personal" ? personal.length === 0 : source === "public" ? publicItems.length === 0 : enterprise.length === 0 && installed.length === 0) ? <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-muted-foreground">{source === "personal" ? "暂无独立技能，可以创建或导入技能包。" : source === "public" ? "暂无公开技能。" : "暂无获授权的企业技能。"}</div> : null}
    {source === "personal" ? <p className="text-xs text-muted-foreground">支持导入标准技能 .md（最大 1 MB）；含脚本、参考资料的技能请使用 .ipollowork-skill 包。</p> : null}
    {source === "public" && cursor && publicItems.length < 500 ? <Button variant="outline" disabled={loading} onClick={() => void reload(true)}>加载更多技能</Button> : null}
    <Dialog open={Boolean(exporting)} onOpenChange={(open) => { if (!open && !pending) setExporting(null); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>导出独立技能 / 企业投稿</DialogTitle><DialogDescription>包含 SKILL.md 和同目录配套文件。插件内置技能由所属插件管理。</DialogDescription></DialogHeader><label className="space-y-2 text-sm">技能名称<Input value={title} maxLength={96} onChange={(event) => setTitle(event.target.value)} /></label><label className="space-y-2 text-sm">版本号<Input value={version} maxLength={64} placeholder="1.0.0" onChange={(event) => setVersion(event.target.value)} /></label><DialogFooter><Button variant="outline" disabled={pending || !title.trim()} onClick={() => void exportPackage(false)}>导出技能包</Button>{connection?.features?.skillPublishing ? <Button disabled={pending || !title.trim()} onClick={() => void exportPackage(true)}>提交到{connection.name}</Button> : null}</DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(details)} onOpenChange={(open) => { if (!open && !pending) setDetails(null); }}><DialogContent className="max-h-[85dvh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{details?.title}</DialogTitle><DialogDescription>{details?.editable ? "编辑当前项目中的技能正文。" : "技能内容仅供查看，企业技能和插件技能由来源管理。"}</DialogDescription></DialogHeader><Textarea aria-label="技能正文" className="min-h-72 font-mono text-xs" value={content} readOnly={!details?.editable} onChange={(event) => setContent(event.target.value)} />{details?.files ? <details><summary className="cursor-pointer text-sm">配套文件（{details.files.length}）</summary><ul className="mt-2 text-xs text-muted-foreground">{details.files.map((file) => <li key={file}>{file}</li>)}</ul></details> : null}{details?.editable ? <DialogFooter><Button disabled={pending} onClick={() => void perform(async () => { if (!details.editable) return; await props.extensions.saveSkill({ name: details.editable.name, content, description: details.editable.description ?? "" }); setDetails(null); }, "技能已保存。")}>保存技能</Button></DialogFooter> : null}</DialogContent></Dialog>
    <ConfirmModal open={Boolean(uninstalling)} title="卸载技能" message={`将移除当前项目中的 ${uninstalling?.name ?? ""} 及其配套文件。`} confirmLabel="卸载" variant="danger" cancelLabel="取消" onCancel={() => setUninstalling(null)} onConfirm={() => void perform(async () => { if (uninstalling) await props.extensions.uninstallSkill(uninstalling.name); setUninstalling(null); }, "技能已卸载。") } />
  </section>;
});
