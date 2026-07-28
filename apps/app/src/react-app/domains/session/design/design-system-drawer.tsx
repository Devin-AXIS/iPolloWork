/** @jsxImportSource react */
import * as React from "react";
import { GripVertical, Palette, RotateCcw, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  buildDesignSystemCardPreviewDoc,
  buildDesignSystemTokenControls,
  DESIGN_SYSTEM_THEMES,
  type DesignSystemTokenControl,
  type DesignSystemTheme,
  getDesignSystemTheme,
} from "./design-system-registry";
import type { DesignTokenValues } from "./design-system-files";

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
  "--ipw-bg-image": "none",
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
  templateName: string;
  currentThemeId?: string | null;
  variablesDisabled?: boolean;
  initialValues?: DesignTokenValues;
  onClose: () => void;
  onTokenChange: (name: string, value: string) => void;
  onApplyDesignSystem?: (theme: DesignSystemTheme) => void;
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
  templateName,
  currentThemeId,
  variablesDisabled = false,
  initialValues,
  onClose,
  onTokenChange,
  onApplyDesignSystem,
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
        "absolute inset-y-0 right-0 z-30 overflow-visible border-l border-border/70 bg-background shadow-[-12px_0_32px_rgba(0,0,0,0.08)] transition-transform duration-200 ease-out",
        open ? "translate-x-0" : "pointer-events-none translate-x-full",
      )}
      style={{ width: drawerWidth }}
      aria-hidden={!open}
      data-testid="design-system-drawer"
    >
      <div
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
      </div>
      <div className="flex h-full w-full flex-col overflow-hidden">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-3">
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
        </div>

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
