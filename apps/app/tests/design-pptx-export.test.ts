import { describe, expect, test } from "bun:test";

import {
  PPTX_EXPORT_CONFIRMATION,
  PPTX_CAPTURE_SCALE,
  createPptxShapeOverlay,
  createPptxTextOverlay,
  createPptxVisualShadow,
  isPptxShapeStyleCompatible,
  deckPptxFileName,
  isPptxTextStyleCompatible,
} from "../src/react-app/domains/session/design/pptx-export";
import {
  activateDeckExportSlide,
  deckExportContainer,
  PRESENTATION_SLIDE_SELECTOR,
} from "../src/react-app/domains/session/design/deck-export";

const panelUrl = new URL("../src/react-app/domains/session/design/design-panel.tsx", import.meta.url);

describe("PPTX deck export", () => {
  test("uses a PowerPoint filename and editable-first confirmation copy", () => {
    expect(deckPptxFileName("Q2 launch")).toBe("Q2 launch.pptx");
    expect(deckPptxFileName("Q2 launch.pdf")).toBe("Q2 launch.pptx");
    expect(PPTX_EXPORT_CONFIRMATION.title).toBe("可编辑优先导出 PPTX");
    expect(PPTX_EXPORT_CONFIRMATION.message).toContain("局部图片");
  });

  test("maps slide-relative browser text geometry to editable PPTX text", () => {
    expect(createPptxTextOverlay({
      text: "Launch faster",
      slide: { left: 0, top: 0, width: 1600, height: 900 },
      box: { left: 160, top: 90, width: 800, height: 90 },
      style: {
        color: "rgba(17, 24, 39, 0.75)",
        fontFamily: "Inter, sans-serif",
        fontSize: "48px",
        fontWeight: "700",
        fontStyle: "normal",
        textAlign: "center",
        lineHeight: "",
        letterSpacing: "",
        opacity: 1,
      },
    })).toEqual({
      text: "Launch faster",
      x: 1.333,
      y: 0.75,
      w: 6.667,
      h: 0.75,
      fontSize: 36,
      fontFace: "Inter",
      color: "111827",
      transparency: 25,
      bold: true,
      italic: false,
      align: "center",
    });
  });

  test("uses installed CJK fonts and exact spacing for Chinese editable text", () => {
    expect(createPptxTextOverlay({
      text: "学术出版物\n视觉系统设计",
      slide: { left: 0, top: 0, width: 1600, height: 900 },
      box: { left: 160, top: 90, width: 800, height: 180 },
      style: {
        color: "#064E3B",
        fontFamily: '"Playfair Display", "Noto Serif SC", serif',
        fontSize: "112px",
        fontWeight: "500",
        fontStyle: "normal",
        textAlign: "left",
        lineHeight: "106px",
        letterSpacing: "1.5px",
        opacity: 1,
      },
    })).toMatchObject({
      fontFace: "Noto Serif SC",
      fontSize: 84,
      lineSpacing: 79.5,
      charSpacing: 1.125,
      lang: "zh-CN",
    });
  });

  test("captures only local visual fallbacks at high resolution", () => {
    expect(PPTX_CAPTURE_SCALE).toBe(2);
  });

  test("exports an element plan instead of rasterizing every full slide", async () => {
    const source = await Bun.file(panelUrl).text();
    const pptxExport = source.slice(source.indexOf("const exportDeckToPptx"), source.indexOf("const saveMutation"));

    expect(pptxExport).toContain("collectPptxElementPlans(slide)");
    expect(pptxExport).toContain("capturePptxElement(plan.element");
    expect(pptxExport).not.toContain("html2canvas(slide");
  });

  test("stops a legacy deck export instead of creating a background-only slide", async () => {
    const source = await Bun.file(panelUrl).text();
    const pptxExport = source.slice(source.indexOf("const exportDeckToPptx"), source.indexOf("const saveMutation"));

    expect(pptxExport).toContain("validatePptxElementPlanCoverage");
    expect(pptxExport).toContain("No blank presentation was created.");
  });

  test("stops a native-editable deck export instead of writing blank slides", async () => {
    const source = await Bun.file(panelUrl).text();
    const pptxExport = source.slice(source.indexOf("const exportDeckToPptx"), source.indexOf("const saveMutation"));

    expect(pptxExport).toContain("const objectCoverage = validatePptxElementPlanCoverage");
    expect(pptxExport).toContain("planCount: objects.length");
  });

  test("keeps native-editable exports separate from PDF color conversion", async () => {
    const source = await Bun.file(panelUrl).text();
    const pptxExport = source.slice(source.indexOf("const exportDeckToPptx"), source.indexOf("const saveMutation"));

    expect(pptxExport).toContain("const previewContent = usesNativeEditablePptx ? content : downgradeUnsupportedPdfExportColorText(content)");
    expect(pptxExport).toContain("if (!usesNativeEditablePptx) downgradeUnsupportedPdfExportColors(frameDocument)");
  });

  test("maps CSS shadows into native PowerPoint shadow effects", () => {
    expect(createPptxVisualShadow("rgba(0, 0, 0, 0.18) 0px 4px 48px 0px")).toEqual({
      type: "outer",
      color: "000000",
      opacity: 0.18,
      blur: 36,
      offset: 3,
      angle: 270,
    });
  });

  test("maps a simple CSS card into an editable PowerPoint shape", () => {
    expect(createPptxShapeOverlay({
      slide: { left: 0, top: 0, width: 1600, height: 900 },
      box: { left: 160, top: 90, width: 640, height: 300 },
      style: {
        backgroundColor: "rgba(255, 255, 255, 0.92)",
        borderColor: "rgb(6, 78, 59)",
        borderWidth: "2px",
        borderRadius: "16px",
        boxShadow: "rgba(0, 0, 0, 0.18) 0px 4px 48px 0px",
        opacity: 1,
      },
    })).toEqual({
      shape: "roundRect",
      x: 1.333,
      y: 0.75,
      w: 5.333,
      h: 2.5,
      rectRadius: 0.107,
      fill: { color: "FFFFFF", transparency: 8 },
      line: { color: "064E3B", transparency: 0, width: 1.5 },
      shadow: {
        type: "outer",
        color: "000000",
        opacity: 0.18,
        blur: 36,
        offset: 3,
        angle: 270,
      },
    });
  });

  test("does not turn a transparent card into a black PowerPoint shape", () => {
    expect(createPptxShapeOverlay({
      slide: { left: 0, top: 0, width: 1600, height: 900 },
      box: { left: 0, top: 0, width: 400, height: 200 },
      style: {
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderWidth: "0px",
        borderRadius: "0px",
        boxShadow: "none",
        opacity: 1,
      },
    }).fill).toEqual({ color: "000000", transparency: 100 });
  });

  test("does not turn a one-sided CSS divider into a four-sided PowerPoint shape", () => {
    expect(isPptxShapeStyleCompatible({
      backgroundColor: "transparent",
      borderTopColor: "rgb(6, 78, 59)",
      borderRightColor: "transparent",
      borderBottomColor: "transparent",
      borderLeftColor: "transparent",
      borderTopWidth: "1px",
      borderRightWidth: "0px",
      borderBottomWidth: "0px",
      borderLeftWidth: "0px",
      boxShadow: "none",
      transform: "none",
      filter: "none",
      backdropFilter: "none",
      mixBlendMode: "normal",
      backgroundImage: "none",
      clipPath: "none",
      maskImage: "none",
    })).toBe(false);
  });

  test("preserves opacity inherited from a styled text container", () => {
    expect(createPptxTextOverlay({
      text: "Muted label",
      slide: { left: 0, top: 0, width: 1600, height: 900 },
      box: { left: 0, top: 0, width: 400, height: 50 },
      style: {
        color: "rgba(17, 24, 39, 0.8)",
        fontFamily: "Inter, sans-serif",
        fontSize: "16px",
        fontWeight: "400",
        fontStyle: "normal",
        textAlign: "left",
        lineHeight: "24px",
        letterSpacing: "0px",
        opacity: 0.6,
      },
    }).transparency).toBe(52);
  });

  test("keeps rich or transformed text in the visual background", () => {
    expect(isPptxTextStyleCompatible({
      text: "Plain text",
      hasElementChildren: false,
      transform: "none",
      filter: "none",
      textShadow: "none",
      backgroundClip: "border-box",
      webkitBackgroundClip: "border-box",
    })).toBe(true);
    expect(isPptxTextStyleCompatible({
      text: "Accent text",
      hasElementChildren: true,
      transform: "none",
      filter: "none",
      textShadow: "none",
      backgroundClip: "border-box",
      webkitBackgroundClip: "border-box",
    })).toBe(false);
    expect(isPptxTextStyleCompatible({
      text: "Wrapped title",
      hasElementChildren: true,
      isMarkedForPptxText: true,
      transform: "none",
      filter: "none",
      textShadow: "none",
      backgroundClip: "border-box",
      webkitBackgroundClip: "border-box",
    })).toBe(true);
  });

  test("keeps text eligible when its container is reconstructed as a native shape", () => {
    expect(isPptxTextStyleCompatible({
      text: "Card label",
      hasElementChildren: false,
      transform: "none",
      filter: "none",
      textShadow: "none",
      backgroundClip: "border-box",
      webkitBackgroundClip: "border-box",
      hasVisualAncestor: true,
    })).toBe(true);
  });

  test("recognizes slide wrapper containers when preparing export pages", () => {
    const wrapper = { closest: () => null };
    const slide = {
      closest: (selector: string) => selector === ".slide-wrap" ? wrapper : null,
    };

    expect(deckExportContainer(slide as unknown as HTMLElement)).toBe(wrapper);
  });

  test("recognizes fixed canvas frames as legacy presentation pages", () => {
    expect(PRESENTATION_SLIDE_SELECTOR).toContain(".slide-frame");
  });

  test("unhides a slide wrapper before capturing an export page", () => {
    const createElement = () => {
      const classes = new Set<string>();
      const wrapper = {
        hidden: false,
        removeAttribute: () => {},
        classList: {
          toggle: (name: string, force?: boolean) => force ? classes.add(name) : classes.delete(name),
          remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
        },
      };
      const slide = {
        hidden: false,
        classList: { toggle: () => {} },
        style: {},
        setAttribute: () => {},
        removeAttribute: () => {},
        closest: (selector: string) => selector === ".slide-wrap" ? wrapper : null,
      };
      return { slide, wrapper };
    };
    const first = createElement();
    const second = createElement();

    activateDeckExportSlide([first.slide, second.slide] as unknown as HTMLElement[], second.slide as unknown as HTMLElement);

    expect(first.wrapper.hidden).toBe(true);
    expect(first.wrapper.classList.contains("hidden")).toBe(true);
    expect(second.wrapper.hidden).toBe(false);
    expect(second.wrapper.classList.contains("hidden")).toBe(false);
  });
});
