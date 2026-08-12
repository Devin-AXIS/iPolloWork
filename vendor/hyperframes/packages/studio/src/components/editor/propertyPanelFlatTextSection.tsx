import { useEffect, useState, type ReactNode } from "react";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ListBullets,
  ListNumbers,
  TextIndent,
  X,
} from "../../icons/SystemIcons";
import { isTextEditableSelection, type DomEditSelection } from "./domEditing";
import type { ImportedFontAsset } from "./fontAssets";
import { normalizeTextMetricValue } from "./propertyPanelHelpers";
import { FontFamilyField } from "./propertyPanelFont";
import { PromotableControl } from "./PromotableControl";
import { FlatRow, FlatSelectRow } from "./propertyPanelFlatPrimitives";
import { resolveValueTier } from "./propertyPanelValueTier";
import {
  detectAvailableWeights,
  formatTextFieldPreview,
  getTextFieldColor,
  getTextStyleValue,
  TextAreaField,
  WEIGHT_LABELS,
} from "./propertyPanelSections";

/* ------------------------------------------------------------------ */
/*  Flat text section (design_handoff_studio_inspector, #10a)          */
/* ------------------------------------------------------------------ */

const FONT_SIZE_OPTIONS = [
  "8",
  "10",
  "12",
  "14",
  "16",
  "18",
  "20",
  "24",
  "28",
  "32",
  "40",
  "48",
  "64",
  "72",
  "96",
].map((size) => ({ value: `${size}px`, label: size }));

const LETTER_SPACING_OPTIONS = [
  { value: "normal", label: "Normal" },
  { value: "-2px", label: "-2 px" },
  { value: "-1px", label: "-1 px" },
  { value: "0px", label: "0 px" },
  { value: "0.5px", label: "0.5 px" },
  { value: "1px", label: "1 px" },
  { value: "2px", label: "2 px" },
  { value: "4px", label: "4 px" },
  { value: "8px", label: "8 px" },
  { value: "12px", label: "12 px" },
];

export function toggleDecoration(
  current: string,
  decoration: "underline" | "line-through",
): string {
  const values = new Set(current === "none" ? [] : current.split(/\s+/).filter(Boolean));
  if (values.has(decoration)) values.delete(decoration);
  else values.add(decoration);
  return values.size > 0 ? Array.from(values).join(" ") : "none";
}

export function TextIconButton({
  label,
  active = false,
  disabled = false,
  children,
  onClick,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  children: ReactNode;
  onClick?: () => void;
}) {
  const { tx } = useStudioI18n();
  return (
    <button
      type="button"
      aria-label={tx(label)}
      aria-pressed={disabled ? undefined : active}
      title={disabled ? `${tx(label)}（此图层暂不可用）` : tx(label)}
      disabled={disabled}
      onClick={onClick}
      className="hf-text-icon-button flex h-[34px] min-w-0 flex-1 items-center justify-center rounded-[8px] border-[0.5px] border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#20bbc0]/50 disabled:cursor-not-allowed disabled:opacity-45"
    >
      {children}
    </button>
  );
}

function FlatTextFieldEditor({
  field,
  styles,
  fontAssets,
  onImportFonts,
  onSetText,
  onSetTextFieldStyle,
  autoFocus = false,
}: {
  field: DomEditSelection["textFields"][number];
  styles: Record<string, string>;
  fontAssets: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  autoFocus?: boolean;
}) {
  const track = useTrackDesignInput();
  const weight = getTextStyleValue(field, styles, "font-weight", "400");
  const weightOptions = detectAvailableWeights(
    field.computedStyles["font-family"] || styles["font-family"] || "",
  );
  const align = getTextStyleValue(field, styles, "text-align", "start");
  const fontStyle = getTextStyleValue(field, styles, "font-style", "normal");
  const decoration = getTextStyleValue(field, styles, "text-decoration-line", "none");
  const numericWeight = Number.parseInt(weight, 10);
  const bold = weight === "bold" || (!Number.isNaN(numericWeight) && numericWeight >= 600);

  return (
    <div className="space-y-3" data-flat-text-controls="true">
      <PromotableControl channel={{ kind: "text" }} enabled={field.source === "self"}>
        {({ value, onCommit }) => (
          <TextAreaField
            flat
            label="Content"
            value={value ?? field.value}
            autoFocus={autoFocus}
            onCommit={onCommit ?? ((next) => onSetText(next, field.key))}
          />
        )}
      </PromotableControl>
      <PromotableControl
        channel={{ kind: "style", prop: "font-family" }}
        enabled={field.source === "self"}
      >
        {({ value, onCommit }) => (
          <FontFamilyField
            flat
            valueOnly
            value={
              value ?? (field.computedStyles["font-family"] || styles["font-family"] || "inherit")
            }
            importedFonts={fontAssets}
            onImportFonts={onImportFonts}
            onCommit={onCommit ?? ((next) => onSetTextFieldStyle(field.key, "font-family", next))}
          />
        )}
      </PromotableControl>
      <div className="hf-flat-responsive-grid grid grid-cols-2 gap-3">
        <FlatSelectRow
          label="Weight"
          ariaLabel="Font style"
          value={weight}
          valueOnly
          options={(weightOptions.includes(weight)
            ? weightOptions
            : [weight, ...weightOptions]
          ).map((option) => ({
            value: option,
            label: WEIGHT_LABELS[option]?.replace(/^\d+ · /, "") ?? option,
          }))}
          tier={resolveValueTier(field.inlineStyles["font-weight"], "400")}
          onChange={(next) => onSetTextFieldStyle(field.key, "font-weight", next)}
        />
        <FlatSelectRow
          label="Size"
          value={field.computedStyles["font-size"] || styles["font-size"] || "16px"}
          valueOnly
          options={FONT_SIZE_OPTIONS}
          tier={resolveValueTier(field.inlineStyles["font-size"], styles["font-size"] || "16px")}
          onChange={(next) => onSetTextFieldStyle(field.key, "font-size", next)}
        />
      </div>
      <div className="hf-flat-responsive-grid grid grid-cols-2 gap-3">
        <FlatRow
          label="Line height"
          value={getTextStyleValue(field, styles, "line-height", "normal")}
          tier={resolveValueTier(field.inlineStyles["line-height"], "normal")}
          liveCommit
          onCommit={(next) =>
            onSetTextFieldStyle(
              field.key,
              "line-height",
              normalizeTextMetricValue("line-height", next),
            )
          }
          onReset={() => onSetTextFieldStyle(field.key, "line-height", "")}
        />
        <FlatSelectRow
          label="Letter spacing"
          value={getTextStyleValue(field, styles, "letter-spacing", "0px")}
          options={LETTER_SPACING_OPTIONS}
          tier={resolveValueTier(field.inlineStyles["letter-spacing"], "0px")}
          onChange={(next) =>
            onSetTextFieldStyle(
              field.key,
              "letter-spacing",
              normalizeTextMetricValue("letter-spacing", next),
            )
          }
          onReset={() => onSetTextFieldStyle(field.key, "letter-spacing", "")}
        />
      </div>
      <div className="hf-flat-responsive-grid grid grid-cols-2 gap-3">
        <div className="flex min-w-0 gap-1" role="group" aria-label="Text alignment">
          {(
            [
              ["left", "Align left", AlignLeft],
              ["center", "Align center", AlignCenter],
              ["right", "Align right", AlignRight],
            ] as const
          ).map(([key, label, Icon]) => (
            <TextIconButton
              key={key}
              label={label}
              active={
                align === key ||
                (key === "left" && align === "start") ||
                (key === "right" && align === "end")
              }
              onClick={() => {
                if ((key === "left" && align === "start") || (key === "right" && align === "end")) {
                  return;
                }
                onSetTextFieldStyle(field.key, "text-align", key);
              }}
            >
              <Icon size={16} />
            </TextIconButton>
          ))}
        </div>
        <div className="flex min-w-0 gap-1" role="group" aria-label="List formatting">
          <TextIconButton label="Bulleted list" disabled>
            <ListBullets size={16} />
          </TextIconButton>
          <TextIconButton label="Numbered list" disabled>
            <ListNumbers size={16} />
          </TextIconButton>
          <TextIconButton label="Increase indent" disabled>
            <TextIndent size={16} />
          </TextIconButton>
        </div>
      </div>
      <div className="flex min-w-0 gap-1" role="group" aria-label="Text formatting">
        <TextIconButton
          label="Bold"
          active={bold}
          onClick={() => onSetTextFieldStyle(field.key, "font-weight", bold ? "400" : "700")}
        >
          <span className="text-[16px] font-semibold">B</span>
        </TextIconButton>
        <TextIconButton
          label="Italic"
          active={fontStyle === "italic"}
          onClick={() =>
            onSetTextFieldStyle(
              field.key,
              "font-style",
              fontStyle === "italic" ? "normal" : "italic",
            )
          }
        >
          <span className="text-[16px] italic">I</span>
        </TextIconButton>
        <TextIconButton
          label="Underline"
          active={decoration.split(/\s+/).includes("underline")}
          onClick={() =>
            onSetTextFieldStyle(
              field.key,
              "text-decoration-line",
              toggleDecoration(decoration, "underline"),
            )
          }
        >
          <span className="text-[16px] underline underline-offset-2">U</span>
        </TextIconButton>
        <TextIconButton
          label="Strikethrough"
          active={decoration.split(/\s+/).includes("line-through")}
          onClick={() =>
            onSetTextFieldStyle(
              field.key,
              "text-decoration-line",
              toggleDecoration(decoration, "line-through"),
            )
          }
        >
          <span className="text-[16px] line-through">S</span>
        </TextIconButton>
      </div>
    </div>
  );
}

export function FlatTextSection({
  element,
  styles,
  fontAssets,
  onImportFonts,
  onSetText,
  onSetTextFieldStyle,
  onRemoveTextField,
}: {
  element: DomEditSelection;
  styles: Record<string, string>;
  fontAssets: ImportedFontAsset[];
  onImportFonts?: (files: FileList | File[]) => Promise<ImportedFontAsset[]>;
  onSetText: (value: string, fieldKey?: string) => void;
  onSetTextFieldStyle: (fieldKey: string, property: string, value: string) => void;
  onAddTextField: (afterFieldKey?: string) => string | Promise<string | null> | null;
  onRemoveTextField: (fieldKey: string) => void;
}) {
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(
    element.textFields[0]?.key ?? null,
  );

  useEffect(() => {
    const nextFields = element.textFields;
    setActiveFieldKey((current) => {
      if (current && nextFields.some((field) => field.key === current)) return current;
      return nextFields[0]?.key ?? null;
    });
  }, [element.id, element.selector, element.textFields]);

  if (!isTextEditableSelection(element)) return null;
  const textFields = element.textFields;
  const activeField = textFields.find((field) => field.key === activeFieldKey) ?? textFields[0];
  if (!activeField) return null;

  if (textFields.length > 1) {
    return (
      <div className="space-y-2">
        <FlatTextLayerList
          fields={textFields}
          activeFieldKey={activeField.key}
          styles={styles}
          onSelect={setActiveFieldKey}
          onRemove={onRemoveTextField}
        />
        <FlatTextFieldEditor
          key={activeField.key}
          field={activeField}
          styles={styles}
          fontAssets={fontAssets}
          onImportFonts={onImportFonts}
          onSetText={onSetText}
          onSetTextFieldStyle={onSetTextFieldStyle}
          autoFocus
        />
      </div>
    );
  }

  return (
    <div className="space-y-3" data-flat-text-editor="true">
      <FlatTextFieldEditor
        field={activeField}
        styles={styles}
        fontAssets={fontAssets}
        onImportFonts={onImportFonts}
        onSetText={onSetText}
        onSetTextFieldStyle={onSetTextFieldStyle}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Multi-field layer list (design_handoff_studio_inspector, #10a —     */
/*  no mock exists for this row; layout originated by this plan,        */
/*  following the "left-rule nested content" convention established     */
/*  by Text's own content block, Motion's effect cards, and Media's     */
/*  cutout block. Flag for design review.)                              */
/* ------------------------------------------------------------------ */

export function FlatTextLayerList({
  fields,
  activeFieldKey,
  styles,
  onSelect,
  onRemove,
}: {
  fields: DomEditSelection["textFields"];
  activeFieldKey: string;
  styles: Record<string, string>;
  onSelect: (fieldKey: string) => void;
  onRemove: (fieldKey: string) => void;
}) {
  const track = useTrackDesignInput();
  return (
    <div className="mb-2 border-l-2 border-panel-border-input py-0.5 pl-[10px]">
      <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-panel-text-5">
        Text layers
      </div>
      <div className="space-y-1">
        {fields.map((field, index) => {
          const active = field.key === activeFieldKey;
          return (
            <div
              key={field.key}
              data-flat-text-layer-row="true"
              data-active={active}
              onClick={() => onSelect(field.key)}
              className={`flex min-h-[26px] cursor-pointer items-center gap-2 rounded px-1 ${
                active ? "bg-panel-accent/10" : "hover:bg-panel-hover"
              }`}
            >
              <span
                className="h-3 w-3 flex-shrink-0 rounded-sm"
                style={{ backgroundColor: getTextFieldColor(field, styles) }}
              />
              <span className="min-w-0 flex-1 truncate text-[11px] text-panel-text-1">
                {formatTextFieldPreview(field.value) || `Text ${index + 1}`}
              </span>
              <span className="flex-shrink-0 font-mono text-[9px] text-panel-text-4">
                {field.tagName}
              </span>
              {fields.length > 1 && (
                <button
                  type="button"
                  data-flat-text-layer-remove="true"
                  aria-label="Remove text field"
                  onClick={(e) => {
                    e.stopPropagation();
                    track("button", "Remove text field");
                    onRemove(field.key);
                  }}
                  className="flex-shrink-0 text-panel-text-4 hover:text-panel-text-1"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
