import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStoredZip } from "./package-archive.js";
import { assertStandaloneSkillWritable, exportStandaloneSkill, importStandaloneSkill, inspectSkillArchive, installEnterpriseSkill, listEnterpriseSkills, listStandaloneSkillPackages, prepareEnterpriseSkills, prepareStandaloneSkills, readEnterpriseSkill, setEnterpriseSkillContext, skillMarkdownArchive, updateEnterpriseSkill } from "./skill-packages.js";
import { installPluginPackage } from "./plugin-package-lifecycle.js";
import * as skillDiscovery from "./skills.js";
import { disposeTemplateStore } from "./templates.js";
import { disposeWorkItemStore } from "./work-items.js";
import type { ServerConfig, WorkspaceInfo } from "./types.js";
import type { EnterpriseSkillContext } from "@ipollowork/types/skills";

const content = "---\nname: proof-skill\ndescription: Use this skill to validate scoped enterprise access.\n---\n# Proof\nRead references/guide.md before producing a result.\n";
const manifest = { schemaVersion: 1, kind: "skill", id: "personal.proof-skill", name: "proof-skill", title: "验证技能", description: "Use this skill to validate scoped enterprise access.", version: "1.0.0", entry: "SKILL.md", category: "research", minimumAppVersion: "0.50.18", dependencies: [] };
const archive = (extra: Record<string, string> = {}) => createStoredZip(Object.entries({ "ipollowork.skill.json": JSON.stringify(manifest), "SKILL.md": content, "references/guide.md": "# Only use verified evidence", "scripts/proof.py": "raise Exception('must never run during installation')", ...extra }).map(([name, value]) => ({ name, data: Buffer.from(value) })));
let root: string; let config: ServerConfig; let workspace: WorkspaceInfo; let context: EnterpriseSkillContext;
let service: ReturnType<typeof Bun.serve>; let permitted: boolean; let online: boolean; let bytes: Buffer;
const previousDb = process.env.IPOLLOWORK_RUNTIME_DB;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "ipw-enterprise-skills-")); await mkdir(join(root, "project", ".git"), { recursive: true });
  workspace = { id: "ws_skill_test", name: "Skill test", path: join(root, "project"), preset: "starter", workspaceType: "local", engineId: "opencode", workContextId: "enterprise:ent_skill_test" };
  config = { host: "127.0.0.1", port: 0, token: "fixture-token", hostToken: "fixture-host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  process.env.IPOLLOWORK_RUNTIME_DB = join(root, "runtime.sqlite"); bytes = archive(); permitted = true; online = true;
  service = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (!online) return Response.json({ error: "unavailable" }, { status: 503 });
    const path = new URL(request.url).pathname; const second = request.headers.get("authorization") === "Bearer member-two";
    if (path.endsWith("/client-manifest")) return Response.json({ enterprise: { id: "ent_skill_test" }, features: { skills: true } });
    if (path.endsWith("/membership")) return Response.json({ membership: { id: second ? "member-two" : "member-one", displayName: "Fixture", email: "fixture@example.test", role: "member", status: "active", departmentId: null } });
    if (path.endsWith("/resources")) return Response.json({ items: permitted && !second ? [{ id: "skl_proof", type: "skill", latestVersion: { version: "1.0.0", digest: createHash("sha256").update(bytes).digest("hex") } }] : [], nextCursor: null });
    if (path.endsWith("/download") && permitted && !second) return new Response(new Uint8Array(bytes));
    return Response.json({ error: "not_found" }, { status: 404 });
  } });
  context = { enterpriseId: "ent_skill_test", origin: `http://127.0.0.1:${service.port}`, memberId: "member-one", token: "member-one" };
});
afterEach(async () => {
  await setEnterpriseSkillContext(config, workspace, null);
  await disposeTemplateStore(config); await disposeWorkItemStore(config); service.stop(true);
  await rm(root, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.IPOLLOWORK_RUNTIME_DB; else process.env.IPOLLOWORK_RUNTIME_DB = previousDb;
});
const install = () => installEnterpriseSkill(config, workspace, { context, resourceId: "skl_proof", version: "1.0.0", digest: createHash("sha256").update(bytes).digest("hex") });
const projection = () => join(workspace.path, ".opencode", "skills", "ipollowork-enterprise");

describe("independent skill packages", () => {
  test.each([["codex-harness", ".agents"], ["deepseek-harness", ".dsh"]])("makes personal and public skills available to %s without copying or executing scripts", async (engineId, directory) => {
    const markdown = Buffer.from(content.replaceAll("proof-skill", "personal-chat-proof"));
    await importStandaloneSkill(config, workspace, markdown, { origin: "local", resourceId: "local", digest: createHash("sha256").update(markdown).digest("hex") });
    await importStandaloneSkill(config, workspace, bytes, { origin: "https://cloud.example.test", resourceId: "public-chat-proof", digest: createHash("sha256").update(bytes).digest("hex") });
    const native = { ...workspace, engineId };
    await prepareStandaloneSkills(config, native);
    const mapped = join(workspace.path, directory, "skills", "ipollowork-standalone");
    expect(await readFile(join(mapped, "personal-chat-proof", "SKILL.md"), "utf8")).toContain("personal-chat-proof");
    expect(await readFile(join(mapped, "proof-skill", "references", "guide.md"), "utf8")).toContain("Only use verified evidence");
    expect(await readFile(join(mapped, "proof-skill", "scripts", "proof.py"), "utf8")).toContain("must never run");
    const source = join(workspace.path, ".opencode", "skills", "proof-skill", "SKILL.md");
    await writeFile(source, `${content}\nUpdated personal instructions`);
    await prepareStandaloneSkills(config, native);
    expect(await readFile(join(mapped, "proof-skill", "SKILL.md"), "utf8")).toContain("Updated personal instructions");
    await rm(join(workspace.path, ".opencode", "skills", "personal-chat-proof"), { recursive: true });
    await prepareStandaloneSkills(config, native);
    expect(await Bun.file(join(mapped, "personal-chat-proof", "SKILL.md")).exists()).toBe(false);
    await prepareStandaloneSkills(config, workspace);
    expect(await Bun.file(join(mapped, ".ipollowork-owned")).exists()).toBe(false);
    expect(await readFile(source, "utf8")).toContain("Updated personal instructions");
  });

  test("does not overwrite an unowned native skill directory", async () => {
    const path = join(workspace.path, ".agents", "skills", "ipollowork-standalone");
    await mkdir(path, { recursive: true });
    await writeFile(join(path, "keep.md"), "Keep my file");
    await expect(prepareStandaloneSkills(config, { ...workspace, engineId: "codex-harness" })).rejects.toMatchObject({ code: "skill_projection_conflict" });
    expect(await readFile(join(path, "keep.md"), "utf8")).toBe("Keep my file");
  });

  test("imports a standard UTF-8 Markdown file without requiring a package", async () => {
    const markdown = Buffer.from(`\uFEFF${content}`); const source = { origin: "local", resourceId: "local", digest: createHash("sha256").update(markdown).digest("hex") };
    expect(await importStandaloneSkill(config, workspace, markdown, source)).toEqual({ name: "proof-skill", version: "1.0.0" });
    const directory = join(workspace.path, ".opencode", "skills", "proof-skill");
    expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe(content);
    const exported = await exportStandaloneSkill(config, workspace, { name: "proof-skill", title: "Markdown 技能", version: "1.0.0" });
    expect((await inspectSkillArchive(exported.archive)).files.map(file => file.name)).toEqual(["ipollowork.skill.json", "SKILL.md"]);
    expect(await importStandaloneSkill(config, workspace, markdown, source)).toMatchObject({ name: "proof-skill" });
  });
  test("reads Markdown versions and multiline descriptions, and rejects malformed or oversized Markdown", async () => {
    const markdown = Buffer.from("---\r\nname: proof-skill\r\ndescription: >\r\n  Use verified sources.\r\nmetadata:\r\n  version: 1.2.0\r\n---\r\n# Test\r\n");
    expect((await inspectSkillArchive(skillMarkdownArchive(markdown))).manifest).toMatchObject({ version: "1.2.0", description: "Use verified sources." });
    for (const text of ["# Plain Markdown", "---\nname: ../outside\ndescription: bad\n---\n", "---\nname: proof-skill\ndescription: ''\n---\n", "---\nname: proof-skill\ndescription: [invalid\n---\n"]) expect(() => skillMarkdownArchive(Buffer.from(text))).toThrow();
    expect(() => skillMarkdownArchive(Buffer.alloc(1024 * 1024 + 1))).toThrow();
    await expect(importStandaloneSkill(config, workspace, markdown, { origin: "local", resourceId: "local", digest: "0".repeat(64) })).rejects.toMatchObject({ code: "skill_digest_mismatch" });
  });
  test("round-trips complete standalone skills without executing their scripts", async () => {
    const directory = join(workspace.path, ".opencode", "skills", "proof-skill"); await mkdir(join(directory, "references"), { recursive: true }); await mkdir(join(directory, "scripts"));
    await writeFile(join(directory, "SKILL.md"), content); await writeFile(join(directory, "references", "guide.md"), "# Source"); await writeFile(join(directory, "scripts", "proof.py"), "raise Exception('must not execute')");
    const result = await exportStandaloneSkill(config, workspace, { name: "proof-skill", title: "验证技能", version: "1.0.0" });
    const inspected = await inspectSkillArchive(result.archive);
    expect(result.filename).toEndWith(".ipollowork-skill"); expect(inspected.files.map((file) => file.name)).toContain("references/guide.md"); expect(inspected.content).toBe(content);
  });
  test("personal plugin skills can be submitted separately with their plugin dependency", async () => {
    const packageRoot = join(root, "plugin-source");
    const skillRoot = join(packageRoot, "skills/proof-skill");
    await mkdir(join(skillRoot, "references"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), content);
    await writeFile(join(skillRoot, "references/guide.md"), "# Plugin reference");
    await writeFile(join(packageRoot, "ipollowork.plugin.json"), JSON.stringify({ schemaVersion: 2, id: "proof-plugin", name: "Proof Plugin", description: "Skill publishing test", source: { format: "ipollowork-extension-manifest", origin: "local", trusted: false }, package: { version: "1.0.0", engines: ["opencode"], updateId: "proof/plugin" }, resources: [{ type: "skill", id: "proof-skill", path: "skills/proof-skill/SKILL.md", required: true }, { type: "file", id: "proof-files", path: "skills/proof-skill/references", required: true }] }));
    await installPluginPackage({ serverConfig: config, packageRoot });
    expect((await listStandaloneSkillPackages(config, workspace)).find(item => item.name === "proof-skill")).toMatchObject({ canExport: true, pluginName: "Proof Plugin" });
    const exported = await exportStandaloneSkill(config, workspace, { name: "proof-skill", title: "个人技能投稿", version: "1.0.0" });
    const inspected = await inspectSkillArchive(exported.archive);
    expect(inspected.manifest.dependencies).toEqual([{ type: "plugin", name: "proof-plugin" }]);
    expect(inspected.files.some(file => file.name === "references/guide.md")).toBe(true);
    expect(await readFile(join(skillRoot, "SKILL.md"), "utf8")).toBe(content);
    await expect(assertStandaloneSkillWritable(config, workspace, "proof-skill")).rejects.toMatchObject({ code: "skill_owned_by_plugin" });
  });
  test("global personal skills can be exported for enterprise submission", async () => {
    const directory = join(root, "global/proof-skill");
    await mkdir(directory, { recursive: true }); await writeFile(join(directory, "SKILL.md"), content);
    const discovery = spyOn(skillDiscovery, "listSkills").mockResolvedValue([{ name: "proof-skill", description: manifest.description, path: join(directory, "SKILL.md"), scope: "global" }]);
    try {
      expect((await listStandaloneSkillPackages(config, workspace))[0]).toMatchObject({ canExport: true, scope: "global" });
      const exported = await exportStandaloneSkill(config, workspace, { name: "proof-skill", title: "个人全局技能", version: "1.0.0" });
      expect((await inspectSkillArchive(exported.archive)).content).toBe(content);
      expect(await readFile(join(directory, "SKILL.md"), "utf8")).toBe(content);
    } finally { discovery.mockRestore(); }
  });
  test.each(["../escape.md", "scripts/link:stream.py", ".env", "assets/CON.md"])("rejects unsafe archive path %s", async (path) => {
    await expect(inspectSkillArchive(archive({ [path]: "bad" }))).rejects.toMatchObject({ code: "unsafe_skill_file" });
  });
  test("never treats a plugin or host ownership metadata as a standalone skill", async () => {
    await expect(inspectSkillArchive(archive({ "ipollowork.plugin.json": "{}" }))).rejects.toMatchObject({ code: "skill_package_type_mismatch" });
    await expect(inspectSkillArchive(archive({ "ipollowork.source.json": "{}" }))).rejects.toMatchObject({ code: "skill_package_type_mismatch" });
  });
  test("public package updates preserve modified personal files and reject name collisions", async () => {
    const inspected = await inspectSkillArchive(bytes); const source = { origin: "https://cloud.example.test", resourceId: "public-proof", digest: inspected.digest };
    await importStandaloneSkill(config, workspace, bytes, source);
    await importStandaloneSkill(config, workspace, bytes, source);
    const path = join(workspace.path, ".opencode", "skills", "proof-skill", "SKILL.md"); await writeFile(path, `${content}\nPersonal changes`);
    await expect(importStandaloneSkill(config, workspace, bytes, source)).rejects.toMatchObject({ code: "skill_local_modified" });
    await expect(importStandaloneSkill(config, workspace, bytes, { ...source, resourceId: "someone-else" })).rejects.toMatchObject({ code: "skill_name_conflict" });
    expect(await readFile(path, "utf8")).toContain("Personal changes");
  });
  test("does not follow a skill directory junction outside the workspace", async () => {
    await mkdir(join(root, "outside")); await mkdir(join(workspace.path, ".opencode"));
    await symlink(join(root, "outside"), join(workspace.path, ".opencode", "skills"), "junction");
    await expect(importStandaloneSkill(config, workspace, bytes, { origin: "local", resourceId: "local", digest: createHash("sha256").update(bytes).digest("hex") })).rejects.toMatchObject({ code: "path_escape" });
    expect(await readdir(join(root, "outside"))).toEqual([]);
  });
  test("public updates do not discard locally added companion files", async () => {
    const source = { origin: "https://cloud.example.test", resourceId: "public-proof", digest: createHash("sha256").update(bytes).digest("hex") };
    await importStandaloneSkill(config, workspace, bytes, source);
    const added = join(workspace.path, ".opencode", "skills", "proof-skill", "references", "personal.md");
    await writeFile(added, "Keep my research");
    await expect(importStandaloneSkill(config, workspace, bytes, source)).rejects.toMatchObject({ code: "skill_local_modified" });
    expect(await readFile(added, "utf8")).toBe("Keep my research");
  });
});
describe("enterprise skill identity and execution eligibility", () => {
  test("install, stop, resume and uninstall only affect the managed projection", async () => {
    await install(); await prepareEnterpriseSkills(config, workspace);
    const names = (await readdir(projection())).filter((name) => !name.startsWith(".")); expect(names).toHaveLength(1);
    const projected = await readFile(join(projection(), names[0], "SKILL.md"), "utf8"); expect(projected).toContain(`name: ${names[0]}`);
    expect(await readFile(join(projection(), names[0], "scripts", "proof.py"), "utf8")).toContain("must never run");
    await updateEnterpriseSkill(config, workspace, "skl_proof", false); await prepareEnterpriseSkills(config, workspace); expect(await Bun.file(join(projection(), ".ipollowork-owned")).exists()).toBe(false);
    await updateEnterpriseSkill(config, workspace, "skl_proof", true); await prepareEnterpriseSkills(config, workspace); expect(await Bun.file(join(projection(), ".ipollowork-owned")).exists()).toBe(true);
    await updateEnterpriseSkill(config, workspace, "skl_proof", null); expect(await listEnterpriseSkills(config, workspace)).toEqual([]);
  });
  test("revocation removes eligibility and content access without relying on the list UI", async () => {
    await install(); await prepareEnterpriseSkills(config, workspace); permitted = false;
    await prepareEnterpriseSkills(config, workspace);
    expect(await Bun.file(join(projection(), ".ipollowork-owned")).exists()).toBe(false);
    await expect(readEnterpriseSkill(config, workspace, "skl_proof")).rejects.toMatchObject({ code: "enterprise_skill_access_denied" });
    await expect(updateEnterpriseSkill(config, workspace, "skl_proof", true)).rejects.toMatchObject({ code: "enterprise_skill_access_denied" });
  });
  test("switching accounts hides the prior installation and returning restores only the right account", async () => {
    await install(); await prepareEnterpriseSkills(config, workspace);
    await setEnterpriseSkillContext(config, workspace, { ...context, memberId: "member-two", token: "member-two" });
    expect(await listEnterpriseSkills(config, workspace)).toEqual([]); expect(await Bun.file(join(projection(), ".ipollowork-owned")).exists()).toBe(false);
    await setEnterpriseSkillContext(config, workspace, context); expect(await listEnterpriseSkills(config, workspace)).toHaveLength(1);
    await prepareEnterpriseSkills(config, workspace); expect(await Bun.file(join(projection(), ".ipollowork-owned")).exists()).toBe(true);
    const stateFiles = await readdir(join(root, "enterprise-skills"), { recursive: true });
    const state = await readFile(join(root, "enterprise-skills", stateFiles.find((path) => path.endsWith("installed.json")) ?? "missing"), "utf8");
    expect(state).not.toContain('"token"');
  });
  test("offline checks deactivate files and a foreign enterprise cannot reuse credentials", async () => {
    await install(); await prepareEnterpriseSkills(config, workspace); online = false;
    await prepareEnterpriseSkills(config, workspace); expect(await Bun.file(join(projection(), ".ipollowork-owned")).exists()).toBe(false);
    online = true;
    await expect(setEnterpriseSkillContext(config, workspace, { ...context, enterpriseId: "ent_foreign" })).rejects.toMatchObject({ code: "enterprise_context_mismatch" });
  });
  test.each([["codex-harness", ".agents"], ["deepseek-harness", ".dsh"]])("projects to the %s native skill directory", async (engineId, directory) => {
    await install(); await prepareEnterpriseSkills(config, { ...workspace, engineId });
    expect(await Bun.file(join(workspace.path, directory, "skills", "ipollowork-enterprise", ".ipollowork-owned")).exists()).toBe(true);
  });
});
