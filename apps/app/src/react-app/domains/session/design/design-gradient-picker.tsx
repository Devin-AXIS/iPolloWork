/** @jsxImportSource react */
import * as React from "react";
import { ArrowLeftRight, ChevronDown, Pipette, X } from "lucide-react";

import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { DesignColorFormat } from "./design-color-field";

type RgbaColor = { red: number; green: number; blue: number; alpha: number };
type HsbColor = { hue: number; saturation: number; brightness: number };
type GradientStop = { color: RgbaColor; position: number };
export type LinearGradient = { angle: number; stops: [GradientStop, GradientStop] };

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

type DesignGradientPickerProps = {
  value: string;
  recommendationColors: readonly (string | undefined)[];
  onChange: (value: string, remember?: boolean) => void;
};

const DEFAULT_GRADIENT: LinearGradient = {
  angle: 180,
  stops: [
    { color: { red: 46, green: 107, blue: 219, alpha: 1 }, position: 0 },
    { color: { red: 118, green: 227, blue: 233, alpha: 1 }, position: 100 },
  ],
};

export function DesignGradientPicker({ value, recommendationColors, onChange }: DesignGradientPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [gradient, setGradient] = React.useState(() => parseLinearGradient(value));
  const [selectedStop, setSelectedStop] = React.useState(0);
  const [pickingColor, setPickingColor] = React.useState(false);

  React.useEffect(() => setGradient(parseLinearGradient(value)), [value]);

  const selected = gradient.stops[selectedStop] ?? gradient.stops[0];
  const hsb = rgbToHsb(selected.color);
  const gradientPresets = buildGradientPresets(recommendationColors, gradient);
  const preview = serializeLinearGradient(gradient);

  const commit = (next: LinearGradient, remember = false) => {
    setGradient(next);
    onChange(serializeLinearGradient(next), remember);
  };

  const updateSelectedColor = (color: RgbaColor, remember = false) => {
    const stops: [GradientStop, GradientStop] = selectedStop === 0
      ? [{ ...gradient.stops[0], color }, gradient.stops[1]]
      : [gradient.stops[0], { ...gradient.stops[1], color }];
    commit({ ...gradient, stops }, remember);
  };

  const rememberCurrent = () => onChange(preview, true);
  const pickColorFromScreen = async () => {
    const EyeDropper = typeof window === "undefined" ? undefined : window.EyeDropper;
    if (!EyeDropper || pickingColor) return;
    setPickingColor(true);
    try {
      const result = await new EyeDropper().open();
      updateSelectedColor({ ...parseHexColor(result.sRGBHex), alpha: selected.color.alpha }, true);
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== "AbortError") console.warn("Could not pick a color from the screen.", error);
    } finally {
      setPickingColor(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        type="button"
        className="mt-3 flex h-[34px] w-full items-center justify-between rounded-lg bg-muted px-2 pr-4 text-left transition-colors hover:bg-accent"
        aria-label="Edit gradient"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2 text-[13px] text-foreground">
          <span className="size-5 rounded-[4px]" style={{ backgroundImage: preview }} />
          Gradient
        </span>
        <ChevronDown className={cn("size-4 transition-transform", open && "rotate-180")} strokeWidth={1.5} />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="left"
        sideOffset={12}
        initialFocus={false}
        className="w-[280px] gap-0 overflow-hidden p-0"
        aria-label="Gradient editor"
      >
        <div className="flex h-12 items-center justify-between border-b border-foreground/5 px-4">
          <span className="text-[14px] font-semibold tracking-[-0.3px]">Gradient</span>
          <PopoverClose className="grid size-7 place-items-center rounded-lg transition-colors hover:bg-foreground/10 active:bg-foreground/15" aria-label="Close gradient editor">
            <X className="size-4" strokeWidth={1.5} />
          </PopoverClose>
        </div>

        <div className="px-4 pb-4 pt-[14px]">
          <div className="flex items-center justify-between pr-2">
            <div className="relative h-4 w-[182px] rounded-[7px]" style={{ backgroundImage: preview }}>
              {gradient.stops.map((stop, index) => (
                <button
                  key={index}
                  type="button"
                  className={cn(
                    "absolute top-[-7px] grid size-[26px] place-items-center rounded-[7px] rounded-bl-[2px] border bg-background p-px shadow-[0_2px_6px_rgba(0,0,0,0.12)]",
                    selectedStop === index ? "border-foreground" : "border-border",
                  )}
                  style={index === 0 ? { left: -2 } : { right: -13 }}
                  onClick={() => setSelectedStop(index)}
                  aria-label={index === 0 ? "Select start color" : "Select end color"}
                  aria-pressed={selectedStop === index}
                >
                  <span className="size-[13px] rounded-[3px]" style={{ backgroundColor: colorToCss(stop.color) }} />
                </button>
              ))}
            </div>
            <button
              type="button"
              className="grid size-6 place-items-center rounded-md transition-colors hover:bg-foreground/10 active:bg-foreground/15"
              onClick={() => commit({
                ...gradient,
                stops: [
                  { ...gradient.stops[0], color: gradient.stops[1].color },
                  { ...gradient.stops[1], color: gradient.stops[0].color },
                ],
              }, true)}
              aria-label="Reverse gradient"
            >
              <ArrowLeftRight className="size-4" strokeWidth={1.5} />
            </button>
          </div>

          <SaturationBrightnessArea
            color={selected.color}
            hsb={hsb}
            onStart={rememberCurrent}
            onChange={(saturation, brightness) => updateSelectedColor({ ...hsbToRgb({ ...hsb, saturation, brightness }), alpha: selected.color.alpha })}
          />

          <div className="mt-2 flex items-center gap-4">
            <button
              type="button"
              className="grid size-6 place-items-center rounded-md transition-colors hover:bg-foreground/10 active:bg-foreground/15 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => void pickColorFromScreen()}
              disabled={typeof window === "undefined" || !window.EyeDropper || pickingColor}
              aria-label="Pick color from screen"
              title={typeof window !== "undefined" && window.EyeDropper ? "Pick color from screen" : "Screen color picker is unavailable"}
            >
              <Pipette className="size-4" strokeWidth={1.5} />
            </button>
            <div className="flex w-[208px] flex-col gap-[11px]">
              <GradientSlider
                ariaLabel="Hue"
                value={hsb.hue / 360}
                background="linear-gradient(90deg,#ff0000 0%,#ffff00 16.667%,#00ff00 33.333%,#00ffff 50%,#0000ff 66.667%,#ff00ff 83.333%,#ff0000 100%)"
                thumbColor={colorToCss({ ...hsbToRgb({ hue: hsb.hue, saturation: 100, brightness: 100 }), alpha: 1 })}
                onStart={rememberCurrent}
                onChange={(ratio) => updateSelectedColor({ ...hsbToRgb({ ...hsb, hue: ratio * 360 }), alpha: selected.color.alpha })}
              />
              <GradientSlider
                ariaLabel="Opacity"
                value={selected.color.alpha}
                background={`linear-gradient(90deg,rgba(${selected.color.red},${selected.color.green},${selected.color.blue},0),rgb(${selected.color.red},${selected.color.green},${selected.color.blue}))`}
                thumbColor={colorToCss(selected.color)}
                checkerboard
                onStart={rememberCurrent}
                onChange={(alpha) => updateSelectedColor({ ...selected.color, alpha })}
              />
            </div>
          </div>

          <ColorValues
            color={selected.color}
            hsb={hsb}
            onStart={rememberCurrent}
            onChange={updateSelectedColor}
          />

          <div className="mt-[14px] grid grid-cols-[repeat(6,28px)] gap-2" role="list" aria-label="Recommended gradients">
            {gradientPresets.map((preset, index) => (
              <button
                key={`${index}-${serializeLinearGradient(preset)}`}
                type="button"
                className={cn(
                  "size-7 rounded-[7px] border border-border transition-transform hover:scale-105 active:scale-95",
                  sameGradient(gradient, preset) && "ring-2 ring-foreground ring-offset-1",
                )}
                style={{ backgroundImage: serializeLinearGradient(preset) }}
                onClick={() => commit(preset, true)}
                aria-label={`Apply recommended gradient ${index + 1}`}
                aria-pressed={sameGradient(gradient, preset)}
              />
            ))}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

function SaturationBrightnessArea({ color, hsb, onStart, onChange }: { color: RgbaColor; hsb: HsbColor; onStart: () => void; onChange: (saturation: number, brightness: number) => void }) {
  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(clamp((event.clientX - rect.left) / rect.width) * 100, (1 - clamp((event.clientY - rect.top) / rect.height)) * 100);
  };
  return (
    <div
      className="relative mt-4 h-[165px] touch-none overflow-hidden rounded-lg border border-[#d9d9d9]"
      style={{ backgroundImage: `linear-gradient(0deg,#000 0%,transparent 100%),linear-gradient(90deg,#fff 0%,hsl(${hsb.hue} 100% 50%) 100%)` }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onStart(); update(event); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}
      aria-label="Saturation and brightness"
    >
      <span
        className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_5px_rgba(0,0,0,0.25)]"
        style={{ left: `${hsb.saturation}%`, top: `${100 - hsb.brightness}%`, backgroundColor: colorToCss(color) }}
      />
    </div>
  );
}

function GradientSlider({ ariaLabel, value, background, thumbColor, checkerboard = false, onStart, onChange }: { ariaLabel: string; value: number; background: string; thumbColor: string; checkerboard?: boolean; onStart: () => void; onChange: (value: number) => void }) {
  const update = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    onChange(clamp((event.clientX - rect.left) / rect.width));
  };
  return (
    <div
      className={cn("relative h-4 touch-none rounded-full border border-[#d7d7d7]", checkerboard && "bg-[conic-gradient(#ddd_25%,white_0_50%,#ddd_0_75%,white_0)] bg-[length:8px_8px]")}
      style={checkerboard ? undefined : { backgroundImage: background }}
      onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); onStart(); update(event); }}
      onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) update(event); }}
      role="slider"
      aria-label={ariaLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      {checkerboard ? <span className="pointer-events-none absolute inset-0 rounded-[inherit]" style={{ backgroundImage: background }} /> : null}
      <span className="pointer-events-none absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_5px_rgba(0,0,0,0.25)]" style={{ left: `${value * 100}%`, backgroundColor: thumbColor }} />
    </div>
  );
}

function ColorValues({ color, hsb, onStart, onChange }: { color: RgbaColor; hsb: HsbColor; onStart: () => void; onChange: (color: RgbaColor) => void }) {
  const [format, setFormat] = React.useState<DesignColorFormat>("hsb");
  const applyHsb = (field: keyof HsbColor, rawValue: string) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    const next = { ...hsb, [field]: field === "hue" ? clamp(value / 360) * 360 : clamp(value / 100) * 100 };
    onChange({ ...hsbToRgb(next), alpha: color.alpha });
  };
  const applyRgb = (field: "red" | "green" | "blue", rawValue: string) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    onChange({ ...color, [field]: clamp(value / 255) * 255 });
  };
  const opacity = <label className="flex items-center justify-center gap-0.5 text-[12px]"><input type="number" min={0} max={100} value={Math.round(color.alpha * 100)} className="w-7 appearance-none bg-transparent text-center outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" onFocus={onStart} onChange={(event) => onChange({ ...color, alpha: clamp(Number(event.currentTarget.value) / 100) })} aria-label="Opacity" /><span className="text-[#727272]">%</span></label>;

  return (
    <div className={cn("mt-3 grid h-9 overflow-hidden rounded-lg border border-[#e5e5e5] bg-[#f5f5f5]", format === "hex" ? "grid-cols-[58px_1fr_48px]" : "grid-cols-[58px_1fr_1fr_1fr_48px]")}>
      <div className="min-w-0 border-r border-white">
        <Select value={format} onValueChange={(next) => { if (next === "hsb" || next === "rgb" || next === "hex") setFormat(next); }}>
          <SelectTrigger className="h-full w-full border-0 bg-transparent px-3 text-[12px] shadow-none focus-visible:ring-0 data-[size=default]:h-full" aria-label="Gradient color format">
            <SelectValue />
          </SelectTrigger>
          <SelectContent align="start" className="min-w-24">
            {COLOR_FORMAT_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      {format === "hsb" ? <>
        <ColorNumberInput label="Hue" value={Math.round(hsb.hue)} max={360} onFocus={onStart} onChange={(value) => applyHsb("hue", value)} />
        <ColorNumberInput label="Saturation" value={Math.round(hsb.saturation)} max={100} onFocus={onStart} onChange={(value) => applyHsb("saturation", value)} />
        <ColorNumberInput label="Brightness" value={Math.round(hsb.brightness)} max={100} onFocus={onStart} onChange={(value) => applyHsb("brightness", value)} />
      </> : null}
      {format === "rgb" ? <>
        <ColorNumberInput label="Red" value={Math.round(color.red)} max={255} onFocus={onStart} onChange={(value) => applyRgb("red", value)} />
        <ColorNumberInput label="Green" value={Math.round(color.green)} max={255} onFocus={onStart} onChange={(value) => applyRgb("green", value)} />
        <ColorNumberInput label="Blue" value={Math.round(color.blue)} max={255} onFocus={onStart} onChange={(value) => applyRgb("blue", value)} />
      </> : null}
      {format === "hex" ? <HexColorInput color={color} onFocus={onStart} onChange={onChange} /> : null}
      {opacity}
    </div>
  );
}

const COLOR_FORMAT_OPTIONS: ReadonlyArray<{ value: DesignColorFormat; label: string }> = [
  { value: "hsb", label: "HSB" },
  { value: "rgb", label: "RGB" },
  { value: "hex", label: "HEX" },
];

function HexColorInput({ color, onFocus, onChange }: { color: RgbaColor; onFocus: () => void; onChange: (color: RgbaColor) => void }) {
  const formatted = colorToHex(color).slice(1).toUpperCase();
  const [draft, setDraft] = React.useState(formatted);
  React.useEffect(() => setDraft(formatted), [formatted]);
  return (
    <label className="flex min-w-0 items-center border-r border-white px-2 text-[12px]">
      <span className="text-[#727272]">#</span>
      <input
        value={draft}
        maxLength={6}
        className="min-w-0 flex-1 bg-transparent text-center uppercase outline-none"
        onFocus={onFocus}
        onChange={(event) => {
          const next = event.currentTarget.value.replace(/[^0-9a-f]/gi, "").slice(0, 6);
          setDraft(next);
          if (next.length === 6) onChange({ ...parseHexColor(`#${next}`), alpha: color.alpha });
        }}
        onBlur={() => setDraft(formatted)}
        aria-label="Hex color"
      />
    </label>
  );
}

function ColorNumberInput({ label, value, max, onFocus, onChange }: { label: string; value: number; max: number; onFocus: () => void; onChange: (value: string) => void }) {
  return <input type="number" min={0} max={max} value={value} className="min-w-0 appearance-none border-r border-white bg-transparent text-center text-[12px] outline-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" onFocus={onFocus} onChange={(event) => onChange(event.currentTarget.value)} aria-label={label} />;
}

export function parseLinearGradient(value: string): LinearGradient {
  const match = value.trim().match(/^linear-gradient\((.*)\)$/i);
  if (!match?.[1]) return DEFAULT_GRADIENT;
  const parts = splitTopLevel(match[1]);
  const angleMatch = parts[0]?.match(/^(-?\d+(?:\.\d+)?)deg$/i);
  const angle = angleMatch?.[1] ? Number(angleMatch[1]) : DEFAULT_GRADIENT.angle;
  const colorParts = angleMatch ? parts.slice(1) : parts;
  const first = colorParts[0] ? parseGradientStop(colorParts[0], 0) : null;
  const lastSource = colorParts[colorParts.length - 1];
  const last = lastSource ? parseGradientStop(lastSource, 100) : null;
  return first && last ? { angle, stops: [first, last] } : DEFAULT_GRADIENT;
}

export function serializeLinearGradient(gradient: LinearGradient) {
  return `linear-gradient(${normalizeAngle(gradient.angle)}deg, ${colorToCss(gradient.stops[0].color)} ${formatNumber(gradient.stops[0].position)}%, ${colorToCss(gradient.stops[1].color)} ${formatNumber(gradient.stops[1].position)}%)`;
}

export function buildGradientPresets(colors: readonly (string | undefined)[], current: LinearGradient): LinearGradient[] {
  const palette = colors.map(parseCssColor).filter((color) => color !== null);
  const primary = palette[0] ?? DEFAULT_GRADIENT.stops[0].color;
  const secondary = palette[1] ?? DEFAULT_GRADIENT.stops[1].color;
  const accent = palette[2] ?? mixColors(primary, secondary, 0.5);
  const background = palette[3] ?? { red: 250, green: 250, blue: 249, alpha: 1 };
  const surface = palette[4] ?? mixColors(background, { red: 255, green: 255, blue: 255, alpha: 1 }, 0.5);
  const currentBackground = palette[5] ?? background;
  return [
    gradientPreset(primary, secondary, current.angle),
    gradientPreset(secondary, accent, current.angle),
    gradientPreset(accent, primary, current.angle),
    gradientPreset(currentBackground, primary, current.angle),
    gradientPreset(surface, secondary, current.angle),
    gradientPreset(background, accent, current.angle),
  ];
}

function gradientPreset(start: RgbaColor, end: RgbaColor, angle: number): LinearGradient {
  return { angle, stops: [{ color: start, position: 0 }, { color: end, position: 100 }] };
}

function parseGradientStop(value: string, fallbackPosition: number): GradientStop | null {
  const match = value.trim().match(/^(#[0-9a-f]{3,8}|rgba?\([^)]*\))(?:\s+(-?\d+(?:\.\d+)?)%)?$/i);
  if (!match?.[1]) return null;
  const color = parseCssColor(match[1]);
  if (!color) return null;
  return { color, position: match[2] ? clamp(Number(match[2]) / 100) * 100 : fallbackPosition };
}

function parseCssColor(value: string | undefined): RgbaColor | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return parseHexColor(`#${trimmed.slice(1).split("").map((part) => `${part}${part}`).join("")}`);
  }
  if (/^#[0-9a-f]{6}$/i.test(trimmed) || /^#[0-9a-f]{8}$/i.test(trimmed)) return parseHexColor(trimmed);
  const rgb = trimmed.match(/^rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)(?:\s*,\s*(\d*(?:\.\d+)?))?\s*\)$/i);
  if (!rgb?.[1] || !rgb[2] || !rgb[3]) return null;
  return {
    red: clamp(Number(rgb[1]) / 255) * 255,
    green: clamp(Number(rgb[2]) / 255) * 255,
    blue: clamp(Number(rgb[3]) / 255) * 255,
    alpha: rgb[4] ? clamp(Number(rgb[4])) : 1,
  };
}

function parseHexColor(value: string): RgbaColor {
  const hex = value.replace("#", "");
  return {
    red: Number.parseInt(hex.slice(0, 2), 16),
    green: Number.parseInt(hex.slice(2, 4), 16),
    blue: Number.parseInt(hex.slice(4, 6), 16),
    alpha: hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1,
  };
}

function rgbToHsb(color: RgbaColor): HsbColor {
  const red = color.red / 255;
  const green = color.green / 255;
  const blue = color.blue / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const delta = max - min;
  const hue = delta === 0 ? 0 : (60 * (max === red ? (green - blue) / delta : max === green ? (blue - red) / delta + 2 : (red - green) / delta + 4) + 360) % 360;
  return { hue, saturation: max === 0 ? 0 : delta / max * 100, brightness: max * 100 };
}

function hsbToRgb(color: HsbColor): Omit<RgbaColor, "alpha"> {
  const hue = ((color.hue % 360) + 360) % 360;
  const saturation = clamp(color.saturation / 100);
  const brightness = clamp(color.brightness / 100);
  const chroma = brightness * saturation;
  const x = chroma * (1 - Math.abs((hue / 60) % 2 - 1));
  const match = brightness - chroma;
  const channels = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return { red: (channels[0] + match) * 255, green: (channels[1] + match) * 255, blue: (channels[2] + match) * 255 };
}

function mixColors(start: RgbaColor, end: RgbaColor, ratio: number): RgbaColor {
  const amount = clamp(ratio);
  return {
    red: start.red + (end.red - start.red) * amount,
    green: start.green + (end.green - start.green) * amount,
    blue: start.blue + (end.blue - start.blue) * amount,
    alpha: start.alpha + (end.alpha - start.alpha) * amount,
  };
}

function colorToHex(color: RgbaColor) {
  return `#${[color.red, color.green, color.blue].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

function colorToCss(color: RgbaColor) {
  if (color.alpha >= 0.999) return colorToHex(color);
  return `rgba(${Math.round(color.red)}, ${Math.round(color.green)}, ${Math.round(color.blue)}, ${formatNumber(color.alpha)})`;
}

function sameGradient(left: LinearGradient, right: LinearGradient) {
  return serializeLinearGradient(left) === serializeLinearGradient(right);
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts;
}

function normalizeAngle(value: number) {
  return formatNumber(((value % 360) + 360) % 360);
}

function formatNumber(value: number) {
  return String(Math.round(value * 100) / 100);
}

function clamp(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
