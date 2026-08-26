/** @jsxImportSource react */
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { useQuery } from "@tanstack/react-query";
import type { TemplateCatalogItem } from "@ipollowork/types/templates";
import { Check, Minimize2, X } from "lucide-react";
import { toast } from "@/components/ui/sonner";

import { captureAnalyticsEvent } from "@/app/lib/analytics";
import { createClient, unwrap } from "@/app/lib/opencode";
import { isDelegatableExternalAgent, isPluginPackageReady } from "@/app/lib/plugin-package-readiness";
import { t } from "@/i18n";
import type {
  HyperframesAnimationSelection,
  HyperframesCatalogItem,
  HyperframesEffectVariableValues,
  iPolloWorkPluginPackageItem,
  iPolloWorkServerClient,
} from "@/app/lib/ipollowork-server";
import {
  hyperframesAnimationDisplayMetadata,
  hyperframesSelectionPayload,
} from "@/app/lib/hyperframes-effect-params";
import type {
  ComposerAttachment,
  ComposerDraft,
  McpServerEntry,
  McpStatusMap,
  ModelRef,
  PromptDispatchOptions,
  SkillCard,
  TodoItem,
} from "@/app/types";
import type {
  ConversationAgent,
  ConversationEngineConnection,
  ConversationMode,
  ConversationPermission,
  ConversationQuestion,
  ConversationSnapshot,
  ConversationStatus,
} from "../engine/conversation-engine";
import {
  publishInspectorSlice,
  recordInspectorEvent,
} from "@/app/lib/app-inspector";
import { useControlAction, type iPolloWorkControlAction } from "@/react-app/shell/control/control-provider";
import { ReactSessionComposer } from "./composer/composer";
import { encodeComposerMentionValue, type ComposerMentionKind } from "./composer/mention-encoding";
import {
  failedDraftRetrySurface,
  parseComposerParts,
  shouldPreserveComposerDraftAfterSendFailure,
} from "./composer/composer-draft";
import { desktopBridge } from "@/app/lib/desktop";
import { publicAssetUrl } from "@/app/lib/public-asset";
import { parseSlashCommandInvocation } from "./composer/slash-command";
import { useDesignAiSelectionStore } from "../design/design-ai-selection-store";
import {
  videoVoiceDisplayMetadata,
  type VideoVoiceAiReference,
} from "../video/video-voice";
import {
  hasVideoDeliveryRequirements,
  unchangedVideoArtifactIssue,
  videoDeliveryRequirementsForPrompt,
  videoProjectEntryPath,
  type VideoArtifactCompletionRequirement,
  type VideoDeliveryRequirements,
} from "../video/video-project";
import { DevProfiler } from "@/react-app/shell/dev-profiler";
import { useShellConfig } from "@/react-app/shell/shell-config";
import { useReactRenderWatchdog } from "@/react-app/shell/react-render-watchdog";
import { SessionDebugPanel } from "./debug-panel";
import {
  deriveComposerInputHistory,
  deriveRenderedSessionMessages,
  resolveRenderedSessionSnapshot,
} from "./session-render-state";
import { useLocal } from "@/react-app/kernel/local-provider";
import {
  attachmentRequiresNativeModelSupport,
  isModelReadableAttachment,
} from "@/react-app/domains/session/sync/attachment-support";
import { deriveSessionRenderModel } from "@/react-app/domains/session/sync/transition-controller";
import { useSessionScrollController } from "./scroll-controller";
import { SessionScrollOverlay } from "./scroll-overlay";
import { SessionFindBar } from "./find-bar";
import { useSessionFindStore } from "./find-store";
import { getSessionActivityStatusLabel, useSessionActivityStore, type SessionActivityStatus } from "@/react-app/domains/session/status/session-activity-store";
import { PermissionApprovalPanel } from "@/react-app/domains/session/chat/permission-approval-modal";
import { QuestionPanel } from "@/react-app/domains/session/modals/question-modal";
import { QueuedMessagesPanel } from "@/react-app/domains/session/modals/queued-messages-panel";
import { deriveOpenTargets, type OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { usePanelTabStore } from "@/react-app/domains/session/panel/panel-tab-store";
import {
  beginOptimisticSessionPrompt,
  rollbackOptimisticSessionPrompt,
  seedSessionState,
  snapshotKey as reactSnapshotKey,
  statusKey as reactStatusKey,
  transcriptKey as reactTranscriptKey,
} from "@/react-app/domains/session/sync/session-sync";
import {
  getComposerAttachments,
  getComposerDraft,
  getComposerMentions,
  getComposerPasteParts,
  getComposerQueuedDrafts,
  useComposerStateStore,
} from "./composer-state-store";
import { MessageList } from "@/components/chat/message-list";
import type { ArtifactInteractionContext } from "@/lib/artifacts";
import { NewConversationStarter, newConversationPlaceholder, type NewConversationMode, type StarterCapability } from "@/components/chat/new-conversation-starter";
import { MessageListProvider, type DispatchAction } from "@/components/chat/message-list-provider";
import { OpenTargetProvider, type OpenTargetOptions } from "@/lib/target-provider";
import type { ThreadStatus } from "@/lib/messages";
import { collectToolParts, getActiveToolLabel } from "@/lib/tool-activity";

import {
  EnvironmentVariableProvider,
  type ApplyEnvironmentChangesResult,
} from "@/react-app/domains/settings/pages/environment-variable-provider";

const EMPTY_TRANSCRIPT: UIMessage[] = [];
const IDLE_STATUS: ConversationStatus = { type: "idle" };
const DEFAULT_COMPOSER_CONTROL_TEXT = "Help me outline the next iPolloWork task.";
const SESSION_SURFACE_SELECTOR = "[data-session-surface-id]";
const STALLED_SESSION_WARNING_MS = 90_000;
const ACTIVE_SESSION_ACTIVITY_STATUSES = new Set<SessionActivityStatus>([
  "thinking",
  "responding",
  "waiting",
  "compacting",
]);

type SessionError = {
  message: string;
  kind?: "model-not-found" | "generic" | "stalled";
  /** For model-not-found: the model that failed. */
  failedModel?: { providerID: string; modelID: string };
  /** For model-not-found: suggested replacements from the backend. */
  suggestions?: Array<{ providerID: string; modelID: string }>;
};

type PendingVideoDeliveryValidation = {
  sourcePath: string;
  requirements: VideoDeliveryRequirements;
  baselineFingerprint: string | null;
  mustChange: boolean;
  recoveryAttempted: boolean;
};

type VideoDeliveryValidationOutput = {
  valid: boolean;
  issues: Array<{ code?: string; message?: string }>;
};

function videoDeliveryValidationOutput(response: unknown): VideoDeliveryValidationOutput | null {
  if (!response || typeof response !== "object") return null;
  const result = "result" in response && response.result && typeof response.result === "object"
    ? response.result
    : null;
  const output = result && "output" in result && result.output && typeof result.output === "object"
    ? result.output
    : null;
  if (!output || !("valid" in output) || typeof output.valid !== "boolean") return null;
  const issues = "issues" in output && Array.isArray(output.issues)
    ? output.issues.filter((issue): issue is { code?: string; message?: string } => Boolean(issue && typeof issue === "object"))
    : [];
  return { valid: output.valid, issues };
}

export type SessionSurfaceProps = {
  client: iPolloWorkServerClient;
  conversation: ConversationEngineConnection;
  environmentClient?: iPolloWorkServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  sessionId: string;
  engineId?: string;
  sessionTitle?: string;
  opencodeBaseUrl: string;
  ipolloworkToken: string;
  developerMode: boolean;
  modelLabel: string;
  onModelClick: () => void;
  modelPickerOpen: boolean;
  modelUnavailable?: boolean;
  selectedModel: ModelRef;
  onModelPickerOpenChange: (open: boolean) => void;
  onModelChange: (model: ModelRef) => void;
  onSendDraft: (
    draft: ComposerDraft,
    sessionId: string,
    options?: PromptDispatchOptions,
  ) => boolean | Promise<boolean>;
  onDraftChange: (draft: ComposerDraft) => void;
  supportsNativeAttachments: boolean;
  modelVariantLabel: string;
  modelVariant: string | null;
  modelBehaviorOptions?: { value: string | null; label: string }[];
  onModelVariantChange: (value: string | null) => void;
  onConfigureTokenStar?: () => void;
  selectedMode: string | null;
  onModeSelectionLockedChange?: (locked: boolean) => void;
  listModes: () => Promise<ConversationMode[]>;
  onSelectMode: (mode: string | null) => void;
  listAgents: () => Promise<ConversationAgent[]>;
  onSelectAgent: (agent: string | null) => void;
  listCommands: () => Promise<import("@/app/types").SlashCommandOption[]>;
  recentFiles: string[];
  searchFiles: (query: string) => Promise<string[]>;
  isRemoteWorkspace: boolean;
  isSandboxWorkspace: boolean;
  todos?: TodoItem[];
  activePermission?: ConversationPermission | null;
  permissionReplyBusy?: boolean;
  respondPermission?: (requestID: string, reply: "once" | "always" | "reject") => void;
  activeQuestion?: ConversationQuestion | null;
  questionReplyBusy?: boolean;
  respondQuestion?: (requestID: string, answers: string[][]) => void;
  safeStringify?: (value: unknown) => string;
  assistantWaitLabel?: string;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onConfigureModels?: (providerId?: string) => void;
  onUploadInboxFiles?: ((files: File[], options?: { notify?: boolean }) => void | Promise<unknown>) | null;
  providerConnectedCount?: number;
  onCreateSession?: (type: NewConversationMode, templateId?: string) => void;
  onMaterializeTemplate?: (templateId: string, surface: "design" | "video") => void | Promise<void>;
  /** Marks the first prompt as a video task before it reaches the agent. */
  onActivateVideoStudio?: (sessionId: string) => void;
  /** Opens the session-owned Video Studio for a generated video artifact. */
  onOpenVideoStudio?: () => void;
  /** Opens iPolloWork Schedule focused on an imported task. */
  onOpenSchedule?: (focusAt: number) => void;
  /** Opens the installed plugin's Workspace App when selected from the extension menu. */
  onOpenWorkspaceApp?: (pluginId: string) => void;
  designTemplates?: TemplateCatalogItem[];
  designTemplatesLoading?: boolean;
  designTemplateBusyId?: string | null;
  onInstallDesignTemplate?: (templateId: string) => void;
  onRequestDesignTemplates?: () => void;
  onOpenSettingsSection?: ((section: "commands" | "skills" | "mcps" | "plugins" | "providers") => void) | undefined;
  onRevertToMessage?: (messageId: string, sessionId: string) => Promise<boolean>;
  onForkAtMessage?: (messageId: string, sessionId: string, messages: UIMessage[]) => void;
  onOpenTarget?: (target: OpenTarget, options?: OpenTargetOptions, sessionId?: string) => void;
  onConversationMessagesChange?: (sessionId: string, messages: UIMessage[]) => void;
  onLoadSettled?: (sessionId: string) => void;
  templateEntryPath?: string;
  artifactFiles?: readonly string[];
  artifactContext?: ArtifactInteractionContext;
  artifactCompletionRequirement?: VideoArtifactCompletionRequirement;
  onArtifactCompletionRequirementConsumed?: () => void;
  environmentRuntimeKey?: string | null;
  onApplyEnvironmentChanges?: () => Promise<ApplyEnvironmentChangesResult>;
  composerEndAccessory?: ReactNode;
};

function messageToReadableText(message: UIMessage) {
  const header = message.role === "user" ? "You" : message.role === "assistant" ? "iPolloWork" : message.role;
  const body = message.parts
    .flatMap((part) => {
      if (part.type === "text") return [part.text];
      if (part.type === "reasoning") return [part.text];
      if (part.type === "dynamic-tool") {
        if (part.state === "output-error") return [`[tool:${part.toolName}] ${part.errorText}`];
        if (part.state === "output-available") return [`[tool:${part.toolName}] ${JSON.stringify(part.output)}`];
        return [`[tool:${part.toolName}] ${JSON.stringify(part.input)}`];
      }
      return [];
    })
    .join("\n\n");
  return `${header}\n${body}`.trim();
}

function transcriptToText(messages: UIMessage[]) {
  return messages
    .flatMap((message) => {
      const text = messageToReadableText(message);
      return text ? [text] : [];
    })
    .join("\n\n---\n\n");
}

function isSessionSurfaceMounted(sessionId: string) {
  for (const surface of document.querySelectorAll(SESSION_SURFACE_SELECTOR)) {
    if (surface.getAttribute("data-session-surface-id") === sessionId) return true;
  }
  return false;
}

function firstMountedSessionSurfaceId() {
  return document.querySelector(SESSION_SURFACE_SELECTOR)?.getAttribute("data-session-surface-id") ?? null;
}

function resolveFindOwnerSessionId() {
  const focusedRoot = document.activeElement?.closest(SESSION_SURFACE_SELECTOR);
  const focusedSessionId = focusedRoot?.getAttribute("data-session-surface-id") ?? null;
  if (focusedSessionId) return focusedSessionId;

  const lastFocusedSessionId = useSessionFindStore.getState().lastFocusedSessionId;
  if (lastFocusedSessionId && isSessionSurfaceMounted(lastFocusedSessionId)) {
    return lastFocusedSessionId;
  }

  return firstMountedSessionSurfaceId();
}

function statusLabel(snapshot: ConversationSnapshot | undefined, busy: boolean) {
  if (busy) return t("session.status_running");
  if (snapshot?.status.type === "busy") return t("session.status_running");
  if (snapshot?.status.type === "retry") return t("session.status_retrying", { message: snapshot.status.message });
  return t("session.status_ready");
}

function controlTextArgument(args: unknown) {
  if (typeof args === "string") return args;
  if (args && typeof args === "object" && "text" in args) {
    const text = (args as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  return DEFAULT_COMPOSER_CONTROL_TEXT;
}

const waitForControl = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

function useSharedQueryState<T>(queryKey: readonly unknown[], fallback: T) {
  const query = useQuery<T, Error, T, readonly unknown[]>({
    queryKey,
    queryFn: async () => fallback,
    enabled: false,
  });
  return query.data ?? fallback;
}

function messageHasVisibleAssistantOutput(message: UIMessage) {
  if (message.role !== "assistant") return false;
  return message.parts.some((part) => {
    if ("text" in part && typeof part.text === "string") return part.text.trim().length > 0;
    return part.type === "dynamic-tool" || part.type === "file";
  });
}

function AssistantWaitingCard({ label = t("session.assistant_thinking") }: { label?: string }) {
  return (
    <div className="flex justify-start" role="status" aria-live="polite">
      <div className="inline-flex items-center gap-2 px-1 py-1 text-[12px] text-dls-secondary">
        <img
          src={publicAssetUrl("ipollowork-thinking-logo-v2.gif")}
          alt=""
          aria-hidden="true"
          className="size-6 shrink-0 object-contain"
        />
        <span>{label}</span>
      </div>
    </div>
  );
}

function sessionProgressFingerprint(messages: UIMessage[]) {
  const message = messages.at(-1);
  if (!message) return "empty";
  return `${message.id}:${message.parts.map((part) => {
    if (part.type === "text" || part.type === "reasoning") return `${part.type}:${part.text.length}`;
    if (part.type === "dynamic-tool") return `${part.type}:${part.toolName}:${part.state}`;
    return part.type;
  }).join("|")}`;
}

function latestAssistantMessageCompleted(messages: UIMessage[]) {
  const latest = messages.findLast((message) => message.role === "assistant");
  if (!latest) return false;
  const metadata = latest.metadata as { ipollowork?: { completed?: unknown } } | undefined;
  return typeof metadata?.ipollowork?.completed === "number";
}

function TodoPanel(props: { todos: TodoItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const todos = props.todos.filter((todo) => todo.content.trim());
  const completedTodos = todos.filter((todo) => todo.status === "completed").length;
  const progressLabel = t("session.todo_progress_label");
  const label = expanded ? progressLabel : `${progressLabel} · ${completedTodos}/${todos.length}`;

  if (todos.length === 0) return null;

  return (
    <div className="overflow-hidden border-b border-dls-border bg-transparent">
        <button
          type="button"
          className="flex w-full items-center justify-between px-4 py-3 text-xs text-gray-9 transition-colors hover:bg-gray-2/50"
          onClick={() => setExpanded((current) => !current)}
        >
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-11">{label}</span>
          </div>
          <Minimize2 size={12} className={`text-gray-8 transition-transform ${expanded ? "" : "rotate-180"}`} />
        </button>
        {expanded ? (
          <div className="max-h-60 space-y-2.5 overflow-auto border-t border-dls-border px-4 pb-3">
            {todos.map((todo, index) => {
              const done = todo.status === "completed";
              const cancelled = todo.status === "cancelled";
              const active = todo.status === "in_progress";
              return (
                <div key={todo.id} className="flex items-start gap-2.5 pt-2.5 first:pt-2.5">
                  <div className="flex items-center gap-1.5 pt-0.5">
                    <div
                      className={`flex size-4.5 items-center justify-center rounded-full border ${
                        done
                          ? "border-green-6 bg-green-2 text-green-11"
                          : active
                            ? "border-amber-6 bg-amber-2 text-amber-11"
                            : cancelled
                              ? "border-gray-6 bg-gray-2 text-gray-8"
                              : "border-gray-6 bg-gray-1 text-gray-8"
                      }`}
                    >
                      {done ? <Check size={10} /> : active ? <span className="size-1.5 rounded-full bg-amber-9" /> : null}
                    </div>
                  </div>
                  <div className={`flex-1 text-sm leading-relaxed ${cancelled ? "text-gray-9 line-through" : "text-gray-12"}`}>
                    <span className="mr-1.5 text-gray-9">{index + 1}.</span>
                    {todo.content}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
    </div>
  );
}

function parseSessionError(thrown: unknown): SessionError {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  // Try to detect ProviderModelNotFoundError from the SDK error shape.
  // The error message may be a JSON string from our serializer in session-route.
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.name === "ProviderModelNotFoundError" && parsed?.data) {
      const { providerID, modelID, suggestions } = parsed.data;
      return {
        message: `Model ${providerID}/${modelID} is not available.`,
        kind: "model-not-found",
        failedModel: { providerID, modelID },
        suggestions: Array.isArray(suggestions) ? suggestions : [],
      };
    }
  } catch {
    // Not JSON — fall through to plain message
  }
  // Check if the raw string mentions model-not-found patterns
  if (/ProviderModelNotFoundError/i.test(raw) || /model.*not found/i.test(raw)) {
    return { message: raw, kind: "model-not-found" };
  }
  return { message: raw || "Failed to send prompt." };
}

function SessionErrorCard({ error, onDismiss, onChangeModel, onOpenModelPicker }: {
  error: SessionError;
  onDismiss: () => void;
  onChangeModel?: (model: { providerID: string; modelID: string }) => void;
  onOpenModelPicker?: () => void;
}) {
  return (
    <div className="mx-auto max-w-[800px] px-3 py-3 sm:px-5">
      <div className="rounded-2xl border border-red-6/30 bg-red-3/15 px-5 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-red-11">{error.message}</div>
            {error.kind === "model-not-found" ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {error.suggestions && error.suggestions.length > 0 ? (
                  error.suggestions.map((s) => (
                    <button
                      key={`${s.providerID}/${s.modelID}`}
                      type="button"
                      className="rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                      onClick={() => {
                        onChangeModel?.(s);
                        onDismiss();
                      }}
                    >
                      Use {s.providerID}/{s.modelID}
                    </button>
                  ))
                ) : null}
                <button
                  type="button"
                  className="rounded-full border border-dls-border bg-dls-surface px-3 py-1.5 text-xs font-medium text-dls-text transition-colors hover:bg-dls-hover"
                  onClick={() => {
                    onOpenModelPicker?.();
                    onDismiss();
                  }}
                >
                  {t("model_picker.change_model")}
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className="shrink-0 rounded-full p-1 text-red-10 transition-colors hover:bg-red-3 hover:text-red-11"
            onClick={onDismiss}
            aria-label={t("session.dismiss_error")}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function revokeAttachmentPreview(attachment: { previewUrl?: string | undefined }) {
  if (!attachment.previewUrl) return;
  URL.revokeObjectURL(attachment.previewUrl);
}

export function StarterCapabilityChip({ capability, onClear }: { capability: StarterCapability; onClear: () => void }) {
  const CapabilityIcon = capability.icon;
  const isWebsiteCapability = capability.id === "site";
  return (
    <div className="new-conversation-capability-chip inline-flex h-7 max-w-full items-center gap-1.5 rounded-[18px] border border-[#E0DDC3] bg-[#F4F4EE] px-2 py-1 text-[11px] font-normal leading-4 text-[#161E24] dark:border-[#666] dark:bg-[#343434] dark:text-[#f5f5f5]">
      {isWebsiteCapability ? (
        <span className="relative size-3.5 shrink-0">
          <img src={publicAssetUrl("quick-task-globe-selected.svg")} alt="" aria-hidden className="absolute inset-[8.33%] size-[83.34%] dark:invert" />
        </span>
      ) : (
        <CapabilityIcon className="size-3.5 shrink-0" aria-hidden />
      )}
      <span className="max-w-[13rem] truncate">{capability.label}</span>
      <button
        type="button"
        className="inline-flex size-3.5 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-[#E0DDC3] dark:hover:bg-[#666]"
        aria-label={t("new_conversation.capability.clear")}
        onClick={onClear}
      >
        <img src={publicAssetUrl("quick-task-close.svg")} alt="" aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

function AnimationChip({ animation, onClear }: { animation: HyperframesAnimationSelection; onClear: () => void }) {
  const configuredCount = Object.keys(animation.values).length;
  return (
    <div
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-6/35 bg-violet-3/20 py-1 pl-2.5 pr-1.5 text-xs font-medium text-violet-11"
      data-composer-token="animation-reference"
      title={animation.item.title}
    >
      <span className="max-w-[13rem] truncate">{animation.item.title}</span>
      {configuredCount ? <span className="rounded-full bg-violet-4 px-1.5 text-[9px] text-violet-11">{t("new_conversation.animations.customized", { count: configuredCount })}</span> : null}
      <button type="button" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-violet-10 transition-colors hover:bg-violet-4 hover:text-violet-12 active:bg-violet-5" aria-label={t("new_conversation.animations.remove", { title: animation.item.title })} onClick={onClear}>
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}

function VoiceChip({ reference, onClear }: { reference: VideoVoiceAiReference; onClear: () => void }) {
  return (
    <div className="inline-flex max-w-full items-center gap-1 rounded-full border border-violet-6/35 bg-violet-3/20 py-1 pl-2.5 pr-1.5 text-xs font-medium text-violet-11" data-composer-token="voice-reference" title={reference.label}>
      <span className="max-w-[13rem] truncate">{reference.label}</span>
      <button type="button" className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-violet-10 transition-colors hover:bg-violet-4 hover:text-violet-12 active:bg-violet-5" aria-label={`Remove voice reference: ${reference.label}`} onClick={onClear}>
        <X className="size-3" aria-hidden />
      </button>
    </div>
  );
}

const VIDEO_ANIMATION_PICKER_ENABLED = false;

function animationSelectionInstruction(animations: HyperframesAnimationSelection[]): string | null {
  if (!animations.length) return null;
  const choices = animations.map((selection) => {
    const item = selection.item;
    const reference = item.agentPrompt?.trim() || `- ${item.title} (registry: ${item.name}, category: ${item.category}): ${item.description}`;
    return `${reference}\nEffect configuration: ${JSON.stringify(hyperframesSelectionPayload(selection))}`;
  }).join("\n\n");
  return [
    hyperframesAnimationDisplayMetadata(animations),
    "Selected HyperFrames animation references:",
    choices,
    "Use /hyperframes and treat these as the user's explicit motion direction for the video.",
    "Adapt the supplied reference and variables directly through HyperFrames data-variable-values/getVariables so preview and deterministic render use the same values. The selection payload is complete: do not run package installation, registry catalog, update, or version commands.",
    "Every selected reference is a required deliverable: apply each at least once, mark its owning implementation element with data-ipw-animation-reference equal to the registry name, and include every selected registry name in the final validator's requirements.animationReferences array.",
    "Do not paste unrelated demo content or force a selection into every scene. Preserve the visual characteristics that motivated each selection while producing one coherent video.",
  ].join("\n");
}

const DEFAULT_VOICEOVER_PROMPT = "请用这段话给我视频做配音";

function voiceReferenceInstruction(reference: VideoVoiceAiReference | null) {
  if (!reference) return null;
  return [
    videoVoiceDisplayMetadata(reference),
    "Selected video voiceover reference:",
    `- Voice: ${reference.label}`,
    `- Voice ID: ${reference.voiceId}`,
    `- Model: ${reference.model}`,
    "Use the current video session's voiceover.json and the Video voiceover contract to synthesize and synchronize the narration requested by the user.",
  ].join("\n");
}

export function SessionSurface(props: SessionSurfaceProps) {
  const local = useLocal();
  const { config: shellConfig } = useShellConfig();
  const showThinking = local.prefs.showThinking;
  const findOpen = useSessionFindStore((state) => state.open);
  const findSessionId = useSessionFindStore((state) => state.sessionId);
  const findAppliedQuery = useSessionFindStore((state) => state.appliedQuery);
  const setFindLastFocused = useSessionFindStore((state) => state.setLastFocused);
  const findOwned = findOpen && findSessionId === props.sessionId;
  const findHighlightQuery = findOwned && findAppliedQuery.trim().length >= 2 ? findAppliedQuery : "";
  const sessionActivityStatus = useSessionActivityStore(
    (state) => state.statusesByWorkspaceId[props.workspaceId]?.[props.sessionId] ?? "idle",
  );
  const draft = useComposerStateStore((state) => getComposerDraft(state, props.sessionId));
  const attachments = useComposerStateStore((state) => getComposerAttachments(state, props.sessionId));
  const mentions = useComposerStateStore((state) => getComposerMentions(state, props.sessionId));
  const pasteParts = useComposerStateStore((state) => getComposerPasteParts(state, props.sessionId));
  const setComposerDraft = useComposerStateStore((state) => state.setDraft);
  const setComposerAttachments = useComposerStateStore((state) => state.setAttachments);
  const setComposerMentions = useComposerStateStore((state) => state.setMentions);
  const setComposerPasteParts = useComposerStateStore((state) => state.setPasteParts);
  const clearComposerSession = useComposerStateStore((state) => state.clearSession);
  const restoreComposerSessionIfEmpty = useComposerStateStore((state) => state.restoreSessionIfEmpty);
  // Queued follow-up drafts live in the shared composer store keyed by session
  // id. That keeps a queued message in session A from being drained into
  // session B when the route swaps the same surface component to another
  // session.
  const queuedDrafts = useComposerStateStore((state) => getComposerQueuedDrafts(state, props.sessionId));
  const appendQueuedDraft = useComposerStateStore((state) => state.appendQueuedDraft);
  const removeQueuedDraftFromStore = useComposerStateStore((state) => state.removeQueuedDraft);
  const prependQueuedDrafts = useComposerStateStore((state) => state.prependQueuedDrafts);
  const [error, setError] = useState<SessionError | null>(null);
  const [sending, setSending] = useState(false);
  const [showDelayedLoading, setShowDelayedLoading] = useState(false);
  const [awaitingAssistantBaseline, setAwaitingAssistantBaseline] = useState<number | null>(null);
  const [rendered, setRendered] = useState<{ sessionId: string; snapshot: ConversationSnapshot } | null>(null);
  const [toolSkills, setToolSkills] = useState<SkillCard[]>([]);
  const [toolMcpServers, setToolMcpServers] = useState<McpServerEntry[]>([]);
  const [toolMcpStatus, setToolMcpStatus] = useState<string | null>(null);
  const [toolMcpStatuses, setToolMcpStatuses] = useState<McpStatusMap>({});
  const [verifiedOpenTargets, setVerifiedOpenTargets] = useState<OpenTarget[]>([]);
  const [newConversationMode, setNewConversationMode] = useState<NewConversationMode>("work");
  const [starterCapability, setStarterCapability] = useState<StarterCapability | null>(null);
  const [animationCatalog, setAnimationCatalog] = useState<HyperframesCatalogItem[]>([]);
  const [animationCatalogLoading, setAnimationCatalogLoading] = useState(false);
  const [animationCatalogError, setAnimationCatalogError] = useState<string | null>(null);
  const [animationCatalogRevision, setAnimationCatalogRevision] = useState(0);
  const [selectedAnimations, setSelectedAnimations] = useState<HyperframesAnimationSelection[]>([]);
  const [selectedVoiceReference, setSelectedVoiceReference] = useState<VideoVoiceAiReference | null>(null);
  const runActivityObservedRef = useRef(false);
  const stalledAtProgressRef = useRef<string | null>(null);
  const pendingVideoDeliveryRef = useRef<PendingVideoDeliveryValidation | null>(null);
  const videoDeliveryValidationInFlightRef = useRef(false);
  const artifactCompletionRequirementKeyRef = useRef<string | null>(null);

  useEffect(() => {
    const addAnimationReference = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; item?: unknown }>).detail;
      if (detail?.sessionId !== props.sessionId || !detail.item || typeof detail.item !== "object") return;
      const item = detail.item as HyperframesCatalogItem;
      if (!item.name || !item.title || !item.agentPrompt) return;
      setSelectedAnimations((current) => [
        ...current.filter((animation) => animation.item.name !== item.name),
        { item, values: {} },
      ]);
      toast.success(t("new_conversation.animations.added_to_ai"));
    };
    window.addEventListener("ipollowork:add-animation-reference", addAnimationReference);
    return () => window.removeEventListener("ipollowork:add-animation-reference", addAnimationReference);
  }, [props.sessionId]);

  useEffect(() => {
    const requirement = props.artifactCompletionRequirement;
    if (!requirement) {
      artifactCompletionRequirementKeyRef.current = null;
      return;
    }
    const key = `${requirement.sourcePath}:${requirement.baselineFingerprint}:${requirement.assistantMessageBaseline}`;
    if (artifactCompletionRequirementKeyRef.current === key) return;
    artifactCompletionRequirementKeyRef.current = key;
    pendingVideoDeliveryRef.current = {
      sourcePath: requirement.sourcePath,
      requirements: videoDeliveryRequirementsForPrompt({}),
      baselineFingerprint: requirement.baselineFingerprint,
      mustChange: true,
      recoveryAttempted: false,
    };
    runActivityObservedRef.current = false;
    setAwaitingAssistantBaseline(requirement.assistantMessageBaseline);
    setSending(true);
  }, [props.artifactCompletionRequirement]);

  useEffect(() => {
    const addVoiceReference = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId?: unknown; reference?: unknown }>).detail;
      if (detail?.sessionId !== props.sessionId || !detail.reference || typeof detail.reference !== "object") return;
      const candidate = detail.reference as Partial<VideoVoiceAiReference>;
      if (!candidate.voiceId?.trim() || !candidate.model?.trim() || !candidate.label?.trim()) return;
      setSelectedVoiceReference({ voiceId: candidate.voiceId.trim(), model: candidate.model.trim(), label: candidate.label.trim() });
      const current = getComposerDraft(useComposerStateStore.getState(), props.sessionId).trimEnd();
      if (!current.includes(DEFAULT_VOICEOVER_PROMPT)) {
        setComposerDraft(props.sessionId, `${current}${current ? "\n" : ""}${DEFAULT_VOICEOVER_PROMPT}`);
      }
      toast.success(t("new_conversation.animations.added_to_ai"));
      window.dispatchEvent(new Event("ipollowork:focusPrompt"));
    };
    window.addEventListener("ipollowork:add-voice-reference", addVoiceReference);
    return () => window.removeEventListener("ipollowork:add-voice-reference", addVoiceReference);
  }, [props.sessionId, setComposerDraft]);
  const composerShellRef = useRef<HTMLDivElement>(null);
  const hydratedKeyRef = useRef<string | null>(null);
  const opencodeClient = useMemo(
    () => createClient(props.opencodeBaseUrl, undefined, { token: props.ipolloworkToken, mode: "ipollowork" }),
    [props.opencodeBaseUrl, props.ipolloworkToken],
  );

  const snapshotQueryKey = useMemo(
    () => reactSnapshotKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const transcriptQueryKey = useMemo(
    () => reactTranscriptKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const statusQueryKey = useMemo(
    () => reactStatusKey(props.workspaceId, props.sessionId),
    [props.workspaceId, props.sessionId],
  );
  const snapshotQuery = useQuery<ConversationSnapshot>({
    queryKey: snapshotQueryKey,
    queryFn: async () => props.conversation.mapSnapshot(
      (await props.client.getSessionSnapshot(props.workspaceId, props.sessionId, { limit: 140 })).item,
    ),
    staleTime: 500,
  });

  const currentSnapshot = snapshotQuery.data?.session.id === props.sessionId ? snapshotQuery.data : null;
  const transcriptState = useSharedQueryState<UIMessage[]>(transcriptQueryKey, EMPTY_TRANSCRIPT);
  const statusState = useSharedQueryState(statusQueryKey, currentSnapshot?.status ?? IDLE_STATUS);

  useEffect(() => {
    if (!currentSnapshot) return;
    setRendered({ sessionId: props.sessionId, snapshot: currentSnapshot });
  }, [props.sessionId, currentSnapshot]);

  useEffect(() => {
    hydratedKeyRef.current = null;
    setError(null);
    setSending(false);
    runActivityObservedRef.current = false;
    stalledAtProgressRef.current = null;
    pendingVideoDeliveryRef.current = null;
    videoDeliveryValidationInFlightRef.current = false;
    setShowDelayedLoading(false);
    setAwaitingAssistantBaseline(null);
    // Composer draft state lives in the shared store keyed by session id, so
    // switching sessions preserves each session's own in-progress composer.
    setVerifiedOpenTargets([]);
    setNewConversationMode("work");
    setStarterCapability(null);
    setSelectedAnimations([]);
    setAnimationCatalogError(null);
  }, [props.sessionId]);

  useEffect(() => {
    if (!VIDEO_ANIMATION_PICKER_ENABLED || newConversationMode !== "video" || animationCatalog.length) return;
    let cancelled = false;
    setAnimationCatalogLoading(true);
    setAnimationCatalogError(null);
    void props.client.listHyperframesCatalog(props.workspaceId)
      .then(({ items }) => {
        if (cancelled) return;
        setAnimationCatalog(items);
        if (!items.length) setAnimationCatalogError("empty_catalog");
      })
      .catch((error) => {
        if (cancelled) return;
        setAnimationCatalog([]);
        setAnimationCatalogError(error instanceof Error ? error.message : "catalog_unavailable");
      })
      .finally(() => { if (!cancelled) setAnimationCatalogLoading(false); });
    return () => { cancelled = true; };
  }, [animationCatalog.length, animationCatalogRevision, newConversationMode, props.client, props.workspaceId]);

  // Publish a composer inspector slice so external drivers can read draft
  // state, attachments, mentions, and sending status from the running app.
  useEffect(() => {
    const dispose = publishInspectorSlice("composer", () => ({
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
      draft,
      draftLength: draft.length,
      attachments: attachments.map((attachment) => ({
        id: attachment.id,
        name: attachment.name,
        mimeType: attachment.mimeType,
        size: attachment.size,
        kind: attachment.kind,
      })),
      mentions,
      pasteParts: pasteParts.map((part) => ({
        id: part.id,
        label: part.label,
        lines: part.lines,
      })),
      sending,
      error,
    }));
    return dispose;
  }, [
    attachments,
    draft,
    error,
    mentions,
    pasteParts,
    props.sessionId,
    props.workspaceId,
    sending,
  ]);

  useEffect(() => {
    recordInspectorEvent("session.mounted", {
      workspaceId: props.workspaceId,
      sessionId: props.sessionId,
    });
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [currentSnapshot, props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (!currentSnapshot) return;
    const key = `${props.sessionId}:${currentSnapshot.session.time?.updated ?? currentSnapshot.session.time?.created ?? 0}:${currentSnapshot.messages.length}`;
    if (hydratedKeyRef.current === key) return;
    hydratedKeyRef.current = key;
    seedSessionState(props.workspaceId, currentSnapshot);
  }, [props.sessionId, currentSnapshot, props.workspaceId]);

  const snapshot = resolveRenderedSessionSnapshot({
    sessionId: props.sessionId,
    currentSnapshot,
    cachedRendered: rendered,
  });
  const modeState = snapshot ? props.conversation.modeState?.(snapshot.session) : undefined;
  const modeSelectionLocked = modeState?.mutable === false;
  const selectedMode = modeSelectionLocked ? modeState.id ?? props.selectedMode : props.selectedMode;
  useEffect(() => {
    props.onModeSelectionLockedChange?.(modeSelectionLocked);
  }, [modeSelectionLocked, props.onModeSelectionLockedChange]);
  useEffect(() => () => {
    props.onModeSelectionLockedChange?.(false);
  }, [props.onModeSelectionLockedChange]);
  const liveStatus = statusState ?? snapshot?.status ?? IDLE_STATUS;
  const activityRunActive = ACTIVE_SESSION_ACTIVITY_STATUSES.has(sessionActivityStatus);
  const chatStreaming = sending || liveStatus.type === "busy" || liveStatus.type === "retry" || activityRunActive;
  const status = useMemo((): ThreadStatus => {
    if (sending) {
      return "submitted";
    }

    if (liveStatus.type === "retry") {
      return "retrying";
    }

    if (liveStatus.type === "busy" || activityRunActive) {
      return "streaming";
    }

    return "ready";
  }, [activityRunActive, liveStatus, sending]);
  const renderedMessages = useMemo(
    () => deriveRenderedSessionMessages({ transcriptState, snapshot }),
    [snapshot, transcriptState],
  );
  const inputHistory = useMemo(
    () => deriveComposerInputHistory(renderedMessages),
    [renderedMessages],
  );
  const progressFingerprint = useMemo(
    () => sessionProgressFingerprint(renderedMessages),
    [renderedMessages],
  );
  const latestAssistantCompleted = useMemo(
    () => latestAssistantMessageCompleted(renderedMessages),
    [renderedMessages],
  );
  const activeToolLabel = useMemo(
    () => getActiveToolLabel(collectToolParts(renderedMessages)),
    [renderedMessages],
  );
  useEffect(() => {
    if (stalledAtProgressRef.current && stalledAtProgressRef.current !== progressFingerprint) {
      stalledAtProgressRef.current = null;
      setError((current) => current?.kind === "stalled" ? null : current);
    }
    if (!chatStreaming || activeToolLabel) return;
    const timeout = window.setTimeout(() => {
      stalledAtProgressRef.current = progressFingerprint;
      setError((current) => current ?? {
        kind: "stalled",
        message: t("session.run_stalled"),
      });
    }, STALLED_SESSION_WARNING_MS);
    return () => window.clearTimeout(timeout);
  }, [activeToolLabel, chatStreaming, progressFingerprint]);
  useEffect(() => {
    props.onConversationMessagesChange?.(props.sessionId, renderedMessages);
  }, [props.onConversationMessagesChange, props.sessionId, renderedMessages]);
  const openTargets = useMemo(
    () => deriveOpenTargets(renderedMessages, {
      supplementalFiles: props.artifactFiles ?? (props.templateEntryPath ? [props.templateEntryPath] : undefined),
    }),
    [props.artifactFiles, props.templateEntryPath, renderedMessages],
  );
  const openTargetsFingerprint = useMemo(
    () => openTargets.map((target) => `${target.kind}:${target.value}:${target.confidence}`).join("|"),
    [openTargets],
  );
  const pendingSessionLoad = !snapshot && snapshotQuery.isLoading && renderedMessages.length === 0;
  useEffect(() => {
    if (snapshotQuery.isLoading) return;
    props.onLoadSettled?.(props.sessionId);
  }, [props.onLoadSettled, props.sessionId, snapshotQuery.isLoading]);
  const isEmptyConversation = renderedMessages.length === 0
    && !chatStreaming
    && !pendingSessionLoad
    && !error
    && !snapshotQuery.isError;
  const assistantOutputAfterAwaitStart = useMemo(() => {
    if (awaitingAssistantBaseline === null) return false;
    return renderedMessages
      .slice(awaitingAssistantBaseline)
      .some(messageHasVisibleAssistantOutput);
  }, [awaitingAssistantBaseline, renderedMessages]);
  const showAssistantWaitState = awaitingAssistantBaseline !== null && !assistantOutputAfterAwaitStart;
  const showAssistantRespondingState = awaitingAssistantBaseline !== null && assistantOutputAfterAwaitStart && chatStreaming;
  const effectiveActivityStatus: SessionActivityStatus = sessionActivityStatus !== "idle"
    ? sessionActivityStatus
    : showAssistantWaitState
      ? "thinking"
      : showAssistantRespondingState
        ? "responding"
        : "idle";
  useReactRenderWatchdog("SessionSurface", {
    sessionId: props.sessionId,
    workspaceId: props.workspaceId,
    messageCount: renderedMessages.length,
    liveStatus: liveStatus.type,
    sending,
    pendingSessionLoad,
    showAssistantWaitState,
    showAssistantRespondingState,
    hasSnapshot: Boolean(snapshot),
  });

  useEffect(() => {
    let cancelled = false;
    async function verifyTargets() {
      if (!openTargets.length) {
        setVerifiedOpenTargets([]);
        return;
      }
      try {
        const response = await props.client.resolveArtifacts(props.workspaceId, openTargets);
        if (!cancelled) {
          const nextTargets = response.items as OpenTarget[];
          setVerifiedOpenTargets(nextTargets);
        }
      } catch {
        if (!cancelled) {
          const nextTargets = openTargets.map((target) => ({ ...target, exists: target.kind === "url" }));
          setVerifiedOpenTargets(nextTargets);
        }
      }
    }
    void verifyTargets();
    return () => { cancelled = true; };
  }, [openTargetsFingerprint, props.client, props.sessionId, props.workspaceId]);

  useEffect(() => {
    usePanelTabStore.getState().syncTranscriptArtifacts(props.sessionId, verifiedOpenTargets);
  }, [props.sessionId, verifiedOpenTargets]);

  useEffect(() => {
    if (!pendingSessionLoad) {
      setShowDelayedLoading(false);
      return;
    }
    const id = window.setTimeout(() => setShowDelayedLoading(true), 2000);
    return () => window.clearTimeout(id);
  }, [pendingSessionLoad]);

  useEffect(() => {
    if (awaitingAssistantBaseline === null) return;
    if (assistantOutputAfterAwaitStart) {
      return;
    }
    if (sending || liveStatus.type !== "idle" || renderedMessages.length <= awaitingAssistantBaseline) return;
    const id = window.setTimeout(() => {
      setAwaitingAssistantBaseline(null);
    }, 1200);
    return () => window.clearTimeout(id);
  }, [assistantOutputAfterAwaitStart, awaitingAssistantBaseline, liveStatus.type, renderedMessages.length, sending]);

  const model = deriveSessionRenderModel({
    intendedSessionId: props.sessionId,
    renderedSessionId: renderedMessages.length > 0 || snapshot ? props.sessionId : null,
    hasSnapshot: Boolean(snapshot) || renderedMessages.length > 0,
    isFetching: snapshotQuery.isFetching,
    isError: snapshotQuery.isError || Boolean(error),
  });

  const buildDraft = useCallback((text: string, nextAttachments: ComposerAttachment[]): ComposerDraft => {
    const parts = parseComposerParts(text, {
      mentions,
      pasteParts,
      designSelectionLabel: (contextId) => (
        useDesignAiSelectionStore.getState().contexts[contextId]?.target.label
      ),
    });
    // Expand paste placeholders in resolvedText so the model receives
    // the actual pasted content instead of "[pasted text <label>]".
    let resolved = text;
    for (const part of pasteParts) {
      resolved = resolved.replace(`[pasted text ${part.label}]`, part.text);
    }
    resolved = resolved.replace(/\[skill ([^\]]+)\]/g, (_match, name: string) => `the \"${name}\" skill`);
    for (const value of Object.keys(mentions)) {
      resolved = resolved.replaceAll(`@${encodeComposerMentionValue(value)}`, `@${value}`);
    }
    const slashCommand = parseSlashCommandInvocation(resolved);
    const animationInstruction = animationSelectionInstruction(selectedAnimations);
    const voiceInstruction = voiceReferenceInstruction(selectedVoiceReference);
    const capabilityInstruction = [starterCapability?.instruction, animationInstruction, voiceInstruction]
      .filter((value): value is string => Boolean(value))
      .join("\n\n");
    return {
      mode: "prompt",
      parts,
      attachments: nextAttachments,
      text,
      resolvedText: resolved,
      capability: capabilityInstruction
        ? { id: selectedAnimations.length ? "hyperframes-animation-selection" : selectedVoiceReference ? "video-voice-reference" : starterCapability!.id, instruction: capabilityInstruction }
        : undefined,
      command: slashCommand ?? undefined,
    };
  }, [mentions, pasteParts, selectedAnimations, selectedVoiceReference, starterCapability]);

  const handleComposerDraftChange = useCallback((value: string) => {
    setComposerDraft(props.sessionId, value);
  }, [props.sessionId, setComposerDraft]);

  const handleCopyTranscript = async () => {
    try {
      await navigator.clipboard.writeText(transcriptToText(renderedMessages));
    } catch (nextError) {
      setError({ message: nextError instanceof Error ? nextError.message : "Failed to copy transcript." });
    }
  };

  // Core sender used only while the session is idle. Busy follow-ups remain
  // in the local queue until the current run has completed.
  const sendDraft = useCallback(async (nextDraft: ComposerDraft, draftAttachments: ComposerAttachment[]) => {
    setError(null);
    runActivityObservedRef.current = false;
    setSending(true);
    setAwaitingAssistantBaseline(renderedMessages.length);
    const recoveryDraft = nextDraft.capability?.instruction.includes("authoritative delivery validation") === true;
    const clientUserMessageId = !recoveryDraft
      ? beginOptimisticSessionPrompt(props.workspaceId, props.sessionId, nextDraft.text)
      : null;
    const templateEntryPath = props.templateEntryPath?.replace(/\\/g, "/") ?? "";
    const videoTask = newConversationMode === "video"
      || props.artifactContext?.kind === "video"
      || /^video\/[^/]+\/index\.html$/i.test(templateEntryPath);
    let pendingDelivery: PendingVideoDeliveryValidation | null = null;
    try {
      if (videoTask && !recoveryDraft) {
        const requirements = videoDeliveryRequirementsForPrompt({
          capabilityId: nextDraft.capability?.id,
          promptText: nextDraft.resolvedText ?? nextDraft.text,
          animationReferences: selectedAnimations.map((selection) => selection.item.name),
        });
        const mustChange = false;
        if (hasVideoDeliveryRequirements(requirements)) {
          const sourcePath = props.artifactContext?.kind === "video"
            ? props.artifactContext.entryPath
            : templateEntryPath || videoProjectEntryPath(props.sessionId);
          pendingDelivery = {
            sourcePath,
            requirements,
            baselineFingerprint: null,
            mustChange,
            recoveryAttempted: false,
          };
          pendingVideoDeliveryRef.current = pendingDelivery;
        }
      }
      const dispatched = await props.onSendDraft(
        nextDraft,
        props.sessionId,
        clientUserMessageId ? { clientUserMessageId } : undefined,
      );
      if (selectedAnimations.length) {
        recordInspectorEvent("composer.hyperframes_sent", {
          workspaceId: props.workspaceId,
          sessionId: props.sessionId,
          selections: selectedAnimations.map(hyperframesSelectionPayload),
        });
      }
      draftAttachments.forEach(revokeAttachmentPreview);
      setStarterCapability(null);
      setSelectedAnimations([]);
      setSelectedVoiceReference(null);
      // promptAsync resolves once the run is accepted, before generation
      // finishes. Keep the optimistic busy latch until the session's idle
      // event; only release immediately when the route did not dispatch.
      if (!dispatched) {
        rollbackOptimisticSessionPrompt(props.workspaceId, props.sessionId, clientUserMessageId);
        setAwaitingAssistantBaseline(null);
        runActivityObservedRef.current = false;
        setSending(false);
      }
    } catch (nextError) {
      rollbackOptimisticSessionPrompt(props.workspaceId, props.sessionId, clientUserMessageId);
      if (pendingVideoDeliveryRef.current === pendingDelivery) pendingVideoDeliveryRef.current = null;
      const parsed = parseSessionError(nextError);
      captureAnalyticsEvent("task_send_failed", {});
      setError(parsed);
      useSessionActivityStore.getState().setError(props.workspaceId, props.sessionId, parsed.message);
      if (!shouldPreserveComposerDraftAfterSendFailure(nextDraft)) {
        draftAttachments.forEach(revokeAttachmentPreview);
      }
      setAwaitingAssistantBaseline(null);
      runActivityObservedRef.current = false;
      setSending(false);
      throw nextError;
    }
  }, [newConversationMode, props.artifactContext, props.engineId, props.onSendDraft, props.sessionId, props.templateEntryPath, props.workspaceId, renderedMessages.length, selectedAnimations]);

  const validatePendingVideoDelivery = useCallback(async () => {
    const pending = pendingVideoDeliveryRef.current;
    if (!pending || videoDeliveryValidationInFlightRef.current) return;
    videoDeliveryValidationInFlightRef.current = true;
    try {
      const currentContent = pending.mustChange
        ? (await props.client.readWorkspaceFile(props.workspaceId, pending.sourcePath)).content
        : "";
      if (pendingVideoDeliveryRef.current !== pending) return;
      const mutationIssue = pending.mustChange
        ? unchangedVideoArtifactIssue(pending.baselineFingerprint, currentContent)
        : null;
      let issues: VideoDeliveryValidationOutput["issues"] = mutationIssue ? [mutationIssue] : [];
      if (!mutationIssue) {
        const response = await props.client.callExtensionAction({
          extensionId: "media",
          action: "voiceover_timeline_validate",
          args: {
            sourcePath: pending.sourcePath,
            requirements: {
              ...pending.requirements,
              ...(pending.requirements.captions ? { captionStyle: "transparent-bottom" } : {}),
            },
          },
          context: { directory: props.workspaceRoot || undefined },
        });
        if (pendingVideoDeliveryRef.current !== pending) return;
        if (!response.ok) throw new Error(response.message);
        const output = videoDeliveryValidationOutput(response);
        if (!output) throw new Error("Video delivery validation returned an unreadable result.");
        issues = output.issues;
        if (output.valid) {
          pendingVideoDeliveryRef.current = null;
          props.onArtifactCompletionRequirementConsumed?.();
          setSending(false);
          toast.success(t("session.video_delivery_validated"));
          return;
        }
      }
      const issueMessages = issues
        .map((issue) => [issue.code, issue.message].filter(Boolean).join(": "))
        .filter(Boolean);
      if (!pending.recoveryAttempted) {
        pending.recoveryAttempted = true;
        toast.warning(t("session.video_delivery_repairing"));
        const recoveryInstruction = [
          "The preceding video run ended without satisfying the application's authoritative delivery validation.",
          `Continue editing only ${pending.sourcePath} now. Do not merely plan, summarize, or explain.`,
          `Required deliverables: ${JSON.stringify(pending.requirements)}.`,
          "Fix every issue below in one complete pass. For narration, use the saved voiceover.json and the built-in media workspace batch synthesis action; patch the returned audio, captions, scene timing, and root duration into index.html.",
          "Run media/voiceover_timeline_validate with the exact same requirements after the edit, and finish only when it returns valid.",
          ...issueMessages.map((issue) => `- ${issue}`),
        ].join("\n");
        await sendDraft({
          mode: "prompt",
          parts: [{ type: "text", text: recoveryInstruction, synthetic: true }],
          attachments: [],
          text: "Continue the unfinished video delivery.",
          resolvedText: "Continue the unfinished video delivery.",
          capability: { id: pending.requirements.voiceover ? "video-voice-reference" : "video-delivery-recovery", instruction: recoveryInstruction },
        }, []);
        return;
      }

      setError({
        kind: "generic",
        message: `${t("session.video_delivery_failed")} ${issueMessages.slice(0, 3).join(" ")}`.trim(),
      });
      setSending(false);
    } catch (validationError) {
      if (pendingVideoDeliveryRef.current === pending) {
        setError({
          kind: "generic",
          message: validationError instanceof Error ? validationError.message : t("session.video_delivery_failed"),
        });
      }
      setSending(false);
    } finally {
      videoDeliveryValidationInFlightRef.current = false;
    }
  }, [props.client, props.onArtifactCompletionRequirementConsumed, props.workspaceId, props.workspaceRoot, sendDraft]);

  const clearComposer = useCallback(() => {
    clearComposerSession(props.sessionId);
    props.onDraftChange(buildDraft("", []));
  }, [buildDraft, clearComposerSession, props.onDraftChange, props.sessionId]);

  // Initial send (agent idle) and explicit "Steer" follow-up (agent busy)
  // share the same immediate path.
  const handleSend = useCallback(async (draftOverride?: string) => {
    const text = (draftOverride ?? draft).trim();
    if (!text && attachments.length === 0 && selectedAnimations.length === 0 && !selectedVoiceReference) return;
    // A user can select Video and type directly into the centred first-prompt
    // composer. Mark it before the request is sent so SessionPage opens the
    // session-owned Studio while the agent is creating the composition.
    if (isEmptyConversation && newConversationMode === "video") {
      props.onActivateVideoStudio?.(props.sessionId);
    }
    const nextDraft = buildDraft(text, attachments);
    const sentAttachments = attachments;
    const submittedComposerState = { draft, attachments, mentions, pasteParts };
    clearComposer();
    try {
      await sendDraft(nextDraft, sentAttachments);
    } catch {
      if (shouldPreserveComposerDraftAfterSendFailure(nextDraft)) {
        restoreComposerSessionIfEmpty(props.sessionId, submittedComposerState);
      }
    }
  }, [attachments, buildDraft, clearComposer, draft, isEmptyConversation, mentions, newConversationMode, pasteParts, props.onActivateVideoStudio, props.sessionId, restoreComposerSessionIfEmpty, selectedAnimations.length, selectedVoiceReference, sendDraft]);

  // Queue: hold the draft locally and clear the composer. The drain effect
  // sends it once the session reports idle.
  const handleQueue = useCallback(() => {
    const text = draft.trim();
    if (!text && attachments.length === 0 && selectedAnimations.length === 0 && !selectedVoiceReference) return;
    appendQueuedDraft(props.sessionId, buildDraft(text, attachments));
    clearComposer();
    setStarterCapability(null);
    setSelectedAnimations([]);
    setSelectedVoiceReference(null);
  }, [appendQueuedDraft, attachments, buildDraft, clearComposer, draft, props.sessionId, selectedAnimations.length, selectedVoiceReference]);

  const removeQueuedDraft = useCallback((index: number) => {
    removeQueuedDraftFromStore(props.sessionId, index);
  }, [props.sessionId, removeQueuedDraftFromStore]);
  const removeQueuedDrafts = useComposerStateStore((state) => state.removeQueuedDrafts);
  const removeManyQueuedDrafts = useCallback((indices: number[]) => {
    removeQueuedDrafts(props.sessionId, indices);
  }, [props.sessionId, removeQueuedDrafts]);

  // One label per queued draft, kept index-aligned with `queuedDrafts` so the
  // panel's remove action targets the correct entry. Attachment-only drafts
  // (no text) fall back to a count label instead of being dropped.
  const queuedMessages = useMemo(
    () =>
      queuedDrafts.map((draftItem) => {
        const text = draftItem.text.trim();
        if (text) return text;
        return t("composer.queued_attachments_only", { count: draftItem.attachments.length });
      }),
    [queuedDrafts],
  );
  const hasOpenTodos = (props.todos ?? []).some((todo) => todo.content.trim());
  const composerHasPromptContext = selectedAnimations.length > 0
    || Boolean(selectedVoiceReference);
  const composerTopAccessoryVisible = Boolean(
    starterCapability
      || selectedAnimations.length
      || selectedVoiceReference
      || props.activeQuestion
      || hasOpenTodos
      || props.activePermission
      || queuedMessages.length > 0,
  );

  const handleAbort = useCallback(async () => {
    if (!chatStreaming) return;
    setError(null);
    // Abort only the active run. Queued follow-ups stay intact and the drain
    // effect below starts the next one after the session reports idle.
    // The prompt was sent through a directory-scoped client (session-route
    // passes the workspace root), so the abort must target the same scope —
    // without it the server resolves the default project, finds no live run,
    // and answers `200: false` while the stream keeps going (#2014).
    let aborted = false;
    try {
      aborted = await props.conversation.abort(
        props.sessionId,
        props.workspaceRoot.trim() || undefined,
      );
    } catch {}
    if (!aborted) {
      setError({ message: t("session.stop_failed") });
      return;
    }
    captureAnalyticsEvent("task_run_stopped", {});
    await snapshotQuery.refetch();
  }, [chatStreaming, props.conversation, props.sessionId, props.workspaceRoot, snapshotQuery.refetch]);

  const handleDismissError = useCallback(() => {
    setError(null);
    useSessionActivityStore.getState().clearError(props.workspaceId, props.sessionId);
  }, [props.sessionId, props.workspaceId]);

  useEffect(() => {
    if (liveStatus.type === "busy" || liveStatus.type === "retry" || activityRunActive) {
      runActivityObservedRef.current = true;
      return;
    }
    if (!sending || liveStatus.type !== "idle") return;
    // Ignore an idle snapshot left over from before promptAsync accepted this
    // request. Release the optimistic latch only after this run was observed,
    // or after new assistant output proves it actually ran.
    if (!runActivityObservedRef.current && !assistantOutputAfterAwaitStart) return;
    // OpenCode can emit idle just before the final message.updated event.
    // Give that completion metadata a short reconciliation window; if it
    // never arrives, surface the interrupted run instead of showing Ready as
    // though a reasoning-only/tool-only turn were a finished task.
    const timeout = window.setTimeout(() => {
      runActivityObservedRef.current = false;
      if (assistantOutputAfterAwaitStart && !latestAssistantCompleted) {
        setSending(false);
        setError((current) => current ?? {
          kind: "stalled",
          message: t("session.run_ended_incomplete"),
        });
      } else if (latestAssistantCompleted) {
        if (pendingVideoDeliveryRef.current) void validatePendingVideoDelivery();
        else setSending(false);
      } else {
        setSending(false);
      }
    }, 1_200);
    return () => window.clearTimeout(timeout);
  }, [activityRunActive, assistantOutputAfterAwaitStart, latestAssistantCompleted, liveStatus.type, sending, validatePendingVideoDelivery]);

  // Drain one queued follow-up each time the session goes idle. The ref guards
  // against re-entrancy while the send is in flight.
  const drainingQueueRef = useRef(false);
  useEffect(() => {
    if (drainingQueueRef.current) return;
    if (queuedDrafts.length === 0) return;
    if (chatStreaming || liveStatus.type !== "idle") return;
    const next = queuedDrafts[0];
    if (!next) return;
    drainingQueueRef.current = true;
    removeQueuedDraftFromStore(props.sessionId, 0);
    void (async () => {
      try {
        await sendDraft(next, next.attachments);
      } catch {
        if (failedDraftRetrySurface(next) === "composer") {
          setComposerDraft(props.sessionId, next.text);
        } else {
          // Restore ordinary queued drafts so the user can retry / edit them.
          prependQueuedDrafts(props.sessionId, [next]);
        }
      } finally {
        drainingQueueRef.current = false;
      }
    })();
  }, [chatStreaming, liveStatus.type, prependQueuedDrafts, props.sessionId, queuedDrafts, removeQueuedDraftFromStore, sendDraft]);

  useEffect(() => {
    props.onDraftChange(buildDraft(draft, attachments));
  }, [attachments, buildDraft, draft, props.onDraftChange]);

  const handleAttachFiles = (files: File[]) => {
    const oversized = files.filter((file) => file.size > 25 * 1024 * 1024);
    const sized = files.filter((file) => file.size <= 25 * 1024 * 1024);
    if (oversized.length) {
      toast.warning(
        oversized.length === 1 ? `${oversized[0]?.name ?? "File"} is too large` : `${oversized.length} files are too large`,
        { description: "Files over 25 MB were skipped." },
      );
    }
    const unreadable = sized.filter((file) => !isModelReadableAttachment(file.type));
    const readable = sized.filter((file) => isModelReadableAttachment(file.type));
    const unsupportedNative = props.supportsNativeAttachments
      ? []
      : readable.filter((file) => attachmentRequiresNativeModelSupport(file.type));
    const accepted = readable.filter((file) => (
      props.supportsNativeAttachments || !attachmentRequiresNativeModelSupport(file.type)
    ));
    if (unreadable.length) {
      toast.warning(
        unreadable.length === 1
          ? `${unreadable[0]?.name ?? "File"} has a format the model can't read`
          : `${unreadable.length} files have formats the model can't read`,
        { description: "Convert to PDF, image, or plain text and attach again." },
      );
    }
    if (unsupportedNative.length) {
      toast.warning(t("composer.attachments_require_multimodal"));
    }
    if (!accepted.length) return;
    const next = accepted.map((file) => ({
      id: `${file.name}-${file.lastModified}-${Math.random().toString(36).slice(2)}`,
      name: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size,
      kind: file.type.startsWith("image/") ? "image" as const : "file" as const,
      file,
      previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setComposerAttachments(props.sessionId, [...attachments, ...next]);
  };

  const handleRemoveAttachment = (id: string) => {
    const target = attachments.find((item) => item.id === id);
    if (target?.previewUrl) {
      URL.revokeObjectURL(target.previewUrl);
    }
    setComposerAttachments(props.sessionId, attachments.filter((item) => item.id !== id));
  };

  const handleInsertMention = (kind: ComposerMentionKind, value: string) => {
    // @agent mentions switch the session agent instead of inserting an agent
    // part. Agent parts are treated as *subagent* (task tool) calls by the
    // engine, which silently fails for primary agents and left every reply
    // coming from the default agent (#2101).
    if (kind === "agent") {
      setComposerDraft(props.sessionId, draft.replace(/@([^\s@]*)$/, ""));
      props.onSelectAgent(value);
      toast.success(t("composer.agent_selected", { agent: value }));
      return;
    }
    setComposerDraft(props.sessionId, draft.replace(/@([^\s@]*)$/, `@${encodeComposerMentionValue(value)} `));
    setComposerMentions(props.sessionId, { ...mentions, [value]: kind });
    // Pre-flight Computer Use permissions when an app is mentioned so missing
    // Accessibility / Screen Recording grants surface before send, not as a
    // mid-task failure. Only ever runs on macOS desktop (apps aren't offered
    // elsewhere); errors are silently ignored.
    if (kind === "app") {
      void (async () => {
        try {
          const status = (await desktopBridge.checkComputerUsePermissions()) as { ok?: boolean };
          if (status.ok === true) return;
          toast.warning(t("composer.computer_use_permissions_missing", { app: value }), {
            action: {
              label: t("composer.computer_use_permissions_setup"),
              onClick: () => void desktopBridge.openComputerUsePermissionSetup(),
            },
          });
        } catch {
          // Desktop bridge unavailable — nothing to pre-flight.
        }
      })();
    }
  };

  const handlePasteText = (text: string) => {
    const id = `paste-${Math.random().toString(36).slice(2)}`;
    const label = `${id.slice(-4)} · ${text.split(/\r?\n/).length} lines`;
    setComposerPasteParts(props.sessionId, [...pasteParts, { id, label, text, lines: text.split(/\r?\n/).length }]);
    setComposerDraft(props.sessionId, `${draft}[pasted text ${label}]`);
  };

  const handleExpandPastedText = (id: string) => {
    const part = pasteParts.find((item) => item.id === id);
    if (!part) return;
    setComposerDraft(props.sessionId, draft.replace(`[pasted text ${part.label}]`, part.text));
    setComposerPasteParts(props.sessionId, pasteParts.filter((item) => item.id !== id));
  };

  const handleRemovePastedText = (id: string) => {
    const target = pasteParts.find((item) => item.id === id);
    if (!target) return;
    setComposerDraft(props.sessionId, draft.replace(`[pasted text ${target.label}]`, ""));
    setComposerPasteParts(props.sessionId, pasteParts.filter((item) => item.id !== id));
  };

  const handleUnsupportedFileLinks = (links: string[]) => {
    if (!links.length) return;
    setComposerDraft(props.sessionId, `${draft}${draft && !draft.endsWith("\n") ? "\n" : ""}${links.join("\n")}`);
  };

  const typeComposerText = useCallback(async (text: string) => {
    window.dispatchEvent(new Event("ipollowork:focusPrompt"));
    setComposerDraft(props.sessionId, text);
    await waitForControl(40);
  }, [props.sessionId, setComposerDraft]);

  useEffect(() => {
    const handleVoiceTranscript = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const detail: unknown = event.detail;
      if (!detail || typeof detail !== "object" || Array.isArray(detail) || !("text" in detail) || typeof detail.text !== "string") return;
      const text = detail.text;
      void typeComposerText(text);
      props.onDraftChange(buildDraft(text, attachments));
      recordInspectorEvent("voice.transcript.applied", {
        workspaceId: props.workspaceId,
        sessionId: props.sessionId,
        length: text.length,
      });
    };
    window.addEventListener("ipollowork:voice-transcript", handleVoiceTranscript);
    return () => window.removeEventListener("ipollowork:voice-transcript", handleVoiceTranscript);
  }, [attachments, buildDraft, props.onDraftChange, props.sessionId, props.workspaceId, typeComposerText]);

  const composerSetTextControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "composer.set_text",
    label: "Type into the composer",
    description: "Replace the current session draft and type the supplied text visibly.",
    sideEffect: "none",
    requiresArgs: true,
    args: [{ name: "text", type: "string", required: true, description: "Prompt text to place in the composer." }],
    previewArgs: { text: DEFAULT_COMPOSER_CONTROL_TEXT },
    targetRef: composerShellRef,
    execute: async (args, helpers) => {
      const text = controlTextArgument(args);
      helpers.setNarration(`Typing ${text.length.toLocaleString()} characters into the composer…`);
      await typeComposerText(text);
      props.onDraftChange(buildDraft(text, attachments));
      return { draftLength: text.length };
    },
  }), [attachments, buildDraft, props.onDraftChange, typeComposerText]);
  useControlAction(composerSetTextControlAction);

  const composerSendControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "composer.send",
    label: "Send the composer prompt",
    description: "Send the currently visible composer draft to the active session.",
    sideEffect: "mutation",
    disabled: props.modelUnavailable || (!draft.trim() && attachments.length === 0 && selectedAnimations.length === 0 && !selectedVoiceReference) || model.transitionState !== "idle",
    targetRef: composerShellRef,
    execute: async () => {
      const liveDraft = getComposerDraft(useComposerStateStore.getState(), props.sessionId);
      await handleSend(liveDraft);
      return true;
    },
  }), [attachments.length, draft, handleSend, model.transitionState, props.modelUnavailable, props.sessionId, selectedAnimations.length, selectedVoiceReference]);
  useControlAction(composerSendControlAction);

  const composerStopControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "composer.stop",
    label: "Stop the current run",
    description: "Stop the current streaming session run.",
    sideEffect: "mutation",
    disabled: !chatStreaming,
    targetRef: composerShellRef,
    execute: async () => {
      await handleAbort();
      return true;
    },
  }), [chatStreaming, handleAbort]);
  useControlAction(composerStopControlAction);

  const listSkills = async (): Promise<SkillCard[]> => {
    const response = await props.client.listSkills(props.workspaceId, { includeGlobal: true });
    const next = (response.items ?? []).map((skill) => ({
      name: skill.name,
      path: skill.path,
      description: skill.description,
      trigger: skill.trigger,
    } satisfies SkillCard));
    setToolSkills(next);
    return next;
  };

  const listMcp = async (): Promise<{ servers: McpServerEntry[]; statuses: McpStatusMap; status: string | null }> => {
    const response = await props.client.listMcp(props.workspaceId);
    const servers = (response.items ?? []).map((entry) => ({
      name: entry.name,
      config: entry.config as McpServerEntry["config"],
    } satisfies McpServerEntry));

    let statuses: McpStatusMap = {};
    try {
      if (props.workspaceRoot.trim()) {
        statuses = unwrap(await opencodeClient.mcp.status({ directory: props.workspaceRoot.trim() })) as McpStatusMap;
      }
    } catch {
      statuses = {};
    }

    const status = servers.length ? null : "No MCP servers loaded.";
    setToolMcpServers(servers);
    setToolMcpStatuses(statuses);
    setToolMcpStatus(status);

    return { servers, statuses, status };
  };

  const listInstalledExtensions = async (): Promise<iPolloWorkPluginPackageItem[]> => {
    const [packageResponse, mcpState] = await Promise.all([
      props.client.listPluginPackages(props.workspaceId),
      listMcp(),
    ]);
    const enabledItems = packageResponse.items.filter((item) => item.enabled);
    const authorizationEntries = await Promise.all(enabledItems.map(async (item) => {
      if (!(item.manifest.authorization?.methods?.length ?? 0)) {
        return [item.pluginId, undefined] as const;
      }
      try {
        const state = await props.client.getPluginAuthorization(props.workspaceId, item.pluginId);
        return [item.pluginId, state] as const;
      } catch {
        return [item.pluginId, undefined] as const;
      }
    }));
    const authorizations = new Map(authorizationEntries);

    return enabledItems
      .filter((item) => isPluginPackageReady(item, authorizations.get(item.pluginId), mcpState.statuses))
      .sort((left, right) => left.name.localeCompare(right.name));
  };
  const listExternalAgents = async (): Promise<iPolloWorkPluginPackageItem[]> => {
    const response = await props.client.listPluginPackages(props.workspaceId);
    return response.items
      .filter(isDelegatableExternalAgent)
      .sort((left, right) => left.name.localeCompare(right.name));
  };

  const handleUploadInboxFiles = async (files: File[]) => {
    const input = files.filter(Boolean);
    if (!input.length) return;
    try {
      const results = await Promise.all(input.map((file) => props.client.uploadInbox(props.workspaceId, file)));
      return results;
    } catch (nextError) {
      toast.warning(nextError instanceof Error ? nextError.message : "Shared folder upload failed");
      throw nextError;
    }
  };

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const sessionScroll = useSessionScrollController({
    selectedSessionId: props.sessionId,
    renderedMessages,
    containerRef: scrollRef,
    contentRef,
  });

  const handleFindBeforeJump = useCallback(() => {
    sessionScroll.markScrollGesture(scrollRef.current);
  }, [sessionScroll.markScrollGesture]);

  const handleFindSurfaceInteraction = useCallback(() => {
    setFindLastFocused(props.sessionId);
  }, [props.sessionId, setFindLastFocused]);

  const handleFindShortcut = useEffectEvent((event: KeyboardEvent) => {
    const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.platform);
    const mod = isMac ? event.metaKey : event.ctrlKey;
    if (!mod || event.shiftKey || event.altKey || event.key?.toLowerCase() !== "f") return;

    event.preventDefault();
    if (resolveFindOwnerSessionId() === props.sessionId) {
      useSessionFindStore.getState().openFind({ sessionId: props.sessionId });
    }
  });

  useEffect(() => {
    const handler = (event: KeyboardEvent) => handleFindShortcut(event);
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const state = useSessionFindStore.getState();
    if (state.open && state.sessionId && state.sessionId !== props.sessionId && !isSessionSurfaceMounted(state.sessionId)) {
      state.closeFind();
    }
  }, [props.sessionId]);

  const sessionIdRef = useRef(props.sessionId);
  useEffect(() => {
    sessionIdRef.current = props.sessionId;
  }, [props.sessionId]);
  useEffect(() => () => {
    const state = useSessionFindStore.getState();
    if (state.sessionId === sessionIdRef.current) {
      state.closeFind();
    }
  }, []);

  const handleMessageListDispatchAction = useCallback((action: DispatchAction) => {
    if (action.target === "settings" && action.action === "open") {
      props.onOpenSettingsSection?.(action.section);
    }
  }, [props.onOpenSettingsSection]);

  const handleMessageListSetPrompt = useCallback((prompt: string) => {
    void typeComposerText(prompt);
  }, [typeComposerText]);

  const handleRevertToUserMessage = useCallback((messageId: string) => {
    void props.onRevertToMessage?.(messageId, props.sessionId);
  }, [props.onRevertToMessage, props.sessionId]);

  const handleForkAtMessage = useCallback((messageId: string) => {
    props.onForkAtMessage?.(messageId, props.sessionId, renderedMessages);
  }, [props.onForkAtMessage, props.sessionId, renderedMessages]);

  const handleEditUserMessage = useCallback((messageId: string, text: string) => {
    void (async () => {
      // Rewind the session to just before this prompt, then restore the
      // prompt text into the composer so the user can rewrite and resend it.
      const reverted = await props.onRevertToMessage?.(messageId, props.sessionId);
      if (reverted === false) return;
      await typeComposerText(text);
    })();
  }, [props.onRevertToMessage, props.sessionId, typeComposerText]);

  const sessionScrollTopControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.scroll_top",
    label: "Go to the top of the session",
    description: "Scroll the visible session transcript to the first messages.",
    sideEffect: "none",
    execute: () => {
      const container = scrollRef.current;
      if (!container) return { ok: false, error: "Session transcript is not mounted" };
      container.scrollTo({ top: 0, behavior: "smooth" });
      return { ok: true, position: "top" };
    },
  }), []);
  useControlAction(sessionScrollTopControlAction);

  const sessionScrollBottomControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.scroll_bottom",
    label: "Go to the bottom of the session",
    description: "Scroll the visible session transcript to the newest messages and composer area.",
    sideEffect: "none",
    execute: () => {
      sessionScroll.jumpToLatest("smooth");
      return { ok: true, position: "bottom" };
    },
  }), [sessionScroll.jumpToLatest]);
  useControlAction(sessionScrollBottomControlAction);

  const sessionLatestMessageControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.latest_message",
    label: "Read the latest session message",
    description: "Return the latest visible message in the current session transcript.",
    sideEffect: "none",
    execute: () => {
      const message = renderedMessages[renderedMessages.length - 1];
      if (!message) return { ok: false, error: "No messages are visible in this session" };
      return {
        ok: true,
        sessionId: props.sessionId,
        index: renderedMessages.length - 1,
        role: message.role,
        text: messageToReadableText(message),
      };
    },
  }), [props.sessionId, renderedMessages]);
  useControlAction(sessionLatestMessageControlAction);

  const sessionReadTranscriptControlAction = useMemo<iPolloWorkControlAction>(() => ({
    id: "session.read_transcript",
    label: "Read the current session transcript",
    description: "Return the last messages from the current session transcript as readable text, including the session ID, title, and message count.",
    sideEffect: "none",
    args: [{ name: "count", type: "number", required: false, description: "Number of recent messages to return, from 1 to 30. Defaults to 10." }],
    execute: (args) => {
      const count = typeof args === "object" && args !== null && "count" in args && typeof (args as { count?: unknown }).count === "number"
        ? Math.min(Math.max(1, (args as { count: number }).count), 30)
        : 10;
      const total = renderedMessages.length;
      const slice = renderedMessages.slice(-count);
      if (!slice.length) return { ok: false, error: "No messages in this session" };
      return {
        ok: true,
        sessionId: props.sessionId,
        messageCount: total,
        returned: slice.length,
        messages: slice.map((message, index) => ({
          index: total - slice.length + index,
          role: message.role,
          text: messageToReadableText(message),
        })),
      };
    },
  }), [props.sessionId, renderedMessages]);
  useControlAction(sessionReadTranscriptControlAction);

  const getDesignTemplateCover = useCallback(
    (templateId: string) => props.client.getTemplateCover(props.workspaceId, templateId),
    [props.client, props.workspaceId],
  );

  const renderComposer = (layout: "dock" | "inline") => (
    <>
      {(props.providerConnectedCount ?? 0) === 0 ? (
        <button
          type="button"
          className="mx-3 mb-2 flex w-[calc(100%-1.5rem)] items-center gap-2 rounded-lg border border-amber-7/40 bg-amber-2/30 px-3 py-2 text-left text-xs text-amber-11 transition-colors hover:bg-amber-3/40"
          onClick={() => props.onOpenSettingsSection?.("providers")}
        >
          <span className="font-medium">{t("session.no_model_connected")}</span>
          <span className="text-amber-11/70">{t("session.add_provider_hint")}</span>
        </button>
      ) : null}
      <DevProfiler id="SessionComposer">
        <ReactSessionComposer
          draft={draft}
          mentions={mentions}
          onDraftChange={handleComposerDraftChange}
          onSend={handleSend}
          onQueue={handleQueue}
          onStop={handleAbort}
          busy={chatStreaming}
          queuedCount={queuedMessages.length}
          disabled={model.transitionState !== "idle" || Boolean(props.modelUnavailable)}
          inputDisabled={false}
          modelUnavailable={Boolean(props.modelUnavailable)}
          statusLabel={statusLabel(snapshot ?? undefined, chatStreaming)}
          modelPickerOpen={props.modelPickerOpen}
          selectedModel={props.selectedModel}
          onModelPickerOpenChange={props.onModelPickerOpenChange}
          onModelChange={props.onModelChange}
          onConfigureModels={props.onConfigureModels}
          attachments={attachments}
          hasPromptContext={composerHasPromptContext}
          onAttachFiles={handleAttachFiles}
          onRemoveAttachment={handleRemoveAttachment}
          modelVariantLabel={props.modelVariantLabel}
          modelVariant={props.modelVariant}
          modelBehaviorOptions={props.modelBehaviorOptions}
          onModelVariantChange={props.onModelVariantChange}
          onConfigureTokenStar={props.onConfigureTokenStar}
          selectedMode={selectedMode}
          modeSelectionDisabled={modeSelectionLocked}
          listModes={props.listModes}
          onSelectMode={props.onSelectMode}
          listAgents={props.listAgents}
          onSelectAgent={props.onSelectAgent}
          listCommands={props.listCommands}
          listSkills={listSkills}
          skills={toolSkills}
          listMcp={listMcp}
          mcpServers={toolMcpServers}
          mcpStatus={toolMcpStatus}
          mcpStatuses={toolMcpStatuses}
          listInstalledExtensions={listInstalledExtensions}
          onOpenWorkspaceApp={props.onOpenWorkspaceApp}
          listExternalAgents={listExternalAgents}
          onOpenSettingsSection={props.onOpenSettingsSection}
          recentFiles={props.recentFiles}
          searchFiles={props.searchFiles}
          onInsertMention={handleInsertMention}
          inputHistory={inputHistory}
          onPasteText={handlePasteText}
          onUnsupportedFileLinks={handleUnsupportedFileLinks}
          pastedText={pasteParts}
          onExpandPastedText={handleExpandPastedText}
          onRemovePastedText={handleRemovePastedText}
          isRemoteWorkspace={props.isRemoteWorkspace}
          isSandboxWorkspace={props.isSandboxWorkspace}
          onUploadInboxFiles={props.onUploadInboxFiles ?? handleUploadInboxFiles}
          layout={layout}
          endAccessory={props.composerEndAccessory}
          placeholder={isEmptyConversation ? newConversationPlaceholder() : undefined}
          compactTopSpacing={composerTopAccessoryVisible}
          topAccessory={
            composerTopAccessoryVisible ? (
              <div>
                {starterCapability || selectedAnimations.length || selectedVoiceReference ? (
                  <div className="mx-4 mt-2 flex flex-wrap gap-1.5">
                    {starterCapability ? <StarterCapabilityChip capability={starterCapability} onClear={() => setStarterCapability(null)} /> : null}
                    {selectedAnimations.map((animation) => <AnimationChip key={animation.item.name} animation={animation} onClear={() => setSelectedAnimations((current) => current.filter((item) => item.item.name !== animation.item.name))} />)}
                    {selectedVoiceReference ? <VoiceChip reference={selectedVoiceReference} onClear={() => setSelectedVoiceReference(null)} /> : null}
                  </div>
                ) : null}
                {queuedMessages.length > 0 ? (
                  <QueuedMessagesPanel messages={queuedMessages} onRemove={removeQueuedDraft} onRemoveMany={removeManyQueuedDrafts} />
                ) : null}
                {props.activeQuestion ? (
                  <QuestionPanel
                    questions={props.activeQuestion.questions}
                    busy={props.questionReplyBusy ?? false}
                    onReply={(answers) => {
                      if (props.activeQuestion) props.respondQuestion?.(props.activeQuestion.id, answers);
                    }}
                  />
                ) : hasOpenTodos ? (
                  <TodoPanel todos={props.todos ?? []} />
                ) : null}
                {props.activePermission ? (
                  <PermissionApprovalPanel
                    permission={props.activePermission}
                    busy={props.permissionReplyBusy}
                    respondPermission={props.respondPermission}
                    safeStringify={props.safeStringify}
                  />
                ) : null}
              </div>
            ) : null
          }
        />
      </DevProfiler>
    </>
  );

  return (
    <DevProfiler id="SessionSurface">
    <div
      data-session-surface-id={props.sessionId}
      onPointerDownCapture={handleFindSurfaceInteraction}
      onFocusCapture={handleFindSurfaceInteraction}
      className="flex h-full min-h-0 flex-col"
    >
      {model.transitionState === "switching" && showDelayedLoading ? (
        <div className="flex justify-center px-6 pt-4">
          <div className="rounded-full border border-dls-border bg-dls-hover/80 px-3 py-1 text-xs text-dls-secondary">
            {model.renderSource === "cache" ? t("session.switching_from_cache") : t("session.switching")}
          </div>
        </div>
      ) : null}

      {isEmptyConversation ? (
        <div className="flex h-0 min-h-0 flex-1 justify-center overflow-y-auto bg-background px-5 dark:bg-[#131313]">
          <div className="flex min-h-full w-full max-w-[800px] flex-col justify-center pb-[max(64px,env(safe-area-inset-bottom))] pt-8 has-[[data-testid=new-conversation-template-strip]]:justify-start">
            <div data-testid="new-conversation-starter-slot" className="shrink-0">
              <NewConversationStarter
              selectedMode={newConversationMode}
              selectedCapabilityId={starterCapability?.id}
              onSelectMode={(mode) => {
                setNewConversationMode(mode);
                setStarterCapability(null);
                if (mode !== "video") setSelectedAnimations([]);
              }}
              onSelectPrompt={(prompt, capability) => {
                setStarterCapability(capability ?? null);
                if (prompt) setComposerDraft(props.sessionId, prompt);
                window.dispatchEvent(new Event("ipollowork:focusPrompt"));
              }}
              templates={props.designTemplates}
              templatesLoading={props.designTemplatesLoading}
              templateBusyId={props.designTemplateBusyId}
              getTemplateCover={getDesignTemplateCover}
              onInstallTemplate={props.onInstallDesignTemplate}
              onRequestTemplates={props.onRequestDesignTemplates}
              animationCatalog={animationCatalog}
              animationCatalogLoading={animationCatalogLoading}
              animationCatalogError={animationCatalogError}
              selectedAnimations={selectedAnimations}
              onToggleAnimation={(animation) => setSelectedAnimations((current) => current.some((item) => item.item.name === animation.name) ? current.filter((item) => item.item.name !== animation.name) : [...current, { item: animation, values: {} }])}
              onChangeAnimationParams={(animation, values: HyperframesEffectVariableValues) => setSelectedAnimations((current) => [
                ...current.filter((item) => item.item.name !== animation.name),
                { item: animation, values },
              ])}
              onRetryAnimationCatalog={() => setAnimationCatalogRevision((current) => current + 1)}
              onUseTemplate={props.onCreateSession
                ? (templateId, surface) => props.onCreateSession?.(surface === "video" ? "video" : "design", templateId)
                : props.onMaterializeTemplate
                  ? (templateId, surface) => void props.onMaterializeTemplate?.(templateId, surface)
                  : undefined}
              />
            </div>
            <div ref={composerShellRef} data-testid="new-conversation-starter-composer-shell" className="mt-6 w-full shrink-0">
              {renderComposer("inline")}
            </div>
          </div>
        </div>
      ) : null}

      {!isEmptyConversation ? (
        <>
      <div className="relative min-h-0 flex-1">
        <div
          ref={scrollRef}
          onWheel={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onTouchStart={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onTouchMove={(event) => {
            sessionScroll.markScrollGesture(event.target);
          }}
          onPointerDown={(event) => {
            if (event.target !== event.currentTarget) return;
            sessionScroll.markScrollGesture(event.currentTarget);
          }}
          onScroll={sessionScroll.handleScroll}
          // Extra top padding while the find bar is open so it never covers
          // the first message (short transcripts cannot scroll it clear).
          className={`absolute inset-0 overflow-x-hidden overflow-y-auto overscroll-y-contain px-3 pb-4 sm:px-5 ${findOwned ? "pt-16" : "pt-4"}`}
        >
          {/* Chat column: tighter than the composer (800px) so messages
               keep a comfortable reading width and don't feel "too big". */}
          <div ref={contentRef} className="mx-auto w-full max-w-[800px]">
            {showDelayedLoading && pendingSessionLoad ? (
              <div className="px-6 py-16">
                <div className="mx-auto max-w-sm rounded-3xl border border-dls-border bg-dls-hover/60 px-8 py-10 text-center">
                  <div className="text-sm text-dls-secondary">{t("session.opening")}</div>
                </div>
              </div>
            ) : (snapshotQuery.isError || error) && !snapshot && renderedMessages.length === 0 ? (
              <div className="px-6 py-8">
                {error ? (
                  <SessionErrorCard
                    error={error}
                    onDismiss={handleDismissError}
                    onChangeModel={props.onChangeModel}
                    onOpenModelPicker={props.onModelClick}
                  />
                ) : (
                  <div className="mx-auto max-w-xl rounded-3xl border border-red-6/40 bg-red-3/20 px-6 py-5 text-sm text-red-11">
                    {snapshotQuery.error instanceof Error ? snapshotQuery.error.message : t("session.failed_to_load")}
                  </div>
                )}
              </div>
            ) : renderedMessages.length === 0 && effectiveActivityStatus !== "idle" ? (
              <div className="px-6 py-12">
                <AssistantWaitingCard label={props.assistantWaitLabel ?? getSessionActivityStatusLabel(effectiveActivityStatus)} />
              </div>
            ) : renderedMessages.length === 0 && snapshot && snapshot.messages.length === 0 && error ? (
              <SessionErrorCard
                error={error}
                onDismiss={handleDismissError}
                onChangeModel={props.onChangeModel}
                onOpenModelPicker={props.onModelClick}
              />
            ) : (
              <DevProfiler id="MessageList">
                <OpenTargetProvider
                  openTargets={verifiedOpenTargets}
                  onOpenTarget={props.onOpenTarget}
                >
                  <EnvironmentVariableProvider
                    client={props.isRemoteWorkspace ? null : props.environmentClient ?? props.client}
                    runtimeKey={props.environmentRuntimeKey}
                    onApplyChanges={props.onApplyEnvironmentChanges}
                  >
                    <MessageListProvider
                      workspaceId={props.workspaceId}
                      sessionId={props.sessionId}
                      sessionTitle={props.sessionTitle ?? t("session.default_title")}
                      showThinking={showThinking}
                      highlightQuery={findHighlightQuery}
                      developerMode={props.developerMode}
                      displaySuggestions={shellConfig.starterCards}
                      providerConnectedCount={props.providerConnectedCount ?? 0}
                      onOpenVideoStudio={props.onOpenVideoStudio}
                      onOpenSchedule={props.onOpenSchedule}
                      dispatchAction={handleMessageListDispatchAction}
                      setPrompt={handleMessageListSetPrompt}
                      onRevertToUserMessage={handleRevertToUserMessage}
                      onForkAtMessage={handleForkAtMessage}
                      onEditUserMessage={handleEditUserMessage}
                    >
                      <MessageList
                        messages={renderedMessages}
                        status={status}
                        retryStatus={liveStatus.type === "retry" ? liveStatus : null}
                        templateEntryPath={props.templateEntryPath}
                        artifactFiles={props.artifactFiles}
                        artifactContext={props.artifactContext}
                        activeMessageBaseline={awaitingAssistantBaseline}
                        assistantWaitLabel={props.assistantWaitLabel}
                      />
                    </MessageListProvider>
                  </EnvironmentVariableProvider>
                </OpenTargetProvider>
              </DevProfiler>
            )}
          </div>
        </div>
        <SessionScrollOverlay
          sessionId={props.sessionId}
          isStreaming={chatStreaming}
          onJumpToLatest={sessionScroll.jumpToLatest}
          onJumpToStartOfMessage={sessionScroll.jumpToStartOfMessage}
        />
        <SessionFindBar
          sessionId={props.sessionId}
          scrollRef={scrollRef}
          onBeforeJump={handleFindBeforeJump}
        />
      </div>

      <div ref={composerShellRef} className="shrink-0 px-0 pb-2 pt-2">
        {renderComposer("dock")}
      </div>
        </>
      ) : null}
      {/* Error display moved inline into the session conversation area */}
      {props.developerMode ? <SessionDebugPanel model={model} snapshot={snapshot} /> : null}
    </div>
    </DevProfiler>
  );
}
