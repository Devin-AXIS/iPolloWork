/** @jsxImportSource react */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useReducer,
  type SetStateAction,
} from "react";
import {
  Cloud,
  Download,
  Edit2,
  Loader2,
  Package,
  Plus,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { toast } from "@/components/ui/sonner";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";
import { saveInstalledSkillToiPolloWorkOrg } from "@/app/lib/den-skills";
import {
  buildDenAuthUrl,
  DEFAULT_DEN_BASE_URL,
  readDenSettings,
} from "@/app/lib/den";
import type {
  DenOrgSkillCard,
  HubSkillCard,
  HubSkillRepo,
  SkillCard,
} from "@/app/types";
import {
  modalNoticeErrorClass,
  modalNoticeSuccessClass,
  pillGhostClass,
  pillPrimaryClass,
  pillSecondaryClass,
  surfaceCardClass,
  tagClass,
} from "@/react-app/domains/workspace/modal-styles";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  settingsPageDescriptionClass,
  settingsPageTitleClass,
  settingsSectionTitleClass,
  settingsStandardContentClass,
} from "@/react-app/domains/settings/shell/panel";
import { SettingsSegmentedTabs } from "@/react-app/domains/settings/settings-segmented-tabs";
import {
  SelectMenu,
  type SelectMenuOption,
} from "@/react-app/design-system/select-menu";

type InstallResult = { ok: boolean; message: string };
type SkillsFilter = "all" | "cloud" | "hub";
type SkillsStatusFilter = "all" | "installed" | "available" | "update";
type CloudSkillInstallState = "available" | "installed" | "update" | "missing_local";

function isSkillsStatusFilter(value: string): value is SkillsStatusFilter {
  return value === "all" || value === "installed" || value === "available" || value === "update";
}

const panelCardClass =
  "group rounded-[8px] bg-transparent p-4 transition-colors hover:bg-[#f6f7fb] focus-within:bg-[#f6f7fb] dark:hover:bg-dls-hover dark:focus-within:bg-dls-hover";

const IPOLLOWORK_DEFAULT_SKILL_NAMES = new Set([
  "workspace-guide",
  "get-started",
  "skill-creator",
  "command-creator",
  "agent-creator",
  "plugin-creator",
]);

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

type SkillsViewLocalState = {
  uninstallTarget: SkillCard | null;
  searchQuery: string;
  activeFilter: SkillsFilter;
  statusFilter: SkillsStatusFilter;
  customRepoOpen: boolean;
  customRepoOwner: string;
  customRepoName: string;
  customRepoRef: string;
  customRepoError: string | null;
  shareTarget: SkillCard | null;
  cloudSessionNonce: number;
  shareTeamBusy: boolean;
  shareTeamError: string | null;
  shareTeamSuccess: string | null;
  sharePermissionChoice: string;
  selectedSkill: SkillCard | null;
  selectedContent: string;
  selectedLoading: boolean;
  selectedDirty: boolean;
  selectedError: string | null;
  installingSkillCreator: boolean;
  installingHubSkill: string | null;
  installingCloudSkillId: string | null;
  denUiTick: number;
};

type SkillsViewLocalAction<K extends keyof SkillsViewLocalState = keyof SkillsViewLocalState> =
  | { type: "set"; key: K; value: SetStateAction<any> }
  | { type: "denSessionUpdated" }
  | { type: "closeShare" }
  | { type: "openShare"; skill: SkillCard };

const initialSkillsViewLocalState: SkillsViewLocalState = {
  uninstallTarget: null,
  searchQuery: "",
  activeFilter: "all",
  statusFilter: "all",
  customRepoOpen: false,
  customRepoOwner: "",
  customRepoName: "",
  customRepoRef: "main",
  customRepoError: null,
  shareTarget: null,
  cloudSessionNonce: 0,
  shareTeamBusy: false,
  shareTeamError: null,
  shareTeamSuccess: null,
  sharePermissionChoice: "org",
  selectedSkill: null,
  selectedContent: "",
  selectedLoading: false,
  selectedDirty: false,
  selectedError: null,
  installingSkillCreator: false,
  installingHubSkill: null,
  installingCloudSkillId: null,
  denUiTick: 0,
};

function skillsViewLocalReducer(
  state: SkillsViewLocalState,
  action: SkillsViewLocalAction,
): SkillsViewLocalState {
  switch (action.type) {
    case "set": {
      const current = state[action.key];
      const next =
        typeof action.value === "function"
          ? (action.value as (value: typeof current) => typeof current)(current)
          : action.value;
      if (Object.is(current, next)) return state;
      return { ...state, [action.key]: next };
    }
    case "denSessionUpdated":
      return {
        ...state,
        denUiTick: state.denUiTick + 1,
        cloudSessionNonce: state.cloudSessionNonce + 1,
      };
    case "closeShare":
      return {
        ...state,
        shareTarget: null,
        shareTeamBusy: false,
        shareTeamError: null,
        shareTeamSuccess: null,
        sharePermissionChoice: "org",
      };
    case "openShare":
      return {
        ...state,
        shareTarget: action.skill,
        shareTeamBusy: false,
        shareTeamError: null,
        shareTeamSuccess: null,
        sharePermissionChoice: "org",
        cloudSessionNonce: state.cloudSessionNonce + 1,
      };
  }
}

export const SkillsView = forwardRef<SkillsViewHandle, SkillsViewProps>(function SkillsView(props, ref) {
  const { extensions } = props;
  const [localState, dispatchLocal] = useReducer(
    skillsViewLocalReducer,
    initialSkillsViewLocalState,
  );
  const {
    uninstallTarget,
    searchQuery,
    activeFilter,
    statusFilter,
    customRepoOpen,
    customRepoOwner,
    customRepoName,
    customRepoRef,
    customRepoError,
    shareTarget,
    cloudSessionNonce,
    shareTeamBusy,
    shareTeamError,
    shareTeamSuccess,
    sharePermissionChoice,
    selectedSkill,
    selectedContent,
    selectedLoading,
    selectedDirty,
    selectedError,
    installingSkillCreator,
    installingHubSkill,
    installingCloudSkillId,
    denUiTick,
  } = localState;
  const setLocal = <K extends keyof SkillsViewLocalState>(
    key: K,
    value: SetStateAction<SkillsViewLocalState[K]>,
  ) => dispatchLocal({ type: "set", key, value });
  const setUninstallTarget = (value: SetStateAction<SkillCard | null>) => setLocal("uninstallTarget", value);
  const setSearchQuery = (value: SetStateAction<string>) => setLocal("searchQuery", value);
  const setActiveFilter = (value: SetStateAction<SkillsFilter>) => setLocal("activeFilter", value);
  const setStatusFilter = (value: SetStateAction<SkillsStatusFilter>) => setLocal("statusFilter", value);
  const setCustomRepoOpen = (value: SetStateAction<boolean>) => setLocal("customRepoOpen", value);
  const setCustomRepoOwner = (value: SetStateAction<string>) => setLocal("customRepoOwner", value);
  const setCustomRepoName = (value: SetStateAction<string>) => setLocal("customRepoName", value);
  const setCustomRepoRef = (value: SetStateAction<string>) => setLocal("customRepoRef", value);
  const setCustomRepoError = (value: SetStateAction<string | null>) => setLocal("customRepoError", value);
  const setShareTeamBusy = (value: SetStateAction<boolean>) => setLocal("shareTeamBusy", value);
  const setShareTeamError = (value: SetStateAction<string | null>) => setLocal("shareTeamError", value);
  const setShareTeamSuccess = (value: SetStateAction<string | null>) => setLocal("shareTeamSuccess", value);
  const setSharePermissionChoice = (value: SetStateAction<string>) => setLocal("sharePermissionChoice", value);
  const setSelectedSkill = (value: SetStateAction<SkillCard | null>) => setLocal("selectedSkill", value);
  const setSelectedContent = (value: SetStateAction<string>) => setLocal("selectedContent", value);
  const setSelectedLoading = (value: SetStateAction<boolean>) => setLocal("selectedLoading", value);
  const setSelectedDirty = (value: SetStateAction<boolean>) => setLocal("selectedDirty", value);
  const setSelectedError = (value: SetStateAction<string | null>) => setLocal("selectedError", value);
  const setInstallingSkillCreator = (value: SetStateAction<boolean>) => setLocal("installingSkillCreator", value);
  const setInstallingHubSkill = (value: SetStateAction<string | null>) => setLocal("installingHubSkill", value);
  const setInstallingCloudSkillId = (value: SetStateAction<string | null>) => setLocal("installingCloudSkillId", value);

  const maskError = useCallback(
    (value: unknown) =>
      value instanceof Error ? value.message : t("common.something_went_wrong"),
    [],
  );

  useEffect(() => {
    void extensions.ensureHubSkillsFresh();
    void extensions.ensureCloudOrgSkillsFresh();
    const onDenSession = () => {
      dispatchLocal({ type: "denSessionUpdated" });
      void extensions.refreshCloudOrgSkills({ force: true });
    };
    window.addEventListener("ipollowork-den-session-updated", onDenSession);
    return () => window.removeEventListener("ipollowork-den-session-updated", onDenSession);
  }, [extensions]);

  useEffect(() => {
    if (!shareTarget) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      dispatchLocal({ type: "closeShare" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [shareTarget]);

  const shareCloudSignedIn = useMemo(() => {
    cloudSessionNonce;
    return Boolean(readDenSettings().authToken?.trim());
  }, [cloudSessionNonce]);

  const shareTeamOrgLabel = useMemo(() => {
    cloudSessionNonce;
    const name = readDenSettings().activeOrgName?.trim();
    return name || t("skills.share_team_org_fallback");
  }, [cloudSessionNonce]);

  const shareTeamDisabledReason = useMemo(() => {
    if (!shareCloudSignedIn) return null;
    const settings = readDenSettings();
    if (!settings.activeOrgId?.trim() && !settings.activeOrgSlug?.trim()) {
      return t("skills.share_team_choose_org");
    }
    return null;
  }, [shareCloudSignedIn]);

  const skills = extensions.skills();
  const hubSkills = extensions.hubSkills();
  const cloudOrgSkills = extensions.cloudOrgSkills();
  const importedCloudSkills = extensions.importedCloudSkills();
  const hubRepo = extensions.hubRepo();
  const hubRepos = extensions.hubRepos();
  const skillsStatus = extensions.skillsStatus();
  const hubSkillsStatus = extensions.hubSkillsStatus();
  const cloudOrgSkillsStatus = extensions.cloudOrgSkillsStatus();

  const skillCreatorInstalled = useMemo(
    () => skills.some((skill) => skill.name === "skill-creator"),
    [skills],
  );

  const filteredSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return skills;
    return skills.filter((skill) => {
      const description = skill.description ?? "";
      return skill.name.toLowerCase().includes(query) || description.toLowerCase().includes(query);
    });
  }, [searchQuery, skills]);

  const installedNames = useMemo(() => new Set(skills.map((skill) => skill.name)), [skills]);

  const filteredHubSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    const items = hubSkills.filter((skill) => !installedNames.has(skill.name));
    if (!query) return items;
    return items.filter((skill) => {
      const description = skill.description ?? "";
      const trigger = skill.trigger ?? "";
      return (
        skill.name.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query) ||
        trigger.toLowerCase().includes(query)
      );
    });
  }, [hubSkills, installedNames, searchQuery]);

  const filteredCloudOrgSkills = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return cloudOrgSkills;
    return cloudOrgSkills.filter((skill) => {
      const description = skill.description ?? "";
      return (
        skill.title.toLowerCase().includes(query) ||
        description.toLowerCase().includes(query)
      );
    });
  }, [cloudOrgSkills, searchQuery]);

  const cloudSkillInstallState = useCallback(
    (skill: DenOrgSkillCard): CloudSkillInstallState => {
      const imported = importedCloudSkills[skill.id];
      if (!imported) return "available";
      if (!installedNames.has(imported.installedName)) return "missing_local";

      const remoteUpdatedAt = skill.updatedAt ? Date.parse(skill.updatedAt) : Number.NaN;
      const importedUpdatedAt = imported.updatedAt ? Date.parse(imported.updatedAt) : Number.NaN;
      if (
        Number.isFinite(remoteUpdatedAt) &&
        (!Number.isFinite(importedUpdatedAt) || remoteUpdatedAt > importedUpdatedAt)
      ) {
        return "update";
      }
      return "installed";
    },
    [importedCloudSkills, installedNames],
  );

  const cloudOrgLabel = useMemo(() => {
    denUiTick;
    const name = readDenSettings().activeOrgName?.trim();
    return name || t("skills.cloud_org_fallback");
  }, [denUiTick]);

  const cloudSessionReady = useMemo(() => {
    denUiTick;
    const settings = readDenSettings();
    return Boolean(settings.authToken?.trim() && settings.activeOrgId?.trim());
  }, [denUiTick]);

  const cloudNeedsSignIn = useMemo(() => {
    denUiTick;
    return !readDenSettings().authToken?.trim();
  }, [denUiTick]);

  const sharePermissionOptions = useMemo<SelectMenuOption[]>(
    () => [
      { value: "private", label: t("skills.share_team_permission_private") },
      { value: "org", label: t("skills.share_team_permission_org") },
    ],
    [],
  );

  const shareModalSubtitle = t("skills.share_subtitle_team");

  const activeHubRepoLabel = useMemo(
    () => (hubRepo ? `${hubRepo.owner}/${hubRepo.repo}@${hubRepo.ref}` : t("skills.no_hub_repo_label")),
    [hubRepo],
  );

  const hasDefaultHubRepo = useMemo(
    () => hubRepos.some((repo) => `${repo.owner}/${repo.repo}@${repo.ref}` === "Devin-AXIS/iPolloWork-hub@main"),
    [hubRepos],
  );

  const statusFilterOptions = useMemo<SelectMenuOption[]>(
    () => [
      { value: "all", label: t("skills.filter_status_all") },
      { value: "installed", label: t("skills.filter_installed") },
      { value: "available", label: t("skills.filter_status_available") },
      { value: "update", label: t("skills.filter_status_update") },
    ],
    [],
  );

  const visibleCloudOrgSkills = useMemo(() => {
    if (statusFilter === "all") return filteredCloudOrgSkills;
    return filteredCloudOrgSkills.filter((skill) => {
      const state = cloudSkillInstallState(skill);
      if (statusFilter === "available") return state === "available" || state === "missing_local";
      return state === statusFilter;
    });
  }, [cloudSkillInstallState, filteredCloudOrgSkills, statusFilter]);

  const visibleHubSkills = statusFilter === "all" || statusFilter === "available" ? filteredHubSkills : [];
  const showInstalledSection = activeFilter === "all" && (statusFilter === "all" || statusFilter === "installed");
  const showCloudSection = activeFilter === "all" || activeFilter === "cloud";
  const showHubSection = activeFilter === "all" || activeFilter === "hub";
  const canCreateInChat = !props.busy && (props.canInstallSkillCreator || props.canUseDesktopTools);

  const resolveSharePermission = () => {
    const choice = sharePermissionChoice.trim();
    if (choice === "private") return { shared: null };
    return { shared: "org" as const };
  };

  const closeShareLink = useCallback(() => {
    dispatchLocal({ type: "closeShare" });
  }, []);

  const runDesktopAction = useCallback(
    (action: () => void | Promise<void>) => {
      if (props.busy) return;
      if (!props.canUseDesktopTools) {
        toast.warning(t("skills.desktop_required"));
        return;
      }
      void Promise.resolve(action());
    },
    [props.busy, props.canUseDesktopTools],
  );

  const refreshCatalogs = useCallback(() => {
    if (props.busy) return;
    void extensions.refreshSkills({ force: true });
    void extensions.refreshHubSkills({ force: true });
    void extensions.refreshCloudOrgSkills({ force: true });
  }, [extensions, props.busy]);

  const installSkillCreator = useCallback(async () => {
    if (props.busy || installingSkillCreator) return;
    if (!props.canInstallSkillCreator) {
      toast.warning(props.accessHint ?? t("skills.host_only_error"));
      return;
    }
    setInstallingSkillCreator(true);
    toast.info(t("skills.installing_skill_creator"));
    try {
      const result = await extensions.installSkillCreator();
      toast.success(result.message);
    } catch (error) {
      toast.error(maskError(error));
    } finally {
      setInstallingSkillCreator(false);
    }
  }, [extensions, installingSkillCreator, maskError, props.accessHint, props.busy, props.canInstallSkillCreator]);

  const installFromCloud = useCallback(
    async (skill: DenOrgSkillCard) => {
      if (props.busy || installingCloudSkillId) return;
      const state = cloudSkillInstallState(skill);
      if (state === "installed") return;
      setInstallingCloudSkillId(skill.id);
      toast.info(
        t(state === "update" ? "skills.cloud_updating" : "skills.cloud_installing", undefined, { title: skill.title }),
      );
      try {
        const result = await extensions.installCloudOrgSkill(skill);
        if (result.ok) {
          toast.success(result.message);
        } else {
          toast.error(result.message);
        }
      } catch (error) {
        toast.error(maskError(error));
      } finally {
        setInstallingCloudSkillId(null);
      }
    },
    [cloudSkillInstallState, extensions, installingCloudSkillId, maskError, props.busy],
  );

  const installFromHub = useCallback(
    async (skill: HubSkillCard) => {
      if (props.busy || installingHubSkill) return;
      setInstallingHubSkill(skill.name);
      toast.info(`${t("skills.installing_prefix")} ${skill.name}...`);
      try {
        const result = await extensions.installHubSkill(skill.name);
        toast.success(result.message);
      } catch (error) {
        toast.error(maskError(error));
      } finally {
        setInstallingHubSkill(null);
      }
    },
    [extensions, installingHubSkill, maskError, props.busy],
  );

  const handleNewSkill = useCallback(async () => {
    if (props.busy) return;
    if (props.canInstallSkillCreator && !skillCreatorInstalled) {
      await installSkillCreator();
    }
    await Promise.resolve(props.createSessionAndOpen("/skill-creator"));
  }, [installSkillCreator, props, skillCreatorInstalled]);

  useImperativeHandle(
    ref,
    () => ({
      refresh: refreshCatalogs,
      importLocal: () => runDesktopAction(extensions.importLocalSkill),
      createInChat: () => void handleNewSkill(),
    }),
    [extensions.importLocalSkill, handleNewSkill, refreshCatalogs, runDesktopAction],
  );

  const openCloudSignIn = useCallback(() => {
    const base = readDenSettings().baseUrl?.trim() || DEFAULT_DEN_BASE_URL;
    // Label stays "Sign in"; opens the sign-up tab (returning users can toggle).
    props.onOpenLink(buildDenAuthUrl(base, "sign-up"));
  }, [props]);

  const openShareLink = useCallback(
    (skill: SkillCard) => {
      if (props.busy) return;
      dispatchLocal({ type: "openShare", skill });
    },
    [props.busy],
  );

  const startShareSkillSignIn = useCallback(() => {
    const settings = readDenSettings();
    // Label stays "Sign in"; opens the sign-up tab (returning users can toggle).
    props.onOpenLink(buildDenAuthUrl(settings.baseUrl, "sign-up"));
  }, [props]);

  const publishSkillToTeam = useCallback(async () => {
    if (!shareTarget || props.busy || shareTeamBusy || shareTeamDisabledReason) return;
    setShareTeamBusy(true);
    setShareTeamError(null);
    setShareTeamSuccess(null);
    try {
      const skill = await extensions.readSkill(shareTarget.name);
      if (!skill) throw new Error("Failed to load skill");
      const sharing = resolveSharePermission();
      const { orgName, orgId } = await saveInstalledSkillToiPolloWorkOrg({
        skillText: skill.content,
        shared: sharing.shared,
      });
      setShareTeamSuccess(t("skills.share_team_uploaded_success", undefined, { org: orgName }));
      window.dispatchEvent(
        new CustomEvent<{ orgId: string }>("ipollowork-den-org-skills-changed", {
          detail: { orgId },
        }),
      );
      void extensions.refreshCloudOrgSkills({ force: true });
    } catch (error) {
      setShareTeamError(maskError(error));
    } finally {
      setShareTeamBusy(false);
    }
  }, [extensions, maskError, props.busy, shareTarget, shareTeamBusy, shareTeamDisabledReason]);

  const openSkill = useCallback(
    async (skill: SkillCard) => {
      if (props.busy) return;
      setSelectedSkill(skill);
      setSelectedContent("");
      setSelectedDirty(false);
      setSelectedError(null);
      setSelectedLoading(true);
      try {
        const result = await extensions.readSkill(skill.name);
        if (!result) {
          setSelectedError(t("skills.skill_load_failed"));
          return;
        }
        setSelectedContent(result.content);
      } catch (error) {
        setSelectedError(maskError(error));
      } finally {
        setSelectedLoading(false);
      }
    },
    [extensions, maskError, props.busy],
  );

  const saveSelectedSkill = useCallback(async () => {
    if (!selectedSkill || !selectedDirty) return;
    setSelectedError(null);
    try {
      await Promise.resolve(
        extensions.saveSkill({
          name: selectedSkill.name,
          content: selectedContent,
          description: selectedSkill.description,
        }),
      );
      setSelectedDirty(false);
    } catch (error) {
      setSelectedError(maskError(error));
    }
  }, [extensions, maskError, selectedContent, selectedDirty, selectedSkill]);

  const selectHubRepo = useCallback(
    (repo: HubSkillRepo) => {
      void Promise.resolve(extensions.setHubRepo(repo)).then(() => {
        void extensions.refreshHubSkills({ force: true });
      });
    },
    [extensions],
  );

  const openCustomRepoModal = useCallback(() => {
    if (props.busy) return;
    setCustomRepoOpen(true);
    setCustomRepoOwner(hubRepo?.owner ?? "");
    setCustomRepoName(hubRepo?.repo ?? "");
    setCustomRepoRef(hubRepo?.ref || "main");
    setCustomRepoError(null);
  }, [hubRepo, props.busy]);

  const closeCustomRepoModal = useCallback(() => {
    setCustomRepoOpen(false);
    setCustomRepoError(null);
  }, []);

  const saveCustomRepo = useCallback(() => {
    const owner = customRepoOwner.trim();
    const repo = customRepoName.trim();
    const ref = customRepoRef.trim() || "main";
    if (!owner || !repo) {
      setCustomRepoError(t("skills.owner_repo_required"));
      return;
    }
    void Promise.resolve(extensions.addHubRepo({ owner, repo, ref })).then(() => {
      void extensions.refreshHubSkills({ force: true });
    });
    closeCustomRepoModal();
  }, [closeCustomRepoModal, customRepoName, customRepoOwner, customRepoRef, extensions]);

  const isiPolloWorkInjectedSkill = (skill: SkillCard) => {
    const normalizedName = skill.name.trim().toLowerCase();
    const normalizedPath = skill.path.replace(/\\/g, "/").toLowerCase();
    return normalizedPath.includes("/.opencode/skills/") &&
      (IPOLLOWORK_DEFAULT_SKILL_NAMES.has(normalizedName) || normalizedName.endsWith("-creator"));
  };

  return (
    <section data-testid="settings-standard-page" className={`${settingsStandardContentClass} space-y-8`}>
      <div className="space-y-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            {props.showHeader !== false ? <h2 className={settingsPageTitleClass}>{t("skills.title")}</h2> : null}
            <p className={`${settingsPageDescriptionClass} max-w-[714px]`}>
              {t("skills.worker_profile_desc")}
            </p>
          </div>

          {props.showActions === false ? null : (
            <div className="flex flex-wrap gap-4 lg:justify-end">
              <Button variant="outline" onClick={refreshCatalogs} disabled={props.busy}>
                <RefreshCw size={14} />
                {t("common.refresh")}
              </Button>
              <Button
                variant="outline"
                onClick={() => runDesktopAction(extensions.importLocalSkill)}
                disabled={props.busy || !props.canUseDesktopTools}
              >
                <Download size={14} />
                {t("skills.import_local_skill")}
              </Button>
              <Button onClick={() => void handleNewSkill()} disabled={!canCreateInChat}>
                <Sparkles size={14} />
                {t("skills.create_in_chat")}
              </Button>
            </div>
          )}
        </div>

        <div className="relative min-w-0">
          <Search size={16} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-dls-secondary" />
          <input
            data-testid="skills-library-search"
            type="text"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.currentTarget.value)}
            placeholder={t("skills.catalog_search_placeholder")}
            className="h-[34px] w-full rounded-[8px] border border-transparent bg-[#f5f6f9] pl-[42px] pr-4 text-[13px] text-dls-text shadow-none outline-none transition-colors placeholder:text-[#a2a6af] focus:border-ring focus:ring-3 focus:ring-ring/30 dark:bg-dls-hover dark:placeholder:text-dls-secondary"
          />
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div data-testid="skills-library-source">
            <SettingsSegmentedTabs
              value={activeFilter}
              ariaLabel={t("skills.source_label")}
              items={[
                { value: "all", label: t("skills.filter_all") },
                { value: "cloud", label: t("skills.filter_cloud") },
                { value: "hub", label: t("skills.filter_hub") },
              ]}
              onValueChange={setActiveFilter}
            />
          </div>

          <Select
            value={statusFilter}
            onValueChange={(value) => {
              if (value && isSkillsStatusFilter(value)) setStatusFilter(value);
            }}
          >
            <SelectTrigger
              data-testid="skills-status-filter"
              aria-label={t("skills.filter_status_all")}
              className="w-[132px] shrink-0"
            >
              <SelectValue>{statusFilterOptions.find((option) => option.value === statusFilter)?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end">
              {statusFilterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {props.accessHint ? (
        <div className="rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          {props.accessHint}
        </div>
      ) : null}
      {!props.accessHint && !props.canInstallSkillCreator && !props.canUseDesktopTools ? (
        <div className="rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          {t("skills.host_mode_only")}
        </div>
      ) : null}

      {skillsStatus ? (
        <div className="whitespace-pre-wrap break-words rounded-[20px] border border-dls-border bg-dls-hover px-5 py-4 text-[13px] text-dls-secondary">
          {skillsStatus}
        </div>
      ) : null}

      {showInstalledSection ? (
        <div className="space-y-3">
          <div data-testid="skills-installed-section" className="flex items-end justify-between gap-3 border-b border-dls-border pb-2">
            <div className="space-y-1.5">
              <h3 className={settingsSectionTitleClass}>{t("skills.installed")}</h3>
              <p className={settingsPageDescriptionClass}>{t("skills.installed_desc")}</p>
            </div>
            <span className="text-[13px] text-dls-secondary">{t("skills.shown_count", undefined, { count: filteredSkills.length })}</span>
          </div>

          {filteredSkills.length === 0 ? (
            <div className="rounded-[8px] border border-dashed border-dls-border px-5 py-8 text-[14px] text-dls-secondary">
              {t("skills.no_skills")}
            </div>
          ) : (
            <div data-testid="skills-installed-grid" className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:gap-x-8">
              {filteredSkills.map((skill) => (
                <article key={skill.path} data-testid="skill-library-card" className={`${panelCardClass} flex min-w-0 flex-col gap-4`}>
                  <button
                    type="button"
                    className="flex min-w-0 items-center gap-4 rounded-[8px] text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                    onClick={() => void openSkill(skill)}
                  >
                    <span className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-[8px] bg-[#f6f7fb] text-dls-secondary dark:bg-dls-hover">
                      {skill.name.toLowerCase().includes("figma") ? (
                        <img src="/ext-figma.svg" alt="" className="size-7 object-contain" />
                      ) : (
                        <Package size={19} />
                      )}
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-ui-body font-semibold leading-5 tracking-[0.1px] text-dls-text">{skill.name}</span>
                        {isiPolloWorkInjectedSkill(skill) ? <span className={tagClass}>iPolloWork</span> : null}
                      </span>
                      <span className="line-clamp-1 text-[11px] leading-[15px] text-dls-secondary">
                        {skill.description || t("skills.no_description")}
                      </span>
                    </span>
                  </button>

                  <div className="flex min-w-0 items-center justify-between gap-3">
                    <span className="shrink-0 text-ui-caption text-dls-secondary/60">{t("skills.installed_status")}</span>
                    <div className="flex min-w-0 items-center justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => openShareLink(skill)}
                        disabled={props.busy}
                        title={t("skills.share_option_team_title")}
                      >
                        <Users size={14} />
                        {t("skills.share_option_team_title")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => void openSkill(skill)}
                        disabled={props.busy}
                        title={t("common.edit")}
                      >
                        <Edit2 size={14} />
                        {t("common.edit")}
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {showCloudSection ? (
        <div className="space-y-3">
          <div data-testid="skills-cloud-section" className="flex items-end justify-between gap-3 border-b border-dls-border pb-2">
            <div className="min-w-0 space-y-1.5">
              <h3 className={settingsSectionTitleClass}>{t("skills.cloud_section_title")}</h3>
              <p className={settingsPageDescriptionClass}>{t("skills.cloud_section_subtitle")}</p>
            </div>
            <span className="max-w-[40%] shrink-0 truncate text-[13px] text-dls-secondary">{cloudOrgLabel}</span>
          </div>

          {!cloudSessionReady ? (
            <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-6 text-[14px] text-dls-secondary">
              {cloudNeedsSignIn ? (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <p>{t("skills.cloud_sign_in_hint")}</p>
                  <button type="button" className={pillPrimaryClass} onClick={openCloudSignIn}>
                    {t("skills.cloud_sign_in")}
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <p>{t("skills.cloud_choose_org_hint")}</p>
                  <p className="text-[13px]">{t("skills.cloud_choose_org_detail")}</p>
                </div>
              )}
            </div>
          ) : (
            <>
              {cloudOrgSkillsStatus ? (
                <div
                  data-testid="skills-cloud-error"
                  role="alert"
                  className={modalNoticeErrorClass}
                >
                  {cloudOrgSkillsStatus}
                </div>
              ) : null}

              {visibleCloudOrgSkills.length === 0 ? (
                <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-8 text-[14px] text-dls-secondary">
                  {cloudOrgSkills.length === 0 ? t("skills.cloud_org_empty") : t("skills.cloud_no_search_matches")}
                </div>
              ) : (
                <div className="rounded-[24px] bg-dls-hover p-4">
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {visibleCloudOrgSkills.map((skill) => {
                      const state = cloudSkillInstallState(skill);
                      const installedName = importedCloudSkills[skill.id]?.installedName ?? null;
                      return (
                        <div key={skill.id} className={`${panelCardClass} flex flex-col gap-4 text-left`}>
                          <div className="flex min-w-0 gap-4">
                            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                              <Cloud size={20} className="text-dls-secondary" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <h4 className="truncate text-[14px] font-semibold text-dls-text">{skill.title}</h4>
                              {skill.description ? (
                                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-dls-secondary">{skill.description}</p>
                              ) : null}
                              <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                                {skill.shared === "org" ? <span className={tagClass}>{t("skills.cloud_shared_org")}</span> : null}
                                {skill.shared === "public" ? <span className={tagClass}>{t("skills.cloud_shared_public")}</span> : null}
                                {skill.shared === null ? <span className={tagClass}>{t("skills.cloud_shared_private")}</span> : null}
                                {installedName ? <span className={tagClass}>{t("skills.cloud_installed_as", undefined, { name: installedName })}</span> : null}
                                {state === "installed" ? <span className={tagClass}>{t("skills.cloud_status_installed")}</span> : null}
                                {state === "update" ? <span className={tagClass}>{t("skills.cloud_status_update")}</span> : null}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-3 border-t border-dls-border pt-4">
                            <span className={tagClass}>{t("skills.cloud_footer_label")}</span>
                            <button
                              type="button"
                              className={installingCloudSkillId === skill.id || state === "installed" ? pillSecondaryClass : pillPrimaryClass}
                              onClick={(event) => {
                                event.preventDefault();
                                event.stopPropagation();
                                void installFromCloud(skill);
                              }}
                              disabled={props.busy || installingCloudSkillId === skill.id || state === "installed"}
                            >
                              {installingCloudSkillId === skill.id ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                              {installingCloudSkillId === skill.id
                                ? t("skills.cloud_installing_short")
                                : state === "update"
                                  ? t("skills.cloud_update_skill")
                                  : state === "installed"
                                    ? t("skills.cloud_status_installed")
                                    : t("skills.install")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : null}

      {showHubSection ? (
        <div className="space-y-3">
          <div data-testid="skills-hub-section" className="flex items-end justify-between gap-3 border-b border-dls-border pb-2">
            <div className="min-w-0 space-y-1.5">
              <h3 className={settingsSectionTitleClass}>{t("skills.available_from_hub")}</h3>
              <p className={settingsPageDescriptionClass}>{t("skills.hub_desc")}</p>
            </div>
            <div data-testid="skills-hub-header-actions" className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  void Promise.resolve(extensions.addHubRepo({ owner: "different-ai", repo: "ipollowork-hub", ref: "main" })).then(() => {
                    void extensions.refreshHubSkills({ force: true });
                  });
                }}
                className={pillGhostClass}
                disabled={props.busy || hasDefaultHubRepo}
              >
                <Plus size={14} />
                {t("skills.add_ipollowork_hub")}
              </button>
              <button type="button" onClick={openCustomRepoModal} disabled={props.busy} className={pillSecondaryClass}>
                <Plus size={14} />
                {t("skills.add_git_repo")}
              </button>
            </div>
          </div>

          <div className="space-y-3 rounded-[20px] border border-dls-border bg-dls-surface p-4">
            <div className="text-[12px] text-dls-secondary">
              {t("skills.source_label")}: <span className="font-mono text-dls-text">{activeHubRepoLabel}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {hubRepos.map((repo) => {
                const key = `${repo.owner}/${repo.repo}@${repo.ref}`;
                const active = hubRepo ? key === `${hubRepo.owner}/${hubRepo.repo}@${hubRepo.ref}` : false;
                return (
                  <div key={key} className="inline-flex items-center overflow-hidden rounded-full border border-dls-border bg-dls-surface">
                    <button
                      type="button"
                      onClick={() => selectHubRepo(repo)}
                      className={`px-3 py-1.5 text-[12px] font-medium transition-colors ${
                        active ? "bg-dls-accent text-[var(--dls-accent-fg)]" : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                      }`}
                      disabled={props.busy}
                    >
                      {key}
                    </button>
                    <button
                      type="button"
                      className="px-2 py-1.5 text-[12px] text-dls-secondary transition-colors hover:bg-dls-hover hover:text-red-11"
                      onClick={() => {
                        void Promise.resolve(extensions.removeHubRepo(repo)).then(() => {
                          void extensions.refreshHubSkills({ force: true });
                        });
                      }}
                      disabled={props.busy}
                      title={t("skills.remove_saved_repo")}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {hubSkillsStatus ? (
            <div data-testid="skills-hub-error" role="alert" className={modalNoticeErrorClass}>
              {hubSkillsStatus}
            </div>
          ) : null}

          {visibleHubSkills.length === 0 ? (
            <div className="rounded-[20px] border border-dashed border-dls-border bg-dls-surface px-5 py-8 text-[14px] text-dls-secondary">
              {hubRepo ? t("skills.no_hub_skills") : t("skills.no_hub_repo_selected")}
            </div>
          ) : (
            <div className="rounded-[24px] bg-dls-hover p-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {visibleHubSkills.map((skill) => (
                  <div key={`${skill.source.owner}/${skill.source.repo}/${skill.name}`} className={`${panelCardClass} flex flex-col gap-4 text-left`}>
                    <div className="flex min-w-0 gap-4">
                      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-dls-border bg-dls-hover">
                        <Package size={20} className="text-dls-secondary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h4 className="truncate text-[14px] font-semibold text-dls-text">{skill.name}</h4>
                        <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-dls-secondary">
                          {skill.description || t("skills.from_repo", undefined, { owner: skill.source.owner, repo: skill.source.repo })}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-dls-secondary">
                          <span className={`${tagClass} font-mono`}>{skill.source.owner}/{skill.source.repo}</span>
                          {skill.trigger ? (
                            <span className={tagClass} title={t("skills.trigger_label", undefined, { trigger: skill.trigger })}>
                              {t("skills.trigger_label", undefined, { trigger: skill.trigger })}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-dls-border pt-4">
                      <span className={tagClass}>{t("skills.hub_label")}</span>
                      <button
                        type="button"
                        className={installingHubSkill === skill.name ? pillSecondaryClass : pillPrimaryClass}
                        onClick={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          void installFromHub(skill);
                        }}
                        disabled={props.busy || installingHubSkill === skill.name}
                        title={t("skills.install_name_title", undefined, { name: skill.name })}
                      >
                        {installingHubSkill === skill.name ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                        {installingHubSkill === skill.name ? t("skills.installing") : t("common.add")}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}

      <Dialog
        open={Boolean(selectedSkill)}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedSkill(null);
            setSelectedContent("");
            setSelectedDirty(false);
            setSelectedError(null);
            setSelectedLoading(false);
          }
        }}
      >
        <DialogContent className="flex max-h-[min(650px,calc(100dvh-160px))] min-h-0 w-full max-w-4xl flex-col overflow-hidden sm:max-w-4xl">
            <DialogHeader>
              <DialogTitle className="truncate pr-10">{selectedSkill?.name}</DialogTitle>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto">
              {selectedError ? <div role="alert" className={`mb-3 ${modalNoticeErrorClass}`}>{selectedError}</div> : null}
              {selectedLoading ? (
                <div className="text-xs text-dls-secondary">{t("skills.loading")}</div>
              ) : (
                <textarea
                  value={selectedContent}
                  onChange={(event) => {
                    setSelectedContent(event.currentTarget.value);
                    setSelectedDirty(true);
                  }}
                  className="min-h-[420px] w-full rounded-xl border border-dls-border bg-dls-hover px-4 py-3 text-xs font-mono text-dls-text focus:outline-none focus:ring-2 focus:ring-[rgba(var(--dls-accent-rgb),0.25)]"
                  spellCheck={false}
                />
              )}
            </div>

            <DialogFooter
              data-testid="skill-editor-actions"
              className="flex-row items-center justify-between sm:justify-between"
            >
              <Button
                data-testid="skill-editor-uninstall"
                type="button"
                variant="destructive"
                disabled={props.busy || !props.canUseDesktopTools}
                onClick={() => {
                  const target = selectedSkill;
                  if (!target) return;
                  setUninstallTarget(target);
                  setSelectedSkill(null);
                  setSelectedContent("");
                  setSelectedDirty(false);
                  setSelectedError(null);
                  setSelectedLoading(false);
                }}
              >
                <Trash2 size={14} />
                {t("skills.uninstall")}
              </Button>
              <Button
                data-testid="skill-editor-save"
                type="button"
                disabled={!selectedDirty || props.busy}
                onClick={() => void saveSelectedSkill()}
              >
                {t("common.save")}
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(uninstallTarget)}
        title={t("skills.uninstall_title")}
        message={t("skills.uninstall_warning").replace("{name}", uninstallTarget?.name ?? "")}
        confirmLabel={t("skills.uninstall")}
        cancelLabel={t("common.cancel")}
        confirmButtonVariant="destructive"
        onCancel={() => setUninstallTarget(null)}
        onConfirm={() => {
          const target = uninstallTarget;
          setUninstallTarget(null);
          if (!target) return;
          void extensions.uninstallSkill(target.name);
        }}
      />

      <Dialog
        open={Boolean(shareTarget)}
        onOpenChange={(open) => {
          if (!open) closeShareLink();
        }}
      >
        <DialogContent className="flex max-h-[min(650px,calc(100dvh-160px))] min-h-0 w-full max-w-md flex-col overflow-hidden sm:max-w-md">
          <DialogHeader>
            <div className="min-w-0 flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <DialogTitle>{t("skills.share_title")}</DialogTitle>
                <span className={tagClass}>{shareTarget?.name}</span>
              </div>
              <DialogDescription>{shareModalSubtitle}</DialogDescription>
            </div>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-5 pt-2">
              <p className="text-[14px] leading-relaxed text-dls-secondary">{t("skills.share_team_permissions_intro")}</p>
              <div className={surfaceCardClass}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={tagClass}>{shareTeamOrgLabel}</span>
                </div>
                {shareTeamError?.trim() ? <div role="alert" className={`mt-4 ${modalNoticeErrorClass}`}>{shareTeamError}</div> : null}
                {shareTeamSuccess?.trim() ? <div className={`mt-4 ${modalNoticeSuccessClass}`}>{shareTeamSuccess}</div> : null}
                {shareCloudSignedIn && shareTeamDisabledReason?.trim() ? (
                  <div className="mt-4 text-[12px] text-dls-secondary">{shareTeamDisabledReason}</div>
                ) : null}
                {shareCloudSignedIn ? (
                  <div className="mt-4">
                    <span id="skills-share-hub-label" className="mb-1.5 block text-[13px] font-medium text-dls-text">
                      {t("skills.share_team_permissions_label")}
                    </span>
                    <SelectMenu
                      ariaLabelledBy="skills-share-hub-label"
                      options={sharePermissionOptions}
                      value={sharePermissionChoice}
                      onChange={setSharePermissionChoice}
                      disabled={shareTeamBusy || Boolean(shareTeamSuccess?.trim())}
                    />
                  </div>
                ) : null}
                <button
                  type="button"
                  onClick={() => {
                    if (!shareCloudSignedIn) {
                      startShareSkillSignIn();
                      return;
                    }
                    void publishSkillToTeam();
                  }}
                  disabled={shareCloudSignedIn ? Boolean(shareTeamDisabledReason) || shareTeamBusy || Boolean(shareTeamSuccess?.trim()) : false}
                  className={`${pillPrimaryClass} mt-4 w-full`}
                >
                  {!shareCloudSignedIn
                    ? t("skills.share_team_sign_in")
                    : shareTeamBusy
                      ? t("skills.share_team_uploading")
                      : t("skills.share_team_upload_and_save")}
                </button>
                {!shareCloudSignedIn ? <p className="mt-3 text-[12px] text-dls-secondary">{t("skills.share_team_sign_in_hint")}</p> : null}
              </div>
            </div>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              {t("skills.share_done")}
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={customRepoOpen}
        onOpenChange={(open) => {
          if (!open) closeCustomRepoModal();
        }}
      >
        <DialogContent className="w-full max-w-lg overflow-hidden sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>{t("skills.add_custom_repo")}</DialogTitle>
              <DialogDescription>{t("skills.github_repo_hint")}</DialogDescription>
            </DialogHeader>

            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-widest text-dls-secondary">{t("skills.owner_label")}</div>
                  <input
                    type="text"
                    value={customRepoOwner}
                    onChange={(event) => setCustomRepoOwner(event.currentTarget.value)}
                    placeholder="different-ai"
                    className="w-full rounded-lg border border-dls-border bg-dls-hover px-3 py-2 text-xs font-mono text-dls-text focus:outline-none"
                    spellCheck={false}
                  />
                </label>
                <label className="space-y-1">
                  <div className="text-xs font-semibold uppercase tracking-widest text-dls-secondary">{t("skills.repo_label")}</div>
                  <input
                    type="text"
                    value={customRepoName}
                    onChange={(event) => setCustomRepoName(event.currentTarget.value)}
                    placeholder="ipollowork-hub"
                    className="w-full rounded-lg border border-dls-border bg-dls-hover px-3 py-2 text-xs font-mono text-dls-text focus:outline-none"
                    spellCheck={false}
                  />
                </label>
              </div>

              <label className="space-y-1">
                <div className="text-xs font-semibold uppercase tracking-widest text-dls-secondary">{t("skills.ref_label")}</div>
                <input
                  type="text"
                  value={customRepoRef}
                  onChange={(event) => setCustomRepoRef(event.currentTarget.value)}
                  placeholder="main"
                  className="w-full rounded-lg border border-dls-border bg-dls-hover px-3 py-2 text-xs font-mono text-dls-text focus:outline-none"
                  spellCheck={false}
                />
              </label>

              {customRepoError ? <div role="alert" className={modalNoticeErrorClass}>{customRepoError}</div> : null}
            </div>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                {t("common.cancel")}
              </DialogClose>
              <Button variant="secondary" onClick={saveCustomRepo} disabled={props.busy}>
                {t("skills.save_and_load")}
              </Button>
            </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
});

export default SkillsView;
