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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { listSystemFontFamilies } from "@/app/lib/desktop";
import { cn } from "@/lib/utils";
import type { DesignField, DesignSelection, DesignStyleField } from "./design-html-runtime";
import { toggleTransformScale } from "./design-transform";
import { FALLBACK_FONT_FAMILIES, filterFontFamilyOptions, fontFamilyOptions } from "./font-family-catalog";
import { displayFontFamily } from "./font-family-display";
import { DesignColorField } from "./design-color-field";
import { DesignImageFitSelect, type DesignImageFitMode } from "./design-image-fit-select";
import { DesignPanelSelect } from "./design-panel-select";
import panelSelectChevron from "./assets/panel-select-chevron.svg";

type DesignPropertiesInspectorProps = {
  selection: DesignSelection | null;
  isMultiSelection: boolean;
  selectionCount: number;
  mixedStyleFields: readonly DesignStyleField[];
  activeTab: "element" | "design-system";
  onClose: () => void;
  onActiveTabChange: (tab: "element" | "design-system") => void;
  onApplyField: (field: DesignField, value: string, remember?: boolean) => void;
  onApplyFields: (fields: Partial<Record<DesignStyleField, string>>, remember?: boolean) => void;
  onToggleLock: () => void;
  onDelete: () => void;
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
  isMultiSelection,
  selectionCount,
  mixedStyleFields,
  onClose,
  onApplyField,
  onApplyFields,
  onToggleLock,
  onDelete,
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
  const [linkOpen, setLinkOpen] = React.useState(Boolean(selection.href));
  const [linkDraft, setLinkDraft] = React.useState(selection.href);
  const [aspectRatioLocked, setAspectRatioLocked] = React.useState(false);
  const fillType = imageFillOpen && selection.tag !== "img" ? "image" : fillTypeFor(selection);
  const isMixed = (field: DesignStyleField) => mixedStyleFields.includes(field);

  React.useEffect(() => {
    setLinkOpen(Boolean(selection.href));
    setLinkDraft(selection.href);
  }, [selection.id, selection.href]);

  React.useEffect(() => setAspectRatioLocked(false), [selection.id]);

  const width = numericValue(selection.styles.width, selection.rect.width);
  const height = numericValue(selection.styles.height, selection.rect.height);
  const aspectRatio = width > 0 && height > 0 ? width / height : 1;
  const applySize = (field: "width" | "height", value: number, remember?: boolean) => {
    if (!aspectRatioLocked) {
      onApplyField(field, `${value}px`, remember);
      return;
    }
    onApplyFields(field === "width"
      ? { width: `${value}px`, height: `${value / aspectRatio}px` }
      : { width: `${value * aspectRatio}px`, height: `${value}px` }, remember);
  };

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

  const applyPixels = (field: DesignStyleField, value: string, remember?: boolean) => {
    onApplyField(field, value.trim() && !Number.isNaN(Number(value)) ? `${value}px` : value, remember);
  };

  return <>

      <div className={cn("flex h-[52px] items-center px-4", !linkOpen && "border-b border-[#e8e9ec]")}>
        <span className="min-w-0 flex-1 truncate text-[14px] font-medium">{isMultiSelection ? `${selectionCount} elements · Batch selection` : selection.canEditText ? "Text layer" : `${selection.tag.charAt(0).toUpperCase()}${selection.tag.slice(1).toLowerCase()} layer`}</span>
        {!isMultiSelection ? <>
          <InspectorIconButton
            label={selection.href ? "Edit link" : "Add link"}
            active={linkOpen}
            disabled={selection.locked}
            onClick={() => {
              setLinkDraft(selection.href);
              setLinkOpen((open) => !open);
            }}
          ><Link2 /></InspectorIconButton>
          <InspectorIconButton label={selection.locked ? "Unlock layer" : "Lock layer"} active={selection.locked} onClick={onToggleLock}><Lock /></InspectorIconButton>
          <InspectorIconButton label="Delete layer" disabled={!selection.canDelete || selection.locked} onClick={onDelete}><Trash2 /></InspectorIconButton>
        </> : null}
      </div>

      {linkOpen && !isMultiSelection ? (
        <form
          className="flex gap-2 border-b border-[#e8e9ec] px-4 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            const href = linkDraft.trim();
            onApplyField("href", href, true);
            setLinkOpen(Boolean(href));
          }}
        >
          <Input
            id="design-layer-link"
            autoFocus
            value={linkDraft}
            placeholder="https://example.com or /page"
            aria-label="Layer link"
            className="h-9 min-w-0 flex-1 rounded-lg border-[#dedfe3] px-2.5 text-[12px] shadow-none"
            onChange={(event) => setLinkDraft(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setLinkDraft(selection.href);
                setLinkOpen(false);
              }
            }}
          />
          <Button type="submit" size="sm" className="h-9 shrink-0 rounded-lg bg-black px-3 text-white hover:bg-black/85 active:bg-black">保存</Button>
        </form>
      ) : null}

      <fieldset disabled={selection.locked} className={cn("contents", selection.locked && "pointer-events-none opacity-50")} aria-disabled={selection.locked}>
      {!isMultiSelection && selection.canEditText ? (
        <InspectorSection title="Text">
          <Input
            aria-label="Design text"
            className="h-11 rounded-lg border-[#77a0ff] bg-white px-3 text-[13px] shadow-none focus-visible:ring-1 focus-visible:ring-[#77a0ff]"
            value={selection.text}
            placeholder="预览文本可编辑内容框..."
            onFocus={() => onApplyField("text", selection.text, true)}
            onChange={(event) => onApplyField("text", event.currentTarget.value, false)}
          />
          <div className="mt-3">
            <FontFamilyPicker value={selection.styles.fontFamily || "PingFang SC"} onChange={(value) => onApplyField("fontFamily", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <FontPresetField label="Size" value={String(fontSize)} presets={FONT_SIZE_PRESETS} onChange={(value, remember) => applyPixels("fontSize", value, remember)} />
            <FontPresetField label="Weight" value={selection.styles.fontWeight || "400"} presets={FONT_WEIGHT_PRESETS} onChange={(value) => onApplyField("fontWeight", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <DragNumberField label="Line height" value={String(lineHeight)} onChange={(value, remember) => applyPixels("lineHeight", String(value), remember)} />
            <DragNumberField label="Letter spacing" value={String(letterSpacing)} suffix="%" onChange={(value, remember) => onApplyField("letterSpacing", `${value}%`, remember)} />
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

      {isMultiSelection ? (
        <InspectorSection title="Typography">
          <div className="mb-1 flex items-center justify-between"><FieldCaption>Font family</FieldCaption><MixedValueHint mixed={isMixed("fontFamily")} /></div>
          <FontFamilyPicker mixed={isMixed("fontFamily")} value={selection.styles.fontFamily || "PingFang SC"} onChange={(value) => onApplyField("fontFamily", value)} />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <FontPresetField mixed={isMixed("fontSize")} label="Size" value={String(fontSize)} presets={FONT_SIZE_PRESETS} onChange={(value, remember) => applyPixels("fontSize", value, remember)} />
            <FontPresetField mixed={isMixed("fontWeight")} label="Weight" value={selection.styles.fontWeight || "400"} presets={FONT_WEIGHT_PRESETS} onChange={(value) => onApplyField("fontWeight", value)} />
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <DragNumberField mixed={isMixed("lineHeight")} label="Line height" value={String(lineHeight)} onChange={(value, remember) => applyPixels("lineHeight", String(value), remember)} />
            <DragNumberField mixed={isMixed("letterSpacing")} label="Letter spacing" value={String(letterSpacing)} suffix="%" onChange={(value, remember) => onApplyField("letterSpacing", `${value}%`, remember)} />
          </div>
          <div className="mt-3 flex items-center justify-between"><FieldCaption>Alignment</FieldCaption><MixedValueHint mixed={isMixed("textAlign")} /></div>
          <div className="grid grid-cols-3 gap-1">
            <PropertyButton active={!isMixed("textAlign") && selection.styles.textAlign === "left"} aria-label="Align text left" onClick={() => onApplyField("textAlign", "left")}><AlignLeft /></PropertyButton>
            <PropertyButton active={!isMixed("textAlign") && selection.styles.textAlign === "center"} aria-label="Align text center" onClick={() => onApplyField("textAlign", "center")}><AlignCenter /></PropertyButton>
            <PropertyButton active={!isMixed("textAlign") && selection.styles.textAlign === "right"} aria-label="Align text right" onClick={() => onApplyField("textAlign", "right")}><AlignRight /></PropertyButton>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1">
            <BatchPropertyButton mixed={isMixed("fontWeight")} label="Bold"><PropertyButton active={!isMixed("fontWeight") && numericValue(selection.styles.fontWeight, 400) >= 600} aria-label="Bold" onClick={() => onApplyField("fontWeight", isMixed("fontWeight") ? "700" : numericValue(selection.styles.fontWeight, 400) >= 600 ? "400" : "700")}><Bold /></PropertyButton></BatchPropertyButton>
            <BatchPropertyButton mixed={isMixed("fontStyle")} label="Italic"><PropertyButton active={!isMixed("fontStyle") && selection.styles.fontStyle === "italic"} aria-label="Italic" onClick={() => onApplyField("fontStyle", isMixed("fontStyle") ? "italic" : selection.styles.fontStyle === "italic" ? "normal" : "italic")}><Italic /></PropertyButton></BatchPropertyButton>
            <BatchPropertyButton mixed={isMixed("textDecoration")} label="Underline"><PropertyButton active={!isMixed("textDecoration") && selection.styles.textDecoration.includes("underline")} aria-label="Underline" onClick={() => onApplyField("textDecoration", isMixed("textDecoration") ? ensureDecoration(selection.styles.textDecoration, "underline") : toggleDecoration(selection.styles.textDecoration, "underline"))}><Underline /></PropertyButton></BatchPropertyButton>
            <BatchPropertyButton mixed={isMixed("textDecoration")} label="Strikethrough"><PropertyButton active={!isMixed("textDecoration") && selection.styles.textDecoration.includes("line-through")} aria-label="Strikethrough" onClick={() => onApplyField("textDecoration", isMixed("textDecoration") ? ensureDecoration(selection.styles.textDecoration, "line-through") : toggleDecoration(selection.styles.textDecoration, "line-through"))}><Strikethrough /></PropertyButton></BatchPropertyButton>
          </div>
        </InspectorSection>
      ) : null}

      {!isMultiSelection ? <InspectorSection title="Position">
        <FieldCaption>Alignment</FieldCaption>
        <div className="grid grid-cols-6 gap-1">
          <PropertyButton aria-label="Align left"><AlignLeft /></PropertyButton>
          <PropertyButton aria-label="Align horizontal center"><AlignHorizontalJustifyCenter /></PropertyButton>
          <PropertyButton aria-label="Align right"><AlignRight /></PropertyButton>
          <PropertyButton aria-label="Align top"><AlignVerticalJustifyStart /></PropertyButton>
          <PropertyButton aria-label="Align vertical center"><AlignVerticalJustifyCenter /></PropertyButton>
          <PropertyButton aria-label="Align bottom"><AlignVerticalJustifyEnd /></PropertyButton>
        </div>
        <FieldCaption className="mt-3">Position</FieldCaption>
        <div className="grid grid-cols-2 gap-2">
          <DragNumberField label="X" value={selection.styles.left || `${Math.round(selection.rect.left)}px`} suffix="px" onChange={(value, remember) => onApplyField("left", `${value}px`, remember)} />
          <DragNumberField label="Y" value={selection.styles.top || `${Math.round(selection.rect.top)}px`} suffix="px" onChange={(value, remember) => onApplyField("top", `${value}px`, remember)} />
        </div>
        <div className="mt-2 grid grid-cols-[1fr_42px_42px_42px] gap-1">
          <DragNumberField label="Rotation" value={`${rotation}°`} suffix="°" onChange={(value, remember) => onApplyField("transform", `rotate(${value}deg)`, remember)} />
          <PropertyButton aria-label="Rotate clockwise" onClick={() => onApplyField("transform", `rotate(${rotation + 90}deg)`)}><RotateCw /></PropertyButton>
          <PropertyButton aria-label="Flip horizontal" onClick={() => onApplyField("transform", toggleTransformScale(selection.styles.transform, "x"))}><FlipHorizontal2 /></PropertyButton>
          <PropertyButton aria-label="Flip vertical" onClick={() => onApplyField("transform", toggleTransformScale(selection.styles.transform, "y"))}><SeparatorHorizontal /></PropertyButton>
        </div>
      </InspectorSection> : null}

      {!isMultiSelection ? <InspectorSection title="Size">
        <div className="grid grid-cols-[1fr_1fr_34px] gap-2">
          <DragNumberField label="Width" value={selection.styles.width || `${Math.round(selection.rect.width)}px`} suffix="px" onChange={(value, remember) => applySize("width", value, remember)} />
          <DragNumberField label="Height" value={selection.styles.height || `${Math.round(selection.rect.height)}px`} suffix="px" onChange={(value, remember) => applySize("height", value, remember)} />
          <PropertyButton active={aspectRatioLocked} aria-label={aspectRatioLocked ? "Unlock aspect ratio" : "Lock aspect ratio"} onClick={() => setAspectRatioLocked((locked) => !locked)}>
            <Lock />
          </PropertyButton>
        </div>
      </InspectorSection> : null}

      <InspectorSection title="Fill">
        {!isMultiSelection ? <div className="grid grid-cols-4 gap-1.5">
          <PropertyButton active={fillType === "none"} aria-label="No fill" onClick={() => applyFillType("none")}><Minus /></PropertyButton>
          <PropertyButton active={fillType === "solid"} aria-label="Solid fill" onClick={() => applyFillType("solid")}><span className="size-3 rounded-[2px] border border-current" /></PropertyButton>
          <PropertyButton active={fillType === "gradient"} aria-label="Gradient fill" onClick={() => applyFillType("gradient")}><Grip /></PropertyButton>
          <PropertyButton active={fillType === "image"} aria-label="Image fill" onClick={() => applyFillType("image")}><Image /></PropertyButton>
        </div> : null}
        {isMultiSelection ? <>
          <ColorField label="Text color" mixed={isMixed("color")} value={selection.styles.color || "#000000"} onChange={(value, remember) => onApplyField("color", value, remember)} />
          <ColorField label="Background color" mixed={isMixed("backgroundColor")} value={selection.styles.backgroundColor || "#000000"} onChange={(value, remember) => onApplyField("backgroundColor", value, remember)} />
        </> : <>
          {fillType === "solid" ? <ColorField value={backgroundValue || "#000000"} onChange={(value, remember) => onApplyField(fillField, value, remember)} /> : null}
          {fillType === "gradient" ? <FillSummary swatchClassName="bg-[linear-gradient(180deg,#2e6bdb_0%,#76e3e9_100%)]" label="Gradient" /> : null}
          {fillType === "image" ? <ImageFillPicker selection={selection} onApplyFields={onApplyFields} onChooseImage={selection.tag === "img" ? onChooseReplacementImage : onChooseBackgroundImage} /> : null}
        </>}
      </InspectorSection>

      <InspectorSection title="Border">
        <div className="grid grid-cols-2 gap-2">
          <BorderStyleField value={selection.styles.borderStyle || "solid"} onChange={(value, remember) => onApplyField("borderStyle", value.toLowerCase(), remember)} />
          <PropertyField mixed={isMultiSelection && isMixed("borderWidth")} label="Width" value={selection.styles.borderWidth || "0px"} onChange={(value, remember) => onApplyField("borderWidth", value, remember)} />
        </div>
        <ColorField mixed={isMultiSelection && isMixed("borderColor")} value={selection.styles.borderColor || "#000000"} onChange={(value, remember) => onApplyField("borderColor", value, remember)} />
      </InspectorSection>

      <InspectorSection title="Appearance">
        <div className="grid grid-cols-2 gap-2">
          <PropertyField mixed={isMultiSelection && isMixed("borderRadius")} label="Radius" value={selection.styles.borderRadius || "0px"} onChange={(value, remember) => onApplyField("borderRadius", value, remember)} />
          <PropertyField mixed={isMultiSelection && isMixed("opacity")} label="Opacity" value={String(opacity)} suffix="%" onChange={(value, remember) => onApplyField("opacity", String(Math.max(0, Math.min(100, numericValue(value, 100))) / 100), remember)} />
        </div>
        {isMultiSelection ? <div className="mt-2 grid grid-cols-2 gap-2">
          <PropertyField mixed={isMixed("padding")} label="Padding" value={selection.styles.padding || "0px"} onChange={(value, remember) => onApplyField("padding", value, remember)} />
          <PropertyField mixed={isMixed("margin")} label="Margin" value={selection.styles.margin || "0px"} onChange={(value, remember) => onApplyField("margin", value, remember)} />
        </div> : null}
        <FieldCaption className="mt-3">Shadow</FieldCaption>
        {isMultiSelection ? <PropertyField mixed={isMixed("boxShadow")} label="Shadow" value={selection.styles.boxShadow || "none"} onChange={(value, remember) => onApplyField("boxShadow", value, remember)} /> : <ShadowIntensityControl
          value={shadowIntensity}
          shadow={selection.styles.boxShadow}
          onChange={(value, remember) => onApplyField("boxShadow", shadowWithIntensity(selection.styles.boxShadow, value), remember)}
        />}
      </InspectorSection>
      </fieldset>

      <InspectorSection title="HTML" last>
        <textarea
          readOnly
          value={selection.html}
          aria-label="Selected element HTML code"
          spellCheck={false}
          className="h-[220px] w-full resize-none overflow-auto rounded-[9px] border border-[#99b8f2] bg-white px-4 py-2 text-[14px] leading-5 text-[#24262b] outline-none selection:bg-[#dce8ff]"
          placeholder="HTML Code..."
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

export function DesignSystemInspectorShell({ onClose, children }: Pick<DesignPropertiesInspectorProps, "onClose" | "children">) {
  return <InspectorShell activeTab="design-system" onActiveTabChange={() => undefined} onClose={onClose} designSystemOnly>{children}</InspectorShell>;
}

function InspectorShell({ activeTab, onActiveTabChange, onClose, children, designSystemOnly = false }: Pick<DesignPropertiesInspectorProps, "activeTab" | "onActiveTabChange" | "onClose" | "children"> & { designSystemOnly?: boolean }) {
  return (
    <aside className="flex h-full w-[310px] shrink-0 flex-col overflow-hidden border-l border-[#ebebeb] bg-white text-[#202228]" aria-label="Design inspector">
      <header className="sticky left-0 top-0 z-20 flex h-[58px] w-full shrink-0 items-center border-b border-[#ebebeb] bg-white !px-4">
        <div className="flex w-[240px] shrink-0 gap-1">
          {!designSystemOnly ? <button type="button" onClick={() => onActiveTabChange("element")} className={cn("h-[35px] w-[118px] shrink-0 whitespace-nowrap rounded-lg px-2 text-[12px] font-semibold leading-none text-[#24262b] transition-colors", activeTab === "element" ? "bg-[#f5f6f9]" : "hover:bg-[#f5f6f9]")} aria-pressed={activeTab === "element"}>Element</button> : null}
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
      <DesignImageFitSelect value={mode} onChange={applyMode} />
      <div className="relative flex h-[100px] w-full items-center justify-center overflow-hidden rounded-lg bg-[linear-gradient(45deg,#929292_25%,transparent_25%,transparent_75%,#929292_75%),linear-gradient(45deg,#929292_25%,#a0a0a0_25%,#a0a0a0_75%,#929292_75%)] bg-[length:52px_52px] bg-[position:0_0,26px_26px]">
        {backgroundSource ? <span className="absolute inset-0 bg-no-repeat" style={{ backgroundImage: `url(\"${backgroundSource}\")`, backgroundSize: imagePreviewSize(selection, mode), backgroundPosition: imagePosition(selection) }} /> : null}
        <span className="absolute inset-0 bg-black/45" />
        <button type="button" onClick={onChooseImage} className="relative rounded-lg bg-black px-4 py-2 text-[10px] text-white transition-colors hover:bg-[#202020] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white">Choose Media</button>
      </div>
    </div>
  );
}

type ImageFitMode = DesignImageFitMode;

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

function imagePreviewSize(selection: DesignSelection, mode: ImageFitMode) {
  if (mode !== "crop") return mode === "fill" ? "100% 100%" : "contain";
  return selection.tag === "img" ? "cover" : selection.styles.backgroundSize || "cover";
}

function imagePosition(selection: DesignSelection) {
  return selection.tag === "img" ? selection.styles.objectPosition || "50% 50%" : selection.styles.backgroundPosition || "50% 50%";
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
      <PropertyField label="Intensity" value={String(value)} suffix="%" onChange={(next, remember) => onChange(clampPercentage(numericValue(next, value)), remember ?? true)} />
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

function PropertyField({ label, value, suffix, onChange, disabled = false, mixed = false }: { label: string; value: string; suffix?: string; onChange: (value: string, remember?: boolean) => void; disabled?: boolean; mixed?: boolean }) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="shrink-0 text-[10px] text-[#969ba5]">{label}</span>
      <input className="min-w-0 flex-1 bg-transparent text-right text-[12px] outline-none placeholder:text-[#6b7280] disabled:cursor-default" value={mixed ? "" : value} placeholder={mixed ? "Mixed" : undefined} disabled={disabled} onFocus={() => onChange(value, true)} onChange={(event) => onChange(event.currentTarget.value, false)} aria-label={`Design ${label.toLowerCase()} value`} />
      {suffix && !mixed ? <span className="text-[10px] text-[#969ba5]">{suffix}</span> : null}
    </label>
  );
}

function DragNumberField({ label, value, suffix = "", onChange, mixed = false }: { label: string; value: string; suffix?: string; onChange: (value: number, remember?: boolean) => void; mixed?: boolean }) {
  return (
    <label className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="shrink-0 text-[10px] text-[#969ba5]">{label}</span>
      <DragNumberInput label={label} value={String(numericValue(value, 0))} mixed={mixed} onChange={onChange} />
      {suffix && !mixed ? <span className="text-[10px] text-[#969ba5]">{suffix}</span> : null}
    </label>
  );
}

function DragNumberInput({ label, value, onChange, mixed = false }: { label: string; value: string; onChange: (value: number, remember?: boolean) => void; mixed?: boolean }) {
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

      const remember = !activeDrag.moved;
      activeDrag.moved = true;
      const nextValue = Math.round((activeDrag.startValue + distance) * 100) / 100;
      onChange(nextValue, remember);
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
      value={mixed ? "" : value}
      placeholder={mixed ? "Mixed" : undefined}
      onPointerDown={beginDrag}
      onFocus={() => onChange(numericValue(value, 0), true)}
      onChange={(event) => onChange(numericValue(event.currentTarget.value, numericValue(value, 0)), false)}
      aria-label={`Design ${label.toLowerCase()}`}
      title="Drag left or right to adjust; click to type"
    />
  );
}

function FontPresetField({ label, value, presets, onChange, mixed = false }: { label: string; value: string; presets: string[] | { value: string; label: string }[]; onChange: (value: string, remember?: boolean) => void; mixed?: boolean }) {
  const options = presets.map((preset) => typeof preset === "string" ? { value: preset, label: preset } : preset);

  return (
    <div className="flex h-9 min-w-0 items-center gap-2 rounded-lg bg-[#f4f5f8] px-2.5">
      <span className="shrink-0 text-[10px] text-[#969ba5]">{label}</span>
      {label === "Size" ? (
        <DragNumberInput label={label} value={value} mixed={mixed} onChange={(nextValue, remember) => onChange(String(nextValue), remember)} />
      ) : (
        <span className="min-w-0 flex-1 text-right text-[12px]">{mixed ? "Mixed" : value}</span>
      )}
      <Select value={mixed ? undefined : value} onValueChange={(nextValue) => { if (nextValue) onChange(nextValue); }}>
        <SelectTrigger className="h-auto w-auto shrink-0 border-0 bg-transparent p-0 shadow-none hover:bg-transparent focus-visible:ring-0" aria-label={`Select ${label.toLowerCase()}`} />
        <SelectContent align="end">
          {options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

type BorderStyle = "none" | "dashed" | "solid";

function BorderStyleField({ value, onChange }: { value: string; onChange: (value: BorderStyle, remember?: boolean) => void }) {
  const borderStyle: BorderStyle = value === "none" || value === "dashed" ? value : "solid";

  return (
    <DesignPanelSelect
      value={borderStyle}
      options={BORDER_STYLE_OPTIONS}
      onChange={onChange}
      ariaLabel="Design border style"
      className="h-9 min-w-0 rounded-lg bg-[#f4f5f8]"
    />
  );
}

const BORDER_STYLE_OPTIONS = [
  { value: "none", label: "None" },
  { value: "dashed", label: "Dashed" },
  { value: "solid", label: "Solid" },
] as const;

function FontFamilyPicker({ value, onChange, mixed = false }: { value: string; onChange: (value: string) => void; mixed?: boolean }) {
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
        <span className="min-w-0 flex-1 truncate text-left text-[12px]" style={mixed ? undefined : { fontFamily: currentFamily }}>{mixed ? "Mixed" : currentFamily}</span>
        <img src={panelSelectChevron} alt="" className={cn("size-4 shrink-0 transition-transform", open && "rotate-180")} />
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={12} initialFocus={false} className="w-[276px] gap-2 rounded-xl border-[#dedfe3] bg-white p-3 shadow-[0_8px_18px_rgba(37,41,49,0.11)] before:hidden">
        <Input
          autoFocus
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search fonts"
          aria-label="Search fonts"
          className="h-[34px] rounded-lg border-0 bg-[#f4f5f7] px-2.5 text-[12px] shadow-none"
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

function ColorField({ label = "Color", value, onChange, mixed = false }: { label?: string; value: string; onChange: (value: string, remember?: boolean) => void; mixed?: boolean }) {
  return <DesignColorField label={label} mixed={mixed} value={value} onChange={onChange} className="mt-2 h-9 bg-[#f4f5f8] px-2.5" />;
}

function PropertyButton({ active = false, disabled = false, onClick, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button type="button" className={cn("grid h-9 min-w-0 place-items-center rounded-lg bg-[#f4f5f8] text-[#858a94] transition-colors [&_svg]:size-4", active && "bg-black text-white", !disabled && "hover:bg-[#e9ebef] hover:text-black", active && !disabled && "hover:bg-black hover:text-white")} disabled={disabled} onClick={onClick} {...props}>
      {children}
    </button>
  );
}

function MixedValueHint({ mixed }: { mixed?: boolean }) {
  return mixed ? <span className="text-[10px] font-medium text-[#6b7280]">Mixed</span> : null;
}

function BatchPropertyButton({ mixed, label, children }: { mixed: boolean; label: string; children: React.ReactNode }) {
  return (
    <div className="relative min-w-0" title={mixed ? `${label}: Mixed` : label}>
      {children}
      {mixed ? <span className="pointer-events-none absolute right-0.5 top-0.5 size-1.5 rounded-full bg-[#2f6de1]" aria-label={`${label}: Mixed`} /> : null}
    </div>
  );
}

function inspectorIconButtonClass(active = false) {
  return cn(
    "grid h-9 w-[34px] shrink-0 place-items-center rounded-lg p-0 text-[#858a94] transition-colors hover:bg-[#f4f5f8] hover:text-[#202228] active:bg-black active:text-white disabled:pointer-events-none disabled:opacity-55 [&_svg]:!size-4",
    active && "bg-black text-white hover:bg-black hover:text-white",
  );
}

function InspectorIconButton({ label, active, disabled = false, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return <button type="button" disabled={disabled} aria-label={label} aria-pressed={active} className={inspectorIconButtonClass(active)} {...props}>{children}</button>;
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

function ensureDecoration(value: string, decoration: "underline" | "line-through") {
  const values = value.split(/\s+/).filter(Boolean).filter((item) => item !== "none");
  return values.includes(decoration) ? values.join(" ") : [...values, decoration].join(" ");
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
