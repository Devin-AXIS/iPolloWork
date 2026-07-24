/** @jsxImportSource react */
import * as React from "react";
import { ImagePlus, Palette, RotateCcw, SlidersHorizontal, Sparkles, Type, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type DesignSystemTab = "theme" | "background" | "typography" | "components";

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

export type DesignTokenValues = Partial<Record<keyof typeof DEFAULTS, string>>;

type DesignSystemDrawerProps = {
  open: boolean;
  templateName: string;
  initialValues?: DesignTokenValues;
  onClose: () => void;
  onTokenChange: (name: string, value: string) => void;
  onBackgroundImageUpload: (file: File) => Promise<string>;
};

const SECTION_KEYS: Record<DesignSystemTab, readonly (keyof typeof DEFAULTS)[]> = {
  theme: [
    "--ipw-color-primary", "--ipw-color-secondary", "--ipw-color-accent",
    "--ipw-color-bg", "--ipw-color-surface", "--ipw-color-text",
    "--ipw-color-muted", "--ipw-color-border", "--ipw-color-success",
    "--ipw-color-warning", "--ipw-color-danger",
  ],
  background: [
    "--ipw-color-bg", "--ipw-bg-gradient", "--ipw-bg-image", "--ipw-bg-overlay",
    "--ipw-bg-overlay-color", "--ipw-bg-overlay-opacity",
  ],
  typography: [
    "--ipw-font-display", "--ipw-font-body", "--ipw-type-scale",
    "--ipw-body-line-height",
  ],
  components: [
    "--ipw-content-width", "--ipw-page-padding", "--ipw-section-space",
    "--ipw-button-radius", "--ipw-card-bg", "--ipw-card-border",
    "--ipw-card-radius", "--ipw-card-shadow", "--ipw-card-blur",
  ],
};

const TABS: Array<{ id: DesignSystemTab; label: string; icon: React.ElementType }> = [
  { id: "theme", label: "Theme", icon: Palette },
  { id: "background", label: "Background", icon: Sparkles },
  { id: "typography", label: "Type", icon: Type },
  { id: "components", label: "Components", icon: SlidersHorizontal },
];

const GRADIENTS = [
  { label: "None", value: "none" },
  { label: "Aurora", value: "radial-gradient(circle at 12% 12%, rgba(124,58,237,.34), transparent 42%), radial-gradient(circle at 86% 8%, rgba(37,99,235,.28), transparent 38%)" },
  { label: "Sunset", value: "linear-gradient(135deg, rgba(249,115,22,.30), rgba(236,72,153,.22) 48%, rgba(124,58,237,.26))" },
  { label: "Ocean", value: "linear-gradient(135deg, rgba(14,165,233,.26), rgba(37,99,235,.20) 48%, rgba(16,185,129,.22))" },
] as const;

function normalizeHex(value: string, fallback: string) {
  if (/^#[0-9a-f]{6}$/i.test(value.trim())) return value.trim();
  const rgb = value.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return fallback;
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
}

function toRgba(color: string, opacity: number) {
  const hex = normalizeHex(color, "#1c1b1a");
  const red = Number.parseInt(hex.slice(1, 3), 16);
  const green = Number.parseInt(hex.slice(3, 5), 16);
  const blue = Number.parseInt(hex.slice(5, 7), 16);
  return `rgba(${red}, ${green}, ${blue}, ${Math.min(1, Math.max(0, opacity))})`;
}

function unwrapCssUrl(value: string) {
  const match = value.match(/^url\((?:["']?)(.*?)(?:["']?)\)$/i);
  return match?.[1] ?? (value === "none" ? "" : value);
}

function cssUrl(value: string) {
  const trimmed = value.trim();
  return trimmed ? `url("${trimmed.replace(/"/g, "%22")}")` : "none";
}

export function DesignSystemDrawer({
  open,
  templateName,
  initialValues,
  onClose,
  onTokenChange,
  onBackgroundImageUpload,
}: DesignSystemDrawerProps) {
  const [tab, setTab] = React.useState<DesignSystemTab>("theme");
  const [values, setValues] = React.useState<Record<keyof typeof DEFAULTS, string>>({ ...DEFAULTS });
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (open) setValues({ ...DEFAULTS, ...initialValues });
  }, [initialValues, open]);

  const update = React.useCallback((name: keyof typeof DEFAULTS, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
    onTokenChange(name, value);
  }, [onTokenChange]);

  const updateMany = React.useCallback((next: Partial<Record<keyof typeof DEFAULTS, string>>) => {
    setValues((current) => ({ ...current, ...next }));
    Object.entries(next).forEach(([name, value]) => {
      if (typeof value === "string") onTokenChange(name, value);
    });
  }, [onTokenChange]);

  const resetSection = React.useCallback(() => {
    const reset = Object.fromEntries(SECTION_KEYS[tab].map((key) => [key, DEFAULTS[key]])) as Partial<Record<keyof typeof DEFAULTS, string>>;
    updateMany(reset);
  }, [tab, updateMany]);

  const setOverlay = React.useCallback((color: string, opacity: string) => {
    const alpha = Math.max(0, Math.min(1, Number(opacity) || 0));
    updateMany({
      "--ipw-bg-overlay-color": color,
      "--ipw-bg-overlay-opacity": String(alpha),
      "--ipw-bg-overlay": `linear-gradient(${toRgba(color, alpha)}, ${toRgba(color, alpha)})`,
    });
  }, [updateMany]);

  const setGlass = React.useCallback((strength: "off" | "subtle" | "medium" | "strong") => {
    const presets = {
      off: {
        "--ipw-card-bg": values["--ipw-color-surface"],
        "--ipw-card-border": values["--ipw-color-border"],
        "--ipw-card-blur": "0px",
        "--ipw-card-shadow": "0 12px 32px rgba(28,27,26,.10)",
      },
      subtle: {
        "--ipw-card-bg": "rgba(255,255,255,.76)",
        "--ipw-card-border": "rgba(255,255,255,.54)",
        "--ipw-card-blur": "10px",
        "--ipw-card-shadow": "0 14px 34px rgba(28,27,26,.10)",
      },
      medium: {
        "--ipw-card-bg": "rgba(255,255,255,.62)",
        "--ipw-card-border": "rgba(255,255,255,.62)",
        "--ipw-card-blur": "18px",
        "--ipw-card-shadow": "0 18px 44px rgba(28,27,26,.14)",
      },
      strong: {
        "--ipw-card-bg": "rgba(255,255,255,.46)",
        "--ipw-card-border": "rgba(255,255,255,.72)",
        "--ipw-card-blur": "28px",
        "--ipw-card-shadow": "0 24px 58px rgba(28,27,26,.18)",
      },
    } as const;
    updateMany(presets[strength]);
  }, [updateMany, values]);

  return (
    <aside
      className={cn(
        "shrink-0 overflow-hidden border-l border-border/70 bg-background transition-[width,border-color] duration-200 ease-out",
        open ? "w-[340px]" : "w-0 border-l-transparent",
      )}
      aria-hidden={!open}
      data-testid="design-system-drawer"
    >
      <div className="flex h-full w-[340px] flex-col">
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="sr-only"
          aria-label="Upload background image"
          onChange={async (event) => {
            const file = event.currentTarget.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            try {
              update("--ipw-bg-image", cssUrl(await onBackgroundImageUpload(file)));
            } catch {
              // The parent owns file validation and surfaces any error consistently.
            }
          }}
        />
        <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3 py-3">
          <div className="grid size-7 place-items-center rounded-lg bg-primary/10 text-primary"><Palette className="size-3.5" /></div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Design system</p>
            <p className="truncate text-[10px] text-muted-foreground">{templateName}</p>
          </div>
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close design system"><X /></Button>
        </div>

        <div className="grid shrink-0 grid-cols-4 gap-1 border-b border-border/70 p-2">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-lg px-1 py-2 text-[9px] font-medium transition-colors",
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
          {tab === "theme" ? (
            <div className="space-y-5">
              <DrawerHeading title="Brand palette" description="Use semantic colors so the whole template stays coherent." />
              <div className="space-y-2">
                <ColorToken label="Primary" value={values["--ipw-color-primary"]} onChange={(value) => update("--ipw-color-primary", value)} />
                <ColorToken label="Secondary" value={values["--ipw-color-secondary"]} onChange={(value) => update("--ipw-color-secondary", value)} />
                <ColorToken label="Accent" value={values["--ipw-color-accent"]} onChange={(value) => update("--ipw-color-accent", value)} />
              </div>
              <DrawerHeading title="Surfaces & text" />
              <div className="space-y-2">
                <ColorToken label="Canvas" value={values["--ipw-color-bg"]} onChange={(value) => update("--ipw-color-bg", value)} />
                <ColorToken label="Surface" value={values["--ipw-color-surface"]} onChange={(value) => update("--ipw-color-surface", value)} />
                <ColorToken label="Text" value={values["--ipw-color-text"]} onChange={(value) => update("--ipw-color-text", value)} />
                <ColorToken label="Muted text" value={values["--ipw-color-muted"]} onChange={(value) => update("--ipw-color-muted", value)} />
                <ColorToken label="Border" value={values["--ipw-color-border"]} onChange={(value) => update("--ipw-color-border", value)} />
              </div>
              <DrawerHeading title="Semantic states" />
              <div className="grid grid-cols-3 gap-2">
                <ColorToken compact label="Success" value={values["--ipw-color-success"]} onChange={(value) => update("--ipw-color-success", value)} />
                <ColorToken compact label="Warning" value={values["--ipw-color-warning"]} onChange={(value) => update("--ipw-color-warning", value)} />
                <ColorToken compact label="Danger" value={values["--ipw-color-danger"]} onChange={(value) => update("--ipw-color-danger", value)} />
              </div>
            </div>
          ) : null}

          {tab === "background" ? (
            <div className="space-y-5">
              <DrawerHeading title="Page background" description="Color, gradient and image are composable layers." />
              <ColorToken label="Base canvas" value={values["--ipw-color-bg"]} onChange={(value) => update("--ipw-color-bg", value)} />
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Gradient</p>
                <div className="grid grid-cols-2 gap-2">
                  {GRADIENTS.map((gradient) => (
                    <button
                      key={gradient.label}
                      type="button"
                      onClick={() => update("--ipw-bg-gradient", gradient.value)}
                      className={cn(
                        "rounded-lg border px-2 py-2 text-left text-[10px] transition-colors",
                        values["--ipw-bg-gradient"] === gradient.value ? "border-primary bg-primary/5 text-primary" : "border-border/70 hover:bg-muted/55",
                      )}
                    >
                      <span className="mb-1 block h-4 rounded-md border border-black/5" style={{ background: gradient.value === "none" ? values["--ipw-color-bg"] : gradient.value }} />
                      {gradient.label}
                    </button>
                  ))}
                </div>
                <TokenInput label="Custom gradient" value={values["--ipw-bg-gradient"]} onChange={(value) => update("--ipw-bg-gradient", value || "none")} />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Background image</p>
                <div className="flex gap-2">
                  <Input
                    className="h-8 min-w-0 rounded-lg bg-muted/45 text-[11px]"
                    placeholder="Paste image URL"
                    value={unwrapCssUrl(values["--ipw-bg-image"])}
                    onChange={(event) => update("--ipw-bg-image", cssUrl(event.currentTarget.value))}
                  />
                  <Button variant="secondary" size="icon-sm" onClick={() => inputRef.current?.click()} aria-label="Upload background image"><ImagePlus /></Button>
                </div>
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Image overlay</p>
                <ColorToken label="Tint" value={values["--ipw-bg-overlay-color"]} onChange={(value) => setOverlay(value, values["--ipw-bg-overlay-opacity"])} />
                <RangeToken label="Opacity" value={Number(values["--ipw-bg-overlay-opacity"])} min={0} max={0.9} step={0.05} suffix="" onChange={(value) => setOverlay(values["--ipw-bg-overlay-color"], String(value))} />
              </div>
            </div>
          ) : null}

          {tab === "typography" ? (
            <div className="space-y-5">
              <DrawerHeading title="Typography" description="Set the hierarchy once; local text remains editable on canvas." />
              <FontToken label="Display font" value={values["--ipw-font-display"]} onChange={(value) => update("--ipw-font-display", value)} />
              <FontToken label="Body font" value={values["--ipw-font-body"]} onChange={(value) => update("--ipw-font-body", value)} />
              <RangeToken label="Text scale" value={Number(values["--ipw-type-scale"])} min={0.88} max={1.18} step={0.02} suffix="×" onChange={(value) => update("--ipw-type-scale", String(value))} />
              <RangeToken label="Body line height" value={Number(values["--ipw-body-line-height"])} min={1.3} max={1.8} step={0.05} suffix="" onChange={(value) => update("--ipw-body-line-height", String(value))} />
              <div className="rounded-xl border border-border/70 bg-muted/30 p-3 text-[11px] leading-5 text-muted-foreground">
                Text, links and images are still edited by selecting them directly on the canvas. This panel controls the shared typography rules.
              </div>
            </div>
          ) : null}

          {tab === "components" ? (
            <div className="space-y-5">
              <DrawerHeading title="Shared components" description="Change the visual rules for cards, buttons and page rhythm together." />
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Layout</p>
                <RangeToken label="Content width" value={Number.parseInt(values["--ipw-content-width"], 10)} min={880} max={1320} step={20} suffix="px" onChange={(value) => update("--ipw-content-width", `${value}px`)} />
                <RangeToken label="Page padding" value={Number.parseInt(values["--ipw-page-padding"], 10)} min={16} max={56} step={4} suffix="px" onChange={(value) => update("--ipw-page-padding", `${value}px`)} />
                <RangeToken label="Section spacing" value={Number.parseInt(values["--ipw-section-space"], 10)} min={48} max={128} step={4} suffix="px" onChange={(value) => update("--ipw-section-space", `${value}px`)} />
              </div>
              <div className="space-y-2">
                <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Cards & buttons</p>
                <ColorToken label="Card fill" value={values["--ipw-card-bg"]} onChange={(value) => update("--ipw-card-bg", value)} />
                <ColorToken label="Card border" value={values["--ipw-card-border"]} onChange={(value) => update("--ipw-card-border", value)} />
                <RangeToken label="Card radius" value={Number.parseInt(values["--ipw-card-radius"], 10)} min={0} max={32} step={2} suffix="px" onChange={(value) => update("--ipw-card-radius", `${value}px`)} />
                <RangeToken label="Button radius" value={Number.parseInt(values["--ipw-button-radius"], 10)} min={0} max={24} step={2} suffix="px" onChange={(value) => update("--ipw-button-radius", `${value}px`)} />
                <ShadowToken value={values["--ipw-card-shadow"]} onChange={(value) => update("--ipw-card-shadow", value)} />
              </div>
              <div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Glass effect</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {(["off", "subtle", "medium", "strong"] as const).map((strength) => (
                    <Button key={strength} variant="secondary" size="xs" className="capitalize" onClick={() => setGlass(strength)}>{strength}</Button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex shrink-0 items-center justify-between border-t border-border/70 px-3 py-2">
          <p className="text-[10px] text-muted-foreground">Template tokens apply across mapped elements.</p>
          <Button variant="ghost" size="xs" onClick={resetSection}><RotateCcw /> Reset</Button>
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

function ColorToken({ label, value, onChange, compact = false }: { label: string; value: string; onChange: (value: string) => void; compact?: boolean }) {
  const fallback = label === "Text" ? "#1c1b1a" : "#ffffff";
  return (
    <div className={cn("flex items-center gap-2", compact && "flex-col items-stretch gap-1")}>
      <Label className={cn("min-w-0 flex-1 truncate text-[11px]", compact && "text-[10px]")}>{label}</Label>
      <div className="flex items-center gap-1.5">
        <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-md border border-border shadow-xs" style={{ backgroundColor: value }}>
          <input className="absolute inset-0 cursor-pointer opacity-0" type="color" value={normalizeHex(value, fallback)} onChange={(event) => onChange(event.currentTarget.value)} aria-label={`${label} color`} />
        </label>
        {!compact ? <Input className="h-7 w-24 rounded-md bg-muted/45 px-2 font-mono text-[10px]" value={value} onChange={(event) => onChange(event.currentTarget.value)} aria-label={`${label} color value`} /> : null}
      </div>
    </div>
  );
}

function TokenInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div className="mt-2">
      <Label className="mb-1.5 block text-[10px] text-muted-foreground">{label}</Label>
      <Input className="h-8 rounded-lg bg-muted/45 px-2 text-[10px]" value={value} onChange={(event) => onChange(event.currentTarget.value)} />
    </div>
  );
}

function RangeToken({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix: string; onChange: (value: number) => void }) {
  const safeValue = Number.isFinite(value) ? value : min;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <Label className="text-[11px]">{label}</Label>
        <span className="font-mono text-[10px] text-muted-foreground">{safeValue}{suffix}</span>
      </div>
      <input className="h-1.5 w-full accent-primary" type="range" min={min} max={max} step={step} value={safeValue} onChange={(event) => onChange(Number(event.currentTarget.value))} aria-label={label} />
    </div>
  );
}

function FontToken({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px]">{label}</span>
      <select className="h-8 w-full rounded-lg border border-input bg-muted/35 px-2 text-xs" value={value} onChange={(event) => onChange(event.currentTarget.value)}>
        <option value='-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'>System sans</option>
        <option value='Georgia, "Times New Roman", serif'>Editorial serif</option>
        <option value='ui-monospace, SFMono-Regular, Menlo, monospace'>Monospace</option>
      </select>
    </label>
  );
}

function ShadowToken({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const presets = [
    { label: "Flat", value: "none" },
    { label: "Soft", value: "0 12px 32px rgba(28,27,26,.10)" },
    { label: "Lifted", value: "0 20px 50px rgba(28,27,26,.16)" },
  ];
  return (
    <div>
      <p className="mb-1.5 text-[11px]">Card shadow</p>
      <div className="grid grid-cols-3 gap-1.5">
        {presets.map((preset) => (
          <Button key={preset.label} variant={value === preset.value ? "secondary" : "outline"} size="xs" onClick={() => onChange(preset.value)}>{preset.label}</Button>
        ))}
      </div>
    </div>
  );
}
