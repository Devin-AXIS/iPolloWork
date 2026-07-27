/** @jsxImportSource react */
import * as React from "react";
import { Palette, RotateCcw, SlidersHorizontal, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import {
  buildDesignSystemCardPreviewDoc,
  buildDesignSystemTokenControls,
  DESIGN_SYSTEM_THEMES,
  type DesignSystemTokenControl,
  type DesignSystemTheme,
  getDesignSystemTheme,
} from "./design-system-registry";

type DesignSystemTab = "systems" | "variables";

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

export type DesignTokenValues = Record<string, string>;

type DesignSystemDrawerProps = {
  open: boolean;
  templateName: string;
  currentThemeId?: string | null;
  initialValues?: DesignTokenValues;
  onClose: () => void;
  onTokenChange: (name: string, value: string) => void;
  onApplyDesignSystem?: (theme: DesignSystemTheme) => void;
};

const TABS: Array<{ id: DesignSystemTab; label: string; icon: React.ElementType }> = [
  { id: "systems", label: "选择设计系统", icon: Palette },
  { id: "variables", label: "批量修改变量", icon: SlidersHorizontal },
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
  initialValues,
  onClose,
  onTokenChange,
  onApplyDesignSystem,
}: DesignSystemDrawerProps) {
  const [tab, setTab] = React.useState<DesignSystemTab>("systems");
  const [values, setValues] = React.useState<DesignTokenValues>({ ...DEFAULTS });
  const [selectedThemeId, setSelectedThemeId] = React.useState(currentThemeId ?? DESIGN_SYSTEM_THEMES[0]?.id ?? "");
  const [themeSearch, setThemeSearch] = React.useState("");
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
      className={cn(
        "shrink-0 overflow-hidden border-l border-border/70 bg-background transition-[width,border-color] duration-200 ease-out",
        open ? "w-[360px]" : "w-0 border-l-transparent",
      )}
      aria-hidden={!open}
      data-testid="design-system-drawer"
    >
      <div className="flex h-full w-[360px] flex-col">
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-3">
          <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary"><Palette className="size-3.5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Design system</p>
            <p className="truncate text-[10px] text-muted-foreground">{templateName}</p>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close design system"><X /></Button>
        </div>

        <div className="grid shrink-0 grid-cols-2 gap-1 border-b border-border/70 p-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-[11px] font-medium transition-colors",
                tab === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
              aria-pressed={tab === id}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {tab === "systems" ? (
            <div className="space-y-3">
              <DrawerHeading title="选择设计系统" description="Pick a preset to swap the current HTML theme tokens." />
              <Input
                className="h-8 rounded-lg bg-muted/45 px-2 text-[11px]"
                placeholder="Search themes..."
                value={themeSearch}
                onChange={(event) => setThemeSearch(event.currentTarget.value)}
                aria-label="Search design systems"
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
                        <iframe
                          title={`${theme.name} preview`}
                          srcDoc={buildDesignSystemCardPreviewDoc(theme)}
                          className="h-[320px] w-full border-0 bg-white"
                          sandbox="allow-same-origin"
                        />
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
                        {currentThemeId === theme.id ? "当前主题" : "应用主题"}
                      </Button>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                  No themes found.
                </div>
              )}
            </div>
          ) : null}

          {tab === "variables" ? (
            <div className="space-y-5">
              <DrawerHeading title="设计 token" description={`${selectedTheme?.name ?? "Current theme"} · ${selectedThemeControls.length} 个主题原始变量`} />
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
          <p className="text-[10px] text-muted-foreground">仅显示当前主题 tokens.css 中存在的变量。</p>
          <Button variant="ghost" size="xs" onClick={resetAll}><RotateCcw /> Reset all</Button>
        </div>
      </div>
    </aside>
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
