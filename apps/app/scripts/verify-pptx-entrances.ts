import PptxGenJS from "pptxgenjs";
import JSZip from "jszip";

import { addPptxEntranceAnimations } from "../src/react-app/domains/session/design/pptx-entrance-animations";

const outputPath = process.argv[2];
if (!outputPath) throw new Error("Provide an output PPTX path.");

const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
const slide = pptx.addSlide();
slide.addText("fade up", { x: 1, y: 1, w: 2, h: 0.5, objectName: "ipw-entry-fade-up-1" });
slide.addText("rise", { x: 1, y: 2, w: 2, h: 0.5, objectName: "ipw-entry-rise-2" });
slide.addText("zoom", { x: 1, y: 3, w: 2, h: 0.5, objectName: "ipw-entry-zoom-3" });
const exported = await pptx.write({ outputType: "blob" });
if (!(exported instanceof Blob)) throw new Error("PptxGenJS did not return a Blob.");
const finalized = await addPptxEntranceAnimations(exported);
const zip = await JSZip.loadAsync(await finalized.arrayBuffer());
const xml = await zip.file("ppt/slides/slide1.xml")?.async("string");
if (!xml || !xml.includes('presetID="2" presetClass="entr" presetSubtype="1"') || !xml.includes('presetID="37"') || !xml.includes('presetID="23"')) {
  throw new Error("Generated PPTX did not contain the expected entrance timing XML.");
}
await Bun.write(outputPath, finalized);
console.log(outputPath);
