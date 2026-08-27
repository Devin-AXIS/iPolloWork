/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { AppWindowMac, ArrowUp, Bot, Check, ChevronDown, ChevronRight, Code2, FileText, ListTodo, Paperclip, Plus, Plug, Settings, Shield, ShieldAlert, ShieldCheck, ShieldQuestion, Sparkles, Square, Terminal, Wrench, X, Zap } from "lucide-react";
import fuzzysort from "fuzzysort";
import { toast } from "@/components/ui/sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { iPolloWorkPluginPackageItem } from "@/app/lib/ipollowork-server";
import { activePluginEngineCompatibility } from "@/app/lib/plugin-package-readiness";
import type { ComposerAttachment, McpServerEntry, McpStatusMap, ModelRef, SkillCard, SlashCommandOption } from "@/app/types";
import {
  formatContextTokenCount,
  resolveConversationContextHealth,
  type ConversationAccessMode,
  type ConversationAccessModeIcon,
  type ConversationAgent,
  type ConversationContextUsage,
  type ConversationMode,
  type ConversationModeIcon,
} from "../../engine/conversation-engine";
import { formatBytes } from "@/app/utils";
import { t } from "@/i18n";
import { resolveExtensionIconUrl } from "@/react-app/design-system/extension-icon-src";
import { LexicalPromptEditor, type LexicalPromptEditorHandle } from "./editor";
import { ModelBehaviorMenu } from "@/components/model-behavior-menu";
import { TemplateIcon } from "@/components/template-icon";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { listRunningAppsForMention } from "./app-mentions";
import type { ComposerMentionKind } from "./mention-encoding";
import { getSlashCommandQuery } from "./slash-command";

type MentionItem = {
  id: string;
  kind: ComposerMentionKind;
  value: string;
  label: string;
};

type PastedTextChip = {
  id: string;
  label: string;
  text: string;
  lines: number;
};

type ToolMenuSettingsSection = "commands" | "skills" | "mcps" | "plugins";
type ToolMenuSection = "commands" | "skills" | "mcps" | "extensions";
type PlusMenuSection = "tools" | "delegation";

export type ComposerProps = {
  draft: string;
  mentions: Record<string, ComposerMentionKind>;
  onDraftChange: (value: string) => void;
  onSend: () => void | Promise<void>;
  onQueue: () => void | Promise<void>;
  onStop: () => void | Promise<void>;
  busy: boolean;
  queuedCount: number;
  disabled: boolean;
  inputDisabled?: boolean;
  modelUnavailable?: boolean;
  statusLabel: string;
  modelPickerOpen: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  onConfigureModels?: (providerId?: string) => void;
  onConfigureTokenStar?: () => void;
  attachments: ComposerAttachment[];
  hasPromptContext?: boolean;
  onAttachFiles: (files: File[]) => void;
  onRemoveAttachment: (id: string) => void;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  selectedMode: string | null;
  modeSelectionDisabled?: boolean;
  listModes: () => Promise<ConversationMode[]>;
  onSelectMode: (mode: string | null) => void;
  selectedAccessMode?: string | null;
  accessModeSelectionDisabled?: boolean;
  listAccessModes?: () => Promise<ConversationAccessMode[]>;
  onSelectAccessMode?: (mode: string) => void | Promise<void>;
  listAgents: () => Promise<ConversationAgent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<SlashCommandOption[]>;
  listSkills?: () => Promise<SkillCard[]>;
  skills?: SkillCard[];
  listMcp?: () => Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }>;
  mcpServers?: McpServerEntry[];
  mcpStatus?: string | null;
  mcpStatuses?: McpStatusMap;
  listInstalledExtensions?: () => Promise<iPolloWorkPluginPackageItem[]>;
  /** Compatibility alias used by the project-first starter while plugin packages migrate to extensions. */
  listImportedPlugins?: () => Promise<iPolloWorkPluginPackageItem[]>;
  importedPlugins?: iPolloWorkPluginPackageItem[];
  onOpenWorkspaceApp?: (pluginId: string) => void;
  listExternalAgents: () => Promise<iPolloWorkPluginPackageItem[]>;
  onOpenSettingsSection?: (section: ToolMenuSettingsSection) => void;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  onInsertMention: (kind: ComposerMentionKind, value: string) => void;
  /** Sent-prompt history (oldest first) recalled with ArrowUp/ArrowDown (#2012). */
  inputHistory?: string[];
  onPasteText: (text: string) => void;
  onUnsupportedFileLinks: (links: string[]) => void;
  pastedText: PastedTextChip[];
  onExpandPastedText: (id: string) => void;
  onRemovePastedText: (id: string) => void;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  onUploadInboxFiles?: ((files: File[]) => void | Promise<unknown>) | null;
  onOpenTemplateMarket?: () => void;
  maxAttachmentBytes?: number;
  draftScopeKey?: string;
  placeholder?: string;
  layout?: "dock" | "inline";
  inlineAppearance?: "default" | "engine-selected";
  compactTopSpacing?: boolean;
  topAccessory?: ReactNode;
  contextUsage?: ConversationContextUsage | null;
  modelContextWindow?: number | null;
};

const FLUSH_PROMPT_EVENT = "ipollowork:flushPromptDraft";
const FOCUS_PROMPT_EVENT = "ipollowork:focusPrompt";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const IMAGE_COMPRESS_MAX_PX = 2048;
const IMAGE_COMPRESS_QUALITY = 0.82;
const IMAGE_COMPRESS_TARGET_BYTES = 1_500_000;
const FILE_URL_RE = /^file:\/\//i;
const HTTP_URL_RE = /^https?:\/\//i;

function ContextProgress({ percentage }: { percentage: number | null }) {
  const progress = Math.min(100, Math.max(0, percentage ?? 0));

  return (
    <svg viewBox="0 0 16 16" className="size-4 shrink-0" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" className="stroke-gray-5" strokeWidth="1.75" />
      <circle
        cx="8"
        cy="8"
        r="6.25"
        fill="none"
        stroke="#1FBAC0"
        strokeWidth="1.75"
        strokeLinecap="round"
        pathLength={100}
        strokeDasharray="100"
        strokeDashoffset={100 - progress}
        transform="rotate(-90 8 8)"
        className="transition-[stroke-dashoffset] duration-300 motion-reduce:transition-none"
      />
    </svg>
  );
}

function ContextHealth({
  usage,
  modelContextWindow,
}: {
  usage?: ConversationContextUsage | null;
  modelContextWindow?: number | null;
}) {
  const health = resolveConversationContextHealth(usage, modelContextWindow);
  const usedLabel = formatContextTokenCount(health.usedTokens);
  const limitLabel = health.contextWindow ? formatContextTokenCount(health.contextWindow) : t("composer.context_limit_unknown");
  const percentageLabel = health.percentage === null ? "—" : `${health.percentage}%`;
  const summary = `${usedLabel} / ${limitLabel}${health.percentage === null ? "" : ` · ${percentageLabel}`}`;

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        data-testid="composer-context-health"
        aria-label={`${t("composer.context_health")}: ${summary}`}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-transparent px-2.5 text-[12px] font-medium leading-[18px] transition-colors hover:bg-gray-3 hover:text-gray-12 data-[state=open]:bg-gray-3 data-[state=open]:text-gray-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-7 @max-[560px]/composer:w-8 @max-[560px]/composer:justify-center @max-[560px]/composer:px-0 ${health.compressionWarning ? "text-amber-11" : "text-gray-10"}`}
      >
        <ContextProgress percentage={health.percentage} />
        <span className="whitespace-nowrap tabular-nums @max-[560px]/composer:hidden">{percentageLabel}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" sideOffset={8} className="w-72 gap-0 rounded-2xl p-4">
        <div className="flex items-center justify-between gap-4">
          <span className="text-sm font-medium text-gray-11">{t("composer.context_health")}</span>
          <span className={`text-sm font-semibold tabular-nums ${health.compressionWarning ? "text-amber-11" : "text-gray-12"}`}>
            {percentageLabel}
          </span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-3" aria-hidden="true">
          <div
            className="h-full rounded-full bg-[#1FBAC0] transition-[width]"
            style={{ width: `${Math.min(100, health.percentage ?? 0)}%` }}
          />
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-10">{t("composer.context_usage_label")}</dt>
            <dd className="font-medium tabular-nums text-gray-12">{usedLabel}</dd>
          </div>
          <div className="flex items-center justify-between gap-4">
            <dt className="text-gray-10">{t("composer.context_model_limit")}</dt>
            <dd className="font-medium tabular-nums text-gray-12">{limitLabel}</dd>
          </div>
        </dl>
        {health.compressionWarning ? (
          <div className="mt-4 rounded-xl bg-amber-3 px-3 py-2 text-xs leading-5 text-amber-11">
            {t("composer.context_compression_warning")}
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function WorkModeIcon({ icon, className }: { icon: ConversationModeIcon; className?: string }) {
  if (icon === "plan") return <ListTodo className={className} />;
  if (icon === "code") return <Code2 className={className} />;
  if (icon === "minimal") return <Terminal className={className} />;
  if (icon === "create") return <Sparkles className={className} />;
  return <Zap className={className} />;
}

function AccessModeIcon({ icon, className }: { icon: ConversationAccessModeIcon; className?: string }) {
  if (icon === "read-only") return <Shield className={className} />;
  if (icon === "full-access") return <ShieldAlert className={className} />;
  if (icon === "ask") return <ShieldQuestion className={className} />;
  return <ShieldCheck className={className} />;
}

/**
 * Extract external file/URL drops from a clipboard. Only used when the user
 * drag-drops a file reference from another app (Finder / browser), which sets
 * the text/uri-list MIME type explicitly. Plain text pastes — even ones that
 * contain absolute paths like "/Users/..." — are NEVER treated as links here
 * because that intercepted real text pastes and made composer paste feel
 * broken. Plain text goes straight into the editor via Lexical's default.
 */
function parseClipboardUriList(clipboard: DataTransfer) {
  const raw = clipboard.getData("text/uri-list") ?? "";
  if (!raw.trim()) return [];
  const links: string[] = [];
  const seen = new Set<string>();
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (!FILE_URL_RE.test(trimmed) && !HTTP_URL_RE.test(trimmed)) continue;
    const normalized = encodeURI(trimmed);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push(normalized);
  }
  return links;
}

function isImageAttachment(attachment: ComposerAttachment) {
  return attachment.kind === "image" || attachment.mimeType.startsWith("image/");
}

async function compressImageFile(file: File): Promise<File> {
  if (file.type === "image/gif" || file.size <= IMAGE_COMPRESS_TARGET_BYTES) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  const maxDim = Math.max(width, height);
  const scale = maxDim > IMAGE_COMPRESS_MAX_PX ? IMAGE_COMPRESS_MAX_PX / maxDim : 1;
  const targetW = Math.round(width * scale);
  const targetH = Math.round(height * scale);

  let blob: Blob | null = null;

  if (typeof OffscreenCanvas !== "undefined") {
    const offscreen = new OffscreenCanvas(targetW, targetH);
    const ctx = offscreen.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await offscreen.convertToBlob({
        type: "image/jpeg",
        quality: IMAGE_COMPRESS_QUALITY,
      });
    }
  }

  if (!blob) {
    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.drawImage(bitmap, 0, 0, targetW, targetH);
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", IMAGE_COMPRESS_QUALITY),
      );
    }
  }

  bitmap.close();

  if (!blob || blob.size >= file.size) {
    return file;
  }

  const stem = file.name.replace(/\.[^.]+$/, "") || "image";
  return new File([blob], `${stem}.jpg`, { type: "image/jpeg" });
}

function formatMcpStatusLabel(status: McpServerStatus | undefined) {
  switch (status) {
    case "connected":
      return t("mcp.friendly_status_ready");
    case "needs_auth":
    case "needs_client_registration":
      return t("mcp.friendly_status_needs_signin");
    case "disabled":
      return t("mcp.friendly_status_paused");
    case "disconnected":
      return t("mcp.friendly_status_offline");
    case "failed":
    default:
      return t("mcp.friendly_status_issue");
  }
}

type McpServerStatus = "connected" | "needs_auth" | "needs_client_registration" | "failed" | "disabled" | "disconnected";

function toReactMcpStatus(name: string, entry: McpServerEntry, statuses: McpStatusMap): McpServerStatus {
  const configured = statuses[name];
  if (configured?.status === "connected") return "connected";
  if (configured?.status === "needs_auth") return "needs_auth";
  if (configured?.status === "needs_client_registration") return "needs_client_registration";
  if (configured?.status === "failed") return "failed";
  if (configured?.status === "disabled" || entry.config.enabled === false || entry.config.enabled === undefined && entry.config.type === "local" && entry.config.command?.length === 0) {
    return entry.config.enabled === false ? "disabled" : configured?.status === "disabled" ? "disabled" : "disconnected";
  }
  return "disconnected";
}

function mcpStatusBadgeClass(status: McpServerStatus) {
  switch (status) {
    case "connected":
      return "bg-green-3 text-green-11";
    case "needs_auth":
    case "needs_client_registration":
      return "bg-amber-3 text-amber-11";
    case "disabled":
    case "disconnected":
      return "bg-gray-3 text-gray-11";
    default:
      return "bg-red-3 text-red-11";
  }
}

function extensionIcon(entry: iPolloWorkPluginPackageItem, size = 16) {
  const iconUrl = resolveExtensionIconUrl({
    iconSrc: entry.manifest.icon?.src,
    iconSlug: entry.manifest.icon?.simpleIconSlug,
  });
  if (iconUrl) {
    return <img src={iconUrl} alt="" width={size} height={size} loading="lazy" style={{ display: "block" }} />;
  }
  return <Plug size={size} className="text-gray-9" />;
}

export function ReactSessionComposer(props: ComposerProps) {
  let fileInput: HTMLInputElement | undefined;
  const [externalAgents, setExternalAgents] = useState<iPolloWorkPluginPackageItem[]>([]);
  const [externalAgentsLoading, setExternalAgentsLoading] = useState(false);
  const [delegationMenuOpen, setDelegationMenuOpen] = useState(false);
  const [commands, setCommands] = useState<SlashCommandOption[]>([]);
  const [commandsLoading, setCommandsLoading] = useState(false);
  const [skillsLoading, setSkillsLoading] = useState(false);
  const [skills, setSkills] = useState<SkillCard[]>(props.skills ?? []);
  const [mcpLoading, setMcpLoading] = useState(false);
  const [mcpServers, setMcpServers] = useState<McpServerEntry[]>(props.mcpServers ?? []);
  const [mcpStatus, setMcpStatus] = useState<string | null>(props.mcpStatus ?? null);
  const [mcpStatuses, setMcpStatuses] = useState<McpStatusMap>(props.mcpStatuses ?? {});
  const [installedExtensions, setInstalledExtensions] = useState<iPolloWorkPluginPackageItem[]>(props.importedPlugins ?? []);
  const [extensionsLoading, setExtensionsLoading] = useState(false);
  const [slashOpen, setSlashOpen] = useState(false);
  const [plusMenuOpen, setPlusMenuOpen] = useState(false);
  const [plusMenuSection, setPlusMenuSection] = useState<PlusMenuSection | null>(null);
  const [toolMenuOpen, setToolMenuOpen] = useState(false);
  const [workModeOpen, setWorkModeOpen] = useState(false);
  const [accessModeOpen, setAccessModeOpen] = useState(false);
  const [accessModeBusy, setAccessModeBusy] = useState(false);
  const [pendingDangerousAccessMode, setPendingDangerousAccessMode] = useState<ConversationAccessMode | null>(null);
  const engineSelectedAppearance = props.layout === "inline" && props.inlineAppearance === "engine-selected";
  const canSend = props.draft.trim().length > 0 || props.attachments.length > 0 || props.hasPromptContext;
  const editorDisabled = props.inputDisabled ?? props.disabled;
  const maxAttachmentBytes = props.maxAttachmentBytes ?? MAX_ATTACHMENT_BYTES;
  const [workModes, setWorkModes] = useState<ConversationMode[]>([]);
  const [accessModes, setAccessModes] = useState<ConversationAccessMode[]>([]);
  const [toolMenuSection, setToolMenuSection] = useState<ToolMenuSection>("commands");
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const menuItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const commandsCacheRef = useRef<SlashCommandOption[] | null>(null);
  const commandsRequestRef = useRef<Promise<SlashCommandOption[]> | null>(null);
  const commandsLoadVersionRef = useRef(0);
  const listCommandsRef = useRef(props.listCommands);
  const listSkillsRef = useRef(props.listSkills);
  const listMcpRef = useRef(props.listMcp);
  const listInstalledExtensionsRef = useRef(props.listInstalledExtensions ?? props.listImportedPlugins);
  const listExternalAgentsRef = useRef(props.listExternalAgents);
  const toolMenuLoadRef = useRef({
    openId: 0,
    commands: false,
    skills: false,
    mcps: false,
    extensions: false,
  });
  const [commandsLoaded, setCommandsLoaded] = useState(false);
  const [skillsLoaded, setSkillsLoaded] = useState(Boolean(props.skills));
  const [mcpLoaded, setMcpLoaded] = useState(Boolean(props.mcpServers));
  const [extensionsLoaded, setExtensionsLoaded] = useState(false);
  const [delegationMenuIndex, setDelegationMenuIndex] = useState(0);
  const delegationItemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [dropzoneActive, setDropzoneActive] = useState(false);
  const plusMenuRef = useRef<HTMLDivElement | null>(null);
  const toolMenuRef = useRef<HTMLDivElement | null>(null);
  const editorRef = useRef<LexicalPromptEditorHandle | null>(null);
  const delegationMenuRef = useRef<HTMLDivElement | null>(null);
  // IME composition guard: while an IME composition is active, we must not
  // treat Enter as a submit. Three signals keep this reliable across WebKit,
  // Chrome, and Safari: event.isComposing, event.keyCode === 229, and the
  // compositionstart/compositionend events below.
  const imeComposingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef(props.draft);
  useEffect(() => {
    draftRef.current = props.draft;
  }, [props.draft]);

  // Follow-up message UX (only relevant while the agent is busy):
  // - Enter queues the message to send once the agent finishes.
  // - Cmd/Ctrl+Enter sends immediately (the agent adjusts mid-task).
  // - Escape arms a "Hit Escape again to stop the agent" prompt for 3s;
  //   a second Escape within that window stops the agent.
  const [escapeArmed, setEscapeArmed] = useState(false);
  const escapeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [emptySubmitHintOpen, setEmptySubmitHintOpen] = useState(false);
  const emptySubmitHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionPointerSubmittedRef = useRef(false);

  const showEmptySubmitHint = useCallback(() => {
    if (emptySubmitHintTimerRef.current) clearTimeout(emptySubmitHintTimerRef.current);
    setEmptySubmitHintOpen(true);
    emptySubmitHintTimerRef.current = setTimeout(() => {
      emptySubmitHintTimerRef.current = null;
      setEmptySubmitHintOpen(false);
    }, 2_500);
  }, []);

  const disarmEscape = useCallback(() => {
    if (escapeTimerRef.current) {
      clearTimeout(escapeTimerRef.current);
      escapeTimerRef.current = null;
    }
    setEscapeArmed(false);
  }, []);

  // Reset the escape-to-stop prompt whenever the agent stops being busy.
  useEffect(() => {
    if (!props.busy) disarmEscape();
  }, [props.busy, disarmEscape]);

  // Input history recall (#2012): ArrowUp on an empty composer recalls the
  // previous sent prompt; repeated ArrowUp/ArrowDown walk the history.
  // Editing the recalled text exits recall mode, and ArrowDown past the
  // newest entry restores whatever was typed before recall started.
  const historyPosRef = useRef<number | null>(null);
  const historyExpectedRef = useRef<string | null>(null);
  const historyStashRef = useRef("");

  useEffect(() => {
    if (historyPosRef.current === null) return;
    if (props.draft !== historyExpectedRef.current) {
      historyPosRef.current = null;
      historyExpectedRef.current = null;
    }
  }, [props.draft]);

  useEffect(() => {
    if (canSend) setEmptySubmitHintOpen(false);
  }, [canSend]);

  useEffect(() => () => {
    if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
    if (emptySubmitHintTimerRef.current) clearTimeout(emptySubmitHintTimerRef.current);
  }, []);

  // Editor submit (Enter). While idle this sends normally; while busy every
  // submit is queued. Only the explicit Stop control may interrupt a run.
  const handleEditorSubmit = useCallback(() => {
    if (!canSend) {
      showEmptySubmitHint();
      return;
    }
    if (props.busy) {
      void props.onQueue();
      return;
    }
    void props.onSend();
  }, [canSend, props.busy, props.onSend, props.onQueue, showEmptySubmitHint]);

  const runComposerAction = useCallback(() => {
    void handleEditorSubmit();
  }, [handleEditorSubmit]);

  const handleActionPointerDown: React.PointerEventHandler<HTMLButtonElement> = (event) => {
    if (event.button !== 0 || props.disabled) return;
    event.preventDefault();
    actionPointerSubmittedRef.current = true;
    runComposerAction();
  };

  const handleActionClick = () => {
    if (actionPointerSubmittedRef.current) {
      actionPointerSubmittedRef.current = false;
      return;
    }
    runComposerAction();
  };

  const slashCommandQuery = getSlashCommandQuery(props.draft);
  const slashOpenNext = slashCommandQuery !== null;
  const slashQuery = slashCommandQuery ?? "";
  const mentionMatch = props.draft.match(/@([^\s@]*)$/);
  const mentionOpenNext = Boolean(mentionMatch);
  const mentionQuery = mentionMatch?.[1] ?? "";

  useEffect(() => {
    setSlashOpen(slashOpenNext);
    setMenuIndex(0);
  }, [slashOpenNext, slashQuery]);

  useEffect(() => {
    setMentionOpen(mentionOpenNext);
    setMenuIndex(0);
  }, [mentionOpenNext, mentionQuery]);

  useEffect(() => {
    setSkills(props.skills ?? []);
  }, [props.skills]);

  useEffect(() => {
    setMcpServers(props.mcpServers ?? []);
    setMcpStatus(props.mcpStatus ?? null);
    setMcpStatuses(props.mcpStatuses ?? {});
  }, [props.mcpServers, props.mcpStatus, props.mcpStatuses]);

  useEffect(() => {
    listCommandsRef.current = props.listCommands;
  }, [props.listCommands]);

  useEffect(() => {
    listSkillsRef.current = props.listSkills;
  }, [props.listSkills]);

  useEffect(() => {
    listMcpRef.current = props.listMcp;
  }, [props.listMcp]);

  useEffect(() => {
    let cancelled = false;
    void props.listModes()
      .then((modes) => {
        if (!cancelled) setWorkModes(modes);
      })
      .catch(() => {
        if (!cancelled) setWorkModes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.listModes]);

  useEffect(() => {
    let cancelled = false;
    if (!props.listAccessModes) {
      setAccessModes([]);
      return () => {
        cancelled = true;
      };
    }
    void props.listAccessModes()
      .then((modes) => {
        if (!cancelled) setAccessModes(modes);
      })
      .catch(() => {
        if (!cancelled) setAccessModes([]);
      });
    return () => {
      cancelled = true;
    };
  }, [props.listAccessModes]);

  useEffect(() => {
    if (props.busy || props.modeSelectionDisabled) setWorkModeOpen(false);
  }, [props.busy, props.modeSelectionDisabled]);

  useEffect(() => {
    if (props.busy || props.accessModeSelectionDisabled) setAccessModeOpen(false);
  }, [props.accessModeSelectionDisabled, props.busy]);

  useEffect(() => {
    listInstalledExtensionsRef.current = props.listInstalledExtensions ?? props.listImportedPlugins;
  }, [props.listInstalledExtensions, props.listImportedPlugins]);

  useEffect(() => {
    listExternalAgentsRef.current = props.listExternalAgents;
  }, [props.listExternalAgents]);

  useEffect(() => {
    if (!delegationMenuOpen) return;
    let cancelled = false;
    setExternalAgentsLoading(true);
    void listExternalAgentsRef.current()
      .then((next) => {
        if (!cancelled) setExternalAgents(next);
      })
      .catch(() => {
        if (!cancelled) setExternalAgents([]);
      })
      .finally(() => {
        if (!cancelled) setExternalAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [delegationMenuOpen]);

  useEffect(() => {
    setDelegationMenuIndex(0);
  }, [delegationMenuOpen]);

  useEffect(() => {
    const target = delegationItemRefs.current[delegationMenuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [delegationMenuIndex, delegationMenuOpen]);

  useEffect(() => {
    commandsLoadVersionRef.current += 1;
    commandsCacheRef.current = null;
    commandsRequestRef.current = null;
  }, [props.listCommands]);

  const loadCommands = useCallback(() => {
    if (commandsCacheRef.current !== null) {
      return Promise.resolve(commandsCacheRef.current);
    }
    if (commandsRequestRef.current) {
      return commandsRequestRef.current;
    }
    const version = commandsLoadVersionRef.current;
    const request = listCommandsRef.current().then((next) => {
      if (commandsLoadVersionRef.current === version) {
        commandsCacheRef.current = next;
      }
      return next;
    }).finally(() => {
      if (commandsLoadVersionRef.current === version) {
        commandsRequestRef.current = null;
      }
    });
    commandsRequestRef.current = request;
    return request;
  }, []);

  useEffect(() => {
    if (!plusMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        plusMenuRef.current?.contains(target)
        || toolMenuRef.current?.contains(target)
        || delegationMenuRef.current?.contains(target)
      ) return;
      setPlusMenuOpen(false);
      setPlusMenuSection(null);
      setToolMenuOpen(false);
      setDelegationMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => window.removeEventListener("mousedown", handlePointerDown);
  }, [plusMenuOpen]);

  useEffect(() => {
    if (!plusMenuOpen) return;
    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        plusMenuRef.current?.contains(target)
        || toolMenuRef.current?.contains(target)
        || delegationMenuRef.current?.contains(target)
      ) return;
      setPlusMenuSection(null);
      setToolMenuOpen(false);
      setDelegationMenuOpen(false);
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, [plusMenuOpen]);

  useEffect(() => {
    if (!plusMenuOpen) return;
    setToolMenuOpen(plusMenuSection === "tools");
    setDelegationMenuOpen(plusMenuSection === "delegation");
  }, [plusMenuOpen, plusMenuSection]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    toolMenuLoadRef.current = {
      openId: toolMenuLoadRef.current.openId + 1,
      commands: false,
      skills: false,
      mcps: false,
      extensions: false,
    };
    setCommandsLoaded(false);
    setSkillsLoaded(Boolean(props.skills));
    setMcpLoaded(Boolean(props.mcpServers));
    setExtensionsLoaded(Boolean(props.importedPlugins));
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!slashOpen && !toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    if (toolMenuOpen && toolMenuLoadRef.current.commands) return;
    if (toolMenuOpen) toolMenuLoadRef.current.commands = true;
    let cancelled = false;
    const cached = commandsCacheRef.current;
    if (cached !== null) {
      setCommands(cached);
      setCommandsLoading(false);
      if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
      return () => {
        cancelled = true;
      };
    }
    setCommandsLoading(true);
    void loadCommands()
      .then((next) => {
        if (!cancelled) {
          setCommands(next);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommands([]);
          if (toolMenuOpen && toolMenuLoadRef.current.openId === openId) setCommandsLoaded(true);
        }
      })
      .finally(() => {
        if (!cancelled) setCommandsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slashOpen, toolMenuOpen, loadCommands]);

  useEffect(() => {
    if (!mentionOpen) return;
    let cancelled = false;
    void Promise.all([props.listAgents(), props.searchFiles(mentionQuery), listRunningAppsForMention()]).then(([agentList, files, apps]) => {
      if (cancelled) return;
      const recent = props.recentFiles.slice(0, 8);
      const next: MentionItem[] = [
        ...agentList.map((agent) => ({ id: `agent:${agent.name}`, kind: "agent" as const, value: agent.name, label: agent.name })),
        ...recent.map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
        // Running macOS apps (Computer Use targets). Listed after recent files
        // so an empty "@" stays file-first; fuzzy search surfaces them as the
        // user types (e.g. "@mus" → Music).
        ...apps.map((appName) => ({ id: `app:${appName}`, kind: "app" as const, value: appName, label: appName })),
        ...files.filter((file) => !recent.includes(file)).map((file) => ({ id: `file:${file}`, kind: "file" as const, value: file, label: file })),
      ];
      setMentionItems(next);
    }).catch(() => {
      if (!cancelled) setMentionItems([]);
    });
    return () => {
      cancelled = true;
    };
  }, [mentionOpen, mentionQuery, props.listAgents, props.recentFiles, props.searchFiles]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (plusMenuRef.current?.contains(target) || toolMenuRef.current?.contains(target)) return;
      setToolMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [toolMenuOpen]);

  useEffect(() => {
    if (!delegationMenuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (plusMenuRef.current?.contains(target) || delegationMenuRef.current?.contains(target)) return;
      setDelegationMenuOpen(false);
    };
    window.addEventListener("mousedown", handlePointerDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
    };
  }, [delegationMenuOpen]);

  useEffect(() => {
    if (!toolMenuOpen) return;
    const openId = toolMenuLoadRef.current.openId;
    const listSkills = listSkillsRef.current;
    const listMcp = listMcpRef.current;
    const listInstalledExtensions = listInstalledExtensionsRef.current;
    if (toolMenuSection === "skills" && listSkills && !toolMenuLoadRef.current.skills) {
      let cancelled = false;
      toolMenuLoadRef.current.skills = true;
      setSkillsLoading(true);
      void listSkills()
        .then((next) => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills(next);
            setSkillsLoaded(true);
          }
        })
        .catch(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) {
            setSkills([]);
            setSkillsLoaded(true);
          }
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setSkillsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (toolMenuSection === "mcps" && listMcp && !toolMenuLoadRef.current.mcps) {
      let cancelled = false;
      toolMenuLoadRef.current.mcps = true;
      setMcpLoading(true);
      void listMcp()
        .then((next) => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers(next.servers);
          setMcpStatuses(next.statuses);
          setMcpStatus(next.status);
          setMcpLoaded(true);
        })
        .catch(() => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setMcpServers([]);
          setMcpStatuses({});
          setMcpLoaded(true);
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setMcpLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    if (toolMenuSection === "extensions" && listInstalledExtensions && !toolMenuLoadRef.current.extensions) {
      let cancelled = false;
      toolMenuLoadRef.current.extensions = true;
      setExtensionsLoading(true);
      void listInstalledExtensions()
        .then((next) => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setInstalledExtensions(next);
          setExtensionsLoaded(true);
        })
        .catch(() => {
          if (cancelled || toolMenuLoadRef.current.openId !== openId) return;
          setInstalledExtensions([]);
          setExtensionsLoaded(true);
        })
        .finally(() => {
          if (!cancelled && toolMenuLoadRef.current.openId === openId) setExtensionsLoading(false);
        });
      return () => {
        cancelled = true;
      };
    }
    return undefined;
  }, [toolMenuOpen, toolMenuSection]);

  const slashFiltered = useMemo(() => {
    if (!slashOpen) return [];
    if (!slashQuery) return commands.slice(0, 8);
    return fuzzysort.go(slashQuery, commands, { keys: ["name", "description"], limit: 8 }).map((entry) => entry.obj);
  }, [commands, slashOpen, slashQuery]);
  const mentionFiltered = useMemo(() => {
    if (!mentionOpen) return [];
    if (!mentionQuery) return mentionItems.slice(0, 8);
    return fuzzysort.go(mentionQuery, mentionItems, { keys: ["label"], limit: 8 }).map((entry) => entry.obj);
  }, [mentionItems, mentionOpen, mentionQuery]);
  const pastedTextTokens = useMemo(
    () => props.pastedText.map((item) => ({ label: item.label, lines: item.lines })),
    [props.pastedText],
  );

  const handleExpandPastedText = useCallback((label: string) => {
    const target = props.pastedText.find((item) => item.label === label);
    if (!target) return;
    props.onExpandPastedText(target.id);
  }, [props.onExpandPastedText, props.pastedText]);

  const activeMenu = slashOpen ? "slash" : mentionOpen ? "mention" : null;
  const activeItems = activeMenu === "slash" ? slashFiltered : activeMenu === "mention" ? mentionFiltered : [];
  const toolCommandItems = commands.filter((command) => !command.source || command.source === "command");
  const toolSkillItems = commands.filter((command) => command.source === "skill");
  const toolMcpItems = commands.filter((command) => command.source === "mcp");
  void toolMcpItems;
  const composerExtensions = installedExtensions.filter((item) => (
    activePluginEngineCompatibility(item)?.status !== "unsupported"
  ));
  useEffect(() => {
    if (!activeItems.length) {
      setMenuIndex(0);
      return;
    }
    setMenuIndex((current) => Math.max(0, Math.min(current, activeItems.length - 1)));
  }, [activeItems.length]);

  useEffect(() => {
    menuItemRefs.current.length = activeItems.length;
    const target = menuItemRefs.current[menuIndex];
    target?.scrollIntoView({ block: "nearest" });
  }, [menuIndex, activeItems.length]);

  const applyCommandSelection = (command: SlashCommandOption, options?: { replaceSkillDraft?: boolean }) => {
    if (command.source === "skill") {
      applySkillSelection(command.name, options);
      return;
    }
    props.onDraftChange(`/${command.name} `);
    setSlashOpen(false);
    setToolMenuOpen(false);
  };

  const applySkillSelection = (name: string, options?: { replaceSkillDraft?: boolean }) => {
    if (options?.replaceSkillDraft) {
      props.onDraftChange(`[skill ${name}] `);
    } else {
      const editor = editorRef.current;
      if (editor) {
        editor.insertSkillAtSelection(name);
      } else {
        const separator = props.draft.length > 0 && !/\s$/.test(props.draft) ? " " : "";
        props.onDraftChange(`${props.draft}${separator}[skill ${name}] `);
      }
    }
    setSlashOpen(false);
    setToolMenuOpen(false);
  };

  const applyExternalAgentSelection = (item: iPolloWorkPluginPackageItem) => {
    const prompt = item.manifest.composer?.prompt;
    if (!prompt) return;
    props.onDraftChange(props.draft.trim() ? `${prompt}\n\n${props.draft}` : `${prompt} `);
    setDelegationMenuOpen(false);
    setPlusMenuOpen(false);
    setPlusMenuSection(null);
    window.requestAnimationFrame(() => window.dispatchEvent(new Event(FOCUS_PROMPT_EVENT)));
  };

  const selectWorkMode = (mode: string) => {
    if (props.busy || props.modeSelectionDisabled) return;
    props.onSelectMode(mode);
    setWorkModeOpen(false);
  };

  const activeWorkMode = workModes.find((mode) => mode.id === props.selectedMode)
    ?? workModes.find((mode) => mode.isDefault)
    ?? workModes[0]
    ?? {
      id: props.selectedMode ?? "default",
      label: props.selectedMode || t("composer.work_mode_execute"),
      icon: "execute" as const,
    };

  const activeAccessMode = accessModes.find((mode) => mode.id === props.selectedAccessMode)
    ?? accessModes.find((mode) => mode.isDefault)
    ?? accessModes[0]
    ?? null;

  const applyAccessMode = async (mode: ConversationAccessMode) => {
    if (props.busy || props.accessModeSelectionDisabled || accessModeBusy || mode.selectable === false) return;
    setAccessModeOpen(false);
    setAccessModeBusy(true);
    try {
      await props.onSelectAccessMode?.(mode.id);
    } catch (error) {
      toast.error(t("composer.access_mode_switch_failed"), {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAccessModeBusy(false);
      setPendingDangerousAccessMode(null);
    }
  };

  const selectAccessMode = (mode: ConversationAccessMode) => {
    if (mode.id === props.selectedAccessMode || mode.selectable === false) {
      setAccessModeOpen(false);
      return;
    }
    if (mode.dangerous) {
      setAccessModeOpen(false);
      setPendingDangerousAccessMode(mode);
      return;
    }
    void applyAccessMode(mode);
  };

  const applyExtensionSelection = (entry: iPolloWorkPluginPackageItem) => {
    props.onOpenWorkspaceApp?.(entry.pluginId);
    props.onDraftChange(entry.manifest.composer?.prompt.trim() || `Use ${entry.name} to `);
    setToolMenuOpen(false);
  };

  const openToolMenuSettings = () => {
    const section: ToolMenuSettingsSection = toolMenuSection === "commands" || toolMenuSection === "skills" || toolMenuSection === "mcps"
      ? toolMenuSection
      : "plugins";
    props.onOpenSettingsSection?.(section);
  };

  const acceptActiveItem = () => {
    if (!activeItems.length) return false;
    if (activeMenu === "slash") {
      const command = slashFiltered[menuIndex];
      if (!command) return false;
      applyCommandSelection(command, { replaceSkillDraft: true });
      return true;
    }
    if (activeMenu === "mention") {
      const item = mentionFiltered[menuIndex];
      if (!item) return false;
      props.onInsertMention(item.kind, item.value);
      setMentionOpen(false);
      return true;
    }
    return false;
  };

  // Listen for cross-app focus + draft flush events. The Solid shell uses
  // these from deep-link handlers, the command palette, and the browser
  // pagehide/beforeunload cycle so no in-flight draft is lost.
  useEffect(() => {
    const handleFocus = () => {
      const root = rootRef.current;
      if (!root) return;
      const editable = root.querySelector<HTMLElement>("[contenteditable='true']");
      editable?.focus();
    };
    const handleFlush = () => {
      // onDraftChange always runs synchronously on every keystroke, so this
      // listener is effectively a hook for the shell to signal "we're about
      // to unmount, commit any debounced state". Re-fire with the current
      // draft so downstream stores can checkpoint it.
      props.onDraftChange(draftRef.current);
    };
    window.addEventListener(FOCUS_PROMPT_EVENT, handleFocus);
    window.addEventListener(FLUSH_PROMPT_EVENT, handleFlush);
    window.addEventListener("beforeunload", handleFlush);
    window.addEventListener("pagehide", handleFlush);
    return () => {
      window.removeEventListener(FOCUS_PROMPT_EVENT, handleFocus);
      window.removeEventListener(FLUSH_PROMPT_EVENT, handleFlush);
      window.removeEventListener("beforeunload", handleFlush);
      window.removeEventListener("pagehide", handleFlush);
    };
  }, [props.onDraftChange]);

  const handleKeyDownCapture: React.KeyboardEventHandler<HTMLDivElement> = (event) => {
    // IME composition guard — block Enter while IME is mid-character.
    const imeActive =
      imeComposingRef.current ||
      (event.nativeEvent as KeyboardEvent).isComposing === true ||
      event.keyCode === 229;
    if (event.key === "Enter" && imeActive) {
      return;
    }
    // Escape-to-stop while the agent is busy. Only when no menu is open so
    // Escape can still close menus. First press arms a confirmation prompt
    // for 3s; a second Escape within that window stops the agent.
    const anyMenuOpen = plusMenuOpen || delegationMenuOpen || toolMenuOpen || Boolean(activeMenu);
    if (event.key === "Escape" && props.busy && !anyMenuOpen) {
      event.preventDefault();
      if (escapeArmed) {
        disarmEscape();
        void props.onStop();
      } else {
        setEscapeArmed(true);
        if (escapeTimerRef.current) clearTimeout(escapeTimerRef.current);
        escapeTimerRef.current = setTimeout(() => {
          setEscapeArmed(false);
          escapeTimerRef.current = null;
        }, 3000);
      }
      return;
    }
    if (delegationMenuOpen) {
      if (event.key === "Escape") {
        event.preventDefault();
        setDelegationMenuOpen(false);
        setPlusMenuOpen(false);
        setPlusMenuSection(null);
        return;
      }
      const total = externalAgents.length;
      if (total > 0 && event.key === "ArrowDown") {
        event.preventDefault();
        setDelegationMenuIndex((current) => (current + 1) % total);
        return;
      }
      if (total > 0 && event.key === "ArrowUp") {
        event.preventDefault();
        setDelegationMenuIndex((current) => (current - 1 + total) % total);
        return;
      }
      if (total > 0 && (event.key === "Enter" || event.key === "Tab")) {
        event.preventDefault();
        const selected = externalAgents[delegationMenuIndex];
        if (selected) applyExternalAgentSelection(selected);
        return;
      }
    }

    if (plusMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setPlusMenuOpen(false);
      return;
    }

    if (toolMenuOpen && event.key === "Escape") {
      event.preventDefault();
      setToolMenuOpen(false);
      return;
    }

    // Input history recall (#2012). Only when no menu is consuming the
    // arrow keys and IME composition is not active.
    if (
      (event.key === "ArrowUp" || event.key === "ArrowDown") &&
      !imeActive &&
      !delegationMenuOpen &&
      !toolMenuOpen &&
      (!activeMenu || !activeItems.length)
    ) {
      const history = props.inputHistory ?? [];
      const position = historyPosRef.current;
      if (event.key === "ArrowUp") {
        const startRecall = position === null && props.draft.trim() === "" && history.length > 0;
        const continueRecall = position !== null && position > 0;
        if (startRecall || continueRecall) {
          const nextPos = position === null ? history.length - 1 : position - 1;
          if (position === null) historyStashRef.current = props.draft;
          historyPosRef.current = nextPos;
          historyExpectedRef.current = history[nextPos];
          event.preventDefault();
          props.onDraftChange(history[nextPos]);
          return;
        }
      } else if (position !== null) {
        event.preventDefault();
        const nextPos = position + 1;
        if (nextPos >= history.length) {
          historyPosRef.current = null;
          historyExpectedRef.current = null;
          props.onDraftChange(historyStashRef.current);
        } else {
          historyPosRef.current = nextPos;
          historyExpectedRef.current = history[nextPos];
          props.onDraftChange(history[nextPos]);
        }
        return;
      }
    }

    if (!activeMenu || !activeItems.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setMenuIndex((current) => (current + 1) % activeItems.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setMenuIndex((current) => (current - 1 + activeItems.length) % activeItems.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      event.stopPropagation();
      void acceptActiveItem();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSlashOpen(false);
      setMentionOpen(false);
    }
  };

  const addAttachments = async (inputFiles: File[]) => {
    if (!inputFiles.length) return;

    const accepted: File[] = [];
    const oversize: string[] = [];

    for (const original of inputFiles) {
      const processed = original.type.startsWith("image/") ? await compressImageFile(original) : original;
      if (processed.size > maxAttachmentBytes) {
        oversize.push(processed.name || original.name);
        continue;
      }
      accepted.push(processed);
    }

    if (accepted.length) {
      props.onAttachFiles(accepted);
    }

    if (oversize.length) {
      toast.warning(
        oversize.length === 1
          ? t("composer.file_exceeds_limit", { name: oversize[0] })
          : `${oversize.length} files exceed the 8MB limit.`,
      );
    }

  };

  const activeMcpItems = mcpServers.map((entry) => ({
    entry,
    status: toReactMcpStatus(entry.name, entry, mcpStatuses),
  }));

  const panelRoundedClass =
    mentionOpen || slashOpen
      ? "rounded-t-[18px] border-t-transparent"
      : "";

  const renderSlashMenu = () => {
    if (!slashOpen) return null;
    return (
      <div className="absolute bottom-full left-[-1px] right-[-1px] z-30">
          <div className="overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface shadow-[var(--dls-shell-shadow)]">
            <div
              role="presentation"
              className="max-h-64 overflow-y-auto p-2"
              onMouseDown={(event) => event.preventDefault()}
          >
            {slashFiltered.length > 0 ? (
              <div className="grid gap-1">
                {slashFiltered.map((command, index) => (
                  <button
                    key={command.id}
                    ref={(element) => {
                      menuItemRefs.current[index] = element;
                    }}
                    type="button"
                    className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${activeMenu === "slash" && slashFiltered[menuIndex]?.id === command.id ? "bg-gray-3 text-gray-12" : "text-gray-11"}`}
                    onMouseEnter={() => setMenuIndex(index)}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      applyCommandSelection(command, { replaceSkillDraft: true });
                    }}
                    onClick={(event) => {
                      if (event.detail === 0) applyCommandSelection(command, { replaceSkillDraft: true });
                    }}
                  >
                    <Terminal size={14} className="mt-0.5 shrink-0 text-gray-9" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-3">
                        <div className="truncate text-xs font-semibold">/{command.name}</div>
                        {command.source && command.source !== "command" ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${command.source === "skill" ? "bg-violet-3/40 text-violet-11" : "bg-cyan-3/40 text-cyan-11"}`}>
                            {command.source === "skill" ? t("composer.skill_source") : t("composer.mcps_label")}
                          </span>
                        ) : null}
                      </div>
                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="px-3 py-2 text-xs text-gray-10">
                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderMentionMenu = () => {
    if (!mentionOpen || mentionFiltered.length === 0) return null;
    return (
      <div className="absolute bottom-full left-[-1px] right-[-1px] z-30">
          <div className="overflow-hidden rounded-t-[20px] border border-dls-border border-b-0 bg-dls-surface shadow-[var(--dls-shell-shadow)]">
            <div
              role="presentation"
              className="max-h-64 overflow-y-auto p-2"
              onMouseDown={(event) => event.preventDefault()}
          >
            <div className="grid gap-1">
              {mentionFiltered.map((item, index) => (
                <button
                  key={item.id}
                  ref={(element) => {
                    menuItemRefs.current[index] = element;
                  }}
                  type="button"
                  className={`flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors hover:bg-gray-2/70 ${activeMenu === "mention" && mentionFiltered[menuIndex]?.id === item.id ? "bg-gray-3 text-gray-12" : "text-gray-11"}`}
                  onMouseEnter={() => setMenuIndex(index)}
                  onClick={() => {
                    props.onInsertMention(item.kind, item.value);
                    setMentionOpen(false);
                  }}
                >
                  {item.kind === "agent" ? (
                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  ) : item.kind === "app" ? (
                    <AppWindowMac size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  ) : (
                    <FileText size={14} className="mt-0.5 shrink-0 text-gray-9" />
                  )}
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold">@{item.label}</div>
                    <div className="truncate text-xs text-gray-10">
                      {item.kind === "agent"
                        ? t("composer.agent_label")
                        : item.kind === "app"
                          ? t("composer.app_kind")
                          : t("composer.file_kind")}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      ref={rootRef}
      className={props.layout === "inline"
        ? `relative ${toolMenuOpen ? "z-50" : "z-20"} w-full bg-transparent p-0`
        : `sticky bottom-0 ${toolMenuOpen ? "z-50" : "z-20"} bg-gradient-to-t from-dls-surface via-dls-surface/95 to-transparent px-4 pb-2 md:px-8 ${props.compactTopSpacing ? "pt-0" : "pt-1"}`}
      style={{ contain: "layout style" }}
      onKeyDownCapture={handleKeyDownCapture}
      onCompositionStart={() => {
        imeComposingRef.current = true;
      }}
      onCompositionEnd={() => {
        imeComposingRef.current = false;
      }}
    >
      <div className="max-w-[800px] mx-auto">
        {/* Main composer panel */}
        <div
          className={`@container/composer relative overflow-visible rounded-[18px] border bg-dls-surface transition-all ${engineSelectedAppearance ? "border-sky-8 shadow-[var(--dls-card-shadow)]" : "border-transparent shadow-[0_4px_12.9px_rgba(80,130,222,0.20)]"} ${props.layout === "inline" ? `new-conversation-composer dark:bg-[#343434] ${engineSelectedAppearance ? "" : "dark:shadow-[0_4px_9.5px_rgba(113,156,234,0.53)]"}` : ""} ${panelRoundedClass}`}
          style={engineSelectedAppearance ? undefined : {
            backgroundImage: `linear-gradient(${props.layout === "inline" ? "var(--new-conversation-composer-surface, var(--dls-surface))" : "var(--dls-surface)"}, ${props.layout === "inline" ? "var(--new-conversation-composer-surface, var(--dls-surface))" : "var(--dls-surface)"}), linear-gradient(90deg, #7FCDFF 0%, #FFE67D 100%)`,
            backgroundOrigin: "border-box",
            backgroundClip: "padding-box, border-box",
          }}
        >
          {props.topAccessory ? <div className="relative z-10">{props.topAccessory}</div> : null}

          {renderMentionMenu()}
          {renderSlashMenu()}

          {props.attachments.length > 0 ? (
            <div className="mx-5 mt-5 flex flex-wrap gap-2 md:mx-6">
              {props.attachments.map((attachment) => (
                <div key={attachment.id} className="flex items-center gap-2 rounded-2xl border border-gray-6 bg-gray-2 px-3 py-2 text-xs text-gray-10">
                  {isImageAttachment(attachment) && attachment.previewUrl ? (
                    <div className="h-10 w-10 overflow-hidden rounded-xl border border-gray-6 bg-gray-1">
                      <img src={attachment.previewUrl} alt={attachment.name} decoding="async" className="h-full w-full object-cover" />
                    </div>
                  ) : (
                    <FileText size={14} className="text-gray-9" />
                  )}
                  <div className="max-w-[160px] min-w-0">
                    <div className="truncate text-[12px] font-medium text-gray-11">{attachment.name}</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-gray-10">
                      <span>{isImageAttachment(attachment) ? t("composer.image_kind") : t("composer.file_kind")}</span>
                      <span>·</span>
                      <span>{formatBytes(attachment.size)}</span>
                    </div>
                  </div>
                  <button
                    type="button"
                    className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12"
                    onClick={() => props.onRemoveAttachment(attachment.id)}
                    title={t("action.remove")}
                  >
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {/*
            The pasted-text chip used to render twice — once inline inside
            the Lexical editor (via ComposerPastedTextNode) and again as a
            separate rail here above the composer. Keep only the inline
            chip; its pill already shows label + line count, and the user
            removes it with backspace like any other inline token.
          */}

          {dropzoneActive ? (
            <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-[20px] border-2 border-dashed border-dls-accent bg-[color:color-mix(in_oklab,var(--dls-accent)_10%,transparent)]">
              <div className="rounded-2xl border border-dls-border bg-dls-surface/95 px-5 py-4 text-center backdrop-blur-sm">
                <div className="text-sm font-medium text-dls-text">{t("composer.attach_files")}</div>
                <div className="mt-1 text-xs text-dls-secondary">{t("composer.any_file_type_supported")}</div>
              </div>
            </div>
          ) : null}

          <div className="px-4 pt-3 pb-2">
            {/* Editor */}
            <LexicalPromptEditor
              ref={editorRef}
              value={props.draft}
              mentions={props.mentions}
              pastedText={pastedTextTokens}
              disabled={editorDisabled}
              submitDisabled={props.disabled}
              placeholder={props.placeholder ?? t("composer.placeholder")}
              onChange={props.onDraftChange}
              onSubmit={handleEditorSubmit}
              onExpandPastedText={handleExpandPastedText}
              onPasteText={props.onPasteText}
              onPaste={(event) => {
                // Paste policy:
                // 1. Actual files on the clipboard -> attach them.
                // 2. Explicit text/uri-list (drag from Finder / browser) -> insert links.
                // 3. Plain text -> DO NOTHING. Let Lexical's PlainTextPlugin
                //    handle the paste natively so newlines render correctly
                //    and no content is silently dropped. Previous behavior
                //    hijacked pastes that merely contained absolute paths
                //    like "/Users/..." or pastes longer than 10 lines, which
                //    was the root cause of "paste into composer is broken".
                const files = Array.from(event.clipboardData?.files ?? []);
                if (files.length) {
                  event.preventDefault();
                  void addAttachments(files);
                  return;
                }

                const uriList = event.clipboardData
                  ? parseClipboardUriList(event.clipboardData)
                  : [];
                if (uriList.length) {
                  event.preventDefault();
                  props.onUnsupportedFileLinks(uriList);
                  return;
                }

                const text = event.clipboardData?.getData("text/plain") ?? "";

                // Long pastes (3+ lines / 200+ chars) are collapsed into
                // an inline chip by PasteChipPlugin inside the Lexical
                // editor. Do NOT duplicate that here — calling onPasteText
                // from both the React onPaste handler and the Lexical
                // PASTE_COMMAND handler causes double chip creation.

                if (
                  text.trim() &&
                  (props.isRemoteWorkspace || props.isSandboxWorkspace) &&
                  /file:\/\/|(^|\s)\/(Users|home|var|etc|opt|tmp|private|Volumes|Applications)\//.test(text)
                ) {
                  const attachedFiles = props.attachments.map((attachment) => attachment.file);
                  toast.warning(t("composer.remote_worker_paste_warning"), {
                    action:
                      props.onUploadInboxFiles && attachedFiles.length > 0
                        ? {
                            label: t("composer.upload_to_shared_folder"),
                            onClick: () => void props.onUploadInboxFiles?.(attachedFiles),
                          }
                        : undefined,
                  });
                  // Intentionally no preventDefault — the notice is advisory,
                  // the paste still goes through the editor.
                }
              }}
              onDragOver={(event) => {
                if (event.dataTransfer?.files?.length) {
                  event.preventDefault();
                  if (!dropzoneActive) setDropzoneActive(true);
                }
              }}
              onDragLeave={(event) => {
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
                setDropzoneActive(false);
              }}
              onDrop={(event) => {
                const files = Array.from(event.dataTransfer?.files ?? []);
                setDropzoneActive(false);
                if (!files.length) return;
                event.preventDefault();
                void addAttachments(files);
              }}
            />

            {/* Action row — attachments, quick actions, model controls, and send */}
            <div className="mt-2 flex min-w-0 items-end justify-between gap-2">
              <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-0 overflow-visible">
                <input
                  ref={(element) => {
                    fileInput = element ?? undefined;
                  }}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    if (files.length) void addAttachments(files);
                    event.currentTarget.value = "";
                  }}
                />
                <div ref={plusMenuRef} className="relative me-2 shrink-0">
                  <button
                    type="button"
                    className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-7 ${plusMenuOpen ? "bg-gray-3 text-gray-12" : "bg-transparent text-gray-10 hover:bg-gray-3 hover:text-gray-12"}`}
                    onClick={() => {
                      setWorkModeOpen(false);
                      setToolMenuOpen(false);
                      setDelegationMenuOpen(false);
                      setPlusMenuOpen((open) => {
                        if (open) setPlusMenuSection(null);
                        return !open;
                      });
                    }}
                    aria-expanded={plusMenuOpen}
                    aria-haspopup="menu"
                    title={t("composer.plus_menu_label")}
                  >
                    <Plus size={16} strokeWidth={1.75} />
                  </button>
                  {plusMenuOpen ? (
                    <div className="absolute bottom-full left-0 z-40 mb-2 flex items-end gap-1">
                      <div className="w-52 shrink-0 rounded-[16px] border border-dls-border bg-dls-surface p-1.5 shadow-[var(--dls-shell-shadow)]">
                      <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-sm text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12"
                        onMouseEnter={() => {
                          setPlusMenuSection(null);
                          setToolMenuOpen(false);
                          setDelegationMenuOpen(false);
                        }}
                        onClick={() => {
                          const input = fileInput;
                          flushSync(() => {
                            setPlusMenuOpen(false);
                            setPlusMenuSection(null);
                            setToolMenuOpen(false);
                            setDelegationMenuOpen(false);
                          });
                          input?.click();
                        }}
                      >
                        <Paperclip className="size-4 shrink-0 text-gray-9" aria-hidden />
                        <span>{t("composer.plus_attach_files")}</span>
                      </button>
                      {props.onOpenTemplateMarket ? (
                        <button
                          type="button"
                          className="flex w-full items-center gap-2 rounded-[12px] px-3 py-2.5 text-left text-sm text-gray-11 transition-colors hover:bg-gray-3 hover:text-gray-12"
                          onMouseEnter={() => {
                            setPlusMenuSection(null);
                            setToolMenuOpen(false);
                            setDelegationMenuOpen(false);
                          }}
                          onClick={() => {
                            setPlusMenuOpen(false);
                            setPlusMenuSection(null);
                            props.onOpenTemplateMarket?.();
                          }}
                        >
                          <TemplateIcon className="size-3.5 opacity-60" />
                          <span>{t("composer.plus_use_template")}</span>
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-left text-sm ${plusMenuSection === "tools" ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                        onMouseEnter={() => setPlusMenuSection("tools")}
                        onClick={() => {
                          setPlusMenuSection("tools");
                          setToolMenuOpen(true);
                          setDelegationMenuOpen(false);
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Wrench className="size-4 shrink-0 text-gray-9" aria-hidden />
                          <span>{t("composer.plus_tools")}</span>
                        </span>
                        <ChevronRight size={14} className="text-gray-9" />
                      </button>
                      <button
                        type="button"
                        className={`flex w-full items-center justify-between gap-2 rounded-[12px] px-3 py-2.5 text-left text-sm ${plusMenuSection === "delegation" ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                        onMouseEnter={() => setPlusMenuSection("delegation")}
                        onClick={() => {
                          setPlusMenuSection("delegation");
                          setDelegationMenuOpen(true);
                          setToolMenuOpen(false);
                        }}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Bot className="size-4 shrink-0 text-gray-9" aria-hidden />
                          <span>{t("composer.delegate_external_agents")}</span>
                        </span>
                        <ChevronRight size={14} className="text-gray-9" />
                      </button>
                      </div>
                    </div>
                  ) : null}
                </div>
                <div
                  ref={toolMenuRef}
                  className="relative"
                  onMouseDown={(event) => {
                    const target = event.target;
                    if (target instanceof Element && target.closest("button")) event.preventDefault();
                  }}
                >
                  {toolMenuOpen ? (
                    <div className="absolute bottom-full left-[10.75rem] z-40 mb-2 w-[min(calc(100vw-16rem),34rem)] overflow-hidden rounded-[22px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="grid grid-cols-[152px_minmax(0,1fr)] sm:grid-cols-[176px_minmax(0,1fr)]">
                        <div className="border-r border-dls-border bg-gray-2/30 p-2">
                          {([
                            ["commands", t("dashboard.commands")],
                            ["skills", t("dashboard.skills")],
                            ["extensions", t("composer.extensions_label")],
                            ["mcps", t("composer.mcps_label")],
                          ] as const).map(([section, label]) => (
                            <button
                              key={section}
                              type="button"
                              className={`mb-1 flex w-full items-center justify-between rounded-[16px] px-3 py-2.5 text-left text-sm transition-colors ${toolMenuSection === section ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2"}`}
                              onClick={() => setToolMenuSection(section)}
                            >
                              <span className="truncate">{label}</span>
                              <ChevronRight size={14} className="shrink-0 text-gray-9" />
                            </button>
                          ))}
                        </div>
                        <div className="max-h-72 overflow-y-auto p-2">
                          <div className="mb-2 flex justify-end border-b border-dls-border px-1 pb-2">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1.5 rounded-full border border-dls-border px-3 py-1.5 text-[12px] font-medium text-gray-11 transition-colors hover:bg-gray-2"
                              onClick={() => {
                                setToolMenuOpen(false);
                                openToolMenuSettings();
                              }}
                            >
                              <Settings size={12} />
                              {t("composer.configure")}
                            </button>
                          </div>
                          {toolMenuSection === "commands" ? (
                            toolCommandItems.length > 0 ? (
                              <div className="grid gap-1">
                                {toolCommandItems.map((command) => (
                                  <button
                                    key={command.id}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyCommandSelection(command)}
                                  >
                                    <Terminal size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-gray-11">/{command.name}</div>
                                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!commandsLoaded && commandsLoading ? t("composer.loading_commands") : t("composer.no_commands")}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "skills" ? (
                            (skills.length > 0 || toolSkillItems.length > 0) ? (
                              <div className="grid gap-1">
                                {[...toolSkillItems, ...skills.filter((skill) => !toolSkillItems.some((command) => command.name === skill.name)).map((skill) => ({ id: `skill:${skill.name}`, name: skill.name, description: skill.description, source: "skill" as const }))].map((command) => (
                                  <button
                                    key={command.id}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyCommandSelection(command)}
                                  >
                                    <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0">
                                      <div className="truncate text-xs font-semibold text-gray-11">/{command.name}</div>
                                      {command.description ? <div className="truncate text-xs text-gray-10">{command.description}</div> : null}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {(!skillsLoaded && skillsLoading) || (!commandsLoaded && commandsLoading) ? t("composer.loading_commands") : t("context_panel.no_skills")}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "mcps" ? (
                            activeMcpItems.length > 0 ? (
                              <div className="grid gap-1">
                                {activeMcpItems.map(({ entry, status }) => (
                                  <div key={entry.name} className="flex items-start gap-3 rounded-[16px] px-3 py-2.5 text-gray-11">
                                    <Plug size={14} className="mt-0.5 shrink-0 text-gray-9" />
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{entry.name}</div>
                                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${mcpStatusBadgeClass(status)}`}>
                                          {formatMcpStatusLabel(status)}
                                        </span>
                                      </div>
                                      <div className="truncate text-xs text-gray-10">{entry.config.type === "remote" ? entry.config.url ?? entry.config.command?.join(" ") ?? "Remote MCP" : entry.config.command?.join(" ") ?? "Local MCP"}</div>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!mcpLoaded && mcpLoading ? t("composer.loading_commands") : (mcpStatus ?? t("context_panel.no_mcp"))}
                              </div>
                            )
                          ) : null}
                          {toolMenuSection === "extensions" ? (
                            composerExtensions.length > 0 ? (
                              <div className="grid gap-1">
                                {composerExtensions.map((entry) => (
                                  <button
                                    key={entry.pluginId}
                                    type="button"
                                    className="flex w-full items-start gap-3 rounded-[16px] px-3 py-2.5 text-left text-gray-11 transition-colors hover:bg-gray-2/70"
                                    onClick={() => applyExtensionSelection(entry)}
                                  >
                                    <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-card shadow-sm">
                                      {extensionIcon(entry, 16)}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="flex items-center justify-between gap-3">
                                        <div className="truncate text-xs font-semibold text-gray-11">{entry.name}</div>
                                        {activePluginEngineCompatibility(entry)?.status === "partial" ? (
                                          <span className="shrink-0 rounded-full bg-amber-3 px-2 py-0.5 text-[10px] font-medium text-amber-11">{t("plugin_platform.engine.partial")}</span>
                                        ) : (
                                          <span className="shrink-0 rounded-full bg-green-3 px-2 py-0.5 text-[10px] font-medium text-green-11">{t("composer.enabled")}</span>
                                        )}
                                      </div>
                                      <div className="truncate text-xs text-gray-10">{entry.manifest.description}</div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            ) : (
                              <div className="px-3 py-2 text-xs text-gray-10">
                                {!extensionsLoaded && extensionsLoading ? t("composer.loading_commands") : t("composer.no_extensions_enabled")}
                              </div>
                            )
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div ref={delegationMenuRef} className="relative">
                  {delegationMenuOpen ? (
                    <div className="absolute left-[10.75rem] bottom-full z-40 mb-2 w-64 overflow-hidden rounded-[18px] border border-dls-border bg-dls-surface shadow-[var(--dls-shell-shadow)]">
                      <div className="border-b border-dls-border px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-gray-10">
                        {t("composer.external_agents_label")}
                      </div>
                      <div
                        role="presentation"
                        className="max-h-64 space-y-1 overflow-y-auto p-2"
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        {externalAgents.map((agent, index) => (
                          <button
                            key={agent.pluginId}
                            ref={(element) => {
                              delegationItemRefs.current[index] = element;
                            }}
                            type="button"
                            className={`flex w-full items-start gap-3 rounded-[14px] px-3 py-2.5 text-left transition-colors ${delegationMenuIndex === index ? "bg-gray-3 text-gray-12" : "text-gray-11 hover:bg-gray-2/70"}`}
                            onMouseEnter={() => setDelegationMenuIndex(index)}
                            onMouseDown={(event) => {
                              event.preventDefault();
                              applyExternalAgentSelection(agent);
                            }}
                          >
                            <Zap size={14} className="mt-0.5 shrink-0 text-gray-9" />
                            <span className="min-w-0">
                              <span className="block truncate text-xs font-semibold">{agent.name}</span>
                              <span className="mt-0.5 block line-clamp-2 text-[11px] leading-4 text-gray-10">{agent.manifest.description}</span>
                            </span>
                          </button>
                        ))}
                        {externalAgentsLoading ? (
                          <div className="px-3 py-2 text-xs text-gray-10">{t("composer.loading_external_agents")}</div>
                        ) : externalAgents.length === 0 ? (
                          <div className="px-3 py-2 text-xs text-gray-10">{t("composer.no_external_agents")}</div>
                        ) : null}
                      </div>
                    </div>
                  ) : null}
                </div>

                <ModelBehaviorMenu
                  selectedModel={props.selectedModel}
                  modelVariant={props.modelVariant}
                  modelVariantLabel={props.modelVariantLabel}
                  options={props.modelBehaviorOptions}
                  onModelChange={props.onModelChange}
                  onModelVariantChange={props.onModelVariantChange}
                  onConfigureModels={props.onConfigureModels}
                  onConfigureTokenStar={props.onConfigureTokenStar}
                  disabled={props.busy}
                />
                {activeAccessMode && props.onSelectAccessMode ? (
                  <Popover
                    open={accessModeOpen}
                    onOpenChange={(open) => {
                      setAccessModeOpen(open);
                      if (!open) return;
                      setWorkModeOpen(false);
                      setPlusMenuOpen(false);
                      setPlusMenuSection(null);
                      setToolMenuOpen(false);
                      setDelegationMenuOpen(false);
                    }}
                  >
                    <PopoverTrigger
                      type="button"
                      disabled={props.busy || props.accessModeSelectionDisabled || accessModeBusy}
                      aria-label={`${t("composer.access_mode_label")}: ${activeAccessMode.label}`}
                      className="me-2 inline-flex h-8 items-center gap-1.5 rounded-full bg-transparent px-2 text-[12px] leading-[18px] text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12 data-[state=open]:bg-gray-3 data-[state=open]:text-gray-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-7 disabled:pointer-events-none disabled:opacity-60 @max-[560px]/composer:w-10 @max-[560px]/composer:justify-center @max-[560px]/composer:gap-0.5 @max-[560px]/composer:px-1"
                    >
                      <AccessModeIcon icon={activeAccessMode.icon} className="size-4 shrink-0 [stroke-width:1.75]" />
                      <span className="@max-[560px]/composer:hidden">{activeAccessMode.label}</span>
                      <ChevronDown className="size-3.5 shrink-0 [stroke-width:1.75]" />
                    </PopoverTrigger>
                    <PopoverContent side="top" align="start" sideOffset={8} className="w-72 gap-0 p-1.5">
                      {accessModes.map((mode) => {
                        const active = mode.id === activeAccessMode.id;
                        return (
                          <button
                            key={mode.id}
                            type="button"
                            disabled={props.busy || props.accessModeSelectionDisabled || accessModeBusy || mode.selectable === false}
                            data-access-mode-option={mode.id}
                            aria-pressed={active}
                            className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-2 disabled:cursor-not-allowed disabled:opacity-55"
                            onClick={() => selectAccessMode(mode)}
                          >
                            <AccessModeIcon icon={mode.icon} className={`mt-0.5 size-4 shrink-0 ${mode.dangerous ? "text-red-10" : "text-gray-10"}`} />
                            <span className="min-w-0 flex-1">
                              <span className="block font-medium">{mode.label}</span>
                              {mode.description ? <span className="mt-0.5 block text-xs leading-4 text-gray-9">{mode.description}</span> : null}
                            </span>
                            {active ? <Check className="mt-0.5 size-4 shrink-0 text-gray-11" /> : null}
                          </button>
                        );
                      })}
                    </PopoverContent>
                  </Popover>
                ) : null}
                <Popover
                  open={workModeOpen}
                  onOpenChange={(open) => {
                    setWorkModeOpen(open);
                    if (!open) return;
                    setPlusMenuOpen(false);
                    setPlusMenuSection(null);
                    setToolMenuOpen(false);
                    setDelegationMenuOpen(false);
                  }}
                >
                  <PopoverTrigger
                    type="button"
                    disabled={props.busy || props.modeSelectionDisabled}
                    aria-label={`${t("composer.work_mode_label")}: ${activeWorkMode.label}`}
                    className="inline-flex h-8 max-w-32 shrink-0 items-center gap-1.5 rounded-full bg-transparent px-2 text-[12px] leading-[18px] text-gray-10 transition-colors hover:bg-gray-3 hover:text-gray-12 data-[state=open]:bg-gray-3 data-[state=open]:text-gray-12 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-7 disabled:pointer-events-none disabled:opacity-60 @max-[560px]/composer:w-10 @max-[560px]/composer:justify-center @max-[560px]/composer:gap-0.5 @max-[560px]/composer:px-1"
                  >
                    <WorkModeIcon icon={activeWorkMode.icon} className="size-4 shrink-0 [stroke-width:1.75]" />
                    <span className="truncate @max-[560px]/composer:hidden">{activeWorkMode.label}</span>
                    <ChevronDown className="size-3.5 shrink-0 [stroke-width:1.75]" />
                  </PopoverTrigger>
                  <PopoverContent side="top" align="start" sideOffset={8} className="w-64 gap-0 p-1.5">
                    {workModes.map((mode) => {
                      const active = mode.id === activeWorkMode.id;
                      return (
                        <button
                          key={mode.id}
                          type="button"
                          disabled={props.busy || props.modeSelectionDisabled}
                          data-work-mode-option={mode.id}
                          aria-pressed={active}
                          className="flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left text-sm hover:bg-gray-2 disabled:pointer-events-none disabled:opacity-60"
                          onClick={() => selectWorkMode(mode.id)}
                        >
                          <WorkModeIcon icon={mode.icon} className="mt-0.5 size-4 shrink-0 text-gray-10" />
                          <span className="min-w-0 flex-1">
                            <span className="block font-medium">{mode.label}</span>
                            {mode.description ? <span className="mt-0.5 block text-xs leading-4 text-gray-9">{mode.description}</span> : null}
                          </span>
                          {active ? <Check className="mt-0.5 size-4 shrink-0 text-gray-11" /> : null}
                        </button>
                      );
                    })}
                  </PopoverContent>
                </Popover>
                {props.modelUnavailable ? (
                  <button
                    type="button"
                    className="ms-1.5 text-xs font-medium text-red-10 underline-offset-2 hover:underline"
                    onClick={() => props.onModelPickerOpenChange(true)}
                  >
                    {t("composer.model_unavailable")}
                  </button>
                ) : null}
              </div>

              {/*
                Action area.
                - Idle: single "Run task" button (sends immediately).
                - Busy: Stop is the only action that can interrupt the active
                  run. The send button appends the draft to the queue, and its
                  badge shows how many follow-ups are waiting.
                  Escape arms a "Hit Escape again to stop the agent" prompt.
              */}
              <div className="ml-auto flex min-w-0 shrink-0 items-end gap-1.5 @max-[560px]/composer:gap-1">
                <ContextHealth
                  usage={props.contextUsage}
                  modelContextWindow={props.modelContextWindow}
                />
                {props.busy ? (
                  <>
                    {escapeArmed ? (
                      <span className="hidden self-center truncate pr-1 text-[12px] font-medium text-gray-10 sm:inline">
                        {t("composer.escape_to_stop")}
                      </span>
                    ) : null}
                    <button
                      type="button"
                      onClick={props.onStop}
                      className="mr-1 inline-flex h-8 max-h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] transition-colors hover:bg-[var(--dls-accent-hover)]"
                      aria-label={t("composer.stop")}
                      title={t("composer.stop")}
                    >
                      <Square size={12} fill="currentColor" />
                    </button>
                    <button
                      type="button"
                      onPointerDown={canSend ? handleActionPointerDown : undefined}
                      onClick={canSend ? handleActionClick : undefined}
                      disabled={!canSend}
                      aria-label={t("composer.queue")}
                      className={`relative inline-flex h-8 max-h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
                        canSend
                          ? "bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]"
                          : "bg-gray-2 text-gray-10"
                      }`}
                      title={t("composer.queue_hint")}
                    >
                      <ArrowUp size={15} />
                      {props.queuedCount > 0 ? (
                        <span className="absolute -right-1.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-gray-12 px-1 text-[9px] font-semibold leading-4 text-gray-1 ring-2 ring-[var(--dls-surface)]">
                          {props.queuedCount > 99 ? "99+" : props.queuedCount}
                        </span>
                      ) : null}
                    </button>
                  </>
                ) : (
                  <Tooltip open={emptySubmitHintOpen}>
                    <TooltipTrigger
                      render={(
                        <button
                          type="button"
                          onPointerDown={handleActionPointerDown}
                          onClick={handleActionClick}
                          disabled={props.disabled}
                          className={`inline-flex h-8 max-h-8 w-8 items-center justify-center rounded-full transition-colors ${
                            props.disabled
                              ? "bg-gray-2 text-gray-10"
                              : !canSend
                                ? "bg-gray-9 text-white hover:bg-gray-10"
                                : props.layout === "inline"
                                  ? "bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)] dark:bg-white dark:text-black dark:hover:bg-white/90"
                                  : "bg-[var(--dls-accent)] text-[var(--dls-accent-fg)] hover:bg-[var(--dls-accent-hover)]"
                          }`}
                          title={t("composer.run_task")}
                        >
                          <ArrowUp size={15} />
                        </button>
                      )}
                    />
                    <TooltipContent
                      side="top"
                      sideOffset={10}
                      className="max-w-none whitespace-nowrap rounded-2xl px-4 py-3 text-sm font-medium"
                      data-testid="composer-empty-submit-hint"
                    >
                      {t("composer.empty_submit_hint")}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
            </div>
          </div>
        </div>

        <ConfirmModal
          open={pendingDangerousAccessMode !== null}
          title={t("composer.access_mode_full_access_confirm_title")}
          message={t("composer.access_mode_full_access_confirm_message")}
          confirmLabel={t("composer.access_mode_full_access_confirm_action")}
          cancelLabel={t("common.cancel")}
          variant="danger"
          onConfirm={() => {
            if (pendingDangerousAccessMode) void applyAccessMode(pendingDangerousAccessMode);
          }}
          onCancel={() => setPendingDangerousAccessMode(null)}
        />
      </div>
    </div>
  );
}
