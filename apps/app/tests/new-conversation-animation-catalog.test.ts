import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const starter = readFileSync(resolve(root, "src/components/chat/new-conversation-starter.tsx"), "utf8");
const surface = readFileSync(resolve(root, "src/react-app/domains/session/surface/session-surface.tsx"), "utf8");
const sessionPage = readFileSync(resolve(root, "src/react-app/domains/session/chat/session-page.tsx"), "utf8");
const composer = readFileSync(resolve(root, "src/react-app/domains/session/surface/composer/composer.tsx"), "utf8");
const styles = readFileSync(resolve(root, "src/app/index.css"), "utf8");

describe("new conversation animation catalog", () => {
  test("shows the video template picker without the GSAP animation catalog", () => {
    expect(starter).toContain("const VIDEO_TEMPLATE_PICKER_ENABLED = true");
    expect(starter).toContain("const VIDEO_ANIMATION_PICKER_ENABLED = false");
    expect(surface).toContain("const VIDEO_ANIMATION_PICKER_ENABLED = false");
    expect(starter).toContain('selectedMode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED');
    expect(starter).toContain('selectedMode === "video" && VIDEO_ANIMATION_PICKER_ENABLED');
    expect(starter).toContain('mode === "video" && VIDEO_TEMPLATE_PICKER_ENABLED');
    expect(surface).toContain("if (!VIDEO_ANIMATION_PICKER_ENABLED");
    expect(starter).toContain("function TemplateStrip");
    expect(starter).toContain('data-testid="new-conversation-template-strip"');
    expect(starter).toContain('mt-4 min-h-[185px] min-w-0 overflow-hidden rounded-xl');
  });

  test("separates the GSAP catalog into animation and effect libraries", () => {
    expect(starter).toContain('useState<"animation" | "effect">("effect")');
    expect(starter).toContain('item.engine?.name.toLowerCase() === "gsap"');
    expect(starter).toContain('item.kind === libraryKind');
    expect(starter).toContain("new_conversation.animations.effect_library");
    expect(starter).toContain("new_conversation.animations.animation_library");
    expect(starter).toContain("new_conversation.animations.catalog_synced");
    expect(starter).toContain("new_conversation.animations.all_plugins");
  });

  test("gives the video template empty state a recovery action", () => {
    expect(starter).toContain('new_conversation.templates.video_empty_hint');
    expect(starter).toContain('new_conversation.templates.retry');
    expect(starter).toContain("onRequestTemplates?: () => void");
    expect(starter).toContain('category === "video"');
    expect(starter).toContain("onClick={onRequestTemplates}");
  });

  test("supports multi-select animation references", () => {
    expect(starter).toContain("function AnimationCatalogStrip");
    expect(starter).toContain("selectedNames.has(item.name)");
    expect(surface).toContain("selectedAnimations.map");
    expect(surface).toContain("animationSelectionInstruction(selectedAnimations)");
    expect(surface).toContain("registry: ${item.name}");
  });

  test("surfaces recent-selection and error copy", () => {
    expect(starter).toContain("RECENT_ANIMATION_STORAGE_KEY");
    expect(starter).toContain('new_conversation.animations.recent');
    expect(starter).toContain('new_conversation.animations.empty_catalog_title');
    expect(starter).toContain('new_conversation.animations.error_title');
    expect(starter).toContain('rounded-full px-2 py-1 text-[11px] font-medium');
  });

  test("edits validated effect variables and sends structured configuration", () => {
    expect(starter).toContain("function AnimationParameterDialog");
    expect(starter).toContain("updateHyperframesEffectVariableOverride");
    expect(starter).toContain("new_conversation.animations.update_${lastUpdate}");
    expect(surface).toContain("hyperframesSelectionPayload(selection)");
    expect(surface).toContain("data-variable-values/getVariables");
  });

  test("routes template launches through the current session materializer first", () => {
    expect(surface).toContain("onMaterializeTemplate?: (templateId: string, surface: \"design\" | \"video\") => void | Promise<void>");
    expect(surface).toContain("onUseTemplate={props.onMaterializeTemplate");
    expect(surface).toMatch(/onUseTemplate=\{props\.onMaterializeTemplate[\s\S]{0,250}: props\.onCreateSession/);
    expect(surface).toContain("props.onCreateSession?.(surface === \"video\" ? \"video\" : \"design\", templateId)");
  });

  test("keeps the starter template catalog independent from the template market scope", () => {
    expect(sessionPage).toContain("const [starterTemplateCatalog, setStarterTemplateCatalog]");
    expect(sessionPage).toContain("const refreshStarterTemplateCatalog = useCallback");
    expect(sessionPage).toContain("PERSONAL_WORK_CONTEXT_ID");
    expect(sessionPage).toMatch(/listTemplates\(\s*props\.runtimeWorkspaceId,\s*PERSONAL_WORK_CONTEXT_ID,/);
    expect(sessionPage).toContain("designTemplates={starterTemplateCatalog}");
    expect(sessionPage).toContain("onRequestDesignTemplates={() => void refreshStarterTemplateCatalog()}");
    expect(sessionPage).toContain('id: "design"');
    expect(sessionPage).toContain("onOpenVideoStudio={openCurrentVideoStudio}");
    expect(sessionPage).not.toContain("designWorkspaceEnabled");
    expect(sessionPage).not.toContain("videoWorkspaceEnabled");
  });

  test("loads personal templates for both empty conversations and projects without tasks", () => {
    expect(sessionPage).toMatch(/useEffect\(\(\) => \{[\s\S]*void refreshStarterTemplateCatalog\(\);[\s\S]*\}, \[props\.ipolloworkServerClient, props\.runtimeWorkspaceId, refreshStarterTemplateCatalog\]\);/);
    expect(sessionPage).toContain("templates={starterTemplateCatalog}");
    expect(sessionPage).toContain("templatesLoading={starterTemplateCatalogLoading}");
    expect(sessionPage).toContain("getTemplateCover={getStarterTemplateCover}");
    expect(sessionPage).toContain("onInstallTemplate={(templateId) => void installStarterTemplate(templateId)}");
    expect(sessionPage).toContain('surface === "video" ? "video" : "design"');
  });

  test("keeps the project-first starter wired to the same workspace tools as New task", () => {
    expect(sessionPage).toContain("const listSkills = useCallback");
    expect(sessionPage).toContain("const listMcp = useCallback");
    expect(sessionPage).toContain("const listImportedPlugins = useCallback");
    expect(sessionPage).toContain("const listExternalAgents = useCallback");
    expect(sessionPage).toContain("surface.recentFiles");
    expect(sessionPage).toContain("surface.searchFiles");
    expect(sessionPage).toContain("surface.isRemoteWorkspace");
    expect(sessionPage).toContain("surface.isSandboxWorkspace");
    expect(sessionPage).toContain("surface.providerConnectedCount");
    expect(sessionPage).toContain("onUploadInboxFiles={composerTooling.onUploadInboxFiles}");
    expect(sessionPage).toContain("listSkills={composerTooling.listSkills}");
    expect(sessionPage).toContain("listMcp={composerTooling.listMcp}");
    expect(sessionPage).toContain("listImportedPlugins={composerTooling.listImportedPlugins}");
    expect(sessionPage).toContain("listExternalAgents={composerTooling.listExternalAgents}");
    expect(sessionPage).toContain("topAccessory={starterCapability ? (");
    expect(sessionPage).toContain("<StarterCapabilityChip capability={starterCapability}");
  });

  test("opens a materialized design template in the Design panel", () => {
    expect(sessionPage).toContain("const autoOpenedDesignTemplateRef = useRef<string | null>(null)");
    expect(sessionPage).toContain("const templateKey = `${props.selectedSessionId}:${designTemplateEntryPath}`");
    expect(sessionPage).toContain('sessionSidePanel === "panel" && activePanelTab && activePanelTab.type !== "design"');
    expect(sessionPage).toContain("openDesignTab(designTemplateEntryPath)");
  });

  test("does not carry a previous session's template preview into a new task", () => {
    expect(sessionPage).toContain("sessionId: string;");
    expect(sessionPage).toContain("const currentTemplateSessionData = templateSessionData?.sessionId === props.selectedSessionId");
    expect(sessionPage).toContain("setTemplateSessionData({ ...result, hasBrief });");
    expect(sessionPage).toContain('setTemplateSessionData({ sessionId: props.selectedSessionId, ...result, hasBrief: false, applyMode: "new-conversation" });');
    expect(sessionPage).toContain("const designTemplateEntryPath = currentTemplateSessionData?.manifest.surface === \"design\"");
  });

  test("matches the redesigned tabs with semantic theme colors and spring motion", () => {
    expect(surface).toContain('dark:bg-[#131313]');
    expect(starter).toContain('new-conversation-bg.png');
    expect(starter).toContain('max-w-none dark:opacity-20');
    expect(starter).toContain('rounded-[40px] bg-[var(--new-conversation-tab-surface)] p-1');
    expect(starter).toContain('data-testid="new-conversation-mode-indicator"');
    expect(starter).toContain('layoutId={`new-conversation-mode-indicator-${modeTabIndicatorId}`}');
    expect(starter).toContain('type: "spring"');
    expect(starter).toContain("mass: 1");
    expect(starter).toContain("stiffness: 300");
    expect(starter).toContain("damping: 20");
    expect(starter).toContain("transition={reduceMotion ? { duration: 0 } : MODE_TAB_SPRING}");
    expect(starter).toContain('className="pointer-events-none absolute inset-0 -z-10 rounded-[40px] bg-[var(--new-conversation-tab-selected)]"');
    expect(starter).toContain('text-[var(--new-conversation-tab-muted)] hover:rounded-[40px] hover:bg-[var(--new-conversation-tab-selected)]/70 hover:text-[var(--new-conversation-tab-text)]');
    expect(starter).toContain('WebkitMaskImage: `url(${iconSrc})`');
    expect(starter).toContain('dark:text-[#f5f5f5]');
    expect(starter).toContain('dark:text-[#b0b4ba]');
    expect(starter).toContain('dark:invert dark:opacity-80');
    expect(composer).toContain("new-conversation-composer");
    expect(styles).toContain("--new-conversation-composer-surface: #343434");
    expect(styles).toContain("--new-conversation-tab-surface: #2a2a2d");
    expect(styles).toContain("--new-conversation-tab-selected: #3a3a3d");
    expect(styles).toContain("--new-conversation-tab-text: #f5f5f5");
    expect(styles).toContain("--new-conversation-tab-muted: #b0b4ba");
    expect(composer).toContain("dark:bg-white dark:text-black");
  });

  test("keeps the shortcut editor inside the main content inset", () => {
    expect(starter).toContain('data-testid="new-conversation-shortcut-editor"');
    expect(starter).toContain('createPortal(');
    expect(starter).toContain('document.body');
    expect(starter).toContain("button.closest<HTMLElement>('[data-slot=\"sidebar-inset\"]')");
    expect(starter).toContain("contentRect?.right ?? window.innerWidth");
    expect(starter).toContain("contentRight - contentLeft - horizontalMargin * 2");
    expect(starter).toContain("Math.max(rect.right - width, contentLeft + horizontalMargin)");
    expect(starter).toContain("const availableAbove = Math.max(0, rect.top - gap - verticalMargin)");
    expect(starter).toContain("const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - verticalMargin)");
    expect(starter).toContain("const maxHeight = Math.min(420, opensAbove ? availableAbove : availableBelow)");
    expect(starter).toContain("{ left, width, maxHeight, bottom:");
    expect(starter).toContain("{ left, width, maxHeight, top:");
  });

  test("lets optional starter modules expand the page while keeping the composer close to the content", () => {
    expect(starter).toContain('data-testid="new-conversation-starter-layout"');
    expect(starter).toContain('className="relative w-full overflow-visible');
    expect(starter).toContain('data-testid="new-conversation-starter-header"');
    expect(starter).toContain('data-testid="new-conversation-starter-tasks"');
    expect(starter).toContain('className="relative pt-6"');
    expect(starter).toContain('data-testid="new-conversation-quick-actions"');
    expect(starter).toContain('selectedMode === "video" ? "" : "min-h-[56px] content-start"');
    expect(sessionPage).toContain('data-testid="new-conversation-starter-slot"');
    expect(surface).toContain('data-testid="new-conversation-starter-slot"');
    expect(sessionPage).toContain('className="shrink-0"');
    expect(surface).toContain('className="shrink-0"');
    expect(sessionPage).toContain('flex min-h-full w-full max-w-[800px] flex-col justify-center');
    expect(surface).toContain('flex min-h-full w-full max-w-[800px] flex-col justify-center');
    expect(sessionPage).toContain('has-[[data-testid=new-conversation-template-strip]]:justify-start');
    expect(surface).toContain('has-[[data-testid=new-conversation-template-strip]]:justify-start');
    expect(sessionPage).toContain('pb-[max(64px,env(safe-area-inset-bottom))]');
    expect(surface).toContain('pb-[max(64px,env(safe-area-inset-bottom))]');
    expect(sessionPage).toContain('data-testid="new-conversation-starter-composer-shell"');
    expect(surface).toContain('data-testid="new-conversation-starter-composer-shell"');
    expect(sessionPage).toContain('mt-6 w-full shrink-0');
    expect(surface).toContain('mt-6 w-full shrink-0');
  });

  test("keeps saved prompt templates out of the new conversation starter", () => {
    expect(starter).not.toContain("new_conversation.saved_templates.title");
    expect(starter).not.toContain("listSavedPromptTemplates");
    expect(starter).not.toContain("visiblePromptTemplates");
  });
});
