export type PptxEntranceAnimation = "fade" | "fade-up" | "fade-down" | "fade-left" | "fade-right" | "rise" | "zoom";

export type PptxEntranceTarget = {
  shapeId: string;
  animation: PptxEntranceAnimation;
};

const shapeNamePattern = /<p:cNvPr\b(?=[^>]*\bid="([^"]+)")(?=[^>]*\bname="ipw-entry-([^"]+)")[^>]*>/g;
const animationNames = new Set<PptxEntranceAnimation>(["fade", "fade-up", "fade-down", "fade-left", "fade-right", "rise", "zoom"]);

export function isPptxNativeEntranceAnimation(value: string | null | undefined): value is PptxEntranceAnimation {
  return animationNames.has(value as PptxEntranceAnimation);
}

export function pptxEntranceAnimation(value: string | null | undefined): PptxEntranceAnimation {
  return isPptxNativeEntranceAnimation(value) ? value : "fade";
}

export function pptxEntranceObjectName(index: number, animation: PptxEntranceAnimation) {
  return `ipw-entry-${animation}-${index}`;
}

export function pptxEntranceTargets(slideXml: string): PptxEntranceTarget[] {
  return Array.from(slideXml.matchAll(shapeNamePattern)).flatMap((match) => {
    const shapeId = match[1];
    const animation = match[2]?.replace(/-\d+$/, "");
    return shapeId && animation ? [{ shapeId, animation: pptxEntranceAnimation(animation) }] : [];
  });
}

function xmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&apos;",
  })[character]!);
}

function target(shapeId: string) {
  return `<p:tgtEl><p:spTgt spid="${xmlEscape(shapeId)}"/></p:tgtEl>`;
}

function slideTarget() {
  return "<p:tgtEl><p:sldTgt/></p:tgtEl>";
}

function visibilitySet(shapeId: string, id: number) {
  return `<p:set><p:cBhvr><p:cTn id="${id}" dur="1" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst></p:cTn>${target(shapeId)}<p:attrNameLst><p:attrName>style.visibility</p:attrName></p:attrNameLst></p:cBhvr><p:to><p:strVal val="visible"/></p:to></p:set>`;
}

function fadeEffect(shapeId: string, id: number, duration: number) {
  return `<p:animEffect transition="in" filter="fade"><p:cBhvr><p:cTn id="${id}" dur="${duration}"/>${target(shapeId)}</p:cBhvr></p:animEffect>`;
}

function motion(shapeId: string, id: number, property: "ppt_x" | "ppt_y" | "ppt_w" | "ppt_h", from: string, to: string, duration: number, extra = "") {
  return `<p:anim calcmode="lin" valueType="num"><p:cBhvr additive="base"><p:cTn id="${id}" dur="${duration}" fill="hold"${extra}/>${target(shapeId)}<p:attrNameLst><p:attrName>${property}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:strVal val="${from}"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="${to}"/></p:val></p:tav></p:tavLst></p:anim>`;
}

function zoomMotion(shapeId: string, id: number, property: "ppt_w" | "ppt_h") {
  return `<p:anim calcmode="lin" valueType="num"><p:cBhvr><p:cTn id="${id}" dur="500" fill="hold"/>${target(shapeId)}<p:attrNameLst><p:attrName>${property}</p:attrName></p:attrNameLst></p:cBhvr><p:tavLst><p:tav tm="0"><p:val><p:fltVal val="0"/></p:val></p:tav><p:tav tm="100000"><p:val><p:strVal val="#${property}"/></p:val></p:tav></p:tavLst></p:anim>`;
}

function effectChildren(shapeId: string, animation: PptxEntranceAnimation, firstId: number) {
  if (animation === "fade") return { xml: visibilitySet(shapeId, firstId) + fadeEffect(shapeId, firstId + 1, 500), nextId: firstId + 2, presetId: 10, presetSubtype: 0 };
  if (animation === "zoom") return { xml: visibilitySet(shapeId, firstId) + zoomMotion(shapeId, firstId + 1, "ppt_w") + zoomMotion(shapeId, firstId + 2, "ppt_h"), nextId: firstId + 3, presetId: 23, presetSubtype: 16 };
  if (animation === "rise") {
    return {
      xml: visibilitySet(shapeId, firstId)
        + fadeEffect(shapeId, firstId + 1, 1000)
        + motion(shapeId, firstId + 2, "ppt_y", "#ppt_y+1", "#ppt_y", 1000),
      nextId: firstId + 3,
      presetId: 37,
      presetSubtype: 0,
    };
  }
  const fly = {
    "fade-up": { subtype: 1, x: "#ppt_x", y: "0-#ppt_h/2" },
    "fade-down": { subtype: 4, x: "#ppt_x", y: "1+#ppt_h/2" },
    "fade-left": { subtype: 8, x: "0-#ppt_w/2", y: "#ppt_y" },
    "fade-right": { subtype: 2, x: "1+#ppt_w/2", y: "#ppt_y" },
  }[animation];
  if (!fly) throw new Error(`Unsupported PPTX entrance animation: ${animation}`);
  return {
    xml: visibilitySet(shapeId, firstId)
      + motion(shapeId, firstId + 1, "ppt_x", fly.x, "#ppt_x", 500)
      + motion(shapeId, firstId + 2, "ppt_y", fly.y, "#ppt_y", 500),
    nextId: firstId + 3,
    presetId: 2,
    presetSubtype: fly.subtype,
  };
}

function clickEffect(target: PptxEntranceTarget, id: number) {
  const children = effectChildren(target.shapeId, target.animation, id + 3);
  return {
    xml: `<p:par><p:cTn id="${id}" fill="hold"><p:stCondLst><p:cond delay="indefinite"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${id + 1}" fill="hold"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst><p:par><p:cTn id="${id + 2}" presetID="${children.presetId}" presetClass="entr" presetSubtype="${children.presetSubtype}" fill="hold" grpId="0" nodeType="clickEffect"><p:stCondLst><p:cond delay="0"/></p:stCondLst><p:childTnLst>${children.xml}</p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par></p:childTnLst></p:cTn></p:par>`,
    nextId: children.nextId,
  };
}

export function withPptxEntranceAnimations(slideXml: string, targets: readonly PptxEntranceTarget[]) {
  if (!targets.length || slideXml.includes("<p:timing")) return slideXml;
  let nextId = 3;
  const effects = targets.map((entry) => {
    const effect = clickEffect(entry, nextId);
    nextId = effect.nextId;
    return effect.xml;
  }).join("");
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst><p:seq concurrent="1" nextAc="seek"><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${effects}</p:childTnLst></p:cTn><p:prevCondLst><p:cond evt="onPrev" delay="0">${slideTarget()}</p:cond></p:prevCondLst><p:nextCondLst><p:cond evt="onNext" delay="0">${slideTarget()}</p:cond></p:nextCondLst></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst><p:bldLst>${targets.map((entry) => `<p:bldP spid="${xmlEscape(entry.shapeId)}" grpId="0" animBg="1"/>`).join("")}</p:bldLst></p:timing>`;
  return slideXml.replace("</p:sld>", `${timing}</p:sld>`);
}

export async function addPptxEntranceAnimations(input: Blob): Promise<Blob> {
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await input.arrayBuffer());
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^ppt\/slides\/slide\d+\.xml$/.test(path)) continue;
    const slideXml = await entry.async("string");
    zip.file(path, withPptxEntranceAnimations(slideXml, pptxEntranceTargets(slideXml)));
  }
  return zip.generateAsync({
    type: "blob",
    mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  });
}
