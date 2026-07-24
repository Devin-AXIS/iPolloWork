import { describe, expect, test } from "bun:test";
import JSZip from "jszip";

import {
  addPptxEntranceAnimations,
  pptxEntranceTargets,
  withPptxEntranceAnimations,
} from "../src/react-app/domains/session/design/pptx-entrance-animations";

const slideXml = '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:cNvPr id="7" name="ipw-entry-fade-up-1"/><p:cNvPr id="8" name="ipw-entry-rise-2"/><p:cNvPr id="9" name="ipw-entry-zoom-3"/><p:cNvPr id="10" name="ordinary-object"/><p:cNvPr id="11" name="ipw-background-1"/></p:spTree></p:cSld></p:sld>';

describe("PPTX entrance animation writer", () => {
  test("targets named entry objects and preserves their requested animation", () => {
    expect(pptxEntranceTargets(slideXml)).toEqual([
      { shapeId: "7", animation: "fade-up" },
      { shapeId: "8", animation: "rise" },
      { shapeId: "9", animation: "zoom" },
    ]);
  });

  test("writes standard PowerPoint timing for directional, rise and zoom entrances", () => {
    const result = withPptxEntranceAnimations(slideXml, pptxEntranceTargets(slideXml));

    expect(result).toContain('<p:spTgt spid="7"/>');
    expect(result).toContain('presetID="2" presetClass="entr" presetSubtype="1"');
    expect(result).toContain('presetID="37" presetClass="entr" presetSubtype="0"');
    expect(result).toContain('presetID="23" presetClass="entr" presetSubtype="16"');
    expect(result).toContain("<p:attrName>ppt_w</p:attrName>");
    expect(result).toContain("<p:bldP spid=\"9\" grpId=\"0\" animBg=\"1\"/>");
  });

  test("does not overwrite timing already emitted by another writer", () => {
    const existing = slideXml.replace("</p:sld>", "<p:timing/></p:sld>");

    expect(withPptxEntranceAnimations(existing, pptxEntranceTargets(existing))).toBe(existing);
  });

  test("post-processes a Blob package without relying on JSZip Blob input support", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", slideXml);
    const input = await zip.generateAsync({ type: "blob" });
    const output = await addPptxEntranceAnimations(input);
    const outputZip = await JSZip.loadAsync(await output.arrayBuffer());
    const outputXml = await outputZip.file("ppt/slides/slide1.xml")?.async("string");

    expect(outputXml).toContain("<p:timing>");
  });
});
