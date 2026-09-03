// fallow-ignore-file code-duplication
import { useEffect, useState } from "react";
import { useStudioI18n } from "../../i18n";
import figmaFillGradient from "../../icons/figmaFillGradient.svg?url";
import figmaFillGradientActive from "../../icons/figmaFillGradientActive.svg?url";
import figmaFillImage from "../../icons/figmaFillImage.svg?url";
import figmaFillImageActive from "../../icons/figmaFillImageActive.svg?url";
import figmaFillNone from "../../icons/figmaFillNone.svg?url";
import figmaFillNoneActive from "../../icons/figmaFillNoneActive.svg?url";
import figmaFillSolid from "../../icons/figmaFillSolid.svg?url";
import figmaFillSolidActive from "../../icons/figmaFillSolidActive.svg?url";
import type { DomEditSelection } from "./domEditing";
import { buildDefaultGradientModel, serializeGradient } from "./gradientValue";
import { STROKE_STYLE_OPTIONS } from "./propertyPanelFlatStyleHelpers";
import {
  buildBoxShadowPresetValue,
  buildStrokeStyleUpdates,
  buildStrokeWidthStyleUpdates,
  extractBackgroundImageUrl,
  formatNumericValue,
  formatPxMetricValue,
  getCssFilterFunctionPx,
  inferBoxShadowPreset,
  normalizePanelPxValue,
  parseNumericValue,
  parsePxMetricValue,
  setCssFilterFunctionPx,
  type BoxShadowPreset,
} from "./propertyPanelHelpers";
import { FlatRow, FlatSelectRow, FlatSlider } from "./propertyPanelFlatPrimitives";
import { FlatMaskSection } from "./propertyPanelFlatMaskSection";
import { resolveValueTier } from "./propertyPanelValueTier";
import { ColorField } from "./propertyPanelColor";
import {
  commitElementBackgroundImage,
  GradientField,
  ImageFillField,
  resolveEditableBackgroundImage,
  syncLegacyThemeBackgroundPreview,
} from "./propertyPanelFill";

/* ------------------------------------------------------------------ */
/*  Flat Fill sub-block (design_handoff_studio_inspector, #11a)        */
/* ------------------------------------------------------------------ */

type FillMode = "None" | "Solid" | "Gradient" | "Image";

const FILL_MODE_OPTIONS: ReadonlyArray<{
  key: FillMode;
  label: string;
  icon: string;
  activeIcon: string;
}> = [
  {
    key: "None",
    label: "No fill",
    icon: figmaFillNone,
    activeIcon: figmaFillNoneActive,
  },
  {
    key: "Solid",
    label: "Solid color",
    icon: figmaFillSolid,
    activeIcon: figmaFillSolidActive,
  },
  {
    key: "Gradient",
    label: "Gradient",
    icon: figmaFillGradient,
    activeIcon: figmaFillGradientActive,
  },
  {
    key: "Image",
    label: "Image",
    icon: figmaFillImage,
    activeIcon: figmaFillImageActive,
  },
];

export function FillModeSelector({
  value,
  disabled,
  onChange,
}: {
  value: FillMode;
  disabled: boolean;
  onChange: (value: FillMode) => void;
}) {
  const { tx } = useStudioI18n();
  return (
    <div className="grid grid-cols-4 gap-1" role="group" aria-label={tx("Fill type")}>
      {FILL_MODE_OPTIONS.map(({ key, label, icon, activeIcon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            aria-label={tx(label)}
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={`flex h-[34px] items-center justify-center rounded-[6px] transition-colors duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1FBAC0]/50 disabled:cursor-not-allowed disabled:opacity-40 ${
              active
                ? "bg-black hover:bg-[#1f1f1f] active:bg-[#333333]"
                : "bg-[#f5f6f9] hover:bg-[#eceef2] active:bg-[#e2e5ea] dark:bg-panel-input dark:hover:bg-panel-input/80 dark:active:bg-panel-input/60"
            }`}
          >
            <img
              src={active ? activeIcon : icon}
              alt=""
              aria-hidden="true"
              className="block size-4 object-contain"
            />
          </button>
        );
      })}
    </div>
  );
}

// fallow-ignore-next-line complexity
export function FlatFillSection({
  projectId,
  element,
  styles,
  assets,
  onSetStyle,
  onImportAssets,
}: {
  projectId: string;
  element: DomEditSelection;
  styles: Record<string, string>;
  assets: string[];
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onImportAssets?: (files: FileList) => Promise<string[]>;
}) {
  const styleEditingDisabled = !element.capabilities.canEditStyles;
  const backgroundImage = resolveEditableBackgroundImage(element.element, styles);
  const fillMode: FillMode =
    backgroundImage && backgroundImage !== "none"
      ? backgroundImage.includes("gradient")
        ? "Gradient"
        : "Image"
      : styles["background-color"] === "transparent" ||
          styles["background-color"] === "rgba(0, 0, 0, 0)"
        ? "None"
        : "Solid";
  const [preferredFillMode, setPreferredFillMode] = useState(fillMode);
  const imageUrl = extractBackgroundImageUrl(backgroundImage);

  useEffect(() => {
    setPreferredFillMode(fillMode);
  }, [fillMode, element.id, element.selector, backgroundImage]);

  useEffect(() => {
    // Keep image fills authored by older Studio versions visible immediately;
    // also migrate the token once so subsequent preview reloads retain it.
    if (syncLegacyThemeBackgroundPreview(element.element)) {
      void Promise.resolve(onSetStyle("--ipw-bg-image", backgroundImage)).catch(() => undefined);
    }
  }, [element.element, backgroundImage, onSetStyle]);

  const commitBackgroundImage = (nextValue: string) =>
    commitElementBackgroundImage(element.element, nextValue, onSetStyle);

  const handleFillModeChange = async (nextMode: FillMode) => {
    setPreferredFillMode(nextMode);
    if (nextMode === "None") {
      await commitBackgroundImage("none");
      await onSetStyle("background-color", "transparent");
      return;
    }
    if (nextMode === "Solid") {
      await commitBackgroundImage("none");
      if (
        styles["background-color"] === "transparent" ||
        styles["background-color"] === "rgba(0, 0, 0, 0)"
      ) {
        await onSetStyle("background-color", "rgb(0, 0, 0)");
      }
      return;
    }
    if (nextMode === "Gradient" && !backgroundImage.includes("gradient")) {
      void commitBackgroundImage(
        serializeGradient(buildDefaultGradientModel(styles["background-color"])),
      );
    }
  };

  return (
    <div className="grid gap-2">
      <FillModeSelector
        value={preferredFillMode}
        disabled={styleEditingDisabled}
        onChange={(nextMode) => void handleFillModeChange(nextMode)}
      />
      {preferredFillMode !== "None" &&
        (preferredFillMode === "Solid" ? (
          <ColorField
            flat
            label="Color"
            value={styles["background-color"] ?? "transparent"}
            disabled={styleEditingDisabled}
            onCommit={(next) => onSetStyle("background-color", next)}
          />
        ) : preferredFillMode === "Gradient" ? (
          <GradientField
            value={
              backgroundImage !== "none"
                ? backgroundImage
                : serializeGradient(buildDefaultGradientModel(styles["background-color"]))
            }
            fallbackColor={styles["background-color"]}
            disabled={styleEditingDisabled}
            onCommit={(next) => void commitBackgroundImage(next)}
          />
        ) : (
          <ImageFillField
            flat
            projectId={projectId}
            sourceFile={element.sourceFile}
            value={imageUrl}
            assets={assets}
            disabled={styleEditingDisabled}
            onCommit={(next) => void commitBackgroundImage(next)}
            onImportAssets={onImportAssets}
          />
        ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Flat Stroke row — width (numeric), style (select), color           */
/* ------------------------------------------------------------------ */

export function FlatStrokeSection({
  styles,
  disabled,
  onSetStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
}) {
  const borderWidthValue =
    parsePxMetricValue(styles["border-width"] ?? "") ??
    parsePxMetricValue(styles["border-top-width"] ?? "") ??
    0;
  const borderStyleValue = styles["border-style"] || styles["border-top-style"] || "none";
  const borderColorValue =
    styles["border-color"] || styles["border-top-color"] || "rgba(255, 255, 255, 0.18)";
  const widthDisplay = formatPxMetricValue(borderWidthValue);

  return (
    <div className="hf-flat-responsive-grid grid grid-cols-2 gap-x-3 gap-y-2">
      <FlatSelectRow
        label="Stroke style"
        ariaLabel="Stroke style"
        value={borderStyleValue}
        // Valid border-style keywords — the ONLY way to set this, since a
        // free-text field here would require typing an exact CSS keyword
        // (e.g. "dashed") with no indication of which ones are valid.
        options={STROKE_STYLE_OPTIONS}
        tier={resolveValueTier(styles["border-style"], "none")}
        disabled={disabled}
        large
        valueOnly
        onChange={async (next) => {
          for (const [property, value] of buildStrokeStyleUpdates(
            next,
            formatPxMetricValue(borderWidthValue),
          )) {
            await onSetStyle(property, value);
          }
        }}
      />
      <FlatRow
        label="Width"
        value={widthDisplay}
        tier={resolveValueTier(styles["border-width"], "0px")}
        disabled={disabled}
        large
        onCommit={async (next) => {
          const normalizedWidth = normalizePanelPxValue(next, {
            min: 0,
            max: 200,
            fallback: borderWidthValue,
          });
          if (!normalizedWidth) return;
          for (const [property, value] of buildStrokeWidthStyleUpdates(
            normalizedWidth,
            borderStyleValue,
          )) {
            await onSetStyle(property, value);
          }
        }}
      />
      <div className="col-span-2">
        <ColorField
          flat
          large
          label="Stroke color"
          value={borderColorValue}
          disabled={disabled}
          onCommit={(next) => onSetStyle("border-color", next)}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Flat Radius row — always delegates to BorderRadiusEditor            */
/* ------------------------------------------------------------------ */

// fallow-ignore-next-line complexity
function FlatRadiusRow({
  styles,
  gsapBorderRadius,
  disabled,
  onSetStyle,
  onPreviewStyle,
}: {
  styles: Record<string, string>;
  gsapBorderRadius?: { tl: number; tr: number; br: number; bl: number } | null;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onPreviewStyle?: (prop: string, value: string) => void;
}) {
  const radiusValue = gsapBorderRadius?.tl ?? parseNumericValue(styles["border-radius"]) ?? 0;

  return (
    <FlatRow
      label="Radius"
      value={formatNumericValue(radiusValue)}
      tier={resolveValueTier(styles["border-radius"], "0px")}
      disabled={disabled}
      liveCommit={!onPreviewStyle}
      large
      onPreview={(next) => {
        const parsed = parseNumericValue(next);
        if (parsed === null) return;
        onPreviewStyle?.("border-radius", `${formatNumericValue(Math.max(0, parsed))}px`);
      }}
      onCommit={(next) => {
        const parsed = parseNumericValue(next);
        if (parsed === null) return;
        void onSetStyle("border-radius", `${formatNumericValue(Math.max(0, parsed))}px`);
      }}
    />
  );
}

/* ------------------------------------------------------------------ */
/*  Flat Shadow + Blend rows                                           */
/* ------------------------------------------------------------------ */

function FlatShadowBlendRows({
  styles,
  disabled,
  onSetStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
}) {
  const boxShadowPreset = inferBoxShadowPreset(styles["box-shadow"]);
  const blendValue = styles["mix-blend-mode"] || "normal";

  return (
    <div className="grid gap-2">
      <FlatSelectRow
        label="Shadow"
        value={boxShadowPreset}
        options={["none", "soft", "lift", "glow", "custom"]}
        tier={resolveValueTier(boxShadowPreset === "none" ? undefined : boxShadowPreset, "none")}
        disabled={disabled}
        onChange={(next) => {
          if (next === "custom") return;
          void onSetStyle(
            "box-shadow",
            buildBoxShadowPresetValue(next as BoxShadowPreset, styles["box-shadow"]),
          );
        }}
        onReset={() => void onSetStyle("box-shadow", "none")}
      />
      <FlatSelectRow
        label="Blend"
        value={blendValue}
        options={["normal", "multiply", "screen", "overlay", "darken", "lighten"]}
        tier={resolveValueTier(styles["mix-blend-mode"], "normal")}
        disabled={disabled}
        onChange={(next) => void onSetStyle("mix-blend-mode", next)}
        onReset={() => void onSetStyle("mix-blend-mode", "normal")}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Flat Layer blur + Backdrop sliders                                 */
/* ------------------------------------------------------------------ */

function FlatBlurSliders({
  styles,
  disabled,
  onSetStyle,
  onPreviewStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onPreviewStyle?: (prop: string, value: string) => void;
}) {
  const filterBlurValue = getCssFilterFunctionPx(styles.filter, "blur");
  const backdropBlurValue = getCssFilterFunctionPx(styles["backdrop-filter"], "blur");

  return (
    <div className="grid gap-2">
      <FlatSlider
        label="Layer blur"
        value={filterBlurValue}
        min={0}
        max={Math.max(40, Math.ceil(filterBlurValue))}
        tier={filterBlurValue > 0 ? "explicitCustom" : "default"}
        displayValue={`${formatNumericValue(filterBlurValue)}px`}
        disabled={disabled}
        commitMode={onPreviewStyle ? "release" : "live"}
        onPreview={(next) =>
          onPreviewStyle?.("filter", setCssFilterFunctionPx(styles.filter, "blur", next))
        }
        onPreviewCancel={() => onPreviewStyle?.("filter", styles.filter ?? "none")}
        onCommit={(next) =>
          void onSetStyle("filter", setCssFilterFunctionPx(styles.filter, "blur", next))
        }
      />
      <FlatSlider
        label="Backdrop"
        value={backdropBlurValue}
        min={0}
        max={Math.max(60, Math.ceil(backdropBlurValue))}
        tier={backdropBlurValue > 0 ? "explicitCustom" : "default"}
        displayValue={`${formatNumericValue(backdropBlurValue)}px`}
        disabled={disabled}
        commitMode={onPreviewStyle ? "release" : "live"}
        onPreview={(next) =>
          onPreviewStyle?.(
            "backdrop-filter",
            setCssFilterFunctionPx(styles["backdrop-filter"], "blur", next),
          )
        }
        onPreviewCancel={() =>
          onPreviewStyle?.("backdrop-filter", styles["backdrop-filter"] ?? "none")
        }
        onCommit={(next) =>
          void onSetStyle(
            "backdrop-filter",
            setCssFilterFunctionPx(styles["backdrop-filter"], "blur", next),
          )
        }
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Flat Opacity slider                                                */
/* ------------------------------------------------------------------ */

function FlatOpacitySlider({
  styles,
  disabled,
  onSetStyle,
  onPreviewStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onPreviewStyle?: (prop: string, value: string) => void;
}) {
  const opacityValue = Math.round((parseNumericValue(styles.opacity) ?? 1) * 100);

  return (
    <FlatSlider
      label="Opacity"
      value={opacityValue}
      min={0}
      max={100}
      tier="explicitCustom"
      displayValue={`${opacityValue}%`}
      disabled={disabled}
      commitMode={onPreviewStyle ? "release" : "live"}
      onPreview={(next) => onPreviewStyle?.("opacity", formatNumericValue(next / 100))}
      onPreviewCancel={() => onPreviewStyle?.("opacity", styles.opacity ?? "1")}
      onCommit={(next) => void onSetStyle("opacity", formatNumericValue(next / 100))}
    />
  );
}

function FlatAppearanceOpacityRow({
  styles,
  disabled,
  onSetStyle,
  onPreviewStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onPreviewStyle?: (prop: string, value: string) => void;
}) {
  const opacityValue = Math.round((parseNumericValue(styles.opacity) ?? 1) * 100);
  return (
    <FlatRow
      label="Opacity"
      value={String(opacityValue)}
      tier="explicitDefault"
      disabled={disabled}
      liveCommit={!onPreviewStyle}
      large
      onPreview={(next) => {
        const parsed = parseNumericValue(next);
        if (parsed === null) return;
        const normalized = Math.max(0, Math.min(100, parsed));
        onPreviewStyle?.("opacity", formatNumericValue(normalized / 100));
      }}
      suffix={<span className="text-[10px] font-normal text-[#858a94]">%</span>}
      onCommit={(next) => {
        const parsed = parseNumericValue(next);
        if (parsed === null) return;
        const normalized = Math.max(0, Math.min(100, parsed));
        void onSetStyle("opacity", formatNumericValue(normalized / 100));
      }}
    />
  );
}

export function FlatStyleSection({
  projectId,
  element,
  styles,
  assets,
  onSetStyle,
  onImportAssets,
  gsapBorderRadius,
  onPreviewStyle,
}: {
  projectId: string;
  element: DomEditSelection;
  styles: Record<string, string>;
  assets: string[];
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onImportAssets?: (files: FileList) => Promise<string[]>;
  gsapBorderRadius?: { tl: number; tr: number; br: number; bl: number } | null;
  onPreviewStyle?: (prop: string, value: string) => void;
}) {
  const styleEditingDisabled = !element.capabilities.canEditStyles;
  return (
    <div className="space-y-1.5">
      <FlatFillSection
        projectId={projectId}
        element={element}
        styles={styles}
        assets={assets}
        onSetStyle={onSetStyle}
        onImportAssets={onImportAssets}
      />
      <FlatStrokeSection styles={styles} disabled={styleEditingDisabled} onSetStyle={onSetStyle} />
      <FlatRadiusRow
        styles={styles}
        gsapBorderRadius={gsapBorderRadius}
        disabled={styleEditingDisabled}
        onSetStyle={onSetStyle}
        onPreviewStyle={onPreviewStyle}
      />
      <FlatShadowBlendRows
        styles={styles}
        disabled={styleEditingDisabled}
        onSetStyle={onSetStyle}
      />
      <FlatBlurSliders
        styles={styles}
        disabled={styleEditingDisabled}
        onSetStyle={onSetStyle}
        onPreviewStyle={onPreviewStyle}
      />
      <FlatMaskSection styles={styles} disabled={styleEditingDisabled} onSetStyle={onSetStyle} />
      <FlatOpacitySlider
        styles={styles}
        disabled={styleEditingDisabled}
        onSetStyle={onSetStyle}
        onPreviewStyle={onPreviewStyle}
      />
    </div>
  );
}

export function FlatAppearanceSection({
  styles,
  gsapBorderRadius,
  disabled,
  onSetStyle,
  onPreviewStyle,
}: {
  styles: Record<string, string>;
  gsapBorderRadius?: { tl: number; tr: number; br: number; bl: number } | null;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
  onPreviewStyle?: (prop: string, value: string) => void;
}) {
  return (
    <div className="hf-flat-responsive-grid grid grid-cols-2 gap-x-3 gap-y-2">
      <FlatRadiusRow
        styles={styles}
        gsapBorderRadius={gsapBorderRadius}
        disabled={disabled}
        onSetStyle={onSetStyle}
        onPreviewStyle={onPreviewStyle}
      />
      <FlatAppearanceOpacityRow
        styles={styles}
        disabled={disabled}
        onSetStyle={onSetStyle}
        onPreviewStyle={onPreviewStyle}
      />
    </div>
  );
}
