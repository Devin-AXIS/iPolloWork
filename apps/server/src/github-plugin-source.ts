import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { ApiError } from "./errors.js";
import { buildFrontmatter, parseFrontmatter } from "./frontmatter.js";
import type { PluginPackageManifest } from "./plugin-package-manifest.js";

export type CompatibleGitHubPluginSource = {
  owner: string;
  repo: string;
  ref: string | null;
  dir: string | null;
  /**
   * Raw path segments after `/tree/` when present. Branch names may contain
   * slashes (e.g. `release/v1`), so the ref/dir split is ambiguous from the
   * URL alone — the resolver tries candidates against the trees API.
   */
  treeSegments: string[] | null;
};

export type CompatibleGitHubPluginComponent = {
  type: "mcp" | "skill" | "command" | "agent";
  name: string;
  description: string | null;
};

export type CompatibleGitHubPluginPreview = {
  pluginId: string;
  name: string;
  description: string | null;
  version: string | null;
  source: { owner: string; repo: string; ref: string; dir: string | null };
  components: CompatibleGitHubPluginComponent[];
  warnings: string[];
};

export type CompatibleGitHubPluginBundle = {
  manifest: PluginPackageManifest;
  files: Array<{ path: string; content: string | Uint8Array }>;
  preview: CompatibleGitHubPluginPreview;
};

const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function githubApiBase(): string {
  return (process.env.IPOLLOWORK_GITHUB_API_BASE?.trim() || "https://api.github.com").replace(/\/+$/, "");
}

function githubRawBase(): string {
  return (process.env.IPOLLOWORK_GITHUB_RAW_BASE?.trim() || "https://raw.githubusercontent.com").replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// GitHub owners are alphanumeric + hyphen; repos additionally allow dots and underscores.
const GITHUB_OWNER_RE = /^[A-Za-z0-9-]+$/;
const GITHUB_REPO_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Accepts `https://github.com/owner/repo`, `github.com/owner/repo`,
 * `owner/repo`, with optional `.git` suffix and `/tree/<ref>(/<subdir>)`.
 */
export function parseCompatibleGitHubPluginSource(input: string): CompatibleGitHubPluginSource {
  // Drop query strings and hash fragments (e.g. ?tab=readme-ov-file).
  const trimmed = (input.split(/[?#]/)[0] ?? "").trim();
  if (!trimmed) throw new ApiError(400, "invalid_plugin_url", "GitHub URL is required");
  const withoutProtocol = trimmed.replace(/^https?:\/\//, "");
  const hadHost = /^[A-Za-z0-9.-]+\.[A-Za-z]{2,}\//.test(withoutProtocol);
  if (hadHost && !withoutProtocol.startsWith("github.com/")) {
    throw new ApiError(400, "invalid_plugin_url", "Only github.com sources are supported");
  }
  const path = hadHost ? withoutProtocol.slice(withoutProtocol.indexOf("/") + 1) : withoutProtocol;
  const parts = path.split("/").filter(Boolean);
  const owner = parts[0] ?? "";
  const repo = (parts[1] ?? "").replace(/\.git$/, "");
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) {
    throw new ApiError(400, "invalid_plugin_url", "Expected a GitHub repo URL like https://github.com/owner/repo");
  }
  let ref: string | null = null;
  let dir: string | null = null;
  let treeSegments: string[] | null = null;
  if (parts[2] === "tree" && parts[3]) {
    treeSegments = parts.slice(3);
    ref = parts[3] ?? null;
    const rest = parts.slice(4);
    if (rest.length > 0) dir = rest.join("/");
  }
  return { owner, repo, ref, dir, treeSegments };
}

async function fetchGithubJson(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "ipollowork-server" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(502, "plugin_fetch_failed", `Failed to fetch plugin data (${response.status}): ${text || url}`);
  }
  return response.json();
}

async function fetchGithubText(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: { Accept: "text/plain", "User-Agent": "ipollowork-server" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(502, "plugin_fetch_failed", `Failed to fetch plugin file (${response.status}): ${text || url}`);
  }
  return response.text();
}

async function fetchGithubBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url, {
    headers: { Accept: "application/octet-stream", "User-Agent": "ipollowork-server" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new ApiError(502, "plugin_fetch_failed", `Failed to fetch plugin file (${response.status}): ${text || url}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

type TreeEntry = { path: string; sha: string };

async function fetchRepoTree(source: CompatibleGitHubPluginSource, ref: string): Promise<TreeEntry[]> {
  const url = `${githubApiBase()}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/git/trees/${encodeURIComponent(ref)}?recursive=1`;
  const tree = await fetchGithubJson(url);
  const entries = isRecord(tree) && Array.isArray(tree.tree) ? tree.tree : [];
  return entries.flatMap((entry) => {
    if (!isRecord(entry) || entry.type !== "blob") return [];
    if (typeof entry.path !== "string" || typeof entry.sha !== "string") return [];
    return [{ path: entry.path, sha: entry.sha }];
  });
}

async function resolveDefaultBranch(source: CompatibleGitHubPluginSource): Promise<string> {
  const url = `${githubApiBase()}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}`;
  try {
    const info = await fetchGithubJson(url);
    if (isRecord(info) && typeof info.default_branch === "string" && info.default_branch.trim()) {
      return info.default_branch.trim();
    }
  } catch {
    // Fall through to "main" below.
  }
  return "main";
}

function rawFileUrl(source: CompatibleGitHubPluginSource, ref: string, path: string): string {
  const segments = path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  // Branch names may contain slashes; raw URLs expect them as path segments.
  const refSegments = ref.split("/").map((segment) => encodeURIComponent(segment)).join("/");
  return `${githubRawBase()}/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${refSegments}/${segments}`;
}

// Branch names may contain slashes (release/v1), so a /tree/<...> URL is
// ambiguous between ref and subdirectory. Try progressively longer refs
// against the trees API and use the first that resolves.
async function resolveRefAndTree(
  source: CompatibleGitHubPluginSource,
  explicitRef: string | undefined,
): Promise<{ ref: string; dir: string | null; tree: TreeEntry[] }> {
  const candidates: Array<{ ref: string; dir: string | null }> = [];
  if (explicitRef) {
    let dir = source.dir;
    if (source.treeSegments) {
      const joined = source.treeSegments.join("/");
      dir = joined === explicitRef
        ? null
        : joined.startsWith(`${explicitRef}/`)
          ? joined.slice(explicitRef.length + 1)
          : source.dir;
    }
    candidates.push({ ref: explicitRef, dir });
  } else if (source.treeSegments && source.treeSegments.length > 0) {
    for (let index = 1; index <= source.treeSegments.length; index += 1) {
      candidates.push({
        ref: source.treeSegments.slice(0, index).join("/"),
        dir: index < source.treeSegments.length ? source.treeSegments.slice(index).join("/") : null,
      });
    }
  } else {
    candidates.push({ ref: await resolveDefaultBranch(source), dir: null });
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const tree = await fetchRepoTree(source, candidate.ref);
      return { ref: candidate.ref, dir: candidate.dir, tree };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new ApiError(404, "plugin_ref_not_found", "Could not resolve the requested branch or tag");
}

// Find the plugin root: the given subdir, the repo root, or the shallowest
// directory containing `.claude-plugin/plugin.json`.
function locatePluginRoot(tree: TreeEntry[], dir: string | null): string {
  const manifestPaths = tree
    .map((entry) => entry.path)
    .filter((path) => path === ".claude-plugin/plugin.json" || path.endsWith("/.claude-plugin/plugin.json"));
  if (dir) {
    const normalized = dir.replace(/\/+$/, "");
    const expected = `${normalized}/.claude-plugin/plugin.json`;
    if (!manifestPaths.includes(expected)) {
      throw new ApiError(404, "plugin_manifest_not_found", `No .claude-plugin/plugin.json found under ${normalized}/`);
    }
    return `${normalized}/`;
  }
  if (manifestPaths.length === 0) {
    throw new ApiError(404, "plugin_manifest_not_found", "No .claude-plugin/plugin.json found in this repository");
  }
  manifestPaths.sort((a, b) => a.split("/").length - b.split("/").length || a.localeCompare(b));
  const shallowest = manifestPaths[0]!;
  const root = shallowest.slice(0, shallowest.length - ".claude-plugin/plugin.json".length);
  const sameDepth = manifestPaths.filter((path) => path.split("/").length === shallowest.split("/").length);
  if (sameDepth.length > 1) {
    const candidates = sameDepth
      .map((path) => path.slice(0, path.length - "/.claude-plugin/plugin.json".length))
      .join(", ");
    throw new ApiError(400, "plugin_ambiguous", `Multiple plugins found (${candidates}). Add the plugin directory to the URL, e.g. /tree/main/<dir>.`);
  }
  return root;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readPathList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap((entry) => (typeof entry === "string" && entry.trim() ? [entry.trim()] : []));
  return [];
}

function normalizeRelative(root: string, path: string): string {
  const cleaned = path.replace(/^\.\//, "").replace(/^\/+/, "");
  if (cleaned.split("/").some((part) => part === "..")) return "";
  return `${root}${cleaned}`;
}

function portableId(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
  return normalized || fallback;
}

function translatedAgentContent(description: string, source: string): string {
  const { data, body } = parseFrontmatter(source.trim());
  const tools = typeof data.tools === "string"
    ? Object.fromEntries(data.tools.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean).map((entry) => [entry, true]))
    : Array.isArray(data.tools)
      ? Object.fromEntries(data.tools.flatMap((entry) => typeof entry === "string" && entry.trim() ? [[entry.trim().toLowerCase(), true] as const] : []))
      : isRecord(data.tools)
        ? Object.fromEntries(Object.entries(data.tools).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"))
        : null;
  const model = readString(data.model);
  return `${buildFrontmatter({
    description: readString(data.description) ?? description,
    ...(model?.includes("/") ? { model } : {}),
    ...(tools && Object.keys(tools).length > 0 ? { tools } : {}),
  })}\n${body.replace(/^\s*\n?/, "")}`;
}

function translatedCommandContent(name: string, description: string, source: string): string {
  const { data, body } = parseFrontmatter(source.trim());
  const model = readString(data.model);
  const agent = readString(data.agent);
  return `${buildFrontmatter({
    name,
    description: readString(data.description) ?? description,
    ...(agent ? { agent } : {}),
    ...(model?.includes("/") ? { model } : {}),
    ...(typeof data.subtask === "boolean" ? { subtask: data.subtask } : {}),
  })}\n${body.replace(/^\s*\n?/, "")}`;
}

function packageVersion(version: string | null, digest: string): string {
  const base = version && SEMVER_RE.test(version) ? version : "0.0.0";
  return base.includes("+") ? `${base}.${digest}` : `${base}+${digest}`;
}

function remoteMcpConfig(name: string, value: unknown, warnings: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const url = readString(value.url);
  if (!url?.startsWith("https://")) {
    warnings.push(`MCP server "${name}" is not a remote HTTPS server and was skipped.`);
    return null;
  }
  if (value.headers !== undefined || value.command !== undefined || value.env !== undefined || value.environment !== undefined) {
    warnings.push(`MCP server "${name}" contains local commands or static credentials and was skipped.`);
    return null;
  }
  const oauth = value.oauth === true
    ? {}
    : isRecord(value.oauth)
      ? Object.fromEntries(Object.entries(value.oauth).filter(([key, entry]) => key !== "clientSecret" && ["clientId", "scope"].includes(key) && typeof entry === "string"))
      : undefined;
  return {
    type: "remote",
    url,
    enabled: value.enabled !== false && value.disabled !== true,
    ...(oauth ? { oauth } : {}),
  };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (index < items.length) {
      const current = index++;
      results[current] = await fn(items[current]!);
    }
  });
  await Promise.all(workers);
  return results;
}

const CLAUDE_PLUGIN_ROOT_VAR = "${CLAUDE_PLUGIN_ROOT}";

function mcpConfigReferencesPluginRoot(config: unknown): boolean {
  if (typeof config === "string") return config.includes(CLAUDE_PLUGIN_ROOT_VAR);
  if (Array.isArray(config)) return config.some((entry) => mcpConfigReferencesPluginRoot(entry));
  if (isRecord(config)) return Object.values(config).some((entry) => mcpConfigReferencesPluginRoot(entry));
  return false;
}

export async function resolveCompatibleGitHubPluginBundle(input: { url: string; ref?: string }): Promise<CompatibleGitHubPluginBundle> {
  const source = parseCompatibleGitHubPluginSource(input.url);
  const { ref, dir, tree } = await resolveRefAndTree(source, input.ref?.trim() || undefined);
  const root = locatePluginRoot(tree, dir);
  const treeByPath = new Map(tree.map((entry) => [entry.path, entry]));
  const warnings: string[] = [];

  const manifestPath = `${root}.claude-plugin/plugin.json`;
  const manifestText = await fetchGithubText(rawFileUrl(source, ref, manifestPath));
  let sourceManifest: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(manifestText);
    if (!isRecord(parsed)) throw new Error("not an object");
    sourceManifest = parsed;
  } catch {
    throw new ApiError(400, "invalid_plugin_manifest", `${manifestPath} is not valid JSON`);
  }

  const pluginName = readString(sourceManifest.displayName) ?? readString(sourceManifest.name);
  if (!pluginName) {
    throw new ApiError(400, "invalid_plugin_manifest", `${manifestPath} is missing a plugin name`);
  }
  const description = readString(sourceManifest.description);
  const version = readString(sourceManifest.version);
  if (sourceManifest.hooks !== undefined) {
    warnings.push("This plugin declares hooks, which iPolloWork does not support yet. Hooks were skipped.");
  }

  // --- Collect component file paths -----------------------------------------
  const inTree = (path: string) => treeByPath.has(path);

  const collectMarkdown = (declared: string[], defaultDir: string): string[] => {
    const roots = declared.length > 0
      ? declared.map((entry) => normalizeRelative(root, entry)).filter(Boolean)
      : [`${root}${defaultDir}`];
    const paths = new Set<string>();
    for (const entry of roots) {
      if (entry.endsWith(".md") && inTree(entry)) {
        paths.add(entry);
        continue;
      }
      const prefix = `${entry.replace(/\/+$/, "")}/`;
      for (const candidate of treeByPath.keys()) {
        if (candidate.startsWith(prefix) && candidate.endsWith(".md")) paths.add(candidate);
      }
    }
    return [...paths].sort();
  };

  const commandPaths = collectMarkdown(readPathList(sourceManifest.commands), "commands");
  const agentPaths = collectMarkdown(readPathList(sourceManifest.agents), "agents");

  // Skills are directories containing SKILL.md.
  const skillRoots = readPathList(sourceManifest.skills).map((entry) => normalizeRelative(root, entry)).filter(Boolean);
  const skillPrefixes = skillRoots.length > 0 ? skillRoots.map((entry) => `${entry.replace(/\/+$/, "")}/`) : [`${root}skills/`];
  const skillEntrypoints = [...treeByPath.keys()]
    .filter((path) => skillPrefixes.some((prefix) => path.startsWith(prefix)) && path.endsWith("/SKILL.md"))
    .sort();
  // --- MCP servers -----------------------------------------------------------
  const mcpServers: Record<string, Record<string, unknown>> = {};
  const addMcpServers = (value: unknown) => {
    if (!isRecord(value)) return;
    const record = isRecord(value.mcpServers) ? value.mcpServers : value;
    for (const [name, config] of Object.entries(record)) {
      if (mcpConfigReferencesPluginRoot(config)) {
        warnings.push(`MCP server "${name}" uses \${CLAUDE_PLUGIN_ROOT} and was skipped because imported plugins cannot execute local commands.`);
        continue;
      }
      const normalized = remoteMcpConfig(name, config, warnings);
      if (normalized) mcpServers[name] = normalized;
    }
  };

  const declaredMcp = sourceManifest.mcpServers;
  if (typeof declaredMcp === "string") {
    const mcpPath = normalizeRelative(root, declaredMcp);
    if (mcpPath && inTree(mcpPath)) {
      const text = await fetchGithubText(rawFileUrl(source, ref, mcpPath));
      try {
        addMcpServers(JSON.parse(text));
      } catch {
        warnings.push(`${mcpPath} is not valid JSON; its MCP servers were skipped.`);
      }
    }
  } else if (isRecord(declaredMcp)) {
    addMcpServers(declaredMcp);
  }
  const dotMcpPath = `${root}.mcp.json`;
  if (inTree(dotMcpPath)) {
    const text = await fetchGithubText(rawFileUrl(source, ref, dotMcpPath));
    try {
      addMcpServers(JSON.parse(text));
    } catch {
      warnings.push(`${dotMcpPath} is not valid JSON; its MCP servers were skipped.`);
    }
  }

  // --- Fetch component contents ----------------------------------------------
  type FetchedComponent = {
    type: "skill" | "command" | "agent";
    path: string;
    title: string;
    description: string | null;
    content: string;
    extraFiles: Array<{ path: string; content: Uint8Array }>;
  };

  const componentInputs = [
    ...skillEntrypoints.map((path) => ({ type: "skill" as const, path })),
    ...commandPaths.map((path) => ({ type: "command" as const, path })),
    ...agentPaths.map((path) => ({ type: "agent" as const, path })),
  ];

  const fetched = await mapWithConcurrency(componentInputs, 6, async (item): Promise<FetchedComponent> => {
    const content = await fetchGithubText(rawFileUrl(source, ref, item.path));
    const { data } = parseFrontmatter(content);
    const fallbackTitle = item.type === "skill"
      ? item.path.split("/").at(-2) ?? "skill"
      : (item.path.split("/").at(-1) ?? "").replace(/\.md$/, "");
    const frontmatterName = readString(data.name);
    const skillDirectory = item.type === "skill" ? item.path.slice(0, -"SKILL.md".length) : null;
    const extraPaths = skillDirectory
      ? [...treeByPath.keys()].filter((path) => path.startsWith(skillDirectory) && path !== item.path)
      : [];
    const extraFiles = await mapWithConcurrency(extraPaths, 6, async (path) => ({
      path: path.slice(skillDirectory?.length ?? 0),
      content: await fetchGithubBytes(rawFileUrl(source, ref, path)),
    }));
    return {
      type: item.type,
      path: item.path,
      title: item.type === "skill" && frontmatterName ? frontmatterName : fallbackTitle,
      description: readString(data.description),
      content,
      extraFiles,
    };
  });

  const pluginId = portableId(
    ["github", source.owner, source.repo, dir].filter(Boolean).join("-"),
    "github-plugin",
  );
  const usedResourceIds = new Set<string>();
  const uniqueResourceId = (value: string, fallback: string) => {
    const base = portableId(value, fallback);
    let candidate = base;
    let suffix = 2;
    while (usedResourceIds.has(candidate)) candidate = `${base}-${suffix++}`;
    usedResourceIds.add(candidate);
    return candidate;
  };
  const files: CompatibleGitHubPluginBundle["files"] = [];
  const resources: PluginPackageManifest["resources"] = [];
  for (const component of fetched) {
    const resourceId = uniqueResourceId(component.title, component.type);
    if (component.type === "skill") {
      const directory = `skills/${pluginId}/${resourceId}`;
      files.push({ path: `${directory}/SKILL.md`, content: component.content });
      files.push(...component.extraFiles.map((file) => ({ path: `${directory}/${file.path}`, content: file.content })));
      resources.push({
        type: "skill",
        id: resourceId,
        label: component.title,
        ...(component.description ? { description: component.description } : {}),
        path: directory,
      });
      continue;
    }
    const directory = component.type === "agent" ? "agents" : "commands";
    const path = `${directory}/${pluginId}/${resourceId}.md`;
    const descriptionText = component.description ?? component.title;
    files.push({
      path,
      content: component.type === "agent"
        ? translatedAgentContent(descriptionText, component.content)
        : translatedCommandContent(resourceId, descriptionText, component.content),
    });
    resources.push({
      type: component.type,
      id: resourceId,
      label: component.title,
      ...(component.description ? { description: component.description } : {}),
      path,
    });
  }
  for (const [name, config] of Object.entries(mcpServers)) {
    const resourceId = uniqueResourceId(name, "mcp");
    const path = `mcp/${pluginId}/${resourceId}.json`;
    files.push({ path, content: `${JSON.stringify(config, null, 2)}\n` });
    resources.push({ type: "mcp", id: resourceId, label: name, path, mcpServerName: name, oauth: config.oauth !== undefined });
  }

  if (resources.length === 0) {
    throw new ApiError(400, "plugin_empty", "This plugin has no MCP servers, skills, commands, or agents iPolloWork can install.");
  }

  const digest = createHash("sha256");
  for (const file of files) digest.update(file.path).update("\0").update(file.content).update("\0");
  const contentDigest = digest.digest("hex").slice(0, 12);
  const packageManifest: PluginPackageManifest = {
    schemaVersion: 2,
    id: pluginId,
    name: pluginName,
    description: description ?? `Imported from ${source.owner}/${source.repo}`,
    source: {
      format: "github-compatible",
      trusted: false,
      origin: "local",
      reference: `https://github.com/${source.owner}/${source.repo}/tree/${ref}${dir ? `/${dir}` : ""}`,
    },
    resources,
    package: {
      version: packageVersion(version, contentDigest),
      updateId: ["github", source.owner, source.repo, dir].filter(Boolean).map((entry) => portableId(entry ?? "", "plugin")).join("/"),
      publisher: { id: portableId(source.owner, "github"), name: source.owner },
    },
  };

  const components: CompatibleGitHubPluginComponent[] = [
    ...Object.keys(mcpServers).map((name) => ({ type: "mcp" as const, name, description: null })),
    ...fetched.map((component) => ({ type: component.type, name: component.title, description: component.description })),
  ];

  return {
    manifest: packageManifest,
    files,
    preview: {
      pluginId,
      name: pluginName,
      description,
      version,
      source: { owner: source.owner, repo: source.repo, ref, dir },
      components,
      warnings,
    },
  };
}

export async function withMaterializedCompatibleGitHubPluginBundle<T>(
  bundle: CompatibleGitHubPluginBundle,
  operation: (packageRoot: string) => Promise<T>,
): Promise<T> {
  const packageRoot = await mkdtemp(join(tmpdir(), "ipollowork-plugin-source-"));
  try {
    await writeFile(join(packageRoot, "ipollowork.plugin.json"), `${JSON.stringify(bundle.manifest, null, 2)}\n`, "utf8");
    for (const file of bundle.files) {
      const path = join(packageRoot, file.path);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, file.content);
    }
    return await operation(packageRoot);
  } finally {
    await rm(packageRoot, { recursive: true, force: true });
  }
}
