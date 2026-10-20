import { createHash, randomUUID } from "node:crypto";
import { lstat, realpath, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve, sep } from "node:path";
import { z } from "zod";
import { SKILL_PACKAGE_MANIFEST, MAX_SKILL_PACKAGE_BYTES, skillPackageManifestSchema, installedEnterpriseSkillSchema, type EnterpriseSkillContext, type EnterpriseSkillInstallInput, type InstalledEnterpriseSkill, type SkillPackageExportInput } from "@ipollowork/types/skills";
import { comparePluginPackageVersions } from "@ipollowork/types/plugins";
import { enterpriseMembershipResponseSchema } from "@ipollowork/types/enterprise";
import { ApiError } from "./errors.js";
import { readPackageZip, createStoredZip, type ZipEntry } from "./package-archive.js";
import { parseFrontmatter, buildFrontmatter } from "./frontmatter.js";
import { listSkills } from "./skills.js";
import { listInstalledPluginPackages } from "./plugin-package-lifecycle.js";
import { pluginEnginePortablePath } from "./plugin-engine-adapter.js";
import { projectSkillsDir } from "./workspace-files.js";
import { resolveWithinRoot } from "./paths.js";
import { runtimeStorageDir } from "./runtime-storage.js";
import { readLimitedRequestBody } from "./limited-request-body.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import pkg from "../package.json" with { type: "json" };

const allowed = new Set([".md", ".txt", ".json", ".yaml", ".yml", ".csv", ".tsv", ".html", ".css", ".js", ".mjs", ".ts", ".py", ".sh", ".ps1", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".gif", ".pdf", ".ipynb"]);
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const contexts = new Map<string, EnterpriseSkillContext>();
const projectionFingerprints = new Map<string, string>();
const queues = new Map<string, Promise<unknown>>();
const stateSchema = z.array(installedEnterpriseSkillSchema).max(200);
const projectionBases = [".opencode/skills", ".agents/skills", ".dsh/skills"];
const contextKey = (config: ServerConfig, workspace: WorkspaceInfo) => `${runtimeStorageDir(config)}:${workspace.id}`;
const identity = (context: Pick<EnterpriseSkillContext, "origin" | "enterpriseId" | "memberId">) => digest(`${context.origin.replace(/\/+$/u, "")}\n${context.enterpriseId}\n${context.memberId}`);
const storage = (config: ServerConfig, workspace: WorkspaceInfo) => join(runtimeStorageDir(config), "enterprise-skills", digest(resolve(workspace.path)));
const archivePath = (config: ServerConfig, workspace: WorkspaceInfo, item: InstalledEnterpriseSkill) => join(storage(config, workspace), identity(item), digest(item.resourceId), `${item.digest}.ipollowork-skill`);

async function skillPath(root: string, ...segments: string[]) {
  const base = await realpath(root); const candidate = await resolveWithinRoot(base, ...segments);
  let current = base;
  for (const part of relative(base, candidate).split(sep).filter(Boolean)) {
    current = join(current, part);
    const entry = await lstat(current).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!entry) break;
    if (entry.isSymbolicLink()) throw new ApiError(400, "unsafe_skill_file", "技能路径不能包含符号链接。");
  }
  return candidate;
}

async function locked<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const pending = previous.catch(() => undefined).then(action);
  queues.set(key, pending);
  try { return await pending; } finally { if (queues.get(key) === pending) queues.delete(key); }
}

export function validateSkillPackageFile(name: string, mode = 0) {
  const parts = name.split("/");
  if (!name || name.includes("\\") || name.includes(":") || name.includes("\0") || parts.some((part) => !part || part.startsWith(".") || part === "node_modules" || /[. ]$/u.test(part) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(part))) throw new ApiError(400, "unsafe_skill_file", "技能包包含不安全的文件路径。");
  const extension = extname(name).toLowerCase();
  const script = name.startsWith("scripts/") && [".py", ".sh", ".ps1", ".js", ".mjs", ".ts"].includes(extension);
  if ((mode & 0o170000) === 0o120000 || ((mode & 0o111) !== 0 && !script) || (!allowed.has(extension) && !["LICENSE", "NOTICE"].includes(basename(name)))) throw new ApiError(400, "unsafe_skill_file", "技能包包含不支持的文件或符号链接。");
  return name;
}

export async function inspectSkillArchive(bytes: Buffer) {
  if (bytes.length > MAX_SKILL_PACKAGE_BYTES) throw new ApiError(413, "skill_package_too_large", "技能包不能超过 50 MB。");
  const files = await readPackageZip(bytes, validateSkillPackageFile, { maximumExpandedBytes: MAX_SKILL_PACKAGE_BYTES, maximumFiles: 512 });
  if (files.length > 512 || files.reduce((sum, file) => sum + file.data.length, 0) > MAX_SKILL_PACKAGE_BYTES) throw new ApiError(413, "skill_package_too_large", "技能包解压后不能超过 50 MB 或 512 个文件。");
  const names = new Set(files.map((file) => file.name.toLowerCase()));
  if (names.size !== files.length || names.has("ipollowork.plugin.json") || names.has("manifest.json") || names.has("ipollowork.source.json")) throw new ApiError(400, "skill_package_type_mismatch", "请选择独立技能包，插件包不能作为技能安装。");
  let raw: unknown;
  try { raw = JSON.parse(files.find((file) => file.name === SKILL_PACKAGE_MANIFEST)?.data.toString("utf8") ?? ""); } catch { throw new ApiError(400, "invalid_skill_manifest", "技能包缺少有效的 ipollowork.skill.json。"); }
  const parsed = skillPackageManifestSchema.safeParse(raw);
  if (!parsed.success) throw new ApiError(400, "invalid_skill_manifest", "技能清单格式不正确。");
  const entry = files.find((file) => file.name === parsed.data.entry);
  if (!entry || entry.data.length > 1024 * 1024) throw new ApiError(400, "skill_entry_missing", "技能包缺少 SKILL.md 或正文过大。");
  const content = entry.data.toString("utf8");
  const { data } = parseFrontmatter(content);
  if (data.name !== parsed.data.name || typeof data.description !== "string" || !data.description.trim()) throw new ApiError(400, "invalid_skill_content", "SKILL.md 的名称和描述与技能清单不一致。");
  const compatibility = comparePluginPackageVersions(pkg.version, parsed.data.minimumAppVersion);
  if (compatibility === null || compatibility < 0) throw new ApiError(409, "skill_app_version_unsupported", "当前 iPolloWork 版本过低，请升级后安装技能。");
  return { manifest: parsed.data, content, files, digest: digest(bytes) };
}

export function skillMarkdownArchive(bytes: Buffer) {
  if (bytes.length > 1024 * 1024) throw new ApiError(413, "skill_markdown_too_large", "单个技能 MD 不能超过 1 MB。");
  try {
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (content.includes("\0") || !/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u.test(content)) throw new Error("Invalid Markdown");
    const { data } = parseFrontmatter(content);
    const metadata = z.object({ name: skillPackageManifestSchema.shape.name, description: skillPackageManifestSchema.shape.description, title: skillPackageManifestSchema.shape.title.optional(), version: skillPackageManifestSchema.shape.version.optional(), metadata: z.object({ version: skillPackageManifestSchema.shape.version.optional() }).optional() }).parse(data);
    const manifest = skillPackageManifestSchema.parse({ schemaVersion: 1, kind: "skill", id: `personal.${metadata.name}`, name: metadata.name, title: metadata.title ?? metadata.name, description: metadata.description, version: metadata.version ?? metadata.metadata?.version ?? "1.0.0", entry: "SKILL.md", category: "general", minimumAppVersion: "0.0.0", dependencies: [] });
    return createStoredZip([{ name: SKILL_PACKAGE_MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)) }, { name: "SKILL.md", data: Buffer.from(content) }]);
  } catch { throw new ApiError(400, "invalid_skill_markdown", "请选择 UTF-8 技能 MD，文件开头需包含有效的 name、description；版本号可选，默认 1.0.0。"); }
}

async function readState(config: ServerConfig, workspace: WorkspaceInfo) {
  try { return stateSchema.parse(JSON.parse(await readFile(join(storage(config, workspace), "installed.json"), "utf8"))); }
  catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return []; throw error; }
}
async function saveState(config: ServerConfig, workspace: WorkspaceInfo, items: InstalledEnterpriseSkill[]) {
  const root = storage(config, workspace); await mkdir(root, { recursive: true });
  const temporary = join(root, `installed-${randomUUID()}.json`);
  await writeFile(temporary, JSON.stringify(stateSchema.parse(items)), { mode: 0o600 });
  try { await rename(temporary, join(root, "installed.json")); } finally { await rm(temporary, { force: true }); }
}

async function enterpriseJson(context: EnterpriseSkillContext, path: string): Promise<unknown> {
  const url = new URL(context.origin);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new ApiError(400, "invalid_enterprise_origin", "企业地址不正确。");
  const response = await fetch(`${url.origin}${url.pathname.replace(/\/+$/u, "")}${path}`, { headers: { Authorization: `Bearer ${context.token}` }, redirect: "error", signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new ApiError(response.status, "enterprise_skill_access_denied", "企业身份或技能权限已失效，请重新登录或联系管理员。");
  const length = Number(response.headers.get("content-length"));
  if (length > 2 * 1024 * 1024) throw new ApiError(502, "enterprise_invalid_response", "企业服务返回内容过大。");
  const text = new TextDecoder().decode(await readLimitedRequestBody(response, 2 * 1024 * 1024, { code: "enterprise_invalid_response", message: "企业服务返回内容过大。" }));
  return JSON.parse(text);
}

async function verifyContext(workspace: WorkspaceInfo, context: EnterpriseSkillContext) {
  if (workspace.workContextId !== `enterprise:${context.enterpriseId}`) throw new ApiError(403, "enterprise_context_mismatch", "请切换到技能所属企业后再操作。");
  const manifest = z.object({ enterprise: z.object({ id: z.string() }), features: z.object({ skills: z.boolean() }) }).parse(await enterpriseJson(context, "/api/v1/client-manifest"));
  const result = enterpriseMembershipResponseSchema.parse(await enterpriseJson(context, "/api/v1/membership"));
  if (manifest.enterprise.id !== context.enterpriseId || !manifest.features.skills || result.membership.id !== context.memberId || result.membership.status !== "active") throw new ApiError(403, "enterprise_skill_access_denied", "当前企业成员无法使用技能。");
}
const catalogSchema = z.object({ items: z.array(z.object({ id: z.string(), type: z.literal("skill"), latestVersion: z.object({ version: z.string(), digest: z.string() }).nullable() })).max(50), nextCursor: z.string().nullable() });
async function accessibleSkills(context: EnterpriseSkillContext) {
  const items: z.infer<typeof catalogSchema>["items"] = []; const cursors = new Set<string>(); let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ type: "skill", limit: "50" }); if (cursor) query.set("cursor", cursor);
    const result = catalogSchema.parse(await enterpriseJson(context, `/api/v1/resources?${query}`)); items.push(...result.items);
    if (!result.nextCursor) return items;
    if (cursors.has(result.nextCursor)) break; cursors.add(result.nextCursor); cursor = result.nextCursor;
  }
  throw new ApiError(502, "enterprise_invalid_response", "企业技能目录过大或分页无效。");
}

async function removeProjection(workspace: WorkspaceInfo, group: "enterprise" | "standalone" = "enterprise", keepBase?: string) {
  if (group === "enterprise") projectionFingerprints.delete(resolve(workspace.path));
  for (const base of projectionBases) {
    if (base === keepBase) continue;
    const candidate = join(workspace.path, base, `ipollowork-${group}`);
    const present = await lstat(candidate).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!present) continue;
    const path = await skillPath(workspace.path, base, `ipollowork-${group}`);
    const info = await lstat(path).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (!info) continue;
    if (info.isSymbolicLink()) throw new ApiError(409, "skill_projection_conflict", "技能映射目录被符号链接替换。");
    const marker = await readFile(join(path, ".ipollowork-owned"), "utf8").catch(() => "");
    if (marker !== `${group}-skills-v1`) throw new ApiError(409, "skill_projection_conflict", "技能目录存在其他来源文件，未覆盖。");
    await rm(path, { recursive: true, force: true });
  }
}

/** Native engines read the same standalone files through owned directory links. */
export async function prepareStandaloneSkills(config: ServerConfig, workspace: WorkspaceInfo) {
  return locked(contextKey(config, workspace), async () => {
    const base = workspace.engineId === "codex-harness" ? ".agents/skills" : workspace.engineId === "deepseek-harness" ? ".dsh/skills" : null;
    await removeProjection(workspace, "standalone", base ?? undefined);
    if (!base) return;
    const skills = (await listStandaloneSkillPackages(config, workspace)).filter(item => !item.pluginName);
    if (skills.length > 200) throw new ApiError(413, "too_many_skills", "当前可用独立技能超过 200 个，请减少后再启动任务。");
    const root = await skillPath(workspace.path, base, "ipollowork-standalone");
    const present = await lstat(root).catch(error => { if (error.code === "ENOENT") return null; throw error; });
    if (present && await readFile(join(root, ".ipollowork-owned"), "utf8").catch(() => "") !== "standalone-skills-v1") throw new ApiError(409, "skill_projection_conflict", "技能目录存在其他来源文件，未覆盖。");
    await mkdir(root, { recursive: true });
    if (!present) await writeFile(join(root, ".ipollowork-owned"), "standalone-skills-v1");
    const wanted = new Map(await Promise.all(skills.map(async item => [item.name, await realpath(dirname(item.path))] as const)));
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (entry.name === ".ipollowork-owned") continue;
      const path = join(root, entry.name);
      if (!entry.isSymbolicLink()) throw new ApiError(409, "skill_projection_conflict", "独立技能映射目录中存在其他来源文件，未覆盖。");
      const target = await realpath(path).catch(error => { if (error.code === "ENOENT") return null; throw error; });
      if (wanted.get(entry.name) !== target) await unlink(path);
      else wanted.delete(entry.name);
    }
    for (const [name, source] of wanted) {
      await symlink(source, await skillPath(root, name), process.platform === "win32" ? "junction" : "dir");
    }
  });
}

export async function setEnterpriseSkillContext(config: ServerConfig, workspace: WorkspaceInfo, context: EnterpriseSkillContext | null) {
  return locked(contextKey(config, workspace), async () => {
    const key = contextKey(config, workspace); const previous = contexts.get(key);
    if (!context || !previous || identity(previous) !== identity(context)) { contexts.delete(key); await removeProjection(workspace); }
    if (context) { await verifyContext(workspace, context); contexts.set(key, { ...context, origin: context.origin.replace(/\/+$/u, "") }); }
  });
}

export async function listEnterpriseSkills(config: ServerConfig, workspace: WorkspaceInfo) {
  const context = contexts.get(contextKey(config, workspace));
  if (!context) return [];
  await verifyContext(workspace, context);
  return (await readState(config, workspace)).filter((item) => identity(item) === identity(context));
}

export async function installEnterpriseSkill(config: ServerConfig, workspace: WorkspaceInfo, input: EnterpriseSkillInstallInput) {
  await setEnterpriseSkillContext(config, workspace, input.context);
  return locked(contextKey(config, workspace), async () => {
    const context = contexts.get(contextKey(config, workspace)); if (!context || identity(context) !== identity(input.context)) throw new ApiError(403, "enterprise_skill_access_denied", "企业账号已切换。");
    const allowed = (await accessibleSkills(context)).find((item) => item.id === input.resourceId);
    if (!allowed?.latestVersion || allowed.latestVersion.version !== input.version || allowed.latestVersion.digest !== input.digest) throw new ApiError(403, "enterprise_skill_access_denied", "技能已更新、下架或无权访问，请刷新后重试。");
    const url = `${context.origin}/api/v1/resources/${encodeURIComponent(input.resourceId)}/versions/${encodeURIComponent(input.version)}/download`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${context.token}` }, redirect: "error", signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new ApiError(403, "enterprise_skill_access_denied", "没有下载这个技能版本的权限。");
    const reader = response.body?.getReader(); if (!reader) throw new ApiError(502, "invalid_skill_manifest", "技能包为空。");
    const chunks: Uint8Array[] = []; let size = 0;
    try { while (true) { const next = await reader.read(); if (next.done) break; size += next.value.length; if (size > MAX_SKILL_PACKAGE_BYTES) { await reader.cancel(); throw new ApiError(413, "skill_package_too_large", "技能包不能超过 50 MB。"); } chunks.push(next.value); } } finally { reader.releaseLock(); }
    const bytes = Buffer.concat(chunks); const inspected = await inspectSkillArchive(bytes);
    if (inspected.digest !== input.digest || inspected.manifest.version !== input.version) throw new ApiError(400, "skill_digest_mismatch", "技能包校验失败，未安装。");
    const state = await readState(config, workspace);
    const previous = state.find((item) => identity(item) === identity(context) && item.resourceId === input.resourceId);
    const record: InstalledEnterpriseSkill = { resourceId: input.resourceId, origin: context.origin, enterpriseId: context.enterpriseId, memberId: context.memberId, manifest: inspected.manifest, digest: inspected.digest, enabled: previous?.enabled ?? true, installedAt: new Date().toISOString() };
    const path = archivePath(config, workspace, record); await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes, { mode: 0o600 });
    await saveState(config, workspace, [...state.filter((item) => !(identity(item) === identity(context) && item.resourceId === input.resourceId)), record]);
    return record;
  });
}

export async function updateEnterpriseSkill(config: ServerConfig, workspace: WorkspaceInfo, resourceId: string, enabled: boolean | null) {
  return locked(contextKey(config, workspace), async () => {
    const context = contexts.get(contextKey(config, workspace)); if (!context) throw new ApiError(403, "enterprise_skill_access_denied", "请先登录企业。");
    await removeProjection(workspace);
    const state = await readState(config, workspace);
    const existing = state.find((item) => identity(item) === identity(context) && item.resourceId === resourceId);
    if (!existing) throw new ApiError(404, "skill_not_found", "技能未安装。");
    if (enabled === true) { await verifyContext(workspace, context); if (!(await accessibleSkills(context)).some((item) => item.id === resourceId)) throw new ApiError(403, "enterprise_skill_access_denied", "技能使用权限已撤销。"); }
    const items = state.filter((item) => item !== existing); if (enabled !== null) items.push({ ...existing, enabled });
    await saveState(config, workspace, items);
    if (enabled === null) await rm(archivePath(config, workspace, existing), { force: true });
  });
}

export async function readEnterpriseSkill(config: ServerConfig, workspace: WorkspaceInfo, resourceId: string) {
  const context = contexts.get(contextKey(config, workspace));
  if (!context || !(await accessibleSkills(context)).some((item) => item.id === resourceId)) throw new ApiError(403, "enterprise_skill_access_denied", "技能使用权限已撤销。");
  const item = (await listEnterpriseSkills(config, workspace)).find((record) => record.resourceId === resourceId);
  if (!item) throw new ApiError(404, "skill_not_found", "技能未安装。");
  const inspected = await inspectSkillArchive(await readFile(archivePath(config, workspace, item)));
  if (inspected.digest !== item.digest) throw new ApiError(409, "skill_digest_mismatch", "本地技能已修改，请重新安装。");
  return { manifest: inspected.manifest, content: inspected.content, files: inspected.files.map((file) => file.name) };
}

/** Reconcile before every engine turn; credentials stay in memory and permissions are never inferred from cached files. */
export async function prepareEnterpriseSkills(config: ServerConfig, workspace: WorkspaceInfo) {
  return locked(contextKey(config, workspace), async () => {
    const context = contexts.get(contextKey(config, workspace));
    if (!context || workspace.workContextId !== `enterprise:${context.enterpriseId}`) { await removeProjection(workspace); return; }
    let allowedSkills: Awaited<ReturnType<typeof accessibleSkills>>;
    try { await verifyContext(workspace, context); allowedSkills = await accessibleSkills(context); }
    catch { await removeProjection(workspace); return; } // Offline/expired accounts retain archives but no active projection.
    const allowedIds = new Set(allowedSkills.filter((item) => item.latestVersion).map((item) => item.id));
    const items = (await readState(config, workspace)).filter((item) => item.enabled && identity(item) === identity(context) && allowedIds.has(item.resourceId));
    const fingerprint = digest(JSON.stringify({ identity: identity(context), engine: workspace.engineId, items: items.map((item) => [item.resourceId, item.digest]) }));
    if (projectionFingerprints.get(resolve(workspace.path)) === fingerprint) return;
    await removeProjection(workspace);
    if (!items.length) return;
    const base = workspace.engineId === "codex-harness" ? ".agents/skills" : workspace.engineId === "deepseek-harness" ? ".dsh/skills" : ".opencode/skills";
    const root = await skillPath(workspace.path, base, "ipollowork-enterprise"); await mkdir(root, { recursive: true }); await writeFile(join(root, ".ipollowork-owned"), "enterprise-skills-v1");
    for (const item of items) {
      const archive = await inspectSkillArchive(await readFile(archivePath(config, workspace, item)));
      if (archive.digest !== item.digest) throw new ApiError(409, "skill_digest_mismatch", "本地企业技能已修改，请重新安装。");
      const name = `ent-${identity(item).slice(0, 8)}-${digest(item.resourceId).slice(0, 8)}-${item.manifest.name.slice(0, 28)}`;
      for (const file of archive.files) {
        if (file.name === SKILL_PACKAGE_MANIFEST) continue;
        const target = await skillPath(root, name, file.name); await mkdir(dirname(target), { recursive: true });
        let data = file.data;
        if (file.name === "SKILL.md") { const parsed = parseFrontmatter(data.toString("utf8")); data = Buffer.from(buildFrontmatter({ ...parsed.data, name }) + parsed.body); }
        await writeFile(target, data, { mode: 0o600 });
      }
    }
    projectionFingerprints.set(resolve(workspace.path), fingerprint);
  });
}

export async function exportStandaloneSkill(config: ServerConfig, workspace: WorkspaceInfo, input: SkillPackageExportInput) {
  const skills = await listSkills(workspace.path, false); const skill = skills.find((item) => item.name === input.name);
  if (!skill || skill.scope !== "project") throw new ApiError(404, "skill_not_found", "请选择当前项目中的独立技能。");
  const source = await skillPath(workspace.path, relative(workspace.path, dirname(skill.path))); const localPath = relative(workspace.path, skill.path).replaceAll(sep, "/");
  const packages = await listInstalledPluginPackages({ serverConfig: config });
  if (localPath.includes("/ipollowork-enterprise/") || packages.some((item) => item.manifest.resources.some((resource) => resource.type === "skill" && resource.path && (() => { const path = pluginEnginePortablePath(resource.path).replace(/\/$/u, ""); return localPath === `.opencode/${path.endsWith("SKILL.md") ? path : `${path}/SKILL.md`}`; })()))) throw new ApiError(409, "skill_owned_by_plugin", "插件内置技能和企业技能由来源管理，不能作为个人技能重新投稿。");
  const files: ZipEntry[] = []; let total = 0;
  async function collect(root: string, prefix = "") {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new ApiError(400, "unsafe_skill_file", "技能目录中不允许符号链接。");
      if (entry.isDirectory()) { if (path.split("/").length > 12 || entry.name.startsWith(".") || entry.name === "node_modules") throw new ApiError(400, "unsafe_skill_file", "技能目录层级过深或包含私有目录。"); await collect(join(root, entry.name), path); }
      else { validateSkillPackageFile(path); if (path === SKILL_PACKAGE_MANIFEST || path === "ipollowork.source.json") continue; const data = await readFile(await skillPath(source, path)); total += data.length; files.push({ name: path, data }); if (total > MAX_SKILL_PACKAGE_BYTES || files.length > 511) throw new ApiError(413, "skill_package_too_large", "技能文件超过大小或数量限制。"); }
    }
  }
  await collect(source);
  const { data } = parseFrontmatter((await readFile(skill.path)).toString("utf8"));
  const manifest = skillPackageManifestSchema.parse({ schemaVersion: 1, kind: "skill", id: `personal.${input.name}`, name: input.name, title: input.title, description: data.description, version: input.version, entry: "SKILL.md", category: "general", minimumAppVersion: pkg.version, dependencies: [] });
  const archive = createStoredZip([{ name: SKILL_PACKAGE_MANIFEST, data: Buffer.from(JSON.stringify(manifest, null, 2)) }, ...files]);
  await inspectSkillArchive(archive);
  return { archive, filename: `${manifest.id}-${manifest.version}.ipollowork-skill` };
}

const publicSourceSchema = z.object({ origin: z.string(), resourceId: z.string(), version: z.string(), digest: z.string(), files: z.record(z.string(), z.string()) });
export async function listStandaloneSkillPackages(config: ServerConfig, workspace: WorkspaceInfo) {
  const skills = await listSkills(workspace.path, true);
  const plugins = await listInstalledPluginPackages({ serverConfig: config });
  return Promise.all(skills.filter((item) => !item.path.replaceAll("\\", "/").includes("/ipollowork-enterprise/")).map(async (item) => {
    const path = relative(workspace.path, item.path).replaceAll(sep, "/");
    const plugin = plugins.find((pkg) => pkg.manifest.resources.some((resource) => {
      if (resource.type !== "skill" || !resource.path) return false;
      const portable = pluginEnginePortablePath(resource.path).replace(/\/$/u, "");
      return path === `.opencode/${portable.endsWith("SKILL.md") ? portable : `${portable}/SKILL.md`}`;
    }));
    let source: z.infer<typeof publicSourceSchema> | null = null;
    try { source = publicSourceSchema.parse(JSON.parse(await readFile(join(dirname(item.path), "ipollowork.source.json"), "utf8"))); }
    catch (error) { if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error; }
    return { ...item, pluginName: plugin?.name ?? null, canExport: item.scope === "project" && !path.startsWith("..") && !plugin, source };
  }));
}

export async function assertStandaloneSkillWritable(config: ServerConfig, workspace: WorkspaceInfo, name: string) {
  const local = (await listSkills(workspace.path, false)).find((item) => item.name === name);
  if (local?.path.replaceAll("\\", "/").includes("/ipollowork-enterprise/")) throw new ApiError(409, "skill_managed_resource", "企业技能由企业来源管理，请使用企业技能的启停或卸载入口。");
  const item = (await listStandaloneSkillPackages(config, workspace)).find((record) => record.scope === "project" && record.name === name);
  if (item?.pluginName) throw new ApiError(409, "skill_owned_by_plugin", "插件内置技能随所属插件管理，不能独立修改或卸载。");
}

/** Import passive skill files; never provision tools, run scripts or install a plugin. */
export async function importStandaloneSkill(config: ServerConfig, workspace: WorkspaceInfo, bytes: Buffer, source: { origin: string; resourceId: string; digest: string }) {
  if (digest(bytes) !== source.digest) throw new ApiError(400, "skill_digest_mismatch", "技能文件摘要不一致。");
  if (source.origin === "local" && (bytes[0] !== 0x50 || bytes[1] !== 0x4b)) { bytes = skillMarkdownArchive(bytes); source = { ...source, digest: digest(bytes) }; }
  const inspected = await inspectSkillArchive(bytes);
  if (source.origin === "local") source = { ...source, resourceId: inspected.manifest.id };
  if (inspected.digest !== source.digest) throw new ApiError(400, "skill_digest_mismatch", "技能包摘要不一致。");
  return locked(contextKey(config, workspace), async () => {
    const sameSource = (await listStandaloneSkillPackages(config, workspace)).find((item) => item.scope === "project" && item.source?.origin === source.origin && item.source.resourceId === source.resourceId);
    if (sameSource && sameSource.name !== inspected.manifest.name) throw new ApiError(409, "skill_identity_mismatch", "同一来源的技能调用名发生变化，请先保留并卸载旧版本。");
    const base = await skillPath(workspace.path, relative(workspace.path, projectSkillsDir(workspace.path))); await mkdir(base, { recursive: true });
    const target = await skillPath(base, inspected.manifest.name);
    const existing = await lstat(target).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
    if (existing) {
      const record = (await listStandaloneSkillPackages(config, workspace)).find((item) => item.name === inspected.manifest.name);
      if (existing.isSymbolicLink() || !record || record.pluginName || record.source?.origin !== source.origin || record.source.resourceId !== source.resourceId) throw new ApiError(409, "skill_name_conflict", "同名技能已存在，未覆盖个人或插件技能。");
      const unchangedFiles = new Set(Object.keys(record.source.files));
      const entries = await readdir(target, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        const path = relative(target, join(entry.parentPath, entry.name)).replaceAll(sep, "/");
        if (entry.isSymbolicLink() || (!entry.isDirectory() && path !== "ipollowork.source.json" && !unchangedFiles.has(path))) throw new ApiError(409, "skill_local_modified", "本地技能新增了文件，请先保留副本后再更新。");
      }
      for (const [path, expected] of Object.entries(record.source.files)) {
        const current = await readFile(await skillPath(target, path)).catch((error) => { if (error.code === "ENOENT") return null; throw error; });
        if (!current || digest(current) !== expected) throw new ApiError(409, "skill_local_modified", "本地技能已修改，请先保留副本后再更新。");
      }
      const order = comparePluginPackageVersions(inspected.manifest.version, record.source.version);
      if (order === null || order < 0 || (order === 0 && record.source.digest !== source.digest)) throw new ApiError(409, "skill_version_conflict", "技能版本未递增或同版本内容已变化，未覆盖本地版本。");
    }
    const staging = await skillPath(base, `ipw-staging-${randomUUID()}`); const previous = await skillPath(base, `ipw-previous-${randomUUID()}`);
    await mkdir(staging);
    try {
      for (const file of inspected.files) { const path = await skillPath(staging, file.name); await mkdir(dirname(path), { recursive: true }); await writeFile(path, file.data, { mode: 0o600 }); }
      await writeFile(join(staging, "ipollowork.source.json"), JSON.stringify({ ...source, version: inspected.manifest.version, files: Object.fromEntries(inspected.files.map((file) => [file.name, digest(file.data)])) }));
      if (existing) await rename(target, previous);
      try { await rename(staging, target); } catch (error) { if (existing) await rename(previous, target); throw error; }
      if (existing) await rm(previous, { recursive: true, force: true });
    } finally { await rm(staging, { recursive: true, force: true }); }
    return { name: inspected.manifest.name, version: inspected.manifest.version };
  });
}
