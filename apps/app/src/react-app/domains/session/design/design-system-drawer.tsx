/** @jsxImportSource react */
import * as React from "react";
import { Check, ChevronDown, GripVertical, Palette, RotateCcw, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import backgroundGradientIcon from "./assets/background-gradient.svg";
import backgroundImageIcon from "./assets/background-image.svg";
import backgroundNoneIcon from "./assets/background-none.svg";
import backgroundSolidActiveIcon from "./assets/background-solid-active.svg";
import backgroundSolidDefaultIcon from "./assets/background-solid-default.svg";
import designSystemRefreshIcon from "./assets/design-system-refresh.svg";
import designSystemSearchIcon from "./assets/design-system-search.svg";
import designSystemChevronUpIcon from "./assets/design-system-chevron-up.svg";

import {
  buildDesignSystemCardPreviewDoc,
  buildDesignSystemPresetValues,
  buildDesignSystemTokenControls,
  DESIGN_SYSTEM_THEMES,
  type DesignSystemTokenControl,
  type DesignSystemTheme,
  getDesignSystemTheme,
} from "./design-system-registry";
import type { DesignTokenValues } from "./design-system-files";
import { DesignColorField } from "./design-color-field";
import { DesignImageFitSelect, type DesignImageFitMode } from "./design-image-fit-select";
import { DesignPanelSelect } from "./design-panel-select";

type DesignSystemTab = "systems" | "variables";

const DRAWER_DEFAULT_WIDTH = 360;
const DRAWER_MIN_WIDTH = 280;
const DRAWER_MAX_WIDTH = 720;
const DRAWER_WIDTH_STORAGE_KEY = "ipollowork.design-system-drawer.width";

function clampDrawerWidth(width: number, availableWidth = DRAWER_MAX_WIDTH) {
  const responsiveMax = Math.max(DRAWER_MIN_WIDTH, Math.min(DRAWER_MAX_WIDTH, availableWidth - 280));
  return Math.round(Math.max(DRAWER_MIN_WIDTH, Math.min(responsiveMax, width)));
}

function storedDrawerWidth() {
  if (typeof window === "undefined") return DRAWER_DEFAULT_WIDTH;
  const stored = Number(window.localStorage.getItem(DRAWER_WIDTH_STORAGE_KEY));
  return Number.isFinite(stored) ? clampDrawerWidth(stored, window.innerWidth) : DRAWER_DEFAULT_WIDTH;
}

const DEFAULTS = {
  "--ipw-color-primary": "#c96442",
  "--ipw-color-secondary": "#2563eb",
  "--ipw-color-accent": "#7c3aed",
  "--ipw-color-bg": "#fafaf9",
  "--ipw-color-surface": "#ffffff",
  "--ipw-color-text": "#1c1b1a",
  "--ipw-color-muted": "#6b6964",
  "--ipw-color-border": "#e6e4e0",
  "--ipw-color-success": "#059669",
  "--ipw-color-warning": "#d97706",
  "--ipw-color-danger": "#dc2626",
  "--ipw-color-on-primary": "#ffffff",
  "--ipw-color-primary-soft": "color-mix(in srgb,var(--ipw-color-primary) 12%,var(--ipw-color-bg))",
  "--ipw-bg-gradient": "none",
  "--ipw-bg-mode": "none",
  "--ipw-bg-image": "none",
  "--ipw-bg-size": "cover",
  "--ipw-bg-position": "50% 50%",
  "--ipw-bg-overlay": "linear-gradient(rgba(28,27,26,0), rgba(28,27,26,0))",
  "--ipw-bg-overlay-color": "#1c1b1a",
  "--ipw-bg-overlay-opacity": "0",
  "--ipw-font-display": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--ipw-font-body": "-apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  "--ipw-type-scale": "1",
  "--ipw-body-line-height": "1.55",
  "--ipw-content-width": "1080px",
  "--ipw-page-padding": "32px",
  "--ipw-section-space": "80px",
  "--ipw-button-radius": "8px",
  "--ipw-card-bg": "#ffffff",
  "--ipw-card-border": "#e6e4e0",
  "--ipw-card-radius": "14px",
  "--ipw-card-shadow": "0 12px 32px rgba(28,27,26,.10)",
  "--ipw-card-blur": "0px",
} as const;

type DesignSystemDrawerProps = {
  open: boolean;
  embedded?: boolean;
  templateName: string;
  currentThemeId?: string | null;
  variablesDisabled?: boolean;
  initialValues?: DesignTokenValues;
  onClose: () => void;
  onTokenChange: (name: string, value: string) => void;
  onApplyDesignSystem?: (theme: DesignSystemTheme) => void;
  onChooseBackgroundImage?: () => void;
};

const TABS: Array<{ id: DesignSystemTab; labelKey: string; icon: React.ElementType }> = [
  { id: "systems", labelKey: "design_system.tab.systems", icon: Palette },
  { id: "variables", labelKey: "design_system.tab.variables", icon: SlidersHorizontal },
];

function normalizeHex(value: string, fallback: string) {
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
}

export function DesignSystemDrawer({
  open,
  embedded = false,
  templateName,
  currentThemeId,
  variablesDisabled = false,
  initialValues,
  onClose,
  onTokenChange,
  onApplyDesignSystem,
  onChooseBackgroundImage,
}: DesignSystemDrawerProps) {
  const drawerRef = React.useRef<HTMLElement>(null);
  const resizeStartRef = React.useRef({ clientX: 0, width: DRAWER_DEFAULT_WIDTH });
  const [tab, setTab] = React.useState<DesignSystemTab>("systems");
  const [drawerWidth, setDrawerWidth] = React.useState(storedDrawerWidth);
  const [resizing, setResizing] = React.useState(false);
  const [values, setValues] = React.useState<DesignTokenValues>({ ...DEFAULTS });
  const [selectedThemeId, setSelectedThemeId] = React.useState(currentThemeId ?? DESIGN_SYSTEM_THEMES[0]?.id ?? "");
  const [themeSearch, setThemeSearch] = React.useState("");
  const currentTheme = React.useMemo(
    () => currentThemeId ? getDesignSystemTheme(currentThemeId) : undefined,
    [currentThemeId],
  );
  const selectedTheme = React.useMemo(
    () => getDesignSystemTheme(selectedThemeId) ?? DESIGN_SYSTEM_THEMES[0],
    [selectedThemeId],
  );
  const selectedThemeControls = React.useMemo(
    () => selectedTheme ? buildDesignSystemTokenControls(selectedTheme) : [],
    [selectedTheme],
  );
  const selectedThemeGroups = React.useMemo(() => {
    const groups = new Map<string, typeof selectedThemeControls>();
    selectedThemeControls.forEach((control) => groups.set(control.group, [...(groups.get(control.group) ?? []), control]));
    return [...groups.entries()];
  }, [selectedThemeControls]);

  React.useEffect(() => {
    if (open) setValues({ ...DEFAULTS, ...initialValues });
  }, [initialValues, open]);

  React.useEffect(() => {
    if (!selectedThemeId && DESIGN_SYSTEM_THEMES.length) setSelectedThemeId(DESIGN_SYSTEM_THEMES[0].id);
  }, [selectedThemeId]);

  React.useEffect(() => {
    if (currentThemeId && getDesignSystemTheme(currentThemeId)) setSelectedThemeId(currentThemeId);
  }, [currentThemeId]);

  const availableDrawerWidth = React.useCallback(() => (
    drawerRef.current?.parentElement?.getBoundingClientRect().width ?? window.innerWidth
  ), []);

  const updateDrawerWidth = React.useCallback((width: number) => {
    setDrawerWidth(clampDrawerWidth(width, availableDrawerWidth()));
  }, [availableDrawerWidth]);

  React.useEffect(() => {
    window.localStorage.setItem(DRAWER_WIDTH_STORAGE_KEY, String(drawerWidth));
  }, [drawerWidth]);

  React.useEffect(() => {
    const handleResize = () => updateDrawerWidth(drawerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [drawerWidth, updateDrawerWidth]);

  React.useEffect(() => {
    if (!resizing) return;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [resizing]);

  const startResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    resizeStartRef.current = { clientX: event.clientX, width: drawerWidth };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  }, [drawerWidth]);

  const moveResize = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizing) return;
    updateDrawerWidth(resizeStartRef.current.width + resizeStartRef.current.clientX - event.clientX);
  }, [resizing, updateDrawerWidth]);

  const stopResize = React.useCallback(() => setResizing(false), []);

  const handleResizeKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 40 : 12;
    if (event.key === "ArrowLeft") updateDrawerWidth(drawerWidth + step);
    else if (event.key === "ArrowRight") updateDrawerWidth(drawerWidth - step);
    else if (event.key === "Home") updateDrawerWidth(DRAWER_MIN_WIDTH);
    else if (event.key === "End") updateDrawerWidth(DRAWER_MAX_WIDTH);
    else return;
    event.preventDefault();
  }, [drawerWidth, updateDrawerWidth]);

  const update = React.useCallback((name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    onTokenChange(name, value);
  }, [onTokenChange]);

  const updateMany = React.useCallback((next: DesignTokenValues) => {
    setValues((current) => ({ ...current, ...next }));
    Object.entries(next).forEach(([name, value]) => {
      if (typeof value === "string") onTokenChange(name, value);
    });
  }, [onTokenChange]);

  const resetAll = React.useCallback(() => {
    updateMany(Object.fromEntries(selectedThemeControls.map((control) => [control.storageName, control.value])));
  }, [selectedThemeControls, updateMany]);

  const filteredThemes = React.useMemo(() => {
    const query = themeSearch.trim().toLowerCase();
    if (!query) return DESIGN_SYSTEM_THEMES;
    return DESIGN_SYSTEM_THEMES.filter((theme) => {
      const haystack = `${theme.name} ${theme.category} ${theme.description} ${theme.id}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [themeSearch]);

  return (
    <aside
      ref={drawerRef}
      className={cn(
        embedded
          ? "min-h-0 flex-1 overflow-hidden bg-background"
          : "absolute inset-y-0 right-0 z-30 overflow-visible border-l border-border/70 bg-background shadow-[-12px_0_32px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-out",
        !embedded && (open ? "translate-x-0" : "pointer-events-none translate-x-full"),
      )}
      style={embedded ? undefined : { width: drawerWidth }}
      aria-hidden={!open}
      data-testid="design-system-drawer"
    >
      {!embedded ? <div
        role="separator"
        aria-label={t("design_system.resize")}
        aria-orientation="vertical"
        aria-valuemin={DRAWER_MIN_WIDTH}
        aria-valuemax={DRAWER_MAX_WIDTH}
        aria-valuenow={drawerWidth}
        tabIndex={open ? 0 : -1}
        className={cn(
          "group absolute inset-y-0 left-0 z-10 w-1 cursor-col-resize touch-none outline-none",
          "after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-transparent after:transition-colors",
          "hover:after:bg-primary/60 focus-visible:after:bg-primary",
          resizing && "after:bg-primary",
        )}
        onPointerDown={startResize}
        onPointerMove={moveResize}
        onPointerUp={stopResize}
        onPointerCancel={stopResize}
        onLostPointerCapture={stopResize}
        onDoubleClick={() => updateDrawerWidth(DRAWER_DEFAULT_WIDTH)}
        onKeyDown={handleResizeKeyDown}
      >
        <span className="pointer-events-none absolute left-0 top-1/2 grid h-9 w-3 -translate-y-1/2 place-items-center rounded-sm border border-border bg-background text-muted-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <GripVertical className="size-3" />
        </span>
      </div> : null}
      <div className="flex h-full w-full flex-col overflow-hidden">
        {!embedded ? <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-3">
          <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary"><Palette className="size-3.5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">{t("design_system.title")}</p>
            <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-[10px] text-muted-foreground">
              <span className="truncate">{templateName}</span>
              <span aria-hidden>/</span>
              <span
                className={cn(
                  "max-w-full truncate rounded-full border px-1.5 py-0.5",
                  currentTheme ? "border-primary/25 bg-primary/10 text-primary" : "border-border bg-muted/45",
                )}
              >
                {currentTheme
                  ? t("design_system.current_theme", { theme: currentTheme.name })
                  : t("design_system.no_theme")}
              </span>
            </div>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label={t("design_system.close")}><X /></Button>
        </div> : null}

        {embedded ? <EmbeddedDesignSystemControls
          values={values}
          selectedTheme={selectedTheme}
          currentThemeId={currentThemeId}
          onTokenChange={update}
          onTokenChangeMany={updateMany}
          onApplyTheme={(theme) => {
            setSelectedThemeId(theme.id);
            setValues((current) => ({ ...current, ...buildDesignSystemPresetValues(theme) }));
            onApplyDesignSystem?.(theme);
          }}
          onReset={resetAll}
          onChooseBackgroundImage={onChooseBackgroundImage}
        /> : <>
        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/70 p-2">
          {TABS.map(({ id, labelKey, icon: Icon }) => {
            const disabled = id === "variables" && variablesDisabled;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                disabled={disabled}
                title={disabled ? t("design_system.variables_disabled_hint") : undefined}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors",
                  tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  disabled && "cursor-not-allowed opacity-40 hover:bg-transparent hover:text-muted-foreground",
                )}
                aria-pressed={tab === id}
                aria-describedby={disabled ? "design-system-variables-disabled-hint" : undefined}
              >
                <Icon className="size-3.5" />
                {t(labelKey)}
              </button>
            );
          })}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "systems" ? (
            <div className="space-y-3">
              <DrawerHeading title={t("design_system.systems_heading")} description={t("design_system.systems_description")} />
              {!currentTheme ? (
                <div className="rounded-lg border border-dashed border-border/80 bg-muted/25 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                  {t("design_system.no_theme_hint")}
                </div>
              ) : null}
              <Input
                className="h-8 rounded-lg bg-muted/45 px-2 text-[11px]"
                placeholder={t("design_system.search_placeholder")}
                value={themeSearch}
                onChange={(event) => setThemeSearch(event.currentTarget.value)}
                aria-label={t("design_system.search_label")}
              />
              {filteredThemes.length ? filteredThemes.map((theme) => {
                const active = theme.id === selectedThemeId;
                return (
                  <div
                    key={theme.id}
                    className={cn(
                      "w-full overflow-hidden rounded-xl border bg-background text-left transition-colors",
                      active ? "border-primary/60 ring-1 ring-primary/20" : "border-border/70 hover:border-primary/40 hover:bg-primary/5",
                    )}
                  >
                    <button
                      type="button"
                      className="block w-full text-left"
                      onClick={() => setSelectedThemeId(theme.id)}
                      aria-pressed={active}
                    >
                    <ThemePreview theme={theme} />
                    <div className="space-y-1 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold">{theme.name}</span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{theme.category}</span>
                      </div>
                      <p className="text-[11px] leading-4 text-muted-foreground">{theme.description}</p>
                    </div>
                    </button>
                    <div className="px-3 pb-3">
                      <Button
                        size="xs"
                        className="h-7 w-full"
                        onClick={() => {
                          setSelectedThemeId(theme.id);
                          setValues((current) => ({ ...current, ...buildDesignSystemPresetValues(theme) }));
                          onApplyDesignSystem?.(theme);
                        }}
                      >
                        {currentThemeId === theme.id ? t("design_system.current_theme_button") : t("design_system.apply_theme")}
                      </Button>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                  {t("design_system.no_themes_found")}
                </div>
              )}
            </div>
          ) : null}

          {tab === "variables" ? (
            <div className="space-y-5">
              <DrawerHeading title={t("design_system.variables_heading")} description={t("design_system.variables_description", { theme: selectedTheme?.name ?? t("design_system.current_theme_fallback"), count: selectedThemeControls.length })} />
              {variablesDisabled ? (
                <div id="design-system-variables-disabled-hint" className="rounded-lg border border-dashed border-border/80 bg-muted/25 px-3 py-2 text-[11px] leading-4 text-muted-foreground">
                  {t("design_system.variables_disabled_hint")}
                </div>
              ) : null}
              <div className="space-y-4">
                {selectedThemeGroups.map(([title, controls]) => (
                  <TokenGroup key={title} title={title}>
                    {controls.map((control) => (
                      <ThemeSourceTokenControl
                        key={control.name}
                        token={control}
                        value={values[control.storageName] ?? control.value}
                        onChange={(value) => update(control.storageName, value)}
                      />
                    ))}
                  </TokenGroup>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border/70 px-3 py-2">
          <p className="text-[10px] text-muted-foreground">{t("design_system.variables_footer")}</p>
          <Button variant="ghost" size="xs" onClick={resetAll}><RotateCcw /> {t("design_system.reset_all")}</Button>
        </div>
        </>}
      </div>
    </aside>
  );
}

function ThemePreview({ theme }: { theme: DesignSystemTheme }) {
  const [loaded, setLoaded] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const previewDoc = React.useMemo(() => buildDesignSystemCardPreviewDoc(theme), [theme]);
  const swatches = React.useMemo(() => {
    const values: string[] = [];
    for (const name of ["--ipw-color-primary", "--ipw-color-secondary", "--ipw-color-accent"]) {
      const match = theme.tokensCss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
      if (match?.[1]) values.push(match[1].trim());
    }
    return values;
  }, [theme.tokensCss]);

  React.useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [previewDoc]);

  return (
    <div className="relative h-[320px] overflow-hidden bg-muted/40">
      {!loaded || failed ? (
        <div className="absolute inset-0 z-0 flex flex-col justify-between bg-background p-4">
          <div className="flex gap-2">
            {swatches.map((color) => (
              <span key={color} className="size-6 rounded-full border border-black/10 shadow-sm" style={{ background: color }} />
            ))}
          </div>
          <div>
            <p className="text-xs font-semibold text-foreground">{theme.name}</p>
            <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
              {failed ? t("design_system.preview_failed") : t("design_system.preview_loading")}
            </p>
          </div>
        </div>
      ) : null}
      {!failed ? (
        <iframe
          title={t("design_system.preview_title", { theme: theme.name })}
          srcDoc={previewDoc}
          className={cn("relative z-10 h-full w-full border-0 bg-white transition-opacity", loaded ? "opacity-100" : "opacity-0")}
          sandbox="allow-same-origin"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      ) : null}
    </div>
  );
}

type EmbeddedDesignSystemControlsProps = {
  values: DesignTokenValues;
  selectedTheme: DesignSystemTheme | undefined;
  currentThemeId?: string | null;
  onTokenChange: (name: string, value: string) => void;
  onTokenChangeMany: (values: DesignTokenValues) => void;
  onApplyTheme: (theme: DesignSystemTheme) => void;
  onReset: () => void;
  onChooseBackgroundImage?: () => void;
};

function EmbeddedDesignSystemControls({
  values,
  selectedTheme,
  currentThemeId,
  onTokenChange,
  onTokenChangeMany,
  onApplyTheme,
  onReset,
  onChooseBackgroundImage,
}: EmbeddedDesignSystemControlsProps) {
  const [presetOpen, setPresetOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [category, setCategory] = React.useState("All");
  const [motion, setMotion] = React.useState("none");
  const backgroundMode = backgroundModeFor(values);
  const categories = React.useMemo(
    () => ["All", ...new Set(DESIGN_SYSTEM_THEMES.map((theme) => theme.category))],
    [],
  );
  const themes = React.useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return DESIGN_SYSTEM_THEMES.filter((theme) => {
      const matchesCategory = category === "All" || theme.category === category;
      return matchesCategory && (!normalizedQuery || `${theme.name} ${theme.description}`.toLowerCase().includes(normalizedQuery));
    });
  }, [category, query]);
  const colorValues = themeControlColors(values, selectedTheme);
  const themeTokens = selectedTheme ? parseCssVariableMap(selectedTheme.tokensCss) : {};
  const displayFont = resolveThemeTokenValue(values["--ipw-font-display"], themeTokens) ?? DEFAULTS["--ipw-font-display"];
  const bodyFont = resolveThemeTokenValue(values["--ipw-font-body"], themeTokens) ?? DEFAULTS["--ipw-font-body"];
  const cardRadius = resolveThemeTokenValue(values["--ipw-card-radius"], themeTokens);
  const pagePadding = resolveThemeTokenValue(values["--ipw-page-padding"], themeTokens);
  const cardShadow = resolveThemeTokenValue(values["--ipw-card-shadow"], themeTokens);

  const applyBackgroundMode = (mode: BackgroundMode) => {
    if (mode === "none") onTokenChangeMany({ "--ipw-bg-mode": mode, "--ipw-bg-gradient": "none", "--ipw-bg-image": "none", "--ipw-bg-overlay": "linear-gradient(rgba(28,27,26,0), rgba(28,27,26,0))", "--ipw-bg-overlay-opacity": "0" });
    if (mode === "solid") onTokenChangeMany({ "--ipw-bg-mode": mode, "--ipw-bg-gradient": "none", "--ipw-bg-image": "none", "--ipw-bg-overlay": "linear-gradient(rgba(28,27,26,0), rgba(28,27,26,0))", "--ipw-bg-overlay-opacity": "0" });
    if (mode === "gradient") onTokenChangeMany({
      "--ipw-bg-mode": mode,
      "--ipw-bg-gradient": `linear-gradient(135deg, ${colorValues[0]}, ${colorValues[1]})`,
      "--ipw-bg-image": "none",
      "--ipw-bg-overlay": "linear-gradient(rgba(28,27,26,0), rgba(28,27,26,0))",
      "--ipw-bg-overlay-opacity": "0",
    });
    if (mode === "image") onTokenChangeMany({ "--ipw-bg-mode": mode, "--ipw-bg-gradient": "none", "--ipw-bg-overlay": "linear-gradient(rgba(28,27,26,.45), rgba(28,27,26,.45))", "--ipw-bg-overlay-opacity": "0.45", "--ipw-bg-size": "cover", "--ipw-bg-position": "50% 50%" });
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-white text-[#24262b]">
      <div className="space-y-0">
        <PanelSection title="Style preset">
          <button type="button" className="flex h-16 w-full items-center gap-3 rounded-[9px] border border-[#ebebeb] p-2 text-left hover:border-[#cfd3da]" onClick={() => setPresetOpen((open) => !open)} aria-expanded={presetOpen}>
            <ThemeThumbnail colors={colorValues} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-semibold">{selectedTheme?.name ?? "Custom"}</span><span className="mt-1 block truncate text-[11px] text-[#858a94]">{selectedTheme?.description ?? "Your current style preset"}</span></span>
            {presetOpen ? <img src={designSystemChevronUpIcon} alt="" className="size-4 shrink-0" /> : <ChevronDown className="size-4 shrink-0 text-[#858a94]" />}
          </button>
          {presetOpen ? <div className="mt-3 h-[474px] rounded-xl border border-[#dedfe3] p-3 shadow-[0_8px_18px_rgba(37,41,49,0.11)]">
            <div className="relative"><img src={designSystemSearchIcon} alt="" className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2" /><Input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="Search presets..." className="h-[34px] rounded-lg border-0 bg-[#f4f5f7] pl-[34px] text-[12px] shadow-none" /></div>
            <div className="mt-[9px] flex gap-[5px] overflow-x-auto pb-1">{categories.map((item) => <button key={item} type="button" className={cn("h-[27px] shrink-0 rounded-[7px] px-2 text-[11px] transition-colors", category === item ? "bg-[#202124] text-white" : "bg-[#f4f5f7] text-[#70757e] hover:bg-[#ebebeb]")} onClick={() => setCategory(item)}>{item}</button>)}</div>
            <div className="mt-[9px] max-h-[340px] space-y-[5px] overflow-y-auto">{themes.map((theme) => {
              const active = theme.id === currentThemeId;
              return <button key={theme.id} type="button" className={cn("flex h-16 w-full items-center gap-2.5 rounded-[9px] border p-2 text-left transition-colors", active ? "border-[#9cbdf0] bg-[#f4f8ff]" : "border-transparent bg-white hover:bg-[#f5f6f9]")} onClick={() => { onApplyTheme(theme); setPresetOpen(false); }}>
                <ThemeThumbnail colors={themeColors(theme)} /><span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-semibold">{theme.name}</span><span className="block truncate text-[10px] text-[#858a94]">{theme.category}</span></span>{active ? <Check className="size-4 text-[#2f6de1]" /> : null}
              </button>;
            })}</div>
          </div> : null}
        </PanelSection>

        <PanelSection title="Theme Colors">
          <div className="flex items-center gap-[11px]">{(["--ipw-color-primary", "--ipw-color-secondary", "--ipw-color-bg"] as const).map((name, index) => <ColorSwatch key={name} label={["Primary", "Secondary", "Background"][index] ?? name} value={colorValues[index] ?? DEFAULTS[name]} onChange={(value) => onTokenChange(name, value)} />)}<button type="button" onClick={onReset} className="grid size-[25px] place-items-center rounded-[7px] border border-[#dee0e5] bg-[#f0f2f5]" aria-label="Reset theme colors"><img src={designSystemRefreshIcon} alt="" className="size-4" /></button></div>
        </PanelSection>

        <BackgroundSection mode={backgroundMode} values={values} colors={colorValues} onSelectMode={applyBackgroundMode} onTokenChange={onTokenChange} onChooseMedia={onChooseBackgroundImage} />

        <PanelSection title="Typography">
          <div className="space-y-3"><LabeledTokenSelect label="Heading Font" value={displayFont} ariaLabel="Heading font" options={fontOptions(displayFont, "Preset heading")} onChange={(value) => onTokenChange("--ipw-font-display", value)} /><LabeledTokenSelect label="Body Font" value={bodyFont} ariaLabel="Body font" options={fontOptions(bodyFont, "Preset body")} onChange={(value) => onTokenChange("--ipw-font-body", value)} /></div>
        </PanelSection>

        <PanelSection title="Type Scale"><div className="grid grid-cols-3 gap-1">{([{ label: "Small", value: ".9" }, { label: "Medium", value: "1" }, { label: "Large", value: "1.12" }] as const).map((item) => <SegmentButton key={item.value} active={typeScalePresetFor(values["--ipw-type-scale"]) === item.value} onClick={() => onTokenChange("--ipw-type-scale", item.value)}>{item.label}</SegmentButton>)}</div></PanelSection>
        <PanelSection title="Radius Style"><div className="grid grid-cols-3 gap-1">{([{ label: "None", button: "0px", card: "0px" }, { label: "Subtle", button: "8px", card: "12px" }, { label: "Rounded", button: "16px", card: "24px" }] as const).map((item) => <SegmentButton key={item.label} active={radiusPresetFor(cardRadius) === item.label} onClick={() => onTokenChangeMany({ "--ipw-button-radius": item.button, "--ipw-card-radius": item.card })}>{item.label}</SegmentButton>)}</div></PanelSection>
        <PanelSection title="Spacing"><div className="grid grid-cols-3 gap-1">{([{ label: "Compact", page: "20px", section: "48px" }, { label: "Standard", page: "32px", section: "80px" }, { label: "Spacious", page: "48px", section: "112px" }] as const).map((item) => <SegmentButton key={item.label} active={spacingPresetFor(pagePadding) === item.label} onClick={() => onTokenChangeMany({ "--ipw-page-padding": item.page, "--ipw-section-space": item.section })}>{item.label}</SegmentButton>)}</div></PanelSection>
        <PanelSection title="Shadow"><TokenSelect value={cardShadow ?? "none"} ariaLabel="Shadow" options={shadowOptions(cardShadow)} onChange={(value) => onTokenChange("--ipw-card-shadow", value)} /></PanelSection>
        <PanelSection title="Motion"><TokenSelect value={motion} ariaLabel="Motion" options={MOTION_OPTIONS} onChange={setMotion} /></PanelSection>
      </div>
      <div className="flex items-center justify-end border-t border-[#ebebeb] px-4 py-2"><Button variant="ghost" size="xs" onClick={onReset}><RotateCcw /> Reset</Button></div>
    </div>
  );
}

type BackgroundMode = "none" | "solid" | "gradient" | "image";
const FONT_OPTIONS = [
  { label: "System", value: DEFAULTS["--ipw-font-body"] },
  { label: "Inter", value: "Inter, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "IBM Plex Sans", value: '"IBM Plex Sans", sans-serif' },
];
const SHADOW_OPTIONS = [
  { label: "None", value: "none" },
  { label: "Subtle", value: "0 8px 24px rgba(28,27,26,.08)" },
  { label: "Strong", value: "0 18px 42px rgba(28,27,26,.16)" },
];
const MOTION_OPTIONS = [{ label: "None", value: "none" }, { label: "Gentle", value: "gentle" }, { label: "Expressive", value: "expressive" }];
function withPresetOption(options: Array<{ label: string; value: string }>, value: string | undefined, label: string) { return value && !options.some((item) => item.value === value) ? [{ label, value }, ...options] : options; }
function fontOptions(value: string, label: string) { return withPresetOption(FONT_OPTIONS, value, label); }
function shadowOptions(value: string | undefined) { return withPresetOption(SHADOW_OPTIONS, value, "Preset shadow"); }

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border-b border-[#ebebeb] px-4 pb-6 pt-2"><h3 className="mb-3 text-[14px] font-semibold leading-5">{title}</h3>{children}</section>; }
function SegmentButton({ active, children, onClick }: { active: boolean; children: React.ReactNode; onClick: () => void }) { return <button type="button" className={cn("h-[34px] rounded-lg px-1 text-[14px] font-normal transition-colors", active ? "bg-black text-white" : "bg-[#f5f6f9] text-[#858a94] hover:bg-[#ebebeb]")} onClick={onClick} aria-pressed={active}>{children}</button>; }
function TokenSelect({ value, ariaLabel, options, onChange }: { value: string; ariaLabel: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) { const option = options.find((item) => item.value === value) ?? options[0]; if (!option) return null; return <DesignPanelSelect value={option.value} options={options} onChange={onChange} ariaLabel={ariaLabel} className="h-[34px] w-full rounded-lg bg-[#f5f6f9]" />; }
function LabeledTokenSelect({ label, ...props }: { label: string; value: string; ariaLabel: string; options: Array<{ label: string; value: string }>; onChange: (value: string) => void }) { return <label className="block"><span className="mb-1 block text-[10px] text-[#858a94]">{label}</span><TokenSelect {...props} /></label>; }
function ColorSwatch({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) { return <label className="group relative grid size-[25px] cursor-pointer place-items-center rounded-[7px] border border-black/10" title={label} style={{ backgroundColor: normalizeHex(value, "#ffffff") }}><input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={normalizeHex(value, "#ffffff")} onChange={(event) => onChange(event.currentTarget.value)} aria-label={`${label} color`} /></label>; }
function BackgroundSection({ mode, values, colors, onSelectMode, onTokenChange, onChooseMedia }: { mode: BackgroundMode; values: DesignTokenValues; colors: string[]; onSelectMode: (mode: BackgroundMode) => void; onTokenChange: (name: string, value: string) => void; onChooseMedia?: () => void }) {
  const controls: Array<{ mode: BackgroundMode; label: string; icon: string }> = [{ mode: "none", label: "No background", icon: backgroundNoneIcon }, { mode: "solid", label: "Solid color", icon: backgroundSolidDefaultIcon }, { mode: "gradient", label: "Gradient", icon: backgroundGradientIcon }, { mode: "image", label: "Image", icon: backgroundImageIcon }];
  const solidColor = normalizeHex(colors[2] ?? "#ffffff", "#ffffff");
  const imageMode = backgroundImageFitMode(values["--ipw-bg-size"]);

  return <PanelSection title="Background">
    <div className="flex gap-1">{controls.map(({ mode: itemMode, label, icon }) => <button key={itemMode} type="button" className={cn("grid h-[34px] flex-1 place-items-center rounded-lg transition-colors", mode === itemMode ? "bg-black" : "bg-[#f5f6f9] hover:bg-[#ebebeb]")} onClick={() => onSelectMode(itemMode)} aria-label={label} aria-pressed={mode === itemMode}>{itemMode === "solid" ? <img src={mode === "solid" ? backgroundSolidActiveIcon : icon} alt="" className="h-[34px] w-[68px] max-w-none" /> : <img src={icon} alt="" className={cn("size-4", mode === itemMode && "brightness-0 invert")} />}</button>)}</div>
    {mode === "solid" ? <DesignColorField value={solidColor} onChange={(value) => onTokenChange("--ipw-color-bg", value)} className="mt-3" /> : null}
    {mode === "gradient" ? <button type="button" className="mt-3 flex h-[34px] w-full items-center justify-between rounded-lg bg-[#f5f6f9] px-2 pr-4 text-left"><span className="flex items-center gap-2"><span className="size-5 rounded-[4px] bg-gradient-to-b from-[#2e6bdb] to-[#76e3e9]" /><span className="text-[13px]">Gradient</span></span><ChevronDown className="size-4 text-[#858a94]" /></button> : null}
    {mode === "image" ? <div className="mt-3 space-y-3">
      <DesignImageFitSelect value={imageMode} onChange={(value) => { onTokenChange("--ipw-bg-size", backgroundSizeFor(value)); onTokenChange("--ipw-bg-position", "50% 50%"); }} ariaLabel="Background image fit mode" />
      <div className="group relative flex h-[100px] w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(45deg,#929292_25%,#9f9f9f_25%,#9f9f9f_50%,#929292_50%,#929292_75%,#9f9f9f_75%)] bg-[length:24px_24px]" style={backgroundImageStyle(values["--ipw-bg-image"], values["--ipw-bg-size"], values["--ipw-bg-position"])}>
        <span className="absolute inset-0 bg-black/45" />
        <button type="button" className="relative inline-flex h-[30px] items-center justify-center rounded-lg bg-black px-4 text-[10px] text-white transition-colors group-hover:bg-black/80" onClick={onChooseMedia}>Choose Media</button>
      </div>
    </div> : null}
  </PanelSection>;
}
function ThemeThumbnail({ colors }: { colors: string[] }) { return <span className="grid size-[42px] shrink-0 grid-cols-2 overflow-hidden rounded-md border border-black/5">{colors.slice(0, 3).map((color, index) => <span key={`${color}-${index}`} className={cn(index === 0 && "row-span-2")} style={{ backgroundColor: color }} />)}</span>; }
function themeColors(theme: DesignSystemTheme) { const tokens = parseCssVariableMap(theme.tokensCss); return ["--accent", "--fg-2", "--bg"].map((name) => resolveThemeColor(tokens[name], tokens) ?? "#f5f6f9"); }
function themeControlColors(values: DesignTokenValues, theme: DesignSystemTheme | undefined) { const tokens = theme ? parseCssVariableMap(theme.tokensCss) : {}; const fallback = theme ? themeColors(theme) : ["#c96442", "#2563eb", "#fafaf9"]; return [values["--ipw-color-primary"], values["--ipw-color-secondary"], values["--ipw-color-bg"]].map((value, index) => resolveThemeColor(value, tokens) ?? fallback[index] ?? "#f5f6f9"); }
function parseCssVariableMap(source: string) { const values: Record<string, string> = {}; const pattern = /(--[a-zA-Z0-9_-]+)\s*:\s*([^;]+);/g; let match: RegExpExecArray | null; while ((match = pattern.exec(source))) values[match[1]] = match[2]?.trim() ?? ""; return values; }
function resolveThemeTokenValue(value: string | undefined, tokens: Record<string, string>, seen = new Set<string>()): string | undefined { if (!value) return undefined; const variable = value.match(/^var\(\s*(--[a-zA-Z0-9_-]+)/)?.[1]; if (!variable) return value.trim(); if (seen.has(variable)) return undefined; seen.add(variable); const source = variable.startsWith("--ipw-od-") ? `--${variable.slice("--ipw-od-".length)}` : variable; return resolveThemeTokenValue(tokens[source], tokens, seen); }
function resolveThemeColor(value: string | undefined, tokens: Record<string, string>): string | undefined { const resolved = resolveThemeTokenValue(value, tokens); return resolved && (/^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(resolved) || /^rgba?\(/i.test(resolved)) ? resolved : undefined; }
function backgroundModeFor(values: DesignTokenValues): BackgroundMode { const mode = values["--ipw-bg-mode"]; if (mode === "none" || mode === "solid" || mode === "gradient" || mode === "image") return mode; if (values["--ipw-bg-image"] && values["--ipw-bg-image"] !== "none") return "image"; if (values["--ipw-bg-gradient"] && values["--ipw-bg-gradient"] !== "none") return "gradient"; return "none"; }
type BackgroundImageFitMode = DesignImageFitMode;
function backgroundImageFitMode(value: string | undefined): BackgroundImageFitMode { if (value === "100% 100%") return "fill"; if (value === "contain") return "fit"; return "crop"; }
function backgroundSizeFor(value: BackgroundImageFitMode) { return value === "fill" ? "100% 100%" : value === "fit" ? "contain" : "cover"; }
function backgroundImageStyle(value: string | undefined, size: string | undefined, position: string | undefined): React.CSSProperties | undefined { return value && value !== "none" ? { backgroundImage: value, backgroundPosition: position ?? "50% 50%", backgroundRepeat: "no-repeat", backgroundSize: size ?? "cover" } : undefined; }
function tokenPixelValue(value: string | undefined) { const match = value?.match(/^(-?\d+(?:\.\d+)?)px$/); return match ? Number(match[1]) : undefined; }
function typeScalePresetFor(value: string | undefined) { const scale = Number(value ?? 1); return scale < 0.95 ? ".9" : scale > 1.06 ? "1.12" : "1"; }
function radiusPresetFor(value: string | undefined) { const radius = tokenPixelValue(value); if (radius === undefined) return "Subtle"; return radius <= 0 ? "None" : radius >= 18 ? "Rounded" : "Subtle"; }
function spacingPresetFor(value: string | undefined) { const spacing = tokenPixelValue(value); if (spacing === undefined) return "Standard"; return spacing <= 24 ? "Compact" : spacing >= 44 ? "Spacious" : "Standard"; }
function capitalize(value: string) { return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`; }

function DrawerHeading({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <h3 className="text-xs font-semibold">{title}</h3>
      {description ? <p className="mt-1 text-[11px] leading-4 text-muted-foreground">{description}</p> : null}
    </div>
  );
}

function TokenGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold text-foreground">{title}</h4>
      <div className="space-y-1.5">{children}</div>
    </section>
  );
}

function looksLikeColor(value: string) {
  return /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(value.trim()) || /^rgba?\(/i.test(value.trim()) || /^hsla?\(/i.test(value.trim());
}

function ThemeSourceTokenControl({
  token,
  value,
  onChange,
}: {
  token: DesignSystemTokenControl;
  value: string;
  onChange: (value: string) => void;
}) {
  const isColor = token.kind === "color" && looksLikeColor(value);
  return (
    <div className="grid grid-cols-[minmax(112px,1fr)_minmax(0,1.15fr)] items-center gap-2 px-0.5 py-1">
      <p className="truncate font-mono text-[10px] text-foreground">{token.name}</p>
      <div className="flex min-w-0 items-center gap-1.5">
        {isColor ? (
          <label className="relative size-6 shrink-0 cursor-pointer overflow-hidden rounded border border-border shadow-xs" style={{ background: value }}>
            <input className="absolute inset-0 cursor-pointer opacity-0" type="color" value={normalizeHex(value, "#ffffff")} onChange={(event) => onChange(event.currentTarget.value)} aria-label={`${token.name} color`} />
          </label>
        ) : null}
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-input bg-background px-2 font-mono text-[10px]"
          value={value}
          onChange={(event) => onChange(event.currentTarget.value)}
          aria-label={`${token.name} token value`}
        />
      </div>
    </div>
  );
}
