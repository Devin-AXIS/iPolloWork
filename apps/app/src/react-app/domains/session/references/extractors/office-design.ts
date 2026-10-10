import type JSZip from "jszip";
import type { ReferenceDesign, ReferenceDesignElement } from "@ipollowork/types/reference-context";
import { addDesignElement, createReferenceDesign, finishReferenceDesign } from "./design";
import { descendants, officeRelationships, officeText, officeXml, WORD_NS, xmlDocument } from "./office";

function child(node: Document | Element | undefined, name: string): Element | undefined {
  return node ? Array.from(node.childNodes).find((item): item is Element => item.nodeType === 1 && (item as Element).localName === name) : undefined;
}
function first(node: Document | Element | undefined, name: string) { return node ? descendants(node, name)[0] : undefined; }
function attr(node: Element | undefined, name: string) { return node?.getAttributeNS(WORD_NS, name) || node?.getAttribute(name) || undefined; }
function number(value: string | undefined, divisor = 1) { const result = value === undefined ? NaN : Number(value) / divisor; return Number.isFinite(result) ? result : undefined; }
function put<T extends object>(target: T, values: Partial<T>, clearUndefined = false) { for (const key of Object.keys(values) as (keyof T)[]) { if (values[key] !== undefined) target[key] = values[key]!; else if (clearUndefined) delete target[key]; } }

/** Resolve styles through each document's own relationship chain, never a global theme palette. */
export function officeDesign(zip: JSZip, format: "pptx" | "docx") {
  const design = createReferenceDesign(format);
  const note = (message: string) => { if (!design.limitations.includes(message)) design.limitations.push(message); };
  const documents = new Map<string, Promise<Document | undefined>>();
  const load = (part: string) => {
    let pending = documents.get(part);
    if (!pending) {
      pending = officeXml(zip, part).then((xml) => xml ? xmlDocument(xml) : undefined).catch(() => { note(`无法读取样式来源：${part}`); return undefined; });
      documents.set(part, pending);
    }
    return pending;
  };
  const related = async (part: string, type: string) => (await officeRelationships(zip, part)).find((item) => item.type === type && !item.external)?.target;
  const themeFor = async (part: string, fallback?: string) => {
    const path = await related(part, "theme") ?? fallback;
    const doc = path ? await load(path) : undefined;
    const scheme = first(doc, "clrScheme");
    const colors = new Map<string, string>();
    if (scheme) for (const item of Array.from(scheme.childNodes)) {
      if (item.nodeType !== 1) continue;
      const node = item as Element;
      const value = attr(first(node, "srgbClr"), "val") ?? attr(first(node, "sysClr"), "lastClr");
      if (value) colors.set(node.localName, `#${value.toUpperCase()}`);
    }
    return { doc, colors, path: doc ? path : undefined };
  };
  type Theme = Awaited<ReturnType<typeof themeFor>>;
  function color(node: Element | undefined, theme: Theme, mapping: Record<string, string> = {}): string | undefined {
    if (!node) return undefined;
    const rgb = first(node, "srgbClr");
    const scheme = first(node, "schemeClr");
    const system = first(node, "sysClr");
    const key = attr(scheme, "val") ?? attr(node, "themeColor");
    const value = attr(rgb, "val") ?? attr(system, "lastClr") ?? (node.localName === "color" ? attr(node, "val") : undefined);
    let result = key ? theme.colors.get(mapping[key] ?? ({ bg1: "lt1", bg2: "lt2", tx1: "dk1", tx2: "dk2" }[key] ?? key)) : value && /^[a-f0-9]{6}$/i.test(value) ? `#${value.toUpperCase()}` : undefined;
    const source = rgb ?? scheme ?? system;
    if (source && (descendants(source, "*").some((item) => !["tint", "shade", "alpha"].includes(item.localName)) || descendants(source, "*").filter((item) => item.localName !== "alpha").length > 1)) {
      note("部分亮度、饱和度等颜色变换尚未展开，相关最终色值未推测。"); return undefined;
    }
    if (result) {
      const tint = number(attr(first(source, "tint"), "val"), 100000) ?? (attr(node, "themeTint") ? parseInt(attr(node, "themeTint")!, 16) / 255 : undefined);
      const shade = number(attr(first(source, "shade"), "val"), 100000) ?? (attr(node, "themeShade") ? parseInt(attr(node, "themeShade")!, 16) / 255 : undefined);
      // DrawingML tint: input * tint + white * (1-tint); shade: input * shade.
      // https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.tint
      if (tint !== undefined || shade !== undefined) result = `#${[1, 3, 5].map((offset) => { const channel = parseInt(result!.slice(offset, offset + 2), 16); return Math.round(Math.max(0, Math.min(255, tint !== undefined ? channel * tint + 255 * (1 - tint) : channel * shade!))).toString(16).padStart(2, "0"); }).join("").toUpperCase()}`;
    }
    return result;
  }
  function font(value: string | undefined, theme: Theme): string | undefined {
    if (!value?.startsWith("+")) return value;
    const group = first(theme.doc, value.startsWith("+mj") ? "majorFont" : "minorFont");
    return attr(child(group, value.endsWith("-ea") ? "ea" : value.endsWith("-cs") ? "cs" : "latin"), "typeface") || attr(child(group, "latin"), "typeface");
  }
  function properties(node: Element | undefined, theme: Theme, mapping: Record<string, string> = {}): Partial<ReferenceDesignElement> {
    if (!node) return {};
    const isWord = node.namespaceURI === WORD_NS;
    const fonts = child(node, "rFonts");
    const explicitFont = isWord ? attr(fonts, "eastAsia") ?? attr(fonts, "ascii") : attr(child(node, "ea"), "typeface") ?? attr(child(node, "latin"), "typeface");
    const themeFont = attr(fonts, "eastAsiaTheme") ?? attr(fonts, "asciiTheme");
    const style: Partial<ReferenceDesignElement> = {};
    if (explicitFont || themeFont) style.fontFamily = font(explicitFont ?? (themeFont ? `+${themeFont.startsWith("major") ? "mj" : "mn"}-lt` : undefined), theme);
    const sizeValue = isWord ? attr(child(node, "sz"), "val") : attr(node, "sz");
    if (sizeValue !== undefined) style.fontSizePt = number(sizeValue, isWord ? 2 : 100);
    const colorNode = isWord ? child(node, "color") : child(node, "solidFill");
    if (colorNode) style.color = color(colorNode, theme, mapping);
    if (child(node, "noFill")) style.color = "transparent";
    if (child(node, "gradFill")) { style.color = undefined; note("渐变文字颜色未展开为单一色值。"); }
    for (const [name, key] of [["b", "bold"], ["i", "italic"]] as const) {
      const value = isWord ? child(node, name) : undefined;
      if (isWord ? value : attr(node, name) !== undefined) style[key] = !["0", "false", "off"].includes(isWord ? attr(value, "val") ?? "1" : attr(node, name)!);
    }
    return style;
  }
  function paragraphProperties(node: Element | undefined): Partial<ReferenceDesignElement> {
    const spacing = child(node, "spacing");
    const line = attr(spacing, "line");
    return { alignment: attr(child(node, "jc"), "val") ?? attr(node, "algn"),
      spaceBeforePt: number(attr(spacing, "before"), 20) ?? number(attr(first(child(node, "spcBef"), "spcPts"), "val"), 100),
      spaceAfterPt: number(attr(spacing, "after"), 20) ?? number(attr(first(child(node, "spcAft"), "spcPts"), "val"), 100),
      lineSpacing: line ? ["exact", "atLeast"].includes(attr(spacing, "lineRule") ?? "") ? `${Number(line) / 20} pt${attr(spacing, "lineRule") === "atLeast" ? " minimum" : ""}` : `${Number(line) / 240} lines` : undefined };
  }
  return {
    design,
    finish: () => finishReferenceDesign(design),
    async word(part: string, doc: Document) {
      const styles = await load("word/styles.xml");
      const theme = await themeFor("word/document.xml", "word/theme/theme1.xml");
      const byId = new Map((styles ? descendants(styles, "style") : []).map((node) => [attr(node, "styleId"), node]));
      const chain = (id: string | undefined) => {
        const result: Element[] = []; const seen = new Set<string>();
        while (id && !seen.has(id) && result.length < 32) { seen.add(id); const node = byId.get(id); if (!node) break; result.unshift(node); id = attr(child(node, "basedOn"), "val"); }
        if (id) note("部分 Word 样式继承缺失、循环或超过 32 层。");
        return result;
      };
      const defaultStyle = [...byId.values()].find((node) => attr(node, "type") === "paragraph" && attr(node, "default") === "1");
      const section = first(doc, "sectPr"); const pageSize = child(section, "pgSz"); const margins = child(section, "pgMar");
      const sections = descendants(doc, "sectPr");
      if (sections.length) { design.structure.sections = sections.length; design.structure.sectionPageSizesPt = sections.map((node) => `${number(attr(child(node, "pgSz"), "w"), 20) ?? "?"}×${number(attr(child(node, "pgSz"), "h"), 20) ?? "?"}`).join("、"); }
      const page: ReferenceDesign["pages"][number] = { sourcePart: part, widthPt: number(attr(pageSize, "w"), 20), heightPt: number(attr(pageSize, "h"), 20), elements: [] };
      const background = attr(first(doc, "background"), "color");
      if (background && /^[a-f0-9]{6}$/i.test(background)) page.background = `#${background.toUpperCase()}`;
      for (const side of ["top", "bottom", "left", "right"]) { const value = number(attr(margins, side), 20); if (value !== undefined) design.structure[`margin${side}Pt`] = value; }
      const columns = number(attr(child(section, "cols"), "num")); if (columns) design.structure.columns = columns;
      design.pages.push(page);
      for (const paragraph of descendants(doc, "p").filter((node) => node.namespaceURI === WORD_NS)) {
        const pPr = child(paragraph, "pPr"); const id = attr(child(pPr, "pStyle"), "val") ?? attr(defaultStyle, "styleId");
        const inherited = chain(id); const styleName = inherited.map((node) => attr(child(node, "name"), "val") ?? attr(node, "styleId")).join(" ");
        const base: Partial<ReferenceDesignElement> = {};
        put(base, properties(first(first(styles, "rPrDefault"), "rPr"), theme), true);
        put(base, paragraphProperties(first(first(styles, "pPrDefault"), "pPr")));
        for (const node of inherited) { put(base, properties(child(node, "rPr"), theme), true); put(base, paragraphProperties(child(node, "pPr"))); }
        put(base, paragraphProperties(pPr));
        const role = /heading|标题[1-9]/i.test(styleName) || child(pPr, "outlineLvl") ? "heading" : /title|标题/i.test(styleName) ? "title" : "body";
        const runs = descendants(paragraph, "r").filter((run) => run.namespaceURI === WORD_NS);
        for (const run of runs) {
          const runText = officeText(run); if (!runText.trim()) continue;
          const effective = { ...base }; const rPr = child(run, "rPr");
          for (const node of chain(attr(child(rPr, "rStyle"), "val"))) put(effective, properties(child(node, "rPr"), theme), true);
          put(effective, properties(rPr, theme), true);
          addDesignElement(design, page, { kind: "text", role, roleOrigin: id ? "explicit" : "rule", text: runText.slice(0, 160), sources: [part, ...(styles ? ["word/styles.xml"] : []), ...(theme.path ? [theme.path] : [])], ...effective });
        }
      }
      note("Word 流式布局不等于固定页坐标；未渲染分页、表格条件样式、图片内容及复杂效果。");
    },
    async slide(part: string, doc: Document, pageNumber: number, presentation?: Document) {
      const layoutPath = await related(part, "slideLayout"); const layout = layoutPath ? await load(layoutPath) : undefined;
      const masterPath = layoutPath ? await related(layoutPath, "slideMaster") : undefined; const master = masterPath ? await load(masterPath) : undefined;
      const theme = await themeFor(masterPath ?? "ppt/presentation.xml", "ppt/theme/theme1.xml");
      const mapping: Record<string, string> = {};
      for (const map of [first(master, "clrMap"), first(layout, "overrideClrMapping"), first(doc, "overrideClrMapping")]) if (map) for (const attribute of Array.from(map.attributes)) mapping[attribute.localName] = attribute.value;
      const size = first(presentation, "sldSz");
      const page: ReferenceDesign["pages"][number] = { sourcePart: part, page: pageNumber, widthPt: number(attr(size, "cx"), 12700), heightPt: number(attr(size, "cy"), 12700), elements: [] };
      for (const source of [master, layout, doc]) {
        const bg = first(source, "bg");
        if (bg) delete page.background;
        const bgColor = color(child(child(bg, "bgPr"), "solidFill") ?? child(bg, "bgRef"), theme, mapping);
        if (bgColor) page.background = bgColor;
        if (first(bg, "gradFill") || first(bg, "blipFill")) note("图片背景和渐变背景的素材保留，但未归纳为单一背景色。");
      }
      design.pages.push(page);
      const placeholder = (source: Document | undefined, shape: Element) => {
        const ph = first(shape, "ph"); if (!source || !ph) return undefined;
        return descendants(source, "sp").find((node) => { const candidate = first(node, "ph"); return candidate && (attr(ph, "idx") ? attr(candidate, "idx") === attr(ph, "idx") : (attr(candidate, "type") ?? "obj") === (attr(ph, "type") ?? "obj")); });
      };
      for (const shape of ["sp", "pic", "graphicFrame"].flatMap((kind) => descendants(doc, kind))) {
        const inherited = [placeholder(master, shape), placeholder(layout, shape), shape].filter((node): node is Element => !!node);
        const phType = attr(first(shape, "ph"), "type") ?? attr(first(inherited[0], "ph"), "type");
        const role = ["title", "ctrTitle"].includes(phType ?? "") ? "title" : phType === "body" ? "body" : "unknown";
        const geometry: Partial<ReferenceDesignElement> = {};
        for (const node of inherited) {
          if (child(child(node, "spPr"), "noFill") || child(child(node, "spPr"), "gradFill") || child(child(node, "spPr"), "solidFill")) delete geometry.fill;
          const border = child(child(node, "spPr"), "ln");
          if (child(border, "noFill") || child(border, "gradFill") || child(border, "solidFill")) delete geometry.borderColor;
          const transform = child(child(node, "spPr"), "xfrm") ?? child(node, "xfrm");
          put(geometry, { xPt: number(attr(child(transform, "off"), "x"), 12700), yPt: number(attr(child(transform, "off"), "y"), 12700), widthPt: number(attr(child(transform, "ext"), "cx"), 12700), heightPt: number(attr(child(transform, "ext"), "cy"), 12700), rotationDeg: number(attr(transform, "rot"), 60000), fill: color(child(child(node, "spPr"), "solidFill"), theme, mapping), borderColor: color(child(child(child(node, "spPr"), "ln"), "solidFill"), theme, mapping), borderWidthPt: number(attr(child(child(node, "spPr"), "ln"), "w"), 12700) });
        }
        let ancestor = shape.parentElement ?? shape.parentNode;
        while (ancestor && ancestor.nodeType === 1) {
          const group = ancestor as Element;
          if (group.localName === "grpSp") {
            // Non-rotated groups can be resolved without a rendering engine.
            const t = child(child(group, "grpSpPr"), "xfrm");
            const sx = Number(attr(child(t, "ext"), "cx")) / Number(attr(child(t, "chExt"), "cx"));
            const sy = Number(attr(child(t, "ext"), "cy")) / Number(attr(child(t, "chExt"), "cy"));
            if (Number(attr(t, "rot") ?? 0) || ["1", "true"].includes(attr(t, "flipH") ?? "") || ["1", "true"].includes(attr(t, "flipV") ?? "") || !Number.isFinite(sx) || !Number.isFinite(sy)) {
              delete geometry.xPt; delete geometry.yPt; delete geometry.widthPt; delete geometry.heightPt;
              note("旋转、翻转或缺失比例的组合元素未转换为页面坐标。"); break;
            }
            if (geometry.xPt !== undefined) geometry.xPt = Number(attr(child(t, "off"), "x") ?? 0) / 12700 + (geometry.xPt - Number(attr(child(t, "chOff"), "x") ?? 0) / 12700) * sx;
            if (geometry.yPt !== undefined) geometry.yPt = Number(attr(child(t, "off"), "y") ?? 0) / 12700 + (geometry.yPt - Number(attr(child(t, "chOff"), "y") ?? 0) / 12700) * sy;
            if (geometry.widthPt !== undefined) geometry.widthPt *= sx;
            if (geometry.heightPt !== undefined) geometry.heightPt *= sy;
          }
          ancestor = group.parentElement ?? group.parentNode;
        }
        const sources = [theme.path, masterPath, layoutPath, part].filter((value): value is string => !!value);
        const paragraphs = descendants(shape, "p");
        if (!paragraphs.length) addDesignElement(design, page, { kind: shape.localName, role: "unknown", roleOrigin: "unknown", text: "", sources, ...geometry });
        for (const paragraph of paragraphs) {
          const pPr = child(paragraph, "pPr"); const level = Number(attr(pPr, "lvl") ?? 0) + 1;
          const base: Partial<ReferenceDesignElement> = {};
          const txStyle = child(first(master, "txStyles"), role === "title" ? "titleStyle" : role === "body" ? "bodyStyle" : "otherStyle");
          const layers = [child(first(presentation, "defaultTextStyle"), `lvl${level}pPr`), child(txStyle, `lvl${level}pPr`), ...inherited.flatMap((node) => [child(first(node, "lstStyle"), `lvl${level}pPr`), child(first(node, "p"), "pPr")]), pPr];
          for (const layer of layers) { put(base, paragraphProperties(layer)); put(base, properties(child(layer, "defRPr"), theme, mapping), true); }
          for (const run of [...descendants(paragraph, "r"), ...descendants(paragraph, "fld")]) {
            const runText = officeText(run); if (!runText.trim()) continue;
            const effective = { ...base }; put(effective, properties(child(run, "rPr"), theme, mapping), true);
            addDesignElement(design, page, { kind: "text", role, roleOrigin: role === "unknown" ? "unknown" : "explicit", text: runText.slice(0, 160), sources, ...geometry, ...effective });
          }
        }
      }
      note("阴影、渐变、动画及图像内容未完整解释；颜色和字体频次按记录元素计数，不代表视觉面积占比。");
    },
  };
}
