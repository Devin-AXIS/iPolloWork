import { describe, expect, test } from "bun:test";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);
const inspectorUrl = new URL("../src/react-app/domains/session/design/design-properties-inspector.tsx", import.meta.url);
const colorFieldUrl = new URL("../src/react-app/domains/session/design/design-color-field.tsx", import.meta.url);

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
    expect(source).toContain('active={aspectRatioLocked}');
    expect(source).toContain('applySize("width", value, remember)');
    expect(source).toContain('applySize("height", value, remember)');
  });

  test("keeps font size on the left and font weight on the right with preset menus", async () => {
    const source = await Bun.file(inspectorUrl).text();

    const sizeField = '<FontPresetField label="Size" value={String(fontSize)} presets={FONT_SIZE_PRESETS} onChange={(value, remember) => applyPixels("fontSize", value, remember)} />';
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
    expect(source).toContain('onApplyField("left", `${value}px`, remember)');
    expect(source).toContain('onApplyField("top", `${value}px`, remember)');
  });

  test("matches the Figma position alignment groups and uses spatial edge icons", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain('className="mt-1 flex gap-3"');
    expect(source).toContain('className="grid min-w-0 flex-1 grid-cols-3 gap-0.5"');
    expect(source).toContain('aria-label="Align left" onClick={() => onAlign("left")}><AlignStartVertical />');
    expect(source).toContain('aria-label="Align right" onClick={() => onAlign("right")}><AlignEndVertical />');
    expect(source).toContain('aria-label="Align top" onClick={() => onAlign("top")}><AlignVerticalJustifyStart />');
    expect(source).toContain('aria-label="Align bottom" onClick={() => onAlign("bottom")}><AlignVerticalJustifyEnd />');
    expect(source).toContain('className="h-[34px]"');
    expect(source).toContain('{!isMultiSelection ? <>');
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
    const source = (await Bun.file(inspectorUrl).text()).replace(/\r\n/g, "\n");

    expect(source).toContain("catch {\n      setFamilies(FALLBACK_FONT_FAMILIES);");
  });

  test("toggles each mirror direction without dropping rotation or the other axis", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain('toggleTransformScale(selection.styles.transform, "x")');
    expect(source).toContain('toggleTransformScale(selection.styles.transform, "y")');
    expect(source).not.toContain('onApplyField("transform", "scaleX(-1)")');
    expect(source).not.toContain('onApplyField("transform", "scaleY(-1)")');
  });

  test("supports batch inspector metadata and mixed fields", async () => {
    const source = await Bun.file(inspectorUrl).text();
    expect(source).toContain("isMultiSelection: boolean");
    expect(source).toContain("selectionCount: number");
    expect(source).toContain("mixedStyleFields: readonly DesignStyleField[]");
    expect(source).toContain("const isMixed = (field: DesignStyleField)");
    expect(source).toContain("Batch selection");
    expect(source).toContain("MixedValueHint");
    expect(source).toContain("{!isMultiSelection && selection.canEditText ?");
  });

  test("renders independent batch text and background fill controls", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const colorFieldSource = await Bun.file(colorFieldUrl).text();

    expect(source).toContain('<ColorField label="Text color" mixed={isMixed("color")} value={selection.styles.color || "#000000"} onChange={(value, remember) => onApplyField("color", value, remember)} />');
    expect(source).toContain('<ColorField label="Background color" mixed={isMixed("backgroundColor")} value={selection.styles.backgroundColor || "#000000"} onChange={(value, remember) => onApplyField("backgroundColor", value, remember)} />');
    expect(colorFieldSource).toContain('aria-label={`Design ${label.toLowerCase()} value`}');
    expect(colorFieldSource).toContain("Choose {label.toLowerCase()}");
  });

  test("applies mixed batch typography buttons instead of toggling from the primary style", async () => {
    const source = await Bun.file(inspectorUrl).text();

    expect(source).toContain('"grid h-9 w-full min-w-0 place-items-center');
    expect(source).toContain('isMixed("fontWeight") ? "700" : numericValue(selection.styles.fontWeight, 400) >= 600 ? "400" : "700"');
    expect(source).toContain('isMixed("fontStyle") ? "italic" : selection.styles.fontStyle === "italic" ? "normal" : "italic"');
    expect(source).toContain('isMixed("textDecoration") ? ensureDecoration(selection.styles.textDecoration, "underline") : toggleDecoration(selection.styles.textDecoration, "underline")');
    expect(source).toContain('isMixed("textDecoration") ? ensureDecoration(selection.styles.textDecoration, "line-through") : toggleDecoration(selection.styles.textDecoration, "line-through")');
  });

  test("remembers only the first actual move of every drag number interaction", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const panelSource = await Bun.file(panelUrl).text();

    expect(source).toContain("const remember = !activeDrag.moved;");
    expect(source).toContain("onChange(nextValue, remember);");
    expect(source).toContain("onChange={(event) => onChange(numericValue(event.currentTarget.value, numericValue(value, 0)), false)}");
    expect(source).toContain('onChange={(value, remember) => applyPixels("lineHeight", String(value), remember)}');
    expect(source).toContain('onChange={(value, remember) => onApplyField("letterSpacing", `${value}%`, remember)}');
    expect(source).toContain('onChange={(value, remember) => onApplyField("left", `${value}px`, remember)}');
    expect(source).toContain('onChange={(value, remember) => onApplyField("top", `${value}px`, remember)}');
    expect(source).toContain('onChange={(value, remember) => onApplyField("transform", `rotate(${value}deg)`, remember)}');
    expect(source).toContain('onChange={(value, remember) => applySize("width", value, remember)}');
    expect(source).toContain('onChange={(value, remember) => applySize("height", value, remember)}');
    expect(source).toContain('onChange={(value, remember) => applyPixels("fontSize", value, remember)}');
    expect(panelSource).toContain("const applyField = (field: DesignField, value: string, remember = true) =>");
  });

  test("groups typed property changes into one undo interaction", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const colorFieldSource = await Bun.file(colorFieldUrl).text();

    expect(source).toContain('onFocus={() => onApplyField("text", selection.text, true)}');
    expect(source).toContain('onChange={(event) => onApplyField("text", event.currentTarget.value, false)}');
    expect(source).toContain("onFocus={() => onChange(value, true)}");
    expect(source).toContain("onChange={(event) => onChange(event.currentTarget.value, false)}");
    expect(source).toContain("onChange={(value, remember) => onApplyField(\"borderStyle\", value.toLowerCase(), remember)}");
    expect(source).toContain('<DesignColorField label={label} mixed={mixed} value={value} onChange={onChange}');
    expect(colorFieldSource).toContain("onFocus={() => onChange(hex, true)}");
    expect(colorFieldSource).toContain("onPointerDown={() => onChange(hex, true)}");
    expect(source).toContain("onChange={(next, remember) => onChange(clampPercentage(numericValue(next, value)), remember ?? true)}");
  });

  test("passes selection summary metadata to the inspector", async () => {
    const source = await Bun.file(panelUrl).text();
    expect(source).toContain("isMultiSelection={isMultiSelection}");
    expect(source).toContain("selectionCount={selectionSummary?.selectionCount ?? 0}");
    expect(source).toContain("mixedStyleFields={selectionSummary?.mixedStyleFields ?? []}");
    expect(source).toContain("onAlign={alignSelection}");
    expect(source).toContain("type: \"align\"");
    expect(source).toContain("rememberHistory();");
  });

  test("connects layer link, lock, and delete actions with shared icon states", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const panelSource = await Bun.file(panelUrl).text();

    expect(source).toContain('label={selection.href ? "Edit link" : "Add link"}');
    expect(source).toContain('onChange={(event) => setLinkDraft(event.currentTarget.value)}');
    expect(source).toContain('onApplyField("href", href, true)');
    expect(source).toContain('setLinkOpen(Boolean(selection.href))');
    expect(source).toContain('type="submit" size="sm"');
    expect(source).toContain('>保存</Button>');
    expect(source).toContain('label={selection.locked ? "Unlock layer" : "Lock layer"}');
    expect(source).toContain('label="Delete layer"');
    expect(source).toContain("hover:bg-muted hover:text-foreground active:bg-foreground active:text-background");
    expect(source).toContain('active && "bg-foreground text-background hover:bg-foreground hover:text-background"');
    expect(panelSource).toContain("const toggleSelectionLock = () => {");
    expect(panelSource).toContain('type: "lock"');
    expect(panelSource).toContain('onDelete={() => setDeleteConfirmationOpen(true)}');
  });

  test("shows the selected element HTML at the bottom of the Element inspector", async () => {
    const source = await Bun.file(inspectorUrl).text();
    const htmlSection = '<InspectorSection title="HTML" last>';

    expect(source).toContain(htmlSection);
    expect(source).toContain('value={selection.html}');
    expect(source).toContain('aria-label="Selected element HTML code"');
    expect(source).toContain('h-[220px]');
    expect(source.indexOf(htmlSection)).toBeGreaterThan(source.indexOf('<InspectorSection title="Appearance">'));
  });
});
