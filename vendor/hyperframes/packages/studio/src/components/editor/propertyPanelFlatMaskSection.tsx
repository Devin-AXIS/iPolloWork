import figmaMaskInvert from "../../icons/figmaMaskInvert.svg?url";
import {
  buildMaskGeometry,
  formatNumericValue,
  inferMaskShape,
  parseMaskGeometry,
  parseNumericValue,
} from "./propertyPanelHelpers";
import { FlatRow, FlatSelectRow } from "./propertyPanelFlatPrimitives";
import { resolveValueTier } from "./propertyPanelValueTier";
import { useStudioI18n } from "../../i18n";

export function FlatMaskSection({
  styles,
  disabled,
  onSetStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
}) {
  const { tx } = useStudioI18n();
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const clipPathValue = styles["clip-path"] || "none";
  const maskShape = inferMaskShape(clipPathValue);
  const elementWidth = Math.max(1, parseNumericValue(styles.width) ?? 100);
  const elementHeight = Math.max(1, parseNumericValue(styles.height) ?? 100);
  const geometry = parseMaskGeometry(clipPathValue, elementWidth, elementHeight);
  const shapeOptions = [
    { value: "none", label: "None" },
    { value: "rectangle", label: "Rectangle" },
    { value: "circle", label: "Circle" },
    ...(maskShape === "custom" ? [{ value: "custom", label: "Custom" }] : []),
  ];
  const shapeEditingDisabled = disabled || maskShape === "none" || maskShape === "custom";

  const updateGeometry = (key: keyof typeof geometry, nextValue: string) => {
    if (maskShape !== "rectangle" && maskShape !== "circle") return;
    const parsed = parseNumericValue(nextValue);
    if (parsed == null) return;
    void onSetStyle(
      "clip-path",
      buildMaskGeometry(
        maskShape,
        { ...geometry, [key]: parsed },
        elementWidth,
        elementHeight,
        radiusValue,
      ),
    );
  };

  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-3">
        <FlatSelectRow
          label="Style"
          value={maskShape}
          options={shapeOptions}
          tier={resolveValueTier(maskShape === "none" ? undefined : maskShape, "none")}
          disabled={disabled}
          onChange={(next) => {
            if (next === "custom") return;
            if (next === "none") {
              void onSetStyle("clip-path", "none");
              return;
            }
            if (next !== "rectangle" && next !== "circle") return;
            const maskSize = Math.min(elementWidth, elementHeight);
            const defaultGeometry =
              next === "circle"
                ? {
                    x: Math.max(0, (elementWidth - maskSize) / 2),
                    y: Math.max(0, (elementHeight - maskSize) / 2),
                    width: maskSize,
                    height: maskSize,
                  }
                : { x: 0, y: 0, width: elementWidth, height: elementHeight };
            void onSetStyle(
              "clip-path",
              buildMaskGeometry(next, defaultGeometry, elementWidth, elementHeight, radiusValue),
            );
          }}
          onReset={() => void onSetStyle("clip-path", "none")}
        />
        <button
          type="button"
          aria-label={tx("Invert mask")}
          title={tx("Mask inversion is not supported by the current clip-path renderer")}
          disabled
          className="flex h-[34px] items-center justify-center rounded-[6px] transition-colors hover:bg-[#f5f6f9] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <img
            src={figmaMaskInvert}
            alt=""
            aria-hidden="true"
            className="block size-4 object-contain"
          />
        </button>
      </div>
      <div className="hf-flat-responsive-grid grid grid-cols-2 gap-2">
        <FlatRow
          label="X"
          value={formatNumericValue(geometry.x)}
          tier="explicitCustom"
          disabled={shapeEditingDisabled}
          onCommit={(next) => updateGeometry("x", next)}
        />
        <FlatRow
          label="Y"
          value={formatNumericValue(geometry.y)}
          tier="explicitCustom"
          disabled={shapeEditingDisabled}
          onCommit={(next) => updateGeometry("y", next)}
        />
        <FlatRow
          label="Width"
          value={formatNumericValue(geometry.width)}
          tier="explicitCustom"
          disabled={shapeEditingDisabled}
          onCommit={(next) => updateGeometry("width", next)}
        />
        <FlatRow
          label="Height"
          value={formatNumericValue(geometry.height)}
          tier="explicitCustom"
          disabled={shapeEditingDisabled}
          onCommit={(next) => updateGeometry("height", next)}
        />
        <FlatRow label="Rotation" value="0°" tier="default" disabled onCommit={() => undefined} />
        <FlatRow label="Feather" value="0" tier="default" disabled onCommit={() => undefined} />
      </div>
    </div>
  );
}
