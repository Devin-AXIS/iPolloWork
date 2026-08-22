import { publicAssetUrl } from "./lib/public-asset";
import type {
  PluginAuthorizationMethod,
  PluginAuthorizationMethodTranslation,
  PluginContribution,
  PluginContributionType,
  PluginEnablementCondition,
  PluginEnablementConditionType,
  PluginEnablementResult,
  PluginLifecycle,
  PluginLocalization,
  PluginManifest,
  PluginPackageMetadata,
  PluginPermission,
  PluginReloadReason,
  PluginResource,
  PluginResourceType,
  PluginSecretField,
  PluginSetup,
  PluginSource,
  PluginSourceFormat,
  PluginTranslation,
} from "@ipollowork/types/plugins";

export type ReloadReason = PluginReloadReason;
export type iPolloWorkExtensionSourceFormat = PluginSourceFormat;
export type iPolloWorkExtensionSource = PluginSource;
export type iPolloWorkExtensionResourceType = PluginResourceType;
export type iPolloWorkExtensionResource = PluginResource;
export type iPolloWorkExtensionContributionType = PluginContributionType;
export type iPolloWorkExtensionContribution = PluginContribution;
export type iPolloWorkExtensionSetup = PluginSetup;
export type iPolloWorkExtensionLifecycle = PluginLifecycle;
export type iPolloWorkPluginPermissionId = PluginPermission["id"];
export type iPolloWorkPluginPermission = PluginPermission;
export type iPolloWorkPluginSecretField = PluginSecretField;
export type iPolloWorkPluginAuthorizationMethod = PluginAuthorizationMethod;
export type iPolloWorkPluginPackageMetadata = PluginPackageMetadata;
export type iPolloWorkPluginAuthorizationMethodTranslation = PluginAuthorizationMethodTranslation;
export type iPolloWorkExtensionTranslation = PluginTranslation;
export type iPolloWorkExtensionLocalization = PluginLocalization;
export type EnablementConditionType = PluginEnablementConditionType;
export type EnablementCondition = PluginEnablementCondition;
export type EnablementResult = PluginEnablementResult;
export type iPolloWorkExtensionManifest = PluginManifest;

export function extensionContribution(
  manifest: iPolloWorkExtensionManifest | undefined,
  type: iPolloWorkExtensionContributionType,
): iPolloWorkExtensionContribution | undefined {
  return manifest?.contributions?.find((contribution) => contribution.type === type);
}

export function extensionResource(
  manifest: iPolloWorkExtensionManifest | undefined,
  type: iPolloWorkExtensionResourceType,
): iPolloWorkExtensionResource | undefined {
  return manifest?.resources.find((resource) => resource.type === type);
}

export function isTrustedBuiltInExtension(manifest: iPolloWorkExtensionManifest | undefined): boolean {
  return manifest?.source.origin === "builtin" && manifest.source.trusted;
}

export const BUILT_IN_IPOLLOWORK_EXTENSION_MANIFESTS: iPolloWorkExtensionManifest[] = [
  {
    schemaVersion: 2,
    id: "ipollowork-browser",
    name: "iPolloWork Browser",
    description: "Automate the built-in browser panel that stays visible inside iPolloWork.",
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    icon: { src: publicAssetUrl("ipollowork-mark.svg") },
    composer: { prompt: "Use the iPolloWork built-in browser to " },
    setup: {
      instructions: "iPolloWork Browser is ready by default and uses the same host-owned semantic runtime with every AI engine.",
    },
    resources: [],
    contributions: [
      { type: "settings-panel", ref: "ipollowork.browser.settings", location: "settings-detail" },
      { type: "session-side-panel", ref: "ipollowork.browser.panel", location: "session-right-pane" },
      { type: "composer-prompt", prompt: "Use the iPolloWork built-in browser to ", location: "composer" },
    ],
    enablement: [
      { type: "toggle-enabled", ref: "ipollowork-browser", label: "Enabled" },
    ],
    lifecycle: { reload: [], detection: [] },
    defaultEnabled: true,
  },
  {
    schemaVersion: 2,
    id: "computer-use",
    name: "Computer Use",
    description: "Mac only: control Mac apps through semantic accessibility refs, screenshots, background-safe clicks, keyboard input, and strict mode.",
    preview: true,
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    icon: { src: publicAssetUrl("ipollowork-mark.svg") },
    composer: { prompt: "Use Computer Use to " },
    setup: {
      instructions: "Computer Use is Mac only. It runs as a local MCP server backed by the macOS accessibility runtime. Grant Accessibility and Screen Recording permissions when macOS asks, then connect the MCP server in this workspace.",
      primaryCta: "Connect Computer Use MCP",
      secondaryCta: "Check macOS permissions",
      testActionRef: "ipollowork.computerUse.healthCheck",
    },
    resources: [
      {
        type: "mcp",
        id: "computer-use-mcp",
        label: "Computer Use MCP",
        mcpServerName: "computer-use",
        command: ["npx", "-y", "@ipollowork/handsfree", "mcp"],
        localCommandRef: "ipollowork.computerUseMcp",
        required: true,
      },
      {
        type: "native-binary",
        id: "computer-use-native",
        label: "macOS accessibility runtime",
        packageName: "@ipollowork/handsfree",
        required: true,
      },
    ],
    contributions: [
      { type: "setup-instructions", ref: "ipollowork.computerUse.setup", location: "settings-detail" },
      { type: "native-capability", ref: "ipollowork.computerUse.axPermissions", label: "Accessibility and Screen Recording" },
      { type: "test-action", ref: "ipollowork.computerUse.healthCheck", label: "Verify Computer Use MCP" },
      { type: "composer-prompt", prompt: "Use Computer Use to ", location: "composer" },
    ],
    enablement: [
      { type: "mcp-connected", ref: "computer-use", label: "MCP server connected" },
      { type: "permission-granted", ref: "accessibility", label: "Accessibility permission" },
      { type: "permission-granted", ref: "screenRecording", label: "Screen Recording permission" },
    ],
    lifecycle: { reload: ["mcp"], detection: ["mcp:computer-use"] },
    platform: ["darwin"],
  },
  {
    schemaVersion: 2,
    id: "openai-image-gen",
    name: "OpenAI Image Gen",
    description: "Generate image artifacts with gpt-image-2.",
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    icon: { src: publicAssetUrl("ext-openai.svg") },
    composer: { prompt: "Use the OpenAI Image Gen extension to " },
    setup: {
      instructions: "Add an OpenAI API key, then agents can generate image artifacts through iPolloWork extension actions.",
      primaryCta: "Enable image generation",
      secondaryCta: "Generate test image",
      requiredEnv: ["OPENAI_API_KEY"],
      testActionRef: "ipollowork.imageGen.testGenerate",
    },
    resources: [
      { type: "secret", id: "openai-api-key", envKey: "OPENAI_API_KEY", required: true },
      { type: "local-service", id: "openai-image-generation-service", label: "OpenAI image generation", required: true },
      { type: "tool", id: "openai-image-generate", label: "Image generation", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "ipollowork.imageGen.settings", location: "settings-detail" },
      { type: "test-action", ref: "ipollowork.imageGen.testGenerate", label: "Generate test image" },
      { type: "composer-prompt", prompt: "Use the OpenAI Image Gen extension to ", location: "composer" },
    ],
    enablement: [
      { type: "env-set", ref: "OPENAI_API_KEY", label: "OpenAI API key" },
    ],
    lifecycle: { reload: ["config"], detection: ["env:OPENAI_API_KEY"] },
  },
  {
    schemaVersion: 2,
    id: "ipollowork-voice",
    name: "Voice Mode",
    description: "Talk to iPolloWork through a Realtime voice panel that drives the same semantic UI controls as iPolloWork UI MCP.",
    preview: true,
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    icon: { src: publicAssetUrl("ipollowork-mark.svg") },
    composer: { prompt: "Use Voice Mode to " },
    setup: {
      instructions: "Voice Mode uses OpenAI Realtime. Save an OpenAI API key in iPolloWork env vars, then open the session rail panel and speak or send a typed voice command.",
      primaryCta: "Save OpenAI key",
      secondaryCta: "Test Realtime",
      requiredEnv: ["OPENAI_REALTIME_API_KEY", "OPENAI_API_KEY"],
      testActionRef: "ipollowork.voice.testRealtime",
    },
    resources: [
      { type: "secret", id: "openai-realtime-api-key", envKey: "OPENAI_REALTIME_API_KEY", required: false },
      { type: "secret", id: "openai-api-key", envKey: "OPENAI_API_KEY", required: true },
      { type: "local-service", id: "ipollowork-voice-realtime-session", label: "Realtime client-secret minting", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "ipollowork.voice.settings", location: "settings-detail" },
      { type: "session-side-panel", ref: "ipollowork.voice.panel", location: "session-right-pane" },
      { type: "session-rail-item", ref: "ipollowork.voice.rail", label: "Voice Mode", location: "session-rail" },
      { type: "server-route", ref: "POST /voice/realtime/session", location: "server" },
      { type: "control-actions", ref: "ipollowork.voice.controlActions" },
      { type: "test-action", ref: "ipollowork.voice.testRealtime", label: "Test Realtime" },
      { type: "composer-prompt", prompt: "Use Voice Mode to ", location: "composer" },
    ],
    enablement: [
      { type: "toggle-enabled", ref: "ipollowork-voice", label: "Enabled" },
      { type: "env-set", ref: "OPENAI_API_KEY", label: "OpenAI API key" },
    ],
    lifecycle: { reload: ["config"], detection: ["env:OPENAI_REALTIME_API_KEY", "env:OPENAI_API_KEY"] },
  },
  {
    schemaVersion: 2,
    id: "google-workspace",
    name: "Google Workspace",
    description: "Let iPolloWork help with meetings, selected Drive files, and Gmail drafts.",
    preview: true,
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    icon: { simpleIconSlug: "google" },
    composer: { prompt: "Use Google Workspace to " },
    setup: {
      instructions: "Connect your Google account to use Calendar, Drive, and Gmail drafts in iPolloWork.",
      primaryCta: "Connect Google Workspace",
      secondaryCta: "Test connection",
      testActionRef: "ipollowork.googleWorkspace.testConnection",
    },
    resources: [
      { type: "provider", id: "google-oauth", label: "Google account", providerId: "google-workspace", required: true },
      { type: "local-service", id: "google-workspace-connector", label: "Secure local connection", required: true },
      { type: "tool", id: "google-calendar-read", label: "Calendar", required: true },
      { type: "tool", id: "google-gmail-drafts", label: "Gmail drafts", required: true },
      { type: "tool", id: "google-drive-selected-files", label: "Selected Drive files", required: true },
      { type: "tool", id: "google-gmail-read", label: "Gmail read (opt-in)", required: false },
      { type: "tool", id: "google-drive-full", label: "Full Drive access (opt-in)", required: false },
      { type: "tool", id: "google-calendar-events", label: "Calendar events (opt-in)", required: false },
      { type: "tool", id: "google-chat", label: "Google Chat (opt-in)", required: false },
    ],
    contributions: [
      { type: "settings-panel", ref: "ipollowork.googleWorkspace.settings", location: "settings-detail" },
      { type: "test-action", ref: "ipollowork.googleWorkspace.testConnection", label: "Test Google Workspace" },
      { type: "composer-prompt", prompt: "Use Google Workspace to ", location: "composer" },
    ],
    lifecycle: { reload: ["config"], detection: ["provider:google-workspace"] },
  },
  {
    schemaVersion: 2,
    id: "minimax",
    name: "MiniMax",
    description: "Configure MiniMax models through regional OpenAI-compatible or Anthropic endpoints.",
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    composer: { prompt: "Use MiniMax to " },
    setup: {
      instructions: "Save a MiniMax API key, choose a regional endpoint, and add both current MiniMax models to OpenCode.",
      primaryCta: "Configure MiniMax",
    },
    resources: [
      { type: "provider", id: "minimax", label: "MiniMax", providerId: "minimax", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "ipollowork.minimax.settings", location: "settings-detail" },
      { type: "composer-prompt", prompt: "Use MiniMax to ", location: "composer" },
    ],
    enablement: [
      { type: "provider-connected", ref: "minimax", label: "MiniMax provider" },
    ],
    lifecycle: { reload: ["config"], detection: ["provider:minimax"] },
  },
  {
    schemaVersion: 2,
    id: "ollama",
    name: "Ollama",
    description: "Local model provider at http://localhost:11434.",
    source: { format: "ipollowork-builtin", origin: "builtin", trusted: true },
    icon: { src: publicAssetUrl("ext-ollama.svg") },
    composer: { prompt: "Use the Ollama extension to " },
    setup: {
      instructions: "Run Ollama locally, choose or pull a model, then add it as an OpenCode provider.",
      primaryCta: "Add Ollama model",
      secondaryCta: "Pull model",
    },
    resources: [
      { type: "local-service", id: "ollama-api", label: "Ollama API", description: "http://localhost:11434", required: true },
      { type: "provider", id: "ollama", providerId: "ollama", packageName: "@ai-sdk/openai-compatible", required: true },
    ],
    contributions: [
      { type: "settings-panel", ref: "ipollowork.ollama.settings", location: "settings-detail" },
      { type: "test-action", ref: "ipollowork.ollama.listModels", label: "Check local models" },
      { type: "composer-prompt", prompt: "Use the Ollama extension to ", location: "composer" },
    ],
    enablement: [
      { type: "provider-connected", ref: "ollama", label: "Ollama provider" },
    ],
    lifecycle: { reload: ["config"], detection: ["provider:ollama"] },
  },
];
