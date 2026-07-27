import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);
const inspectorUrl = new URL("../src/react-app/domains/session/design/design-properties-inspector.tsx", import.meta.url);

describe("Design preview height", () => {
  test("fills the panel for ordinary previews without changing the presentation canvas", async () => {
    const source = await Bun.file(panelUrl).text();

    expect(source).toContain('? "h-full w-full rounded-lg shadow-sm"');
    expect(source).toContain(': "h-full w-[390px] max-w-full shrink-0 rounded-[26px] shadow-xl shadow-black/15"');
    expect(source).toContain('? "absolute h-[900px] w-[1600px] origin-top-left rounded-lg shadow-sm"');
    expect(source).toContain('isPresentationTemplate ? "absolute inset-0 overflow-auto" : "contents"');
  });
});

describe("Design property number fields", () => {
  test("support horizontal pointer dragging for the visible width and height controls", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain("function DragNumberField(");
    expect(source).toContain("function DragNumberInput(");
    expect(source).toContain("onPointerDown={beginDrag}");
    expect(source).toContain('window.addEventListener("pointermove", move)');
    expect(source).toContain('className="min-w-0 flex-1 cursor-ew-resize');
    expect(source).toContain('<DragNumberField label="Width"');
    expect(source).toContain('<DragNumberField label="Height"');
  });

  test("keeps font size on the left and font weight on the right with preset menus", async () => {
    const source = await Bun.file(inspectorUrl).text();

    const sizeField = '<FontPresetField label="Size" value={String(fontSize)} presets={FONT_SIZE_PRESETS} onChange={(value) => applyPixels("fontSize", value)} />';
    const weightField = '<FontPresetField label="Weight" value={selection.styles.fontWeight || "400"} presets={FONT_WEIGHT_PRESETS} onChange={(value) => onApplyField("fontWeight", value)} />';

    expect(source.indexOf(sizeField)).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(weightField)).toBeGreaterThan(source.indexOf(sizeField));
    expect(source).toContain("const FONT_SIZE_PRESETS");
    expect(source).toContain("const FONT_WEIGHT_PRESETS");
    expect(source).toContain("<SelectContent align=\"end\">");
  });

  test("renders text controls before position while retaining x and y bindings", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const textSection = '<InspectorSection title="Text">';
    const positionSection = '<InspectorSection title="Position">';

    expect(source.indexOf(textSection)).toBeGreaterThanOrEqual(0);
    expect(source.indexOf(positionSection)).toBeGreaterThan(source.indexOf(textSection));
    expect(source).toContain('onApplyField("left", `${value}px`)');
    expect(source).toContain('onApplyField("top", `${value}px`)');
  });

  test("uses a lazy searchable font picker with self-rendered options", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain("function FontFamilyPicker(");
    expect(source).toContain("void loadFontFamilies()");
    expect(source).toContain("listSystemFontFamilies()");
    expect(source).toContain('style={{ fontFamily: family }}');
    expect(source).toContain("filterFontFamilyOptions(");
    expect(source).toContain('<FontFamilyPicker value={selection.styles.fontFamily || "PingFang SC"}');
  });

  test("retains fallback font choices when the desktop catalog command is unavailable", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain("catch {\n      setFamilies(FALLBACK_FONT_FAMILIES);");
  });

  test("toggles each mirror direction without dropping rotation or the other axis", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain('toggleTransformScale(selection.styles.transform, "x")');
    expect(source).toContain('toggleTransformScale(selection.styles.transform, "y")');
    expect(source).not.toContain('onApplyField("transform", "scaleX(-1)")');
    expect(source).not.toContain('onApplyField("transform", "scaleY(-1)")');
  });
});
