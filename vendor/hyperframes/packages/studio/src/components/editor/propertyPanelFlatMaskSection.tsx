import { buildMaskGeometry, inferMaskShape, parseNumericValue } from "./propertyPanelHelpers";
import { FlatSelectRow } from "./propertyPanelFlatPrimitives";
import { resolveValueTier } from "./propertyPanelValueTier";

export function FlatMaskSection({
  styles,
  disabled,
  onSetStyle,
}: {
  styles: Record<string, string>;
  disabled: boolean;
  onSetStyle: (prop: string, value: string) => void | Promise<void>;
}) {
  const radiusValue = parseNumericValue(styles["border-radius"]) ?? 0;
  const clipPathValue = styles["clip-path"] || "none";
  const inferredMaskShape = inferMaskShape(clipPathValue);
  const maskShape = inferredMaskShape === "circle" ? "circle" : "rectangle";
  const elementWidth = Math.max(1, parseNumericValue(styles.width) ?? 100);
  const elementHeight = Math.max(1, parseNumericValue(styles.height) ?? 100);
  const shapeOptions = [
    { value: "rectangle", label: "Mask rectangle" },
    { value: "circle", label: "Mask circle" },
  ];

  return (
    <FlatSelectRow
      label="Style"
      value={maskShape}
      options={shapeOptions}
      tier={resolveValueTier(clipPathValue === "none" ? undefined : maskShape, "rectangle")}
      disabled={disabled}
      onChange={(next) => {
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
    />
  );
}
