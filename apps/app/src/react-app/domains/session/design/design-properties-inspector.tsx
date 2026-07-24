/** @jsxImportSource react */
import * as React from "react";
import {
  AlignCenter,
  AlignHorizontalJustifyCenter,
  AlignLeft,
  AlignRight,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Bold,
  ChevronDown,
  FlipHorizontal2,
  Grip,
  Image,
  Italic,
  Link2,
  List,
  ListIndentIncrease,
  ListOrdered,
  Lock,
  Minus,
  Palette,
  RotateCw,
  SeparatorHorizontal,
  SlidersHorizontal,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DesignField, DesignSelection, DesignStyleField } from "./design-html-runtime";

type DesignPropertiesInspectorProps = {
  selection: DesignSelection;
  onClose: () => void;
  onApplyField: (field: DesignField, value: string, remember?: boolean) => void;
  onChooseReplacementImage: () => void;
};

const FILL_COLORS = ["#2f6de1", "#111827", "#ffffff", "#7c3aed", "#059669", "#ea580c"];

export function DesignPropertiesInspector({
  selection,
  onClose,
  onApplyField,
  onChooseReplacementImage,
}: DesignPropertiesInspectorProps) {
  const fontSize = numericValue(selection.styles.fontSize, 16);
  const lineHeight = numericValue(selection.styles.lineHeight, 14);
  const letterSpacing = numericValue(selection.styles.letterSpacing, 0);
  const rotation = rotationValue(selection.styles.transform);
  const opacity = Math.round(numericValue(selection.styles.opacity, 1) * 100);
  const shadowIntensity = shadowIntensityValue(selection.styles.boxShadow);
  const fillField = selection.colorField;

  const applyPixels = (field: DesignStyleField, value: string) => {
    onApplyField(field, value.trim() && !Number.isNaN(Number(value)) ? `${value}px` : value);
  };

  return (
    <aside className="w-[310px] shrink-0 overflow-x-hidden overflow-y-auto border-l border-[#e8e9ec] bg-white text-[#202228]" aria-label="Design inspector">
      <header className="sticky left-0 top-0 z-20 flex h-11 w-full items-center gap-2 border-b border-[#e8e9ec] bg-white !pl-4 !pr-3">
        <SlidersHorizontal className="size-[18px] shrink-0 text-[#202228]" strokeWidth={1.7} />
        <h2 className="min-w-0 flex-1 truncate text-[13px] font-medium tracking-[-0.01em]">Design properties</h2>
        <button type="button" className="grid size-8 shrink-0 place-items-center rounded-lg text-[#5f636b] transition-colors hover:bg-[#f3f4f6] hover:text-[#202228]" onClick={onClose} aria-label="Close design properties">
          <X className="size-[18px]" strokeWidth={1.7} />
        </button>
      </header>

      <div className="flex h-[52px] items-center border-b border-[#e8e9ec] px-4">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{selection.canEditText ? "Text layer" : `${selection.tag.charAt(0).toUpperCase()}${selection.tag.slice(1).toLowerCase()} layer`}</span>
        <InspectorIconButton label="Edit link" disabled={!selection.href}><Link2 /></InspectorIconButton>
        <InspectorIconButton label="Lock layer" disabled><Lock /></InspectorIconButton>
        <InspectorIconButton label="Delete layer" disabled><Trash2 /></InspectorIconButton>
      </div>

      <InspectorSection title="Position">
        <FieldCaption>Alignment</FieldCaption>
        <div className="grid grid-cols-6 gap-1">
          <PropertyButton active aria-label="Align left"><AlignLeft /></PropertyButton>
          <PropertyButton aria-label="Align horizontal center"><AlignHorizontalJustifyCenter /></PropertyButton>
          <PropertyButton aria-label="Align right"><AlignRight /></PropertyButton>
          <PropertyButton aria-label="Align top"><AlignVerticalJustifyStart /></PropertyButton>
          <PropertyButton aria-label="Align vertical center"><AlignVerticalJustifyCenter /></PropertyButton>
          <PropertyButton aria-label="Align bottom"><AlignVerticalJustifyEnd /></PropertyButton>
        </div>
        <FieldCaption className="mt-3">Position</FieldCaption>
        <div className="grid grid-cols-2 gap-2">
          <PropertyField label="X" value={selection.styles.left || `${Math.round(selection.rect.left)}px`} onChange={(value) => onApplyField("left", value)} />
          <PropertyField label="Y" value={selection.styles.top || `${Math.round(selection.rect.top)}px`} onChange={(value) => onApplyField("top", value)} />
        </div>
        <div className="mt-2 grid grid-cols-[1fr_42px_42px_42px] gap-1">
          <PropertyField label="Rotation" value={`${rotation}°`} onChange={(value) => onApplyField("transform", `rotate(${numericValue(value, 0)}deg)`)} />
          <PropertyButton aria-label="Rotate clockwise" onClick={() => onApplyField("transform", `rotate(${rotation + 90}deg)`)}><RotateCw /></PropertyButton>
          <PropertyButton aria-label="Flip horizontal" onClick={() => onApplyField("transform", "scaleX(-1)")}><FlipHorizontal2 /></PropertyButton>
          <PropertyButton aria-label="Flip vertical" onClick={() => onApplyField("transform", "scaleY(-1)")}><SeparatorHorizontal /></PropertyButton>
        </div>
      </InspectorSection>

      {selection.canEditText ? (
        <InspectorSection title="Text">
          <Input
            aria-label="Design text"
            className="h-11 rounded-lg border-[#77a0ff] bg-white px-3 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-[#77a0ff]"
            value={selection.text}
            placeholder="预览文本可编辑内容框..."
            onChange={(event) => onApplyField("text", event.currentTarget.value)}
          />
          <div className="mt-3">
            <SelectLikeField label="Font family" value={selection.styles.fontFamily || "PingFang SC"} onChange={(value) => onApplyField("fontFamily", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <SelectLikeField label="Font weight" value={selection.styles.fontWeight || "400"} onChange={(value) => onApplyField("fontWeight", value)} />
            <SelectLikeField label="Font size" value={String(fontSize)} onChange={(value) => applyPixels("fontSize", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <PropertyField label="Line height" value={String(lineHeight)} suffix="" onChange={(value) => applyPixels("lineHeight", value)} />
            <PropertyField label="Letter spacing" value={String(letterSpacing)} suffix="%" onChange={(value) => onApplyField("letterSpacing", `${value}%`)} />
          </div>
          <div className="mt-3 grid grid-cols-6 gap-1">
            <PropertyButton active={selection.styles.textAlign === "left"} aria-label="Align text left" onClick={() => onApplyField("textAlign", "left")}><AlignLeft /></PropertyButton>
            <PropertyButton active={selection.styles.textAlign === "center"} aria-label="Align text center" onClick={() => onApplyField("textAlign", "center")}><AlignCenter /></PropertyButton>
            <PropertyButton active={selection.styles.textAlign === "right"} aria-label="Align text right" onClick={() => onApplyField("textAlign", "right")}><AlignRight /></PropertyButton>
            <PropertyButton aria-label="Bulleted list" disabled><List /></PropertyButton>
            <PropertyButton aria-label="Numbered list" disabled><ListOrdered /></PropertyButton>
            <PropertyButton aria-label="Increase indent" disabled><ListIndentIncrease /></PropertyButton>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            <PropertyButton active={numericValue(selection.styles.fontWeight, 400) >= 600} aria-label="Bold" onClick={() => onApplyField("fontWeight", numericValue(selection.styles.fontWeight, 400) >= 600 ? "400" : "700")}><Bold /></PropertyButton>
            <PropertyButton active={selection.styles.fontStyle === "italic"} aria-label="Italic" onClick={() => onApplyField("fontStyle", selection.styles.fontStyle === "italic" ? "normal" : "italic")}><Italic /></PropertyButton>
            <PropertyButton active={selection.styles.textDecoration.includes("underline")} aria-label="Underline" onClick={() => onApplyField("textDecoration", toggleDecoration(selection.styles.textDecoration, "underline"))}><Underline /></PropertyButton>
            <PropertyButton active={selection.styles.textDecoration.includes("line-through")} aria-label="Strikethrough" onClick={() => onApplyField("textDecoration", toggleDecoration(selection.styles.textDecoration, "line-through"))}><Strikethrough /></PropertyButton>
          </div>
        </InspectorSection>
      ) : null}

      <InspectorSection title="Size">
        <div className="grid grid-cols-[1fr_1fr_34px] gap-2">
          <PropertyField label="Width" value={selection.styles.width || `${Math.round(selection.rect.width)}px`} onChange={(value) => onApplyField("width", value)} />
          <PropertyField label="Height" value={selection.styles.height || `${Math.round(selection.rect.height)}px`} onChange={(value) => onApplyField("height", value)} />
          <button type="button" className="grid h-9 w-[34px] place-items-center rounded-lg text-[#858a94] disabled:opacity-55" disabled aria-label="Lock aspect ratio">
            <Lock className="size-4" />
          </button>
        </div>
      </InspectorSection>

      <InspectorSection title="Fill">
        <div className="grid grid-cols-4 gap-1.5">
          <PropertyButton aria-label="No fill" onClick={() => onApplyField(fillField, "transparent")}><Minus /></PropertyButton>
          <PropertyButton active aria-label="Solid fill"><span className="size-3 rounded-[2px] border border-current" /></PropertyButton>
          <PropertyButton aria-label="Pattern fill" disabled><Grip /></PropertyButton>
          {selection.tag === "img" ? (
            <PropertyButton aria-label="Replace image" onClick={onChooseReplacementImage}><Image /></PropertyButton>
          ) : (
            <PropertyButton aria-label="Image fill" disabled><Image /></PropertyButton>
          )}
        </div>
        <ColorField value={selection.styles[fillField] || "#000000"} onChange={(value) => onApplyField(fillField, value)} />
      </InspectorSection>

      <InspectorSection title="Border">
        <div className="grid grid-cols-2 gap-2">
          <SelectLikeField label="Border style" value={selection.styles.borderStyle || "Solid"} onChange={(value) => onApplyField("borderStyle", value.toLowerCase())} />
          <PropertyField label="Width" value={selection.styles.borderWidth || "0px"} onChange={(value) => onApplyField("borderWidth", value)} />
        </div>
        <ColorField value={selection.styles.borderColor || "#000000"} onChange={(value) => onApplyField("borderColor", value)} />
      </InspectorSection>

      <InspectorSection title="Appearance" last>
        <div className="grid grid-cols-2 gap-2">
          <PropertyField label="Radius" value={selection.styles.borderRadius || "0px"} onChange={(value) => onApplyField("borderRadius", value)} />
          <PropertyField label="Opacity" value={String(opacity)} suffix="%" onChange={(value) => onApplyField("opacity", String(Math.max(0, Math.min(100, numericValue(value, 100))) / 100))} />
        </div>
        <FieldCaption className="mt-3">Shadow</FieldCaption>
        <ShadowIntensityControl
          value={shadowIntensity}
          shadow={selection.styles.boxShadow}
          onChange={(value, remember) => onApplyField("boxShadow", shadowWithIntensity(selection.styles.boxShadow, value), remember)}
        />
      </InspectorSection>
    </aside>
  );
}

function ShadowIntensityControl({ value, shadow, onChange }: { value: number; shadow: string; onChange: (value: number, remember: boolean) => void }) {
  const interactionStarted = React.useRef(false);
  const beginInteraction = () => {
    if (interactionStarted.current) return;
    interactionStarted.current = true;
    onChange(value, true);
  };
  const endInteraction = () => {
    interactionStarted.current = false;
  };

  return (
    <div className="grid grid-cols-2 gap-3">
      <label className="flex h-9 items-center rounded-lg bg-[#f4f5f8] px-2.5">
        <span className="sr-only">Shadow intensity</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={value}
          aria-label="Shadow intensity"
          className="h-3.5 w-full cursor-pointer appearance-none rounded-full bg-transparent [&::-webkit-slider-thumb]:size-3.5 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-[2px] [&::-webkit-slider-thumb]:border-black [&::-webkit-slider-thumb]:bg-white"
          style={{ background: `linear-gradient(to right, #000 0%, #000 ${value}%, #e3e5ea ${value}%, #e3e5ea 100%)` }}
          onPointerDown={beginInteraction}
          onPointerUp={endInteraction}
          onPointerCancel={endInteraction}
          onKeyDown={(event) => {
            if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) beginInteraction();
          }}
          onKeyUp={endInteraction}
          onBlur={endInteraction}
          onChange={(event) => onChange(Number(event.currentTarget.value), !interactionStarted.current)}
        />
      </label>
      <PropertyField label="Intensity" value={String(value)} suffix="%" onChange={(next) => onChange(clampPercentage(numericValue(next, value)), true)} />
      <span className="sr-only" aria-live="polite">Shadow intensity {value} percent. Current shadow: {shadow || "none"}.</span>
    </div>
  );
}

function InspectorSection({ title, children, last = false }: { title: string; children: React.ReactNode; last?: boolean }) {
  return (
    <section className={cn("px-4 py-3.5", !last && "border-b border-[#e8e9ec]")}>
      <h3 className="mb-3 text-[14px] font-medium text-black">{title}</h3>
      {children}
    </section>
  );
}

function FieldCaption({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("mb-1 text-[10px] text-[#969ba5]", className)}>{children}</p>;
}

function PropertyField({ label, value, suffix, onChange, disabled = false }: { label: string; value: string; suffix?: string; onChange: (value: string) => void; disabled?: boolean }) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="shrink-0 text-[10px] text-[#969ba5]">{label}</span>
      <input className="min-w-0 flex-1 bg-transparent text-right text-[12px] outline-none disabled:cursor-default" value={value} disabled={disabled} onChange={(event) => onChange(event.currentTarget.value)} aria-label={`Design ${label.toLowerCase()}`} />
      {suffix ? <span className="text-[10px] text-[#969ba5]">{suffix}</span> : null}
    </label>
  );
}

function SelectLikeField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="flex h-9 min-w-0 items-center rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="sr-only">{label}</span>
      <input className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" value={value} onChange={(event) => onChange(event.currentTarget.value)} aria-label={`Design ${label.toLowerCase()}`} />
      <ChevronDown className="size-3.5 shrink-0 text-[#858a94]" />
    </label>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hex = normalizeHex(value);
  return (
    <div className="mt-2 flex h-9 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <label className="relative size-5 shrink-0 overflow-hidden rounded-[3px]" style={{ backgroundColor: hex }}>
        <span className="sr-only">Choose color</span>
        <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={hex} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
      <span className="text-[10px] text-[#858a94]">HSB</span>
      <ChevronDown className="size-3 text-[#858a94]" />
      <Input className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-[11px] uppercase shadow-none focus-visible:ring-0" value={hex.slice(1)} onChange={(event) => onChange(`#${event.currentTarget.value}`)} aria-label="Design color value" />
    </div>
  );
}

function PropertyButton({ active = false, disabled = false, onClick, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button" className={cn("grid h-9 min-w-0 place-items-center rounded-lg bg-[#f4f5f8] text-[#858a94] transition-colors [&_svg]:size-4", active && "bg-black text-white", !disabled && "hover:bg-[#e9ebef] hover:text-black", active && !disabled && "hover:bg-black hover:text-white")} disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  );
}

function InspectorIconButton({ label, disabled = false, children }: { label: string; disabled?: boolean; children: React.ReactNode }) {
  return <Button type="button" variant="ghost" size="icon-sm" disabled={disabled} aria-label={label} className="h-9 w-[34px] shrink-0 rounded-lg p-0 text-[#858a94] disabled:opacity-55 [&_svg]:!size-4">{children}</Button>;
}

function numericValue(value: string, fallback: number) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampPercentage(value: number) {
  return Math.round(Math.max(0, Math.min(100, value)));
}

function shadowIntensityValue(value: string) {
  if (!value || value === "none") return 0;
  const rgba = value.match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i);
  if (rgba) return clampPercentage(numericValue(rgba[1] ?? "0", 0) * 100);
  const modernRgb = value.match(/rgb\([^/]+\/\s*([\d.]+)%?\s*\)/i);
  if (modernRgb) {
    const alpha = numericValue(modernRgb[1] ?? "0", 0);
    return clampPercentage(modernRgb[0].includes("%") ? alpha : alpha * 100);
  }
  return 100;
}

function shadowWithIntensity(value: string, intensity: number) {
  const safeIntensity = clampPercentage(intensity);
  if (safeIntensity === 0) return "none";
  const alpha = safeIntensity / 100;
  if (!value || value === "none") return `0 8px 24px rgba(0, 0, 0, ${alpha})`;
  if (/rgba\(/i.test(value)) {
    return value.replace(/rgba\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*[\d.]+\s*\)/gi, `rgba($1, $2, $3, ${alpha})`);
  }
  if (/rgb\(/i.test(value)) {
    return value.replace(/rgb\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/gi, `rgba($1, $2, $3, ${alpha})`);
  }
  return `0 8px 24px rgba(0, 0, 0, ${alpha})`;
}

function rotationValue(value: string) {
  const match = value.match(/rotate\((-?[\d.]+)deg\)/);
  return match ? numericValue(match[1] ?? "0", 0) : 0;
}

function toggleDecoration(value: string, decoration: "underline" | "line-through") {
  const values = value.split(/\s+/).filter(Boolean).filter((item) => item !== "none");
  return values.includes(decoration) ? values.filter((item) => item !== decoration).join(" ") || "none" : [...values, decoration].join(" ");
}

function normalizeHex(value: string) {
  const trimmed = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed;
  const rgb = trimmed.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return FILL_COLORS[1] ?? "#111827";
  return `#${rgb.slice(1, 4).map((part) => Math.max(0, Math.min(255, Number(part))).toString(16).padStart(2, "0")).join("")}`;
}
