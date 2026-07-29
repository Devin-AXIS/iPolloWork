/** @jsxImportSource react */
import * as React from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { DesignPanelSelect } from "./design-panel-select";

export type DesignColorFormat = "hsb" | "rgb" | "hex";

type DesignColorFieldProps = {
  value: string;
  onChange: (value: string, remember?: boolean) => void;
  label?: string;
  mixed?: boolean;
  className?: string;
};

export function DesignColorField({ value, onChange, label = "Color", mixed = false, className }: DesignColorFieldProps) {
  const hex = normalizeDesignColorHex(value);
  const [format, setFormat] = React.useState<DesignColorFormat>("hsb");
  const formattedValue = formatDesignColor(hex, format);
  const [draft, setDraft] = React.useState(formattedValue);

  React.useEffect(() => setDraft(formattedValue), [formattedValue]);

  const applyDraft = (next: string) => {
    setDraft(next);
    const parsed = parseDesignColor(next, format);
    if (parsed) onChange(parsed, false);
  };

  return (
    <div className={cn("flex h-[34px] items-center gap-2 rounded-lg bg-[#f5f6f9] px-2 pr-4", className)}>
      <label className="relative size-5 shrink-0 cursor-pointer overflow-hidden rounded-[4px]" style={mixed ? { background: "linear-gradient(135deg, #d1d5db 50%, #f9fafb 50%)" } : { backgroundColor: hex }}>
        <span className="sr-only">Choose {label.toLowerCase()}</span>
        <input
          type="color"
          className="absolute inset-0 cursor-pointer opacity-0"
          value={hex}
          onPointerDown={() => onChange(hex, true)}
          onChange={(event) => onChange(event.currentTarget.value, false)}
        />
      </label>
      <DesignPanelSelect
        value={format}
        options={COLOR_FORMAT_OPTIONS}
        onChange={(next) => {
          setFormat(next);
          setDraft(formatDesignColor(hex, next));
        }}
        ariaLabel="Color format"
        className="h-7 w-[62px] shrink-0 rounded-lg"
        menuClassName="w-[92px]"
        textClassName="text-[10px] uppercase text-[#858a94]"
      />
      <Input
        className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-[13px] uppercase shadow-none focus-visible:ring-0"
        value={mixed ? "" : draft}
        placeholder={mixed ? "Mixed" : undefined}
        onFocus={() => onChange(hex, true)}
        onChange={(event) => applyDraft(event.currentTarget.value)}
        onBlur={() => setDraft(formatDesignColor(normalizeDesignColorHex(value), format))}
        aria-label={`Design ${label.toLowerCase()} value`}
      />
    </div>
  );
}

export function normalizeDesignColorHex(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return "#111827";
  return rgbToHex(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
}

const COLOR_FORMAT_OPTIONS = [
  { value: "hsb", label: "HSB" },
  { value: "rgb", label: "RGB" },
  { value: "hex", label: "HEX" },
] as const;

function formatDesignColor(hex: string, format: DesignColorFormat) {
  const { red, green, blue } = hexToRgb(hex);
  if (format === "hex") return hex.slice(1).toUpperCase();
  if (format === "rgb") return `${red}, ${green}, ${blue}`;
  const { hue, saturation, brightness } = rgbToHsb(red, green, blue);
  return `${hue}, ${saturation}, ${brightness}`;
}

function parseDesignColor(value: string, format: DesignColorFormat) {
  if (format === "hex") {
    const candidate = value.trim().replace(/^#/, "");
    return /^[0-9a-f]{6}$/i.test(candidate) ? `#${candidate.toLowerCase()}` : null;
  }
  const parts = value.split(/[ ,/%°]+/).map((part) => Number(part)).filter(Number.isFinite);
  if (parts.length !== 3) return null;
  return format === "rgb"
    ? rgbToHex(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0)
    : hsbToHex(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}

function hexToRgb(hex: string) {
  return {
    red: Number.parseInt(hex.slice(1, 3), 16),
    green: Number.parseInt(hex.slice(3, 5), 16),
    blue: Number.parseInt(hex.slice(5, 7), 16),
  };
}

function rgbToHex(red: number, green: number, blue: number) {
  return `#${[red, green, blue].map((part) => Math.round(Math.max(0, Math.min(255, part))).toString(16).padStart(2, "0")).join("")}`;
}

function rgbToHsb(red: number, green: number, blue: number) {
  const r = red / 255;
  const g = green / 255;
  const b = blue / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const hue = delta === 0 ? 0 : Math.round((60 * ((max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4)) + 360) % 360);
  return { hue, saturation: max === 0 ? 0 : Math.round(delta / max * 100), brightness: Math.round(max * 100) };
}

function hsbToHex(hue: number, saturation: number, brightness: number) {
  const h = ((hue % 360) + 360) % 360;
  const s = Math.max(0, Math.min(100, saturation)) / 100;
  const v = Math.max(0, Math.min(100, brightness)) / 100;
  const chroma = v * s;
  const x = chroma * (1 - Math.abs((h / 60) % 2 - 1));
  const match = v - chroma;
  const [r, g, b] = h < 60 ? [chroma, x, 0] : h < 120 ? [x, chroma, 0] : h < 180 ? [0, chroma, x] : h < 240 ? [0, x, chroma] : h < 300 ? [x, 0, chroma] : [chroma, 0, x];
  return rgbToHex((r + match) * 255, (g + match) * 255, (b + match) * 255);
}
