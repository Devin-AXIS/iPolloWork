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
  Check,
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
  MousePointer2,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { listSystemFontFamilies } from "@/app/lib/desktop";
import { cn } from "@/lib/utils";
import type { DesignField, DesignSelection, DesignStyleField } from "./design-html-runtime";
import { toggleTransformScale } from "./design-transform";
import { FALLBACK_FONT_FAMILIES, filterFontFamilyOptions, fontFamilyOptions } from "./font-family-catalog";
import { displayFontFamily } from "./font-family-display";

type DesignPropertiesInspectorProps = {
  selection: DesignSelection | null;
  activeTab: "element" | "design-system";
  onClose: () => void;
  onActiveTabChange: (tab: "element" | "design-system") => void;
  onApplyField: (field: DesignField, value: string, remember?: boolean) => void;
  onApplyFields: (fields: Partial<Record<DesignStyleField, string>>) => void;
  onChooseReplacementImage: () => void;
  onChooseBackgroundImage: () => void;
  children?: React.ReactNode;
};

const FILL_COLORS = ["#2f6de1", "#111827", "#ffffff", "#7c3aed", "#059669", "#ea580c"];
const FONT_SIZE_PRESETS = ["8", "9", "10", "11", "12", "14", "16", "18", "20", "24", "28", "32", "36", "48", "60", "72", "96"];
const FONT_WEIGHT_PRESETS = [
  { value: "300", label: "Light" },
  { value: "400", label: "Regular" },
  { value: "500", label: "Medium" },
  { value: "600", label: "Semibold" },
  { value: "700", label: "Bold" },
  { value: "800", label: "Extra bold" },
];

function ElementPropertiesContent({
  selection,
  onClose,
  onApplyField,
  onApplyFields,
  onChooseReplacementImage,
  onChooseBackgroundImage,
}: Omit<DesignPropertiesInspectorProps, "selection" | "activeTab" | "onActiveTabChange" | "children"> & { selection: DesignSelection }) {
  const fontSize = numericValue(selection.styles.fontSize, 16);
  const lineHeight = numericValue(selection.styles.lineHeight, 14);
  const letterSpacing = numericValue(selection.styles.letterSpacing, 0);
  const rotation = rotationValue(selection.styles.transform);
  const opacity = Math.round(numericValue(selection.styles.opacity, 1) * 100);
  const shadowIntensity = shadowIntensityValue(selection.styles.boxShadow);
  const fillField = selection.colorField;
  const backgroundValue = selection.styles[fillField];
  const [imageFillOpen, setImageFillOpen] = React.useState(false);
  const fillType = imageFillOpen && selection.tag !== "img" ? "image" : fillTypeFor(selection);

  const applyFillType = (type: FillType) => {
    if (type === "none") {
      setImageFillOpen(false);
      onApplyFields({ backgroundColor: "transparent", backgroundImage: "none" });
    }
    if (type === "solid") {
      setImageFillOpen(false);
      onApplyFields({ backgroundColor: isTransparentColor(backgroundValue) ? FILL_COLORS[0] ?? "#2f6de1" : backgroundValue, backgroundImage: "none" });
    }
    if (type === "gradient") {
      setImageFillOpen(false);
      onApplyFields({ backgroundColor: "transparent", backgroundImage: DEFAULT_GRADIENT });
    }
    if (type === "image") setImageFillOpen(true);
  };

  const applyPixels = (field: DesignStyleField, value: string) => {
    onApplyField(field, value.trim() && !Number.isNaN(Number(value)) ? `${value}px` : value);
  };

  return <>

      <div className="flex h-[52px] items-center border-b border-[#e8e9ec] px-4">
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{selection.canEditText ? "Text layer" : `${selection.tag.charAt(0).toUpperCase()}${selection.tag.slice(1).toLowerCase()} layer`}</span>
        <InspectorIconButton label="Edit link" disabled={!selection.href}><Link2 /></InspectorIconButton>
        <InspectorIconButton label="Lock layer" disabled><Lock /></InspectorIconButton>
        <InspectorIconButton label="Delete layer" disabled><Trash2 /></InspectorIconButton>
      </div>

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
            <FontFamilyPicker value={selection.styles.fontFamily || "PingFang SC"} onChange={(value) => onApplyField("fontFamily", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <FontPresetField label="Size" value={String(fontSize)} presets={FONT_SIZE_PRESETS} onChange={(value) => applyPixels("fontSize", value)} />
            <FontPresetField label="Weight" value={selection.styles.fontWeight || "400"} presets={FONT_WEIGHT_PRESETS} onChange={(value) => onApplyField("fontWeight", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <DragNumberField label="Line height" value={String(lineHeight)} onChange={(value) => applyPixels("lineHeight", String(value))} />
            <DragNumberField label="Letter spacing" value={String(letterSpacing)} suffix="%" onChange={(value) => onApplyField("letterSpacing", `${value}%`)} />
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
          <DragNumberField label="X" value={selection.styles.left || `${Math.round(selection.rect.left)}px`} suffix="px" onChange={(value) => onApplyField("left", `${value}px`)} />
          <DragNumberField label="Y" value={selection.styles.top || `${Math.round(selection.rect.top)}px`} suffix="px" onChange={(value) => onApplyField("top", `${value}px`)} />
        </div>
        <div className="mt-2 grid grid-cols-[1fr_42px_42px_42px] gap-1">
          <DragNumberField label="Rotation" value={`${rotation}°`} suffix="°" onChange={(value) => onApplyField("transform", `rotate(${value}deg)`)} />
          <PropertyButton aria-label="Rotate clockwise" onClick={() => onApplyField("transform", `rotate(${rotation + 90}deg)`)}><RotateCw /></PropertyButton>
          <PropertyButton aria-label="Flip horizontal" onClick={() => onApplyField("transform", toggleTransformScale(selection.styles.transform, "x"))}><FlipHorizontal2 /></PropertyButton>
          <PropertyButton aria-label="Flip vertical" onClick={() => onApplyField("transform", toggleTransformScale(selection.styles.transform, "y"))}><SeparatorHorizontal /></PropertyButton>
        </div>
      </InspectorSection>

      <InspectorSection title="Size">
        <div className="grid grid-cols-[1fr_1fr_34px] gap-2">
          <DragNumberField label="Width" value={selection.styles.width || `${Math.round(selection.rect.width)}px`} suffix="px" onChange={(value) => onApplyField("width", `${value}px`)} />
          <DragNumberField label="Height" value={selection.styles.height || `${Math.round(selection.rect.height)}px`} suffix="px" onChange={(value) => onApplyField("height", `${value}px`)} />
          <button type="button" className="grid h-9 w-[34px] place-items-center rounded-lg text-[#858a94] disabled:opacity-55" disabled aria-label="Lock aspect ratio">
            <Lock className="size-4" />
          </button>
        </div>
      </InspectorSection>

      <InspectorSection title="Fill">
        <div className="grid grid-cols-4 gap-1.5">
          <PropertyButton active={fillType === "none"} aria-label="No fill" onClick={() => applyFillType("none")}><Minus /></PropertyButton>
          <PropertyButton active={fillType === "solid"} aria-label="Solid fill" onClick={() => applyFillType("solid")}><span className="size-3 rounded-[2px] border border-current" /></PropertyButton>
          <PropertyButton active={fillType === "gradient"} aria-label="Gradient fill" onClick={() => applyFillType("gradient")}><Grip /></PropertyButton>
          <PropertyButton active={fillType === "image"} aria-label="Image fill" onClick={() => applyFillType("image")}><Image /></PropertyButton>
        </div>
        {fillType === "solid" ? <ColorField value={backgroundValue || "#000000"} onChange={(value) => onApplyField(fillField, value)} /> : null}
        {fillType === "gradient" ? <FillSummary swatchClassName="bg-[linear-gradient(180deg,#2e6bdb_0%,#76e3e9_100%)]" label="Gradient" /> : null}
        {fillType === "image" ? <ImageFillPicker selection={selection} onApplyFields={onApplyFields} onChooseImage={selection.tag === "img" ? onChooseReplacementImage : onChooseBackgroundImage} /> : null}
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
  </>;
}

export function DesignPropertiesInspector({ selection, activeTab, onClose, onActiveTabChange, children, ...contentProps }: DesignPropertiesInspectorProps) {
  return (
    <InspectorShell activeTab={activeTab} onActiveTabChange={onActiveTabChange} onClose={onClose}>
      {activeTab === "design-system" ? children : selection ? <ElementPropertiesContent selection={selection} onClose={onClose} {...contentProps} /> : (
        <div className="flex min-h-[180px] flex-col items-center justify-center px-6 text-center text-xs leading-5 text-muted-foreground">
          <MousePointer2 className="mb-2 size-5" />
          Click an element in the page to edit it.
        </div>
      )}
    </InspectorShell>
  );
}

function InspectorShell({ activeTab, onActiveTabChange, onClose, children }: Pick<DesignPropertiesInspectorProps, "activeTab" | "onActiveTabChange" | "onClose" | "children">) {
  return (
    <aside className="flex h-full w-[310px] shrink-0 flex-col overflow-hidden border-l border-[#ebebeb] bg-white text-[#202228]" aria-label="Design inspector">
      <header className="sticky left-0 top-0 z-20 flex h-[52px] w-full shrink-0 items-center border-b border-[#ebebeb] bg-white !px-4">
        <div className="flex w-[240px] shrink-0 gap-1">
          <button type="button" onClick={() => onActiveTabChange("element")} className={cn("h-[35px] w-[118px] shrink-0 whitespace-nowrap rounded-lg px-2 text-[12px] font-semibold leading-none text-[#24262b] transition-colors", activeTab === "element" ? "bg-[#f5f6f9]" : "hover:bg-[#f5f6f9]")} aria-pressed={activeTab === "element"}>Element</button>
          <button type="button" onClick={() => onActiveTabChange("design-system")} className={cn("h-[35px] w-[118px] shrink-0 whitespace-nowrap rounded-lg px-1 text-[12px] font-semibold leading-none text-[#24262b] transition-colors", activeTab === "design-system" ? "bg-[#f5f6f9]" : "hover:bg-[#f5f6f9]")} aria-pressed={activeTab === "design-system"}>Design System</button>
        </div>
        <button type="button" className="absolute right-4 grid size-8 place-items-center rounded-lg text-[#5f636b] transition-colors hover:bg-[#f3f4f6] hover:text-[#202228]" onClick={onClose} aria-label="Close design properties">
          <X className="size-4" strokeWidth={1.7} />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
        {children}
      </div>
    </aside>
  );
}

type FillType = "none" | "solid" | "gradient" | "image";

const DEFAULT_GRADIENT = "linear-gradient(180deg, #2e6bdb 0%, #76e3e9 100%)";

function fillTypeFor(selection: DesignSelection): FillType {
  if (selection.tag === "img") return "image";
  const image = selection.styles.backgroundImage.trim();
  if (/^url\(/i.test(image)) return "image";
  if (image !== "none" && image) return "gradient";
  return isTransparentColor(selection.styles.backgroundColor) ? "none" : "solid";
}

function FillSummary({ swatchClassName, label }: { swatchClassName: string; label: string }) {
  return <div className="mt-3 flex h-[34px] items-center justify-between rounded-lg bg-[#f5f6f9] px-2 pr-4"><span className="flex items-center gap-2 text-[13px] text-[#24262b]"><span className={cn("size-5 rounded-[4px]", swatchClassName)} />{label}</span><ChevronDown className="size-4 text-[#858a94]" /></div>;
}

function ImageFillPicker({ selection, onApplyFields, onChooseImage }: { selection: DesignSelection; onApplyFields: (fields: Partial<Record<DesignStyleField, string>>) => void; onChooseImage: () => void }) {
  const backgroundSource = selection.styles.backgroundImage.match(/^url\(["']?(.*?)["']?\)$/i)?.[1] ?? (selection.tag === "img" ? selection.source : "");
  const mode = imageFitMode(selection);
  const applyMode = (next: ImageFitMode) => onApplyFields(imageModeStyles(selection, next));

  return (
    <div className="mt-3 space-y-3">
      <Select value={mode} onValueChange={(value) => { if (value && isImageFitMode(value)) applyMode(value); }}>
        <SelectTrigger className="h-[34px] w-full rounded-lg border-0 bg-[#f5f6f9] px-2 text-[13px] text-[#24262b] shadow-none focus:ring-0" aria-label="Image fit mode"><SelectValue>{imageFitLabel(mode)}</SelectValue></SelectTrigger>
        <SelectContent align="start" className="min-w-[var(--radix-select-trigger-width)] rounded-xl bg-white p-1 text-[#24262b] shadow-lg before:hidden **:data-[slot=select-item]:focus:bg-[#f1f2f4] **:data-[slot=select-item]:data-highlighted:bg-[#f1f2f4]">
          {(["fill", "fit", "crop"] as const).map((value) => <SelectItem key={value} value={value} className="rounded-lg py-1.5 text-[#24262b] focus:bg-[#f1f2f4] focus:text-[#24262b] data-[state=checked]:bg-[#f1f2f4] data-[state=checked]:text-[#24262b]">{imageFitLabel(value)}</SelectItem>)}
        </SelectContent>
      </Select>
      <div className="relative flex h-[100px] w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(45deg,#929292_25%,transparent_25%,transparent_75%,#929292_75%),linear-gradient(45deg,#929292_25%,#a0a0a0_25%,#a0a0a0_75%,#929292_75%)] bg-[length:52px_52px] bg-[position:0_0,26px_26px]">
        {backgroundSource ? <span className="absolute inset-0 bg-no-repeat" style={{ backgroundImage: `url(\"${backgroundSource}\")`, backgroundSize: imagePreviewSize(selection, mode), backgroundPosition: imagePosition(selection) }} /> : null}
        <span className="absolute inset-0 bg-black/45" />
        <button type="button" onClick={onChooseImage} className="relative rounded-lg bg-black px-4 py-2 text-[10px] text-white transition-colors hover:bg-[#202020] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Choose Media</button>
      </div>
      {mode === "crop" ? <CropControls selection={selection} onApplyFields={onApplyFields} /> : null}
    </div>
  );
}

type ImageFitMode = "fill" | "fit" | "crop";

function isImageFitMode(value: string): value is ImageFitMode {
  return value === "fill" || value === "fit" || value === "crop";
}

function imageFitMode(selection: DesignSelection): ImageFitMode {
  const value = selection.tag === "img" ? selection.styles.objectFit : selection.styles.backgroundSize;
  if (value === "contain") return "fit";
  if (value === "cover") return "crop";
  return "fill";
}

function imageModeStyles(selection: DesignSelection, mode: ImageFitMode): Partial<Record<DesignStyleField, string>> {
  const value = mode === "fill" ? "fill" : mode === "fit" ? "contain" : "cover";
  return selection.tag === "img"
    ? { objectFit: value, objectPosition: "50% 50%" }
    : { backgroundSize: mode === "fill" ? "100% 100%" : value, backgroundPosition: "50% 50%" };
}

function imageFitLabel(mode: ImageFitMode) {
  return mode === "fill" ? "Fill" : mode === "fit" ? "Fit" : "Crop";
}

function imagePreviewSize(selection: DesignSelection, mode: ImageFitMode) {
  if (mode !== "crop") return mode === "fill" ? "100% 100%" : "contain";
  return selection.tag === "img" ? "cover" : selection.styles.backgroundSize || "cover";
}

function imagePosition(selection: DesignSelection) {
  return selection.tag === "img" ? selection.styles.objectPosition || "50% 50%" : selection.styles.backgroundPosition || "50% 50%";
}

function CropControls({ selection, onApplyFields }: { selection: DesignSelection; onApplyFields: (fields: Partial<Record<DesignStyleField, string>>) => void }) {
  const zoom = cropZoom(selection);
  const [x, y] = cropPosition(selection);
  const apply = (nextZoom = zoom, nextX = x, nextY = y) => {
    const position = `${nextX}% ${nextY}%`;
    onApplyFields(selection.tag === "img"
      ? { objectFit: "cover", objectPosition: position }
      : { backgroundSize: `${nextZoom}%`, backgroundPosition: position });
  };

  return <div className="grid grid-cols-3 gap-2"><CropRange label="Zoom" value={zoom} min={100} max={200} suffix="%" onChange={(value) => apply(value)} /><CropRange label="X" value={x} min={0} max={100} suffix="%" onChange={(value) => apply(zoom, value)} /><CropRange label="Y" value={y} min={0} max={100} suffix="%" onChange={(value) => apply(zoom, x, value)} /></div>;
}

function CropRange({ label, value, min, max, suffix, onChange }: { label: string; value: number; min: number; max: number; suffix: string; onChange: (value: number) => void }) {
  return <label className="rounded-lg bg-[#f5f6f9] px-2 py-1.5"><span className="mb-1 block text-[10px] text-[#858a94]">{label} {value}{suffix}</span><input type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} className="h-2 w-full cursor-pointer accent-black" aria-label={`Crop ${label.toLowerCase()}`} /></label>;
}

function cropZoom(selection: DesignSelection) {
  if (selection.tag === "img") return 100;
  const value = Number.parseFloat(selection.styles.backgroundSize);
  return Number.isFinite(value) && value > 0 ? Math.max(100, Math.min(200, Math.round(value))) : 100;
}

function cropPosition(selection: DesignSelection): [number, number] {
  const [rawX = "50", rawY = "50"] = imagePosition(selection).split(/\s+/);
  return [clampPercentage(numericValue(rawX, 50)), clampPercentage(numericValue(rawY, 50))];
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

function DragNumberField({ label, value, suffix = "", onChange }: { label: string; value: string; suffix?: string; onChange: (value: number) => void }) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="shrink-0 text-[10px] text-[#969ba5]">{label}</span>
      <DragNumberInput label={label} value={String(numericValue(value, 0))} onChange={onChange} />
      {suffix ? <span className="text-[10px] text-[#969ba5]">{suffix}</span> : null}
    </label>
  );
}

function DragNumberInput({ label, value, onChange }: { label: string; value: string; onChange: (value: number) => void }) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const drag = React.useRef<{ pointerId: number; startX: number; startValue: number; moved: boolean } | null>(null);

  const beginDrag = (event: React.PointerEvent<HTMLInputElement>) => {
    if (event.button !== 0) return;

    drag.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startValue: numericValue(value, 0),
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();

    const move = (moveEvent: PointerEvent) => {
      const activeDrag = drag.current;
      if (!activeDrag || moveEvent.pointerId !== activeDrag.pointerId) return;
      const distance = moveEvent.clientX - activeDrag.startX;
      if (!activeDrag.moved && Math.abs(distance) < 3) return;

      activeDrag.moved = true;
      const nextValue = Math.round((activeDrag.startValue + distance) * 100) / 100;
      onChange(nextValue);
    };
    const end = (endEvent: PointerEvent) => {
      const activeDrag = drag.current;
      if (!activeDrag || endEvent.pointerId !== activeDrag.pointerId) return;

      if (!activeDrag.moved) inputRef.current?.focus();
      drag.current = null;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };

  return (
    <input
      ref={inputRef}
      className="min-w-0 flex-1 cursor-ew-resize bg-transparent text-right text-[12px] outline-none focus:cursor-text"
      value={value}
      onPointerDown={beginDrag}
      onChange={(event) => onChange(numericValue(event.currentTarget.value, numericValue(value, 0)))}
      aria-label={`Design ${label.toLowerCase()}`}
      title="Drag left or right to adjust; click to type"
    />
  );
}

function FontPresetField({ label, value, presets, onChange }: { label: string; value: string; presets: string[] | { value: string; label: string }[]; onChange: (value: string) => void }) {
  const options = presets.map((preset) => typeof preset === "string" ? { value: preset, label: preset } : preset);

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="shrink-0 text-[10px] text-[#969ba5]">{label}</span>
      {label === "Size" ? (
        <DragNumberInput label={label} value={value} onChange={(nextValue) => onChange(String(nextValue))} />
      ) : (
        <span className="min-w-0 flex-1 text-right text-[12px]">{value}</span>
      )}
      <Select value={value} onValueChange={(nextValue) => { if (nextValue) onChange(nextValue); }}>
        <SelectTrigger className="h-auto w-auto shrink-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-visible:ring-0" aria-label={`Select ${label.toLowerCase()}`} />
        <SelectContent align="end">
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
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

function FontFamilyPicker({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [families, setFamilies] = React.useState<string[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const currentFamily = displayFontFamily(value || "PingFang SC");
  const options = React.useMemo(
    () => fontFamilyOptions(currentFamily, families ?? FALLBACK_FONT_FAMILIES),
    [currentFamily, families],
  );
  const visibleFamilies = React.useMemo(
    () => filterFontFamilyOptions(options, query),
    [options, query],
  );

  const loadFontFamilies = React.useCallback(async () => {
    if (families !== null || typeof window === "undefined") return;

    if (!window.__IPOLLOWORK_ELECTRON__?.invokeDesktop) {
      setFamilies(FALLBACK_FONT_FAMILIES);
      return;
    }

    setLoading(true);
    try {
      const systemFamilies = await listSystemFontFamilies();
      setFamilies(systemFamilies);
    } catch {
      setFamilies(FALLBACK_FONT_FAMILIES);
    } finally {
      setLoading(false);
    }
  }, [families]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setQuery("");
    void loadFontFamilies();
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        type="button"
        className="flex h-9 w-full min-w-0 items-center rounded-lg bg-[#f4f5f8] px-2.5 text-[#202228] hover:bg-[#e9ebef]"
        aria-label="Design font family"
      >
        <span className="min-w-0 flex-1 truncate text-left text-[12px]" style={{ fontFamily: currentFamily }}>{currentFamily}</span>
        <ChevronDown className="size-3.5 shrink-0 text-[#858a94]" />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={4} initialFocus={false} className="w-[310px] gap-2 rounded-lg p-2">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search fonts"
          aria-label="Search fonts"
          className="h-8 rounded-md bg-[#f4f5f8] px-2.5 text-[12px] shadow-none"
        />
        <div className="max-h-64 overflow-y-auto" role="listbox" aria-label="Font families">
          {loading ? <p className="px-2.5 py-2 text-[12px] text-[#858a94]">Loading fonts…</p> : null}
          {!loading && visibleFamilies.length === 0 ? <p className="px-2.5 py-2 text-[12px] text-[#858a94]">No matching fonts</p> : null}
          {visibleFamilies.map((family) => {
            const selected = family.toLocaleLowerCase() === currentFamily.toLocaleLowerCase();
            return (
              <button
                key={family}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  onChange(family);
                  setOpen(false);
                }}
                className={cn("flex w-full items-center rounded-md px-2.5 py-2 text-left text-[13px] hover:bg-[#f4f5f8]", selected && "bg-[#edf2ff]")}
                style={{ fontFamily: family }}
              >
                <span className="min-w-0 flex-1 truncate">{family}</span>
                {selected ? <Check className="size-3.5 shrink-0 text-[#2f6de1]" /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function ColorField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const hex = normalizeHex(value);
  const [mode, setMode] = React.useState<ColorMode>("hsb");
  const displayValue = formatColor(hex, mode);
  return (
    <div className="mt-2 flex h-9 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <label className="relative size-5 shrink-0 overflow-hidden rounded-[3px]" style={{ backgroundColor: hex }}>
        <span className="sr-only">Choose color</span>
        <input type="color" className="absolute inset-0 cursor-pointer opacity-0" value={hex} onChange={(event) => onChange(event.currentTarget.value)} />
      </label>
      <Select value={mode} onValueChange={(next) => { if (next && isColorMode(next)) setMode(next); }}>
        <SelectTrigger className="h-7 w-[54px] border-0 bg-transparent p-0 text-[10px] text-[#858a94] shadow-none hover:bg-transparent focus-visible:ring-0" aria-label="Color mode"><SelectValue>{mode.toUpperCase()}</SelectValue></SelectTrigger>
        <SelectContent align="start" className="min-w-[72px] rounded-lg bg-white p-1 text-[#24262b] shadow-lg before:hidden">
          {(["hsb", "hex", "rgb"] as const).map((option) => <SelectItem key={option} value={option} className="rounded-md py-1 text-[11px] text-[#24262b] focus:bg-[#f1f2f4] focus:text-[#24262b] data-[state=checked]:bg-[#f1f2f4] data-[state=checked]:text-[#24262b]">{option.toUpperCase()}</SelectItem>)}
        </SelectContent>
      </Select>
      <Input className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 text-right text-[11px] uppercase shadow-none focus-visible:ring-0" value={displayValue} onChange={(event) => {
        const parsed = parseColor(event.currentTarget.value, mode);
        if (parsed) onChange(parsed);
      }} aria-label="Design color value" />
    </div>
  );
}

type ColorMode = "hsb" | "hex" | "rgb";

function isColorMode(value: string): value is ColorMode {
  return value === "hsb" || value === "hex" || value === "rgb";
}

function formatColor(hex: string, mode: ColorMode) {
  const { red, green, blue } = hexToRgb(hex);
  if (mode === "hex") return hex.slice(1).toUpperCase();
  if (mode === "rgb") return `${red}, ${green}, ${blue}`;
  const { hue, saturation, brightness } = rgbToHsb(red, green, blue);
  return `${hue}, ${saturation}, ${brightness}`;
}

function parseColor(value: string, mode: ColorMode) {
  if (mode === "hex") return normalizeHex(value.startsWith("#") ? value : `#${value}`);
  const parts = value.split(/[ ,/]+/).map((part) => Number(part)).filter(Number.isFinite);
  if (parts.length !== 3) return null;
  if (mode === "rgb") return rgbToHex(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
  return hsbToHex(parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0);
}

function hexToRgb(hex: string) {
  return { red: Number.parseInt(hex.slice(1, 3), 16), green: Number.parseInt(hex.slice(3, 5), 16), blue: Number.parseInt(hex.slice(5, 7), 16) };
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
  return { hue, saturation: max === 0 ? 0 : Math.round((delta / max) * 100), brightness: Math.round(max * 100) };
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

function isTransparentColor(value: string) {
  const normalized = value.trim().toLowerCase();
  return !normalized || normalized === "transparent" || normalized === "none" || /^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0(?:\.0+)?\s*\)$/i.test(normalized) || /^rgb\([^/]+\/\s*0%\s*\)$/i.test(normalized);
}
