import * as React from "react";

import { t } from "../../../../i18n";
import type {
  Client,
  DenOrgSkillCard,
  HubSkillCard,
  HubSkillRepo,
  ReloadReason,
  ReloadTrigger,
  SkillCard,
} from "../../../../app/types";
import { addOpencodeCacheHint, isDesktopRuntime, normalizeDirectoryPath } from "../../../../app/utils";
import skillCreatorTemplate from "../../../../app/data/skill-creator.md?raw";
import {
  importSkill,
  installSkillTemplate,
  joinDesktopPath,
  listLocalSkills,
  openDesktopPath,
  pickDirectory,
  readLocalSkill,
  revealDesktopItemInDir,
  uninstallSkill as uninstallSkillCommand,
  workspaceiPolloWorkRead,
  workspaceiPolloWorkWrite,
  writeLocalSkill,
} from "../../../../app/lib/desktop";
import type {
  iPolloWorkHubRepo,
  iPolloWorkServerCapabilities,
  iPolloWorkServerClient,
  iPolloWorkServerStatus,
} from "../../../../app/lib/ipollowork-server";
import {
  createDenClient,
  fetchDenOrgSkillsCatalog,
  readDenSettings,
  type DenOrgMarketplaceResolved,
} from "../../../../app/lib/den";
import {
  readWorkspaceCloudImports,
  withWorkspaceCloudImports,
  type CloudImportedSkill,
} from "../../../../app/cloud/import-state";
import type { iPolloWorkServerStore } from "../../connections/ipollowork-server-store";

const OPENCODE_SKILL_NAME_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DEFAULT_HUB_REPO: HubSkillRepo = {
  owner: "different-ai",
  repo: "ipollowork-hub",
  ref: "main",
};
const HUB_REPOS_STORAGE_KEY = "ipollowork.skills.hubRepos.v1";

type SetStateAction<T> = T | ((current: T) => T);

export type ExtensionsStoreSnapshot = {
  workspaceContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  cloudOrgSkills: DenOrgSkillCard[];
  cloudOrgSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  cloudOrgMarketplaces: DenOrgMarketplaceResolved[];
  cloudOrgMarketplacesStatus: string | null;
  hubRepo: HubSkillRepo | null;
  hubRepos: HubSkillRepo[];
  skillsStale: boolean;
  hubSkillsStale: boolean;
  cloudOrgSkillsStale: boolean;
};

type MutableState = {
  skillsContextKey: string;
  hubSkillsContextKey: string;
  cloudOrgSkillsContextKey: string;
  skills: SkillCard[];
  skillsStatus: string | null;
  hubSkills: HubSkillCard[];
  hubSkillsStatus: string | null;
  cloudOrgSkills: DenOrgSkillCard[];
  cloudOrgSkillsStatus: string | null;
  importedCloudSkills: Record<string, CloudImportedSkill>;
  cloudOrgMarketplaces: DenOrgMarketplaceResolved[];
  cloudOrgMarketplacesStatus: string | null;
  hubRepo: HubSkillRepo | null;
  hubRepos: HubSkillRepo[];
};

export type ExtensionsStore = ReturnType<typeof createExtensionsStore>;

function extractSkillBodyMarkdown(skillText: string): string {
  const trimmed = skillText.trim();
  if (!trimmed.startsWith("---")) return trimmed;
  const rest = trimmed.slice(3);
  const end = rest.indexOf("\n---");
  if (end === -1) return trimmed;
  return rest.slice(end + 4).replace(/^\s*\n?/, "");
}


function slugifyOpencodeSkillName(title: string): string {
  let base = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!base) base = "skill";
  if (base.length > 64) base = base.slice(0, 64).replace(/-+$/g, "");
  if (!OPENCODE_SKILL_NAME_RE.test(base)) base = "skill";
  return base;
}

function uniqueSkillInstallName(base: string, taken: Set<string>, stableSuffix: string): string {
  const suffixSource = stableSuffix.replace(/[^a-z0-9]+/g, "").slice(-8) || "org";
  let candidate = base;
  if (!taken.has(candidate)) return candidate;
  for (let n = 1; n < 50; n += 1) {
    const extra = `${suffixSource}${n}`;
    const trimmedBase = base.slice(0, Math.max(1, 64 - extra.length - 1));
    candidate = `${trimmedBase}-${extra}`.replace(/^-+|-+$/g, "").slice(0, 64);
    if (OPENCODE_SKILL_NAME_RE.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return `skill-${suffixSource}`.slice(0, 64);
}

export function createExtensionsStore(options: {
  client: () => Client | null;
  projectDir: () => string;
  selectedWorkspaceId: () => string;
  selectedWorkspaceRoot: () => string;
  workspaceType: () => "local" | "remote";
  ipolloworkServer: iPolloWorkServerStore;
  ipolloworkServerConnection?: () => {
    ipolloworkServerClient: iPolloWorkServerClient | null;
    ipolloworkServerStatus: iPolloWorkServerStatus;
    ipolloworkServerCapabilities: iPolloWorkServerCapabilities | null;
  };
  runtimeWorkspaceId: () => string | null;
  ensureRuntimeWorkspaceId?: () => Promise<string | null | undefined>;
  setBusy: (value: boolean) => void;
  setBusyLabel: (value: string | null) => void;
  setBusyStartedAt: (value: number | null) => void;
  setError: (value: string | null) => void;
  markReloadRequired?: (reason: ReloadReason, trigger?: ReloadTrigger) => void;
}) {
  const listeners = new Set<() => void>();

  let disposed = false;
  let started = false;
  let stopiPolloWorkSubscription: (() => void) | null = null;
  let stopDenSessionListener: (() => void) | null = null;
  let lastWorkspaceContextKey = "";
  let snapshot: ExtensionsStoreSnapshot;

  let refreshSkillsInFlight = false;
  let refreshHubSkillsInFlight = false;
  let refreshCloudOrgSkillsInFlight = false;
  let refreshCloudOrgMarketplacesInFlight = false;
  let refreshCloudOrgSkillsInFlightKey = "";
  let refreshCloudOrgMarketplacesInFlightKey = "";
  let refreshSkillsAborted = false;
  let refreshHubSkillsAborted = false;
  let refreshCloudOrgSkillsAborted = false;
  let refreshCloudOrgMarketplacesAborted = false;
  let skillsLoaded = false;
  let hubSkillsLoaded = false;
  let cloudOrgSkillsLoaded = false;
  let cloudOrgMarketplacesLoaded = false;
  let skillsRoot = "";
  let hubSkillsLoadKey = "";
  let cloudOrgSkillsLoadKey = "";
  let cloudOrgMarketplacesLoadKey = "";

  let state: MutableState = {
    skillsContextKey: "",
    hubSkillsContextKey: "",
    cloudOrgSkillsContextKey: "",
    skills: [],
    skillsStatus: null,
    hubSkills: [],
    hubSkillsStatus: null,
    cloudOrgSkills: [],
    cloudOrgSkillsStatus: null,
    importedCloudSkills: {},
    cloudOrgMarketplaces: [],
    cloudOrgMarketplacesStatus: null,
    hubRepo: DEFAULT_HUB_REPO,
    hubRepos: [DEFAULT_HUB_REPO],
  };

  const emitChange = () => {
    for (const listener of listeners) listener();
  };

  const getWorkspaceContextKey = () => {
    const workspaceId = options.selectedWorkspaceId().trim();
    const root = normalizeDirectoryPath(options.selectedWorkspaceRoot().trim());
    const runtimeWorkspaceId = (options.runtimeWorkspaceId() ?? "").trim();
    const workspaceType = options.workspaceType();
    return `${workspaceType}:${workspaceId}:${root}:${runtimeWorkspaceId}`;
  };

  const getiPolloWorkServerSnapshot = () => {
    const snapshot = options.ipolloworkServer.getSnapshot();
    const connection = options.ipolloworkServerConnection?.();
    if (!connection?.ipolloworkServerClient) return snapshot;
    return {
      ...snapshot,
      ipolloworkServerClient: connection.ipolloworkServerClient,
      ipolloworkServerStatus: connection.ipolloworkServerStatus,
      ipolloworkServerCapabilities: connection.ipolloworkServerCapabilities,
    };
  };

  const resolveWorkspaceServerTarget = async () => {
    const ipolloworkSnapshot = getiPolloWorkServerSnapshot();
    const ipolloworkClient = ipolloworkSnapshot.ipolloworkServerClient;
    let ipolloworkWorkspaceId = options.runtimeWorkspaceId()?.trim() || null;
    if (!ipolloworkWorkspaceId && ipolloworkSnapshot.ipolloworkServerStatus === "connected" && ipolloworkClient) {
      ipolloworkWorkspaceId = (await options.ensureRuntimeWorkspaceId?.())?.trim() || null;
    }
    const hasiPolloWorkTarget =
      ipolloworkSnapshot.ipolloworkServerStatus === "connected" &&
      Boolean(ipolloworkClient && ipolloworkWorkspaceId);
    return {
      ipolloworkSnapshot,
      ipolloworkClient,
      ipolloworkWorkspaceId,
      hasiPolloWorkTarget,
    };
  };

  const refreshSnapshot = () => {
    const workspaceContextKey = getWorkspaceContextKey();
    const orgId = readDenSettings().activeOrgId?.trim() ?? "";
    snapshot = {
      workspaceContextKey,
      skills: state.skills,
      skillsStatus: state.skillsStatus,
      hubSkills: state.hubSkills,
      hubSkillsStatus: state.hubSkillsStatus,
      cloudOrgSkills: state.cloudOrgSkills,
      cloudOrgSkillsStatus: state.cloudOrgSkillsStatus,
      importedCloudSkills: state.importedCloudSkills,
      cloudOrgMarketplaces: state.cloudOrgMarketplaces,
      cloudOrgMarketplacesStatus: state.cloudOrgMarketplacesStatus,
      hubRepo: state.hubRepo,
      hubRepos: state.hubRepos,
      skillsStale: state.skillsContextKey !== workspaceContextKey,
      hubSkillsStale: state.hubSkillsContextKey !== workspaceContextKey,
      cloudOrgSkillsStale: state.cloudOrgSkillsContextKey !== `${workspaceContextKey}::${orgId}`,
    };
  };

  const mutateState = (updater: (current: MutableState) => MutableState) => {
    state = updater(state);
    refreshSnapshot();
    emitChange();
  };

  const setStateField = <K extends keyof MutableState>(key: K, value: MutableState[K]) => {
    if (Object.is(state[key], value)) return;
    mutateState((current) => ({ ...current, [key]: value }));
  };

  const applyStateAction = <T,>(current: T, next: SetStateAction<T>) =>
    typeof next === "function" ? (next as (value: T) => T)(current) : next;

  const formatSkillPath = (location: string) => location.replace(/[/\\]SKILL\.md$/i, "");

  const normalizeHubRepo = (input?: Partial<HubSkillRepo> | null): HubSkillRepo | null => {
    const owner = input?.owner?.trim() || "";
    const repo = input?.repo?.trim() || "";
    const ref = input?.ref?.trim() || DEFAULT_HUB_REPO.ref;
    if (!owner || !repo) return null;
    return { owner, repo, ref };
  };

  const hubRepoKey = (repo: HubSkillRepo) => `${repo.owner}/${repo.repo}@${repo.ref}`;

  const normalizeHubRepoList = (items: unknown[]): HubSkillRepo[] => {
    const seen = new Set<string>();
    const next: HubSkillRepo[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object") continue;
      const record = item as Record<string, unknown>;
      const normalized = normalizeHubRepo({
        owner: typeof record.owner === "string" ? record.owner : undefined,
        repo: typeof record.repo === "string" ? record.repo : undefined,
        ref: typeof record.ref === "string" ? record.ref : undefined,
      });
      if (!normalized) continue;
      const key = hubRepoKey(normalized);
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(normalized);
    }
    return next;
  };

  const readWorkspaceiPolloWorkConfigRecord = async (): Promise<Record<string, unknown>> => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.config?.read !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      const config = await ipolloworkClient.getConfig(ipolloworkWorkspaceId);
      return config.ipollowork ?? {};
    }

    if (hasiPolloWorkTarget) {
      return {};
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      return await workspaceiPolloWorkRead({ workspacePath: root }) as unknown as Record<string, unknown>;
    }

    return {};
  };

  const writeWorkspaceiPolloWorkConfigRecord = async (config: Record<string, unknown>) => {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.config?.write !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      await ipolloworkClient.patchConfig(ipolloworkWorkspaceId, { ipollowork: config });
      return true;
    }

    if (hasiPolloWorkTarget) {
      return false;
    }

    if (isLocalWorkspace && isDesktopRuntime() && root) {
      const result = (await workspaceiPolloWorkWrite({
        workspacePath: root,
        config: config as never,
      })) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        throw new Error(result.stderr || result.stdout || "Failed to write .opencode/ipollowork.json");
      }
      return true;
    }

    return false;
  };

  const refreshImportedCloudSkills = async () => {
    try {
      const config = await readWorkspaceiPolloWorkConfigRecord();
      const cloudImports = readWorkspaceCloudImports(config);
      setStateField("importedCloudSkills", cloudImports.skills);
      return cloudImports.skills;
    } catch {
      setStateField("importedCloudSkills", {});
      return {};
    }
  };

  const persistImportedCloudSkills = async (nextSkills: Record<string, CloudImportedSkill>) => {
    const config = await readWorkspaceiPolloWorkConfigRecord();
    const cloudImports = readWorkspaceCloudImports(config);
    const nextConfig = withWorkspaceCloudImports(config, {
      ...cloudImports,
      skills: nextSkills,
    });
    const persisted = await writeWorkspaceiPolloWorkConfigRecord(nextConfig);
    if (!persisted) {
      throw new Error("iPolloWork server unavailable. Connect to manage imported cloud skills.");
    }
    setStateField("importedCloudSkills", nextSkills);
  };

  const buildCloudSkillContent = (name: string, description: string, body: string) => {
    const safeDescription = description.replace(/\s+/g, " ").trim();
    const normalizedBody = body.replace(/^\s*\n?/, "");
    return [
      "---",
      `name: ${JSON.stringify(name)}`,
      `description: ${JSON.stringify(safeDescription)}`,
      "---",
      "",
      normalizedBody,
    ].join("\n");
  };

  const upsertWorkspaceSkill = async (
    name: string,
    content: string,
    description: string,
    optionsOverride?: { overwrite?: boolean },
  ) => {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const root = options.selectedWorkspaceRoot().trim();
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.skills?.write !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      await ipolloworkClient.upsertSkill(ipolloworkWorkspaceId, {
        name,
        content,
        description,
      });
      return;
    }

    if (hasiPolloWorkTarget) {
      throw new Error("iPolloWork server cannot write skills for this workspace.");
    }

    if (isRemoteWorkspace) {
      throw new Error("iPolloWork server unavailable. Connect to import skills.");
    }

    if (!isDesktopRuntime()) {
      throw new Error(t("skills.desktop_required"));
    }

    if (!isLocalWorkspace || !root) {
      throw new Error(t("skills.pick_workspace_first"));
    }

    const result = (await installSkillTemplate(root, name, content, {
      overwrite: optionsOverride?.overwrite ?? false,
    })) as { ok: boolean; stderr?: string; stdout?: string };
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || t("skills.install_failed"));
    }
  };

  const findImportedCloudSkill = (cloudSkillId: string) => snapshot.importedCloudSkills[cloudSkillId] ?? null;

  const persistImportedCloudSkillRecord = async (skill: DenOrgSkillCard, installedName: string) => {
    const imported = findImportedCloudSkill(skill.id);
    const nextSkills = {
      ...snapshot.importedCloudSkills,
      [skill.id]: {
        cloudSkillId: skill.id,
        installedName,
        title: skill.title,
        description: skill.description,
        shared: skill.shared,
        updatedAt: skill.updatedAt,
        importedAt: imported?.importedAt ?? Date.now(),
      },
    } satisfies Record<string, CloudImportedSkill>;
    await persistImportedCloudSkills(nextSkills);
    return nextSkills[skill.id];
  };

  const deleteWorkspaceSkill = async (name: string) => {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const root = options.selectedWorkspaceRoot().trim();
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.skills?.write !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      await ipolloworkClient.deleteSkill(ipolloworkWorkspaceId, name);
      return;
    }

    if (hasiPolloWorkTarget) {
      throw new Error("iPolloWork server cannot remove skills for this workspace.");
    }

    if (isRemoteWorkspace) {
      throw new Error("iPolloWork server unavailable. Connect to remove skills.");
    }

    if (!isDesktopRuntime()) {
      throw new Error(t("skills.desktop_required"));
    }

    if (!isLocalWorkspace || !root) {
      throw new Error(t("skills.pick_workspace_first"));
    }

    const result = (await uninstallSkillCommand(root, name)) as { ok: boolean; stderr?: string; stdout?: string };
    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || t("skills.uninstall_failed"));
    }
  };

  const persistHubRepos = () => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        HUB_REPOS_STORAGE_KEY,
        JSON.stringify({ selected: state.hubRepo, repos: state.hubRepos }),
      );
    } catch {
      // ignore
    }
  };

  const invalidateWorkspaceCaches = () => {
    skillsLoaded = false;
    hubSkillsLoaded = false;
    cloudOrgSkillsLoaded = false;
    cloudOrgMarketplacesLoaded = false;
    skillsRoot = "";
    hubSkillsLoadKey = "";
    cloudOrgSkillsLoadKey = "";
    cloudOrgMarketplacesLoadKey = "";
  };

  const getCurrentCloudOrgLoadKey = () => {
    const orgId = readDenSettings().activeOrgId?.trim() ?? "";
    return `${getWorkspaceContextKey()}::${orgId}`;
  };

  const touch = () => {
    refreshSnapshot();
    emitChange();
  };

  async function refreshHubSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const repo = snapshot.hubRepo;
    const loadKey = `${root}::${repo ? hubRepoKey(repo) : "none"}`;
    const ipolloworkSnapshot = getiPolloWorkServerSnapshot();
    const ipolloworkClient = ipolloworkSnapshot.ipolloworkServerClient;
    const canUseiPolloWorkServer =
      ipolloworkSnapshot.ipolloworkServerStatus === "connected" &&
      ipolloworkClient &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.hub?.skills?.read;

    if (loadKey !== hubSkillsLoadKey) {
      hubSkillsLoaded = false;
    }

    if (!optionsOverride?.force && hubSkillsLoaded) return;
    if (refreshHubSkillsInFlight) return;

    refreshHubSkillsInFlight = true;
    refreshHubSkillsAborted = false;

    try {
      setStateField("hubSkillsStatus", null);

      if (!repo) {
        mutateState((current) => ({
          ...current,
          hubSkills: [],
          hubSkillsStatus: null,
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
        return;
      }

      if (canUseiPolloWorkServer) {
        const response = await ipolloworkClient.listHubSkills({
          repo: {
            owner: repo.owner,
            repo: repo.repo,
            ref: repo.ref,
          },
        });
        if (refreshHubSkillsAborted) return;
        const next: HubSkillCard[] = Array.isArray(response?.items)
          ? response.items.map((entry) => ({
              name: String(entry.name ?? ""),
              description: typeof entry.description === "string" ? entry.description : undefined,
              trigger: typeof entry.trigger === "string" ? entry.trigger : undefined,
              source: entry.source,
            }))
          : [];
        mutateState((current) => ({
          ...current,
          hubSkills: next,
          hubSkillsStatus: null,
          hubSkillsContextKey: getWorkspaceContextKey(),
        }));
        hubSkillsLoaded = true;
        hubSkillsLoadKey = loadKey;
        return;
      }

      const listingRes = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.repo)}/contents/skills?ref=${encodeURIComponent(repo.ref)}`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!listingRes.ok) {
        throw new Error(`Failed to fetch hub catalog (${listingRes.status})`);
      }
      const listing = (await listingRes.json()) as unknown;
      const dirs: string[] = Array.isArray(listing)
        ? listing.flatMap((entry) => {
            if (!entry || typeof entry !== "object" || (entry as { type?: string }).type !== "dir") return [];
            const name = String((entry as { name?: string }).name ?? "");
            return name ? [name] : [];
          })
        : [];

      const next: HubSkillCard[] = dirs.map((dirName) => ({
        name: dirName,
        source: { owner: repo.owner, repo: repo.repo, ref: repo.ref, path: `skills/${dirName}` },
      }));

      if (refreshHubSkillsAborted) return;
      const sorted = next.toSorted((a, b) => a.name.localeCompare(b.name));
      mutateState((current) => ({
        ...current,
        hubSkills: sorted,
        hubSkillsStatus: null,
        hubSkillsContextKey: getWorkspaceContextKey(),
      }));
      hubSkillsLoaded = true;
      hubSkillsLoadKey = loadKey;
    } catch {
      if (refreshHubSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        hubSkills: [],
        hubSkillsStatus: t("skills.hub_load_failed"),
      }));
    } finally {
      refreshHubSkillsInFlight = false;
    }
  }

  async function refreshCloudOrgSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const wk = getWorkspaceContextKey();
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    const loadKey = `${wk}::${orgId}`;

    if (!root) {
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: [],
        cloudOrgSkillsStatus: null,
        cloudOrgSkillsContextKey: loadKey,
      }));
      cloudOrgSkillsLoaded = true;
      cloudOrgSkillsLoadKey = loadKey;
      return;
    }

    if (loadKey !== cloudOrgSkillsLoadKey) {
      cloudOrgSkillsLoaded = false;
    }

    if (!optionsOverride?.force && cloudOrgSkillsLoaded) {
      await refreshImportedCloudSkills();
      return;
    }
    if (refreshCloudOrgSkillsInFlight && refreshCloudOrgSkillsInFlightKey === loadKey) return;

    refreshCloudOrgSkillsInFlight = true;
    refreshCloudOrgSkillsInFlightKey = loadKey;
    refreshCloudOrgSkillsAborted = false;

    try {
      setStateField("cloudOrgSkillsStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgSkills: [],
          cloudOrgSkillsStatus: null,
          cloudOrgSkillsContextKey: loadKey,
        }));
        cloudOrgSkillsLoaded = true;
        cloudOrgSkillsLoadKey = loadKey;
        await refreshImportedCloudSkills();
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const catalog = await fetchDenOrgSkillsCatalog(client, orgId);
      if (refreshCloudOrgSkillsAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: catalog,
        cloudOrgSkillsStatus: null,
        cloudOrgSkillsContextKey: loadKey,
      }));
      cloudOrgSkillsLoaded = true;
      cloudOrgSkillsLoadKey = loadKey;
      await refreshImportedCloudSkills();
    } catch {
      if (refreshCloudOrgSkillsAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgSkills: [],
        cloudOrgSkillsStatus: t("skills.cloud_org_load_failed"),
      }));
    } finally {
      if (refreshCloudOrgSkillsInFlightKey === loadKey) {
        refreshCloudOrgSkillsInFlight = false;
        refreshCloudOrgSkillsInFlightKey = "";
      }
    }
  }

  async function refreshCloudOrgMarketplaces(optionsOverride?: { force?: boolean }) {
    const wk = getWorkspaceContextKey();
    const settings = readDenSettings();
    const token = settings.authToken?.trim() ?? "";
    const orgId = settings.activeOrgId?.trim() ?? "";
    const loadKey = `${wk}::${orgId}`;

    if (loadKey !== cloudOrgMarketplacesLoadKey) {
      cloudOrgMarketplacesLoaded = false;
    }

    if (!optionsOverride?.force && cloudOrgMarketplacesLoaded) return;
    if (refreshCloudOrgMarketplacesInFlight && refreshCloudOrgMarketplacesInFlightKey === loadKey) return;

    refreshCloudOrgMarketplacesInFlight = true;
    refreshCloudOrgMarketplacesInFlightKey = loadKey;
    refreshCloudOrgMarketplacesAborted = false;

    try {
      setStateField("cloudOrgMarketplacesStatus", null);

      if (!token || !orgId) {
        mutateState((current) => ({
          ...current,
          cloudOrgMarketplaces: [],
          cloudOrgMarketplacesStatus: null,
        }));
        cloudOrgMarketplacesLoaded = true;
        cloudOrgMarketplacesLoadKey = loadKey;
        return;
      }

      const client = createDenClient({ baseUrl: settings.baseUrl, token });
      const marketplaces = await client.listOrgMarketplaces(orgId);
      const resolved = await Promise.all(
        marketplaces.map((marketplace) => client.getOrgMarketplaceResolved(orgId, marketplace.id)),
      );
      if (refreshCloudOrgMarketplacesAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: resolved,
        cloudOrgMarketplacesStatus: null,
      }));

      cloudOrgMarketplacesLoaded = true;
      cloudOrgMarketplacesLoadKey = loadKey;
    } catch (error) {
      if (refreshCloudOrgMarketplacesAborted || getCurrentCloudOrgLoadKey() !== loadKey) return;
      mutateState((current) => ({
        ...current,
        cloudOrgMarketplaces: [],
        cloudOrgMarketplacesStatus:
          error instanceof Error ? error.message : "Failed to load organization marketplaces.",
      }));
    } finally {
      if (refreshCloudOrgMarketplacesInFlightKey === loadKey) {
        refreshCloudOrgMarketplacesInFlight = false;
        refreshCloudOrgMarketplacesInFlightKey = "";
      }
    }
  }

  async function installHubSkill(name: string): Promise<{ ok: boolean; message: string }> {
    const trimmed = name.trim();
    if (!trimmed) return { ok: false, message: "Skill name is required." };
    const repo = snapshot.hubRepo;
    if (!repo) return { ok: false, message: "Select a hub repo before installing skills." };

    const isRemoteWorkspace = options.workspaceType() === "remote";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.hub?.skills?.install !== false;

    if (!canUseiPolloWorkServer) {
      if (isRemoteWorkspace) return { ok: false, message: "iPolloWork server unavailable. Connect to install skills." };
      return { ok: false, message: "Hub install requires iPolloWork server." };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      const repoOverride: iPolloWorkHubRepo = { owner: repo.owner, repo: repo.repo, ref: repo.ref };
      if (!ipolloworkClient || !ipolloworkWorkspaceId) return { ok: false, message: "Hub install requires iPolloWork server." };
      const result = await ipolloworkClient.installHubSkill(ipolloworkWorkspaceId, trimmed, { repo: repoOverride });
      await Promise.all([refreshSkills({ force: true }), refreshHubSkills({ force: true })]);
      if (!result?.ok) return { ok: false, message: "Install failed." };
      return { ok: true, message: `Installed ${trimmed}.` };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function installCloudOrgSkill(skill: DenOrgSkillCard): Promise<{ ok: boolean; message: string }> {
    const existingImport = findImportedCloudSkill(skill.id);
    const installedNames = new Set(snapshot.skills.map((entry) => entry.name));
    const preferredName = existingImport?.installedName?.trim() ?? "";
    if (preferredName) installedNames.delete(preferredName);
    const installName = preferredName || uniqueSkillInstallName(slugifyOpencodeSkillName(skill.title), installedNames, skill.id);
    const rawDesc = (skill.description?.trim() || skill.title).trim();
    const description = rawDesc.slice(0, 1024) || skill.title.slice(0, 1024) || "Skill";
    const body = extractSkillBodyMarkdown(skill.skillText);
    const content = buildCloudSkillContent(installName, description, body);
    const action = existingImport ? "updated" : "added";

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      await upsertWorkspaceSkill(installName, content, description, { overwrite: Boolean(existingImport) });
      await persistImportedCloudSkillRecord(skill, installName);
      options.markReloadRequired?.("skills", { type: "skill", name: installName, action });
      await Promise.all([refreshSkills({ force: true }), refreshCloudOrgSkills({ force: true })]);
      return {
        ok: true,
        message: t(existingImport ? "skills.cloud_updated" : "skills.cloud_installed", { name: installName }),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function syncCloudOrgSkill(skill: DenOrgSkillCard): Promise<{ ok: boolean; message: string }> {
    return installCloudOrgSkill(skill);
  }

  async function removeCloudOrgSkill(cloudSkillId: string): Promise<{ ok: boolean; message: string; removedName: string | null }> {
    const imported = findImportedCloudSkill(cloudSkillId);
    if (!imported) {
      return { ok: false, message: "This cloud skill has not been installed into the workspace.", removedName: null };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);

    try {
      if (snapshot.skills.some((skill) => skill.name === imported.installedName)) {
        await deleteWorkspaceSkill(imported.installedName);
      }
      const nextImports = { ...snapshot.importedCloudSkills };
      delete nextImports[cloudSkillId];
      await persistImportedCloudSkills(nextImports);
      options.markReloadRequired?.("skills", { type: "skill", name: imported.installedName, action: "removed" });
      await Promise.all([refreshSkills({ force: true }), refreshCloudOrgSkills({ force: true })]);
      return {
        ok: true,
        message: t("skills.cloud_removed", { name: imported.installedName }),
        removedName: imported.installedName,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
      return { ok: false, message, removedName: null };
    } finally {
      options.setBusy(false);
    }
  }

  async function refreshSkills(optionsOverride?: { force?: boolean }) {
    const root = options.selectedWorkspaceRoot().trim();
    const isLocalWorkspace = options.workspaceType() === "local";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.skills?.read !== false;

    if (!root && !hasiPolloWorkTarget) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: t("skills.pick_workspace_first"),
      }));
      return;
    }

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      const skillCacheKey = root || ipolloworkWorkspaceId;
      if (skillCacheKey !== skillsRoot) skillsLoaded = false;
      if (!optionsOverride?.force && skillsLoaded) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const response = await ipolloworkClient.listSkills(ipolloworkWorkspaceId, {
          includeGlobal: isLocalWorkspace,
        });
        if (refreshSkillsAborted) return;
        const next: SkillCard[] = Array.isArray(response.items)
          ? response.items.map((entry) => ({
              name: entry.name,
              description: entry.description,
              path: entry.path,
              trigger: entry.trigger,
            }))
          : [];
        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = skillCacheKey;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    if (hasiPolloWorkTarget) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: "iPolloWork server cannot read skills for this workspace.",
      }));
      return;
    }

    if (isLocalWorkspace && isDesktopRuntime()) {
      if (root !== skillsRoot) skillsLoaded = false;
      if (!optionsOverride?.force && skillsLoaded) return;
      if (refreshSkillsInFlight) return;

      refreshSkillsInFlight = true;
      refreshSkillsAborted = false;
      try {
        setStateField("skillsStatus", null);
        const local = await listLocalSkills(root);
        if (refreshSkillsAborted) return;
        const next: SkillCard[] = Array.isArray(local)
          ? local.map((entry) => ({
              name: entry.name,
              description: entry.description,
              path: entry.path,
              trigger: entry.trigger,
            }))
          : [];
        mutateState((current) => ({
          ...current,
          skills: next,
          skillsStatus: next.length ? null : t("skills.no_skills_found"),
          skillsContextKey: getWorkspaceContextKey(),
        }));
        skillsLoaded = true;
        skillsRoot = root;
      } catch (error) {
        if (refreshSkillsAborted) return;
        mutateState((current) => ({
          ...current,
          skills: [],
          skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
        }));
      } finally {
        refreshSkillsInFlight = false;
      }
      return;
    }

    const client = options.client();
    if (!client) {
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: "iPolloWork server unavailable. Connect to load skills.",
      }));
      return;
    }

    if (root !== skillsRoot) skillsLoaded = false;
    if (!optionsOverride?.force && skillsLoaded) return;
    if (refreshSkillsInFlight) return;

    refreshSkillsInFlight = true;
    refreshSkillsAborted = false;
    try {
      setStateField("skillsStatus", null);
      const rawClient = client as unknown as { _client?: { get: (input: { url: string }) => Promise<unknown> } };
      if (!rawClient._client) throw new Error("OpenCode client unavailable.");
      const result = await rawClient._client.get({ url: "/skill" }) as {
        data?: Array<{ name: string; description: string; location: string }>;
        error?: unknown;
      };
      if (result?.data === undefined) {
        const err = result?.error;
        const message = err instanceof Error ? err.message : typeof err === "string" ? err : t("skills.failed_to_load");
        throw new Error(message);
      }
      if (refreshSkillsAborted) return;
      const next: SkillCard[] = Array.isArray(result.data)
        ? result.data.map((entry) => ({
            name: entry.name,
            description: entry.description,
            path: formatSkillPath(entry.location),
          }))
        : [];
      mutateState((current) => ({
        ...current,
        skills: next,
        skillsStatus: next.length ? null : t("skills.no_skills_found"),
        skillsContextKey: getWorkspaceContextKey(),
      }));
      skillsLoaded = true;
      skillsRoot = root;
    } catch (error) {
      if (refreshSkillsAborted) return;
      mutateState((current) => ({
        ...current,
        skills: [],
        skillsStatus: error instanceof Error ? error.message : t("skills.failed_to_load"),
      }));
    } finally {
      refreshSkillsInFlight = false;
    }
  }

  async function importLocalSkill() {
    const isLocalWorkspace = options.workspaceType() === "local";
    if (!isDesktopRuntime()) {
      options.setError(t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      options.setError("Local workers are required to import skills.");
      return;
    }
    const targetDir = options.projectDir().trim();
    if (!targetDir) {
      options.setError(t("skills.pick_project_first"));
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const selection = await pickDirectory({ title: t("skills.select_skill_folder") });
      const sourceDir = typeof selection === "string" ? selection : Array.isArray(selection) ? selection[0] : null;
      if (!sourceDir) return;
      const inferredName = sourceDir.split(/[\\/]/).filter(Boolean).pop();
      const result = (await importSkill(targetDir, sourceDir, { overwrite: false })) as { ok: boolean; stderr?: string; stdout?: string; status?: number };
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.import_failed").replace("{status}", String(result.status)));
      } else {
        setStateField("skillsStatus", result.stdout || t("skills.imported"));
        options.markReloadRequired?.("skills", { type: "skill", name: inferredName, action: "added" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function installSkillCreator(): Promise<{ ok: boolean; message: string }> {
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.skills?.write !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", t("skills.installing_skill_creator"));
      try {
        await ipolloworkClient.upsertSkill(ipolloworkWorkspaceId, { name: "skill-creator", content: skillCreatorTemplate });
        const message = t("skills.skill_creator_installed");
        setStateField("skillsStatus", message);
        options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
        await refreshSkills({ force: true });
        return { ok: true, message };
      } catch (error) {
        const raw = error instanceof Error ? error.message : t("skills.unknown_error");
        const message = addOpencodeCacheHint(raw);
        setStateField("skillsStatus", message);
        options.setError(message);
        return { ok: false, message };
      } finally {
        options.setBusy(false);
      }
    }

    if (hasiPolloWorkTarget) {
      const message = "iPolloWork server cannot write skills for this workspace.";
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    if (isRemoteWorkspace) {
      const message = "iPolloWork server unavailable. Connect to install skills.";
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isDesktopRuntime()) {
      const message = t("skills.desktop_required");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }
    if (!isLocalWorkspace) {
      const message = "Local workers are required to install skills.";
      options.setError(message);
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    const targetDir = options.selectedWorkspaceRoot().trim();
    if (!targetDir) {
      const message = t("skills.pick_workspace_first");
      setStateField("skillsStatus", message);
      return { ok: false, message };
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", t("skills.installing_skill_creator"));
    try {
      const result = (await installSkillTemplate(targetDir, "skill-creator", skillCreatorTemplate, { overwrite: false })) as { ok: boolean; stderr: string; stdout: string };
      if (!result.ok && /already exists/i.test(result.stderr)) {
        const message = t("skills.skill_creator_already_installed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: true, message };
      }
      if (!result.ok) {
        const message = result.stderr || result.stdout || t("skills.install_failed");
        setStateField("skillsStatus", message);
        await refreshSkills({ force: true });
        return { ok: false, message };
      }
      const message = result.stdout || t("skills.skill_creator_installed");
      setStateField("skillsStatus", message);
      options.markReloadRequired?.("skills", { type: "skill", name: "skill-creator", action: "added" });
      await refreshSkills({ force: true });
      return { ok: true, message };
    } catch (error) {
      const raw = error instanceof Error ? error.message : t("skills.unknown_error");
      const message = addOpencodeCacheHint(raw);
      setStateField("skillsStatus", message);
      options.setError(message);
      return { ok: false, message };
    } finally {
      options.setBusy(false);
    }
  }

  async function revealSkillsFolder() {
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    const root = options.selectedWorkspaceRoot().trim();
    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    try {
      const [opencodeSkills, claudeSkills] = await Promise.all([
        joinDesktopPath(root, ".opencode", "skills"),
        joinDesktopPath(root, ".claude", "skills"),
      ]);
      const tryOpen = async (target: string) => {
        try {
          await openDesktopPath(target);
          return true;
        } catch {
          return false;
        }
      };
      if (await tryOpen(opencodeSkills)) return;
      if (await tryOpen(claudeSkills)) return;
      await revealDesktopItemInDir(opencodeSkills);
    } catch (error) {
      setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.reveal_failed"));
    }
  }

  async function uninstallSkill(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      await deleteWorkspaceSkill(trimmed);
      setStateField("skillsStatus", t("skills.uninstalled"));
      options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "removed" });
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      setStateField("skillsStatus", message);
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  async function readSkill(name: string): Promise<{ name: string; path: string; content: string } | null> {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const root = options.selectedWorkspaceRoot().trim();
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.skills?.read !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      try {
        setStateField("skillsStatus", null);
        const result = await ipolloworkClient.getSkill(ipolloworkWorkspaceId, trimmed, {
          includeGlobal: isLocalWorkspace,
        });
        return { name: result.item.name, path: result.item.path, content: result.content };
      } catch (error) {
        setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.failed_to_load"));
        return null;
      }
    }

    if (hasiPolloWorkTarget) {
      setStateField("skillsStatus", "iPolloWork server cannot read skills for this workspace.");
      return null;
    }

    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return null;
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "iPolloWork server unavailable. Connect to view skills.");
      return null;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return null;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "Local workers are required to view skills.");
      return null;
    }

    try {
      setStateField("skillsStatus", null);
      const result = (await readLocalSkill(root, trimmed)) as { path: string; content: string };
      return { name: trimmed, path: result.path, content: result.content };
    } catch (error) {
      setStateField("skillsStatus", error instanceof Error ? error.message : t("skills.failed_to_load"));
      return null;
    }
  }

  async function saveSkill(input: { name: string; content: string; description?: string }) {
    const trimmed = input.name.trim();
    if (!trimmed) return;
    const root = options.selectedWorkspaceRoot().trim();
    const isRemoteWorkspace = options.workspaceType() === "remote";
    const isLocalWorkspace = options.workspaceType() === "local";
    const { ipolloworkSnapshot, ipolloworkClient, ipolloworkWorkspaceId, hasiPolloWorkTarget } =
      await resolveWorkspaceServerTarget();
    const canUseiPolloWorkServer =
      hasiPolloWorkTarget &&
      ipolloworkSnapshot.ipolloworkServerCapabilities?.skills?.write !== false;

    if (canUseiPolloWorkServer && ipolloworkClient && ipolloworkWorkspaceId) {
      options.setBusy(true);
      options.setError(null);
      setStateField("skillsStatus", null);
      try {
        await ipolloworkClient.upsertSkill(ipolloworkWorkspaceId, {
          name: trimmed,
          content: input.content,
          description: input.description,
        });
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
        await refreshSkills({ force: true });
        setStateField("skillsStatus", "Saved.");
      } catch (error) {
        const message = error instanceof Error ? error.message : t("skills.unknown_error");
        options.setError(addOpencodeCacheHint(message));
      } finally {
        options.setBusy(false);
      }
      return;
    }

    if (hasiPolloWorkTarget) {
      setStateField("skillsStatus", "iPolloWork server cannot write skills for this workspace.");
      return;
    }

    if (!root) {
      setStateField("skillsStatus", t("skills.pick_workspace_first"));
      return;
    }

    if (isRemoteWorkspace) {
      setStateField("skillsStatus", "iPolloWork server unavailable. Connect to edit skills.");
      return;
    }
    if (!isDesktopRuntime()) {
      setStateField("skillsStatus", t("skills.desktop_required"));
      return;
    }
    if (!isLocalWorkspace) {
      setStateField("skillsStatus", "Local workers are required to edit skills.");
      return;
    }

    options.setBusy(true);
    options.setError(null);
    setStateField("skillsStatus", null);
    try {
      const result = (await writeLocalSkill(root, trimmed, input.content)) as { ok: boolean; stderr?: string; stdout?: string };
      if (!result.ok) {
        setStateField("skillsStatus", result.stderr || result.stdout || t("skills.unknown_error"));
      } else {
        setStateField("skillsStatus", result.stdout || "Saved.");
        options.markReloadRequired?.("skills", { type: "skill", name: trimmed, action: "updated" });
      }
      await refreshSkills({ force: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : t("skills.unknown_error");
      options.setError(addOpencodeCacheHint(message));
    } finally {
      options.setBusy(false);
    }
  }

  function abortRefreshes() {
    refreshSkillsAborted = true;
    refreshHubSkillsAborted = true;
    refreshCloudOrgSkillsAborted = true;
    refreshCloudOrgMarketplacesAborted = true;
  }

  function ensureSkillsFresh() {
    if (!snapshot.skillsStale) return;
    void refreshSkills({ force: true });
  }

  function ensureHubSkillsFresh() {
    if (!snapshot.hubSkillsStale) return;
    void refreshHubSkills({ force: true });
  }

  function ensureCloudOrgSkillsFresh() {
    if (!snapshot.cloudOrgSkillsStale) return;
    void refreshCloudOrgSkills({ force: true });
  }

  const setHubRepo = (repoInput: Partial<HubSkillRepo> | null, optionsOverride?: { remember?: boolean }) => {
    const next = normalizeHubRepo(repoInput);
    mutateState((current) => ({ ...current, hubRepo: next }));
    hubSkillsLoaded = false;
    if (optionsOverride?.remember === false || !next) {
      persistHubRepos();
      return;
    }
    mutateState((current) => {
      const seen = new Set<string>();
      const merged = [next, ...current.hubRepos];
      const deduped: HubSkillRepo[] = [];
      for (const item of merged) {
        const key = hubRepoKey(item);
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }
      return { ...current, hubRepos: deduped };
    });
    persistHubRepos();
  };

  const addHubRepo = (repoInput: Partial<HubSkillRepo>) => {
    const next = normalizeHubRepo(repoInput);
    if (!next) return;
    setHubRepo(next);
  };

  const removeHubRepo = (repoInput: Partial<HubSkillRepo>) => {
    const target = normalizeHubRepo(repoInput);
    if (!target) return;
    const targetKey = hubRepoKey(target);
    const nextRepos = snapshot.hubRepos.filter((item) => hubRepoKey(item) !== targetKey);
    mutateState((current) => ({ ...current, hubRepos: nextRepos }));
    const activeRepo = snapshot.hubRepo;
    if (activeRepo && hubRepoKey(activeRepo) === targetKey) {
      mutateState((current) => ({
        ...current,
        hubRepo: nextRepos[0] ?? null,
        hubSkills: nextRepos.length ? current.hubSkills : [],
        hubSkillsStatus: nextRepos.length ? current.hubSkillsStatus : null,
      }));
      hubSkillsLoaded = false;
      if (!nextRepos.length) {
        hubSkillsLoadKey = "";
      }
    }
    persistHubRepos();
  };

  const start = () => {
    if (started) return;
    // StrictMode double-mount re-arms after dispose.
    disposed = false;
    started = true;

    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(HUB_REPOS_STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as { selected?: unknown; repos?: unknown[]; custom?: unknown[] };
          const storedRepos = Array.isArray(parsed?.repos)
            ? normalizeHubRepoList(parsed.repos)
            : Array.isArray(parsed?.custom)
              ? normalizeHubRepoList(parsed.custom)
              : [];
          const selected = parsed?.selected && typeof parsed.selected === "object"
            ? normalizeHubRepo(parsed.selected as Partial<HubSkillRepo>)
            : null;
          const selectedKey = selected ? hubRepoKey(selected) : null;
          const hasSelected = selectedKey ? storedRepos.some((item) => hubRepoKey(item) === selectedKey) : false;
          const nextRepos = selected && !hasSelected ? [selected, ...storedRepos] : storedRepos;
          mutateState((current) => ({
            ...current,
            hubRepos: nextRepos.length ? nextRepos : current.hubRepos,
            hubRepo: selected && nextRepos.length ? selected : nextRepos[0] ?? current.hubRepo,
          }));
        }
      } catch {
        // ignore
      }

      const onDenSessionUpdated = () => {
        cloudOrgSkillsLoaded = false;
        cloudOrgMarketplacesLoaded = false;
        mutateState((current) => ({ ...current, cloudOrgSkillsContextKey: "" }));
      };
      window.addEventListener("ipollowork-den-session-updated", onDenSessionUpdated);
      stopDenSessionListener = () => window.removeEventListener("ipollowork-den-session-updated", onDenSessionUpdated);
    }

    stopiPolloWorkSubscription = options.ipolloworkServer.subscribe(() => {
      syncFromOptions();
    });

    syncFromOptions();
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    started = false;
    abortRefreshes();
    stopiPolloWorkSubscription?.();
    stopiPolloWorkSubscription = null;
    stopDenSessionListener?.();
    stopDenSessionListener = null;
    listeners.clear();
  };

  const syncFromOptions = () => {
    if (disposed) return;
    const key = getWorkspaceContextKey();
    if (key === lastWorkspaceContextKey) return;
    lastWorkspaceContextKey = key;
    invalidateWorkspaceCaches();
    touch();
    if (!key || key === "::::") return;
    void refreshSkills({ force: true });
    void refreshImportedCloudSkills();
  };

  refreshSnapshot();

  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };

  const getSnapshot = () => snapshot;

  return {
    subscribe,
    getSnapshot,
    start,
    dispose,
    syncFromOptions,
    skills: () => snapshot.skills,
    skillsStatus: () => snapshot.skillsStatus,
    hubSkills: () => snapshot.hubSkills,
    hubSkillsStatus: () => snapshot.hubSkillsStatus,
    cloudOrgSkills: () => snapshot.cloudOrgSkills,
    cloudOrgSkillsStatus: () => snapshot.cloudOrgSkillsStatus,
    importedCloudSkills: () => snapshot.importedCloudSkills,
    cloudOrgMarketplaces: () => snapshot.cloudOrgMarketplaces,
    cloudOrgMarketplacesStatus: () => snapshot.cloudOrgMarketplacesStatus,
    hubRepo: () => snapshot.hubRepo,
    hubRepos: () => snapshot.hubRepos,
    workspaceContextKey: () => snapshot.workspaceContextKey,
    skillsStale: () => snapshot.skillsStale,
    hubSkillsStale: () => snapshot.hubSkillsStale,
    cloudOrgSkillsStale: () => snapshot.cloudOrgSkillsStale,
    refreshSkills,
    refreshHubSkills,
    refreshCloudOrgSkills,
    refreshCloudOrgMarketplaces,
    setHubRepo,
    addHubRepo,
    removeHubRepo,
    importLocalSkill,
    installSkillCreator,
    installHubSkill,
    installCloudOrgSkill,
    syncCloudOrgSkill,
    removeCloudOrgSkill,
    revealSkillsFolder,
    uninstallSkill,
    readSkill,
    saveSkill,
    abortRefreshes,
    ensureSkillsFresh,
    ensureHubSkillsFresh,
    ensureCloudOrgSkillsFresh,
  };
}

export function useExtensionsStoreSnapshot(store: ExtensionsStore) {
  return React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
}
