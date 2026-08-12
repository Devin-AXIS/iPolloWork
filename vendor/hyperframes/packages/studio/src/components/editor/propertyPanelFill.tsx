import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeftRight, ChevronDown, Eyedropper, Plus, X } from "../../icons/SystemIcons";
import {
  buildDefaultGradientModel,
  parseGradient,
  serializeGradient,
  type GradientModel,
} from "./gradientValue";
import { IMAGE_EXT } from "../../utils/mediaTypes";
import { colorFromCss, FIELD, LABEL } from "./propertyPanelHelpers";
import { DetailField } from "./propertyPanelPrimitives";
import { FlatDropdown } from "./propertyPanelFlatSelectRow";
import { useTrackDesignInput } from "../../contexts/DesignPanelInputContext";
import { useStudioI18n } from "../../i18n";
import { formatCssColor, hsvToRgb, parseCssColor, rgbToHsv, toHexColor } from "./colorValue";
import { resolveFloatingPanelPosition, type FloatingPosition } from "./floatingPanel";

declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

/* ------------------------------------------------------------------ */
/*  Asset path helpers                                                 */
/* ------------------------------------------------------------------ */

function normalizeProjectPath(value: string): string {
  const trimmed = value.trim();
  const maybeUrl = /^[a-z]+:\/\//i.test(trimmed) ? new URL(trimmed).pathname : trimmed;
  return decodeURIComponent(maybeUrl)
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "");
}

export function toRelativeProjectAssetPath(sourceFile: string, assetPath: string): string {
  const fromParts = normalizeProjectPath(sourceFile).split("/").filter(Boolean);
  const targetParts = normalizeProjectPath(assetPath).split("/").filter(Boolean);
  fromParts.pop();
  while (fromParts.length > 0 && targetParts.length > 0 && fromParts[0] === targetParts[0]) {
    fromParts.shift();
    targetParts.shift();
  }
  return [...fromParts.map(() => ".."), ...targetParts].join("/") || assetPath;
}

export function isThemeBackgroundSurface(element: HTMLElement): boolean {
  if (
    element.matches(
      "[data-composition-src][data-composition-id], [data-composition-file][data-composition-id], [data-ipw-slide], section.slide, .slide-frame, .scene.clip",
    )
  ) {
    return true;
  }
  return (
    element.parentElement === element.ownerDocument.body &&
    (element.id === "root" ||
      element.hasAttribute("data-composition-id") ||
      element.classList.contains("composition") ||
      element.classList.contains("stage") ||
      element.classList.contains("canvas"))
  );
}

export async function commitElementBackgroundImage(
  element: HTMLElement,
  nextValue: string,
  onSetStyle: (prop: string, value: string) => void | Promise<void>,
): Promise<void> {
  element.style.setProperty("background-image", nextValue);
  if (isThemeBackgroundSurface(element)) {
    // Theme surfaces use an !important layered background declaration. Feed
    // the image layer through its token so the fill remains visible and keeps
    // participating in theme switches.
    element.style.setProperty("--ipw-bg-image", nextValue);
    await onSetStyle("--ipw-bg-image", nextValue);
  }
  await onSetStyle("background-image", nextValue);
}

export function resolveEditableBackgroundImage(
  element: HTMLElement,
  styles: Record<string, string>,
): string {
  const authoredThemeImage = element.style.getPropertyValue("--ipw-bg-image").trim();
  if (authoredThemeImage) return authoredThemeImage;
  const authoredImage = element.style.getPropertyValue("background-image").trim();
  if (authoredImage) return authoredImage;
  const computedThemeImage = styles["--ipw-bg-image"]?.trim();
  if (computedThemeImage && computedThemeImage !== "none") return computedThemeImage;
  return styles["background-image"] ?? "none";
}

export function syncLegacyThemeBackgroundPreview(element: HTMLElement): boolean {
  if (!isThemeBackgroundSurface(element)) return false;
  if (element.style.getPropertyValue("--ipw-bg-image").trim()) return false;
  const authoredImage = element.style.getPropertyValue("background-image").trim();
  if (!authoredImage || authoredImage === "none") return false;
  element.style.setProperty("--ipw-bg-image", authoredImage);
  return true;
}

function resolveSelectedAsset(
  imageUrl: string,
  sourceFile: string,
  assets: string[],
): string | null {
  const normalizedUrl = normalizeProjectPath(imageUrl);
  if (!normalizedUrl) return null;
  for (const asset of assets) {
    const normalizedAsset = normalizeProjectPath(asset);
    const relativeAsset = toRelativeProjectAssetPath(sourceFile, asset);
    if (
      normalizedUrl === normalizedAsset ||
      normalizedUrl === relativeAsset ||
      normalizedUrl.endsWith(`/${normalizedAsset}`) ||
      normalizedUrl.endsWith(`/${relativeAsset}`)
    ) {
      return asset;
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  ImageFillField                                                     */
/* ------------------------------------------------------------------ */

export function ImageFillField({
  flat,
  projectId,
  sourceFile,
  value,
  assets,
  disabled,
  onCommit,
  onImportAssets,
}: {
  flat?: boolean;
  projectId: string;
  sourceFile: string;
  value: string;
  assets: string[];
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
  onImportAssets?: (files: FileList) => Promise<string[]>;
}) {
  const track = useTrackDesignInput();
  const { tx } = useStudioI18n();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const imageAssets = useMemo(() => assets.filter((a) => IMAGE_EXT.test(a)), [assets]);
  const selectedAsset = useMemo(
    () => resolveSelectedAsset(value, sourceFile, imageAssets),
    [imageAssets, sourceFile, value],
  );
  const externalUrlValue = selectedAsset ? "" : value;

  const handleUpload = async (files: FileList | null) => {
    if (!files?.length || !onImportAssets) return;
    setUploading(true);
    try {
      const uploaded = await onImportAssets(files);
      const nextImage = uploaded.find((a) => IMAGE_EXT.test(a));
      if (nextImage) {
        track("button", "Upload image");
        onCommit(`url("${toRelativeProjectAssetPath(sourceFile, nextImage)}")`);
      }
    } finally {
      setUploading(false);
    }
  };

  if (flat) {
    return (
      <div className="grid gap-3">
        <div className="flex h-[34px] items-center justify-between gap-3 rounded-[6px] bg-panel-input pl-2 pr-4">
          <span className="text-[13px] text-[#24262b] dark:text-panel-text-1">Image</span>
          <FlatDropdown
            ariaLabel="Image fill"
            value={selectedAsset ?? ""}
            disabled={disabled}
            options={[
              { value: "", label: "Choose media" },
              ...imageAssets.map((asset) => ({
                value: asset,
                label: asset.split("/").pop() ?? asset,
              })),
            ]}
            className="max-w-[190px] flex-1"
            valueClassName="text-[12px] text-[#858a94]"
            onChange={(next) => {
              track("select", "Image fill");
              onCommit(next ? `url("${toRelativeProjectAssetPath(sourceFile, next)}")` : "none");
            }}
          />
        </div>
        <div
          className="flex h-[100px] items-center justify-center overflow-hidden rounded-[8px] border border-[var(--hf-studio-divider)]"
          style={{
            backgroundColor: "white",
            backgroundImage: selectedAsset
              ? `url("/api/projects/${projectId}/preview/${selectedAsset}")`
              : "linear-gradient(45deg,#f1f1f1 25%,transparent 25%),linear-gradient(-45deg,#f1f1f1 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#f1f1f1 75%),linear-gradient(-45deg,transparent 75%,#f1f1f1 75%)",
            backgroundPosition: selectedAsset ? "center" : "0 0,0 8px,8px -8px,-8px 0",
            backgroundSize: selectedAsset ? "cover" : "16px 16px",
          }}
        >
          <button
            type="button"
            disabled={disabled || uploading || !onImportAssets}
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-[8px] border border-black/80 bg-white px-4 py-2 text-[11px] font-semibold text-black shadow-[0_3px_14px_rgba(0,0,0,0.38),0_0_0_1px_rgba(255,255,255,0.72)] transition-colors hover:bg-[#f5f6f9] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={14} aria-hidden="true" />
            {tx(uploading ? "Uploading…" : "Choose Media")}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label={tx("Choose image media")}
            className="hidden"
            onChange={async (event) => {
              await handleUpload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid min-w-0 gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <span className={LABEL}>{tx("Project asset")}</span>
          <button
            type="button"
            disabled={disabled || uploading}
            onClick={() => fileInputRef.current?.click()}
            className={`inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-neutral-700 bg-neutral-950 px-2.5 text-[11px] font-medium text-neutral-300 transition-colors ${
              disabled || uploading
                ? "cursor-not-allowed text-neutral-600"
                : "cursor-pointer hover:border-neutral-600 hover:text-white"
            }`}
          >
            <Plus size={12} className="flex-shrink-0" />
            <span className="truncate">{tx(uploading ? "Uploading…" : "Upload image")}</span>
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            aria-label={tx("Upload image asset")}
            disabled={disabled || uploading}
            className="hidden"
            onChange={async (event) => {
              await handleUpload(event.target.files);
              event.target.value = "";
            }}
          />
        </div>
        {imageAssets.length > 0 ? (
          <div className="space-y-3">
            {selectedAsset && (
              <div className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/80">
                <img
                  src={`/api/projects/${projectId}/preview/${selectedAsset}`}
                  alt={selectedAsset.split("/").pop() ?? selectedAsset}
                  className="h-28 w-full object-contain bg-neutral-950/80"
                />
              </div>
            )}
            <div className={FIELD}>
              <select
                value={selectedAsset ?? ""}
                disabled={disabled}
                onChange={(e) => {
                  const next = e.target.value;
                  track("select", "Project asset");
                  if (!next) {
                    onCommit("none");
                    return;
                  }
                  onCommit(`url("${toRelativeProjectAssetPath(sourceFile, next)}")`);
                }}
                className="min-w-0 w-full appearance-none bg-transparent text-[11px] font-medium text-neutral-100 outline-none disabled:cursor-not-allowed disabled:text-neutral-600"
              >
                <option value="">{tx("None")}</option>
                {imageAssets.map((asset) => (
                  <option key={asset} value={asset}>
                    {asset}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-neutral-800 bg-neutral-900/50 px-3 py-3 text-[11px] leading-5 text-neutral-500">
            {tx("No image assets yet. Upload one here and Studio will also add it to the Assets tab.")}
          </div>
        )}
      </div>

      <DetailField
        label="External URL"
        value={externalUrlValue}
        disabled={disabled}
        onCommit={(next) => onCommit(next.trim() ? `url("${next.trim()}")` : "none")}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  GradientField                                                      */
/* ------------------------------------------------------------------ */

export function GradientField({
  value,
  fallbackColor,
  disabled,
  onCommit,
}: {
  value: string;
  fallbackColor: string | undefined;
  disabled?: boolean;
  onCommit: (nextValue: string) => void;
}) {
  const track = useTrackDesignInput();
  const { tx } = useStudioI18n();
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const saturationRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedStop, setSelectedStop] = useState(0);
  const [colorMode, setColorMode] = useState<"hsb" | "rgb" | "hex">("hsb");
  const [panelPosition, setPanelPosition] = useState<FloatingPosition | null>(null);
  const parsed = parseGradient(value) ?? buildDefaultGradientModel(fallbackColor);
  const stopIndex = Math.min(selectedStop, parsed.stops.length - 1);
  const stop = parsed.stops[stopIndex];
  const color = colorFromCss(stop.color);
  const hsv = rgbToHsv(color);
  const hueColor = formatCssColor({
    ...hsvToRgb({ hue: hsv.hue, saturation: 1, value: 1 }),
    alpha: 1,
  });
  const preview = serializeGradient(parsed);

  const commit = (next: GradientModel) => onCommit(serializeGradient(next));
  const updateStop = (index: number, partial: Partial<GradientModel["stops"][number]>) => {
    const stops = parsed.stops.map((stop, i) => (i === index ? { ...stop, ...partial } : stop));
    commit({ ...parsed, stops });
  };
  const commitColor = (next: string) => {
    track("color", `Gradient stop ${stopIndex + 1}`);
    updateStop(stopIndex, { color: next });
  };
  const commitHsv = (next: { hue?: number; saturation?: number; value?: number }) => {
    const rgb = hsvToRgb({
      hue: next.hue ?? hsv.hue,
      saturation: next.saturation ?? hsv.saturation,
      value: next.value ?? hsv.value,
    });
    commitColor(formatCssColor({ ...rgb, alpha: color.alpha }));
  };
  const updateSaturation = (clientX: number, clientY: number) => {
    const rect = saturationRef.current?.getBoundingClientRect();
    if (!rect) return;
    commitHsv({
      saturation: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      value: Math.max(0, Math.min(1, 1 - (clientY - rect.top) / rect.height)),
    });
  };
  const updatePanelPosition = useCallback(() => {
    const anchor = triggerRef.current?.getBoundingClientRect();
    if (!anchor) return;
    setPanelPosition(
      resolveFloatingPanelPosition(
        anchor,
        { width: window.innerWidth, height: window.innerHeight },
        { width: 280, height: 426 },
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePanelPosition();
    window.addEventListener("resize", updatePanelPosition);
    window.addEventListener("scroll", updatePanelPosition, true);
    return () => {
      window.removeEventListener("resize", updatePanelPosition);
      window.removeEventListener("scroll", updatePanelPosition, true);
    };
  }, [open, updatePanelPosition]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  const recommendations = useMemo(() => {
    const base = colorFromCss(fallbackColor || stop.color);
    const baseHsv = rgbToHsv(base);
    const candidates = [
      "#000000",
      "#ffffff",
      ...parsed.stops.map((item) => toHexColor(colorFromCss(item.color))),
      toHexColor(hsvToRgb({ ...baseHsv, value: Math.min(1, baseHsv.value + 0.22) })),
      toHexColor(hsvToRgb({ ...baseHsv, value: Math.max(0.18, baseHsv.value - 0.22) })),
      toHexColor(hsvToRgb({ ...baseHsv, hue: (baseHsv.hue + 32) % 360 })),
      "#20BBC0",
      "#7C5CFC",
      "#F6C344",
    ];
    return [...new Set(candidates.map((item) => item.toUpperCase()))].slice(0, 6);
  }, [fallbackColor, parsed.stops, stop.color]);

  const fields =
    colorMode === "hsb"
      ? [
          {
            label: "H",
            value: Math.round(hsv.hue),
            max: 360,
            commit: (next: number) => commitHsv({ hue: next }),
          },
          {
            label: "S",
            value: Math.round(hsv.saturation * 100),
            max: 100,
            commit: (next: number) => commitHsv({ saturation: next / 100 }),
          },
          {
            label: "B",
            value: Math.round(hsv.value * 100),
            max: 100,
            commit: (next: number) => commitHsv({ value: next / 100 }),
          },
        ]
      : [
          {
            label: "R",
            value: Math.round(color.red),
            max: 255,
            commit: (next: number) => commitColor(formatCssColor({ ...color, red: next })),
          },
          {
            label: "G",
            value: Math.round(color.green),
            max: 255,
            commit: (next: number) => commitColor(formatCssColor({ ...color, green: next })),
          },
          {
            label: "B",
            value: Math.round(color.blue),
            max: 255,
            commit: (next: number) => commitColor(formatCssColor({ ...color, blue: next })),
          },
        ];

  const picker = open
    ? createPortal(
        <div
          ref={panelRef}
          className="fixed z-[9999] w-[280px] overflow-hidden rounded-[16px] border border-[#dedede] bg-white text-[#171717] shadow-[0_16px_40px_rgba(0,0,0,0.14),0_2px_8px_rgba(0,0,0,0.06)] dark:border-panel-hairline dark:bg-panel-bg dark:text-panel-text-1"
          style={{ left: panelPosition?.left ?? -9999, top: panelPosition?.top ?? -9999 }}
        >
          <div className="flex h-12 items-center justify-between border-b border-[#e5e5e5] px-4 dark:border-panel-hairline">
            <span className="text-[14px] font-semibold tracking-[-0.3px]">{tx("Gradient")}</span>
            <button
              type="button"
              aria-label={tx("Close gradient editor")}
              onClick={() => setOpen(false)}
              className="flex size-7 items-center justify-center rounded-[8px] hover:bg-[#f5f5f5] dark:hover:bg-panel-input"
            >
              <X size={16} />
            </button>
          </div>
          <div className="grid gap-[14px] p-[14px_16px_16px]">
            <div className="flex items-center justify-between pr-2">
              <div
                className="relative h-4 w-[182px] rounded-[7px]"
                style={{ backgroundImage: preview }}
              >
                {parsed.stops.map((item, index) => (
                  <button
                    key={`${item.color}-${index}`}
                    type="button"
                    aria-label={tx(`Select gradient stop ${index + 1}`)}
                    onClick={() => setSelectedStop(index)}
                    className={`absolute top-1/2 flex size-[26px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-[7px] border bg-white shadow-sm ${index === stopIndex ? "border-black" : "border-[#dedede]"}`}
                    style={{ left: `${item.position}%` }}
                  >
                    <span
                      className="size-[13px] rounded-[3px]"
                      style={{ backgroundColor: item.color }}
                    />
                  </button>
                ))}
              </div>
              <button
                type="button"
                aria-label={tx("Reverse gradient")}
                onClick={() => {
                  track("button", "Reverse gradient");
                  commit({
                    ...parsed,
                    stops: [...parsed.stops]
                      .reverse()
                      .map((item) => ({ ...item, position: 100 - item.position })),
                  });
                  setSelectedStop(parsed.stops.length - 1 - stopIndex);
                }}
              >
                <ArrowLeftRight size={16} />
              </button>
            </div>
            <div
              ref={saturationRef}
              role="slider"
              aria-label={tx("Saturation and brightness")}
              tabIndex={0}
              className="relative h-[165px] cursor-crosshair overflow-hidden rounded-[8px] border border-[#d9d9d9]"
              style={{ backgroundColor: hueColor }}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                updateSaturation(event.clientX, event.clientY);
              }}
              onPointerMove={(event) => {
                if (event.buttons === 1) updateSaturation(event.clientX, event.clientY);
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-white to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black to-transparent" />
              <span
                className="pointer-events-none absolute size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow"
                style={{
                  left: `${hsv.saturation * 100}%`,
                  top: `${(1 - hsv.value) * 100}%`,
                  backgroundColor: stop.color,
                }}
              />
            </div>
            <div className="grid grid-cols-[28px_minmax(0,1fr)] items-center gap-4">
              <button
                type="button"
                aria-label={tx("Pick color from screen")}
                disabled={!window.EyeDropper}
                onClick={async () => {
                  const Picker = window.EyeDropper;
                  if (!Picker) return;
                  const result = await new Picker().open();
                  commitColor(result.sRGBHex);
                }}
                className="flex size-7 items-center justify-center disabled:opacity-30"
              >
                <Eyedropper size={16} />
              </button>
              <div className="grid gap-[11px]">
                <input
                  type="range"
                  aria-label={tx("Hue")}
                  min={0}
                  max={360}
                  value={hsv.hue}
                  onChange={(event) => commitHsv({ hue: Number(event.target.value) })}
                  className="h-4 w-full appearance-none rounded-full"
                  style={{
                    background: "linear-gradient(90deg,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)",
                  }}
                />
                <input
                  type="range"
                  aria-label={tx("Opacity")}
                  min={0}
                  max={100}
                  value={Math.round(color.alpha * 100)}
                  onChange={(event) =>
                    commitColor(
                      formatCssColor({ ...color, alpha: Number(event.target.value) / 100 }),
                    )
                  }
                  className="h-4 w-full appearance-none rounded-full"
                  style={{
                    background: `linear-gradient(90deg,transparent,${formatCssColor({ ...color, alpha: 1 })})`,
                  }}
                />
              </div>
            </div>
            <div className="flex h-9 overflow-hidden rounded-[8px] border border-[#e5e5e5] bg-[#f5f5f5]">
              <FlatDropdown
                ariaLabel="Gradient color format"
                value={colorMode}
                options={[
                  { value: "hsb", label: "HSB" },
                  { value: "rgb", label: "RGB" },
                  { value: "hex", label: "HEX" },
                ]}
                className="h-full w-[64px] border-r border-white px-2 uppercase"
                valueClassName="text-[12px]"
                onChange={(next) => {
                  if (next === "hsb" || next === "rgb" || next === "hex") setColorMode(next);
                }}
              />
              {colorMode === "hex" ? (
                <input
                  aria-label={tx("Hex color")}
                  value={toHexColor(color).slice(1).toUpperCase()}
                  onChange={(event) => {
                    const next = parseCssColor(`#${event.target.value}`);
                    if (next) commitColor(formatCssColor({ ...next, alpha: color.alpha }));
                  }}
                  className="min-w-0 flex-1 bg-transparent px-2 text-center text-[12px] outline-none"
                />
              ) : (
                fields.map((field) => (
                  <input
                    key={field.label}
                    aria-label={tx(field.label)}
                    type="number"
                    min={0}
                    max={field.max}
                    value={field.value}
                    onChange={(event) =>
                      field.commit(Math.max(0, Math.min(field.max, Number(event.target.value))))
                    }
                    className="min-w-0 flex-1 border-r border-white bg-transparent text-center text-[12px] outline-none"
                  />
                ))
              )}
              <label className="flex w-12 items-center justify-center gap-0.5 text-[12px]">
                <input
                  aria-label={tx("Alpha percent")}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(color.alpha * 100)}
                  onChange={(event) =>
                    commitColor(
                      formatCssColor({
                        ...color,
                        alpha: Math.max(0, Math.min(100, Number(event.target.value))) / 100,
                      }),
                    )
                  }
                  className="w-7 bg-transparent text-center outline-none"
                />
                <span className="text-[#727272]">%</span>
              </label>
            </div>
            <div className="grid grid-cols-6 gap-2">
              {recommendations.map((item) => (
                <button
                  key={item}
                  type="button"
                  aria-label={tx(`Use recommended color ${item}`)}
                  onClick={() => commitColor(item)}
                  className="aspect-square rounded-[7px] border border-[#dedede]"
                  style={{ backgroundColor: item }}
                />
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-label={tx("Edit gradient")}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="flex h-[34px] w-full items-center justify-between rounded-[8px] bg-panel-input pl-2 pr-4"
      >
        <span className="flex items-center gap-2 text-[13px] text-[#24262b] dark:text-panel-text-1">
          <span className="size-5 rounded-[4px]" style={{ backgroundImage: preview }} />
          {tx("Gradient")}
        </span>
        <ChevronDown size={16} className="text-[#858a94]" />
      </button>
      {picker}
    </>
  );
}
