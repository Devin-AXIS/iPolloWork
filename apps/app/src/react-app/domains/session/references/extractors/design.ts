import type { ReferenceDesign, ReferenceDesignElement } from "@ipollowork/types/reference-context";
import type { ExtractedReferenceContent, ReferenceStyle } from "../types";

export function createReferenceDesign(format: string): ReferenceDesign {
  return { schemaVersion: 1, format, method: "local-rules", availability: "extracted", summary: [], limitations: [], omittedElements: 0, typography: [], palette: [], structure: {}, pages: [] };
}

/** Bound design evidence separately from text; originals and full text remain preserved. */
export function addDesignElement(design: ReferenceDesign, page: ReferenceDesign["pages"][number], element: ReferenceDesignElement) {
  const count = Number(design.structure.inspectedElements ?? 0);
  design.structure.inspectedElements = count + 1;
  if (count >= 2000) { design.omittedElements++; return; }
  page.elements.push(element);
}

export function finishReferenceDesign(design: ReferenceDesign): ReferenceDesign {
  const typography = new Map<string, ReferenceDesign["typography"][number]>();
  const palette = new Map<string, ReferenceDesign["palette"][number]>();
  for (const item of design.palette) palette.set(`${item.role}:${item.color}`, { ...item });
  const color = (value: string | undefined, role: string) => {
    if (!value) return;
    const key = `${role}:${value}`;
    const item = palette.get(key) ?? { color: value, role, count: 0 };
    item.count++; palette.set(key, item);
  };
  let centered = 0;
  const textSizes = design.pages.flatMap((page) => page.elements.flatMap((element) => element.fontSizePt ? [element.fontSizePt] : [])).sort((a, b) => a - b);
  const medianSize = textSizes[Math.floor(textSizes.length / 2)];
  for (const page of design.pages) {
    color(page.background, "background");
    for (const element of page.elements) {
      if (element.role === "unknown" && medianSize && element.fontSizePt && element.fontSizePt >= medianSize * 1.25 && element.text.length < 160) {
        element.role = "heading"; element.roleOrigin = "rule";
      }
      if (element.fontFamily || element.fontSizePt) {
        const key = JSON.stringify([element.fontFamily, element.fontSizePt, element.role]);
        const item = typography.get(key) ?? { fontFamily: element.fontFamily, fontSizePt: element.fontSizePt, role: element.role, count: 0 };
        item.count++; typography.set(key, item);
      }
      color(element.color, "text"); color(element.fill, "fill"); color(element.background, "background"); color(element.borderColor, "border");
      if (["ctr", "center"].includes(element.alignment ?? "")) centered++;
    }
  }
  design.typography = [...typography.values()].sort((a, b) => b.count - a.count);
  design.palette = [...palette.values()].sort((a, b) => b.count - a.count);
  const fonts = [...new Set(design.typography.flatMap((item) => item.fontFamily ? [item.fontFamily] : []))];
  const sizes = [...new Set(design.typography.flatMap((item) => item.fontSizePt ? [item.fontSizePt] : []))].sort((a, b) => b - a);
  const summary = [...design.summary];
  if (fonts.length) summary.push(`字体：${fonts.slice(0, 8).join("、")}`);
  if (sizes.length) summary.push(`字号层级：${sizes.slice(0, 8).join("、")} pt`);
  for (const [role, label] of [["title", "标题"], ["heading", "小标题（含规则判断）"], ["body", "正文"]]) {
    const values = design.typography.filter((item) => item.role === role).slice(0, 3).map((item) => [item.fontFamily, item.fontSizePt ? `${item.fontSizePt} pt` : ""].filter(Boolean).join(" "));
    if (values.length) summary.push(`${label}：${values.join("、")}`);
  }
  for (const [role, label] of [["text", "文字颜色"], ["background", "背景色"], ["fill", "元素填充"], ["border", "边框颜色"]]) {
    const colors = design.palette.filter((item) => item.role === role).slice(0, 6).map((item) => item.color);
    if (colors.length) summary.push(`${label}：${colors.join("、")}`);
  }
  const drawingColors = [...new Set(design.palette.filter((item) => item.role.startsWith("drawing-")).map((item) => item.color))];
  if (drawingColors.length) summary.push(`绘制配色（用途未判定）：${drawingColors.slice(0, 6).join("、")}`);
  const canvas = design.pages.find((page) => page.widthPt && page.heightPt);
  if (canvas) summary.push(`版面：${canvas.widthPt} × ${canvas.heightPt} pt（${canvas.widthPt! > canvas.heightPt! ? "横向" : "纵向"}）`);
  if (centered) summary.push(`居中对齐元素：${centered} 个`);
  const positioned = design.pages.flatMap((page) => page.elements).filter((item) => item.xPt !== undefined && item.yPt !== undefined).length;
  if (positioned) summary.push(`已记录 ${positioned} 个元素的位置；最终布局按目标画面适配`);
  if (!summary.length) {
    summary.push(design.availability === "declared" ? "文件包含样式声明，详见设计元素记录。" : "未发现可确认的视觉参数，沿用所选模板样式。");
    if (design.availability === "extracted") design.availability = "unavailable";
  }
  if (design.omittedElements) design.limitations.push(`设计元素仅记录前 2000 项，另外 ${design.omittedElements} 项未纳入样式统计；原文件保留。`);
  design.summary = [...new Set(summary)];
  design.limitations = [...new Set(design.limitations)];
  return design;
}

export function styleWithDesign(style: ReferenceStyle | undefined, design: ReferenceDesign): ReferenceStyle {
  return { fonts: style?.fonts ?? [], colors: style?.colors ?? [], backgrounds: style?.backgrounds ?? [], fontSizesPt: style?.fontSizesPt ?? [], sourceParts: style?.sourceParts ?? [], ...style, design };
}

/** Text/data formats encode structure and sometimes declarations, not rendered appearance. */
export function textReferenceDesign(format: string, content: ExtractedReferenceContent): ReferenceDesign {
  const design = createReferenceDesign(format);
  design.availability = content.text ? "structure-only" : "unavailable";
  design.limitations.push("文本或数据文件没有固定渲染样式；声明的风格不是已验证的视觉效果。");
  if (content.metadata?.rows !== undefined) design.structure.rows = content.metadata.rows;
  if (content.metadata?.columns !== undefined) design.structure.columns = content.metadata.columns;
  const page = { sourcePart: "content", elements: [] } satisfies ReferenceDesign["pages"][number];
  design.pages.push(page);
  const recordDeclaration = (key: string, value: unknown, source: string) => {
    if (typeof value !== "string" && typeof value !== "number") return;
    const string = String(value).slice(0, 400);
    const element: ReferenceDesignElement = { kind: "style-declaration", role: "unknown", roleOrigin: "unknown", text: `${key}: ${string}`, sources: [source] };
    if (/^(fontFamily|font-family|字体)$/i.test(key)) element.fontFamily = string;
    if (/^(fontSize|font-size|字号)$/i.test(key) && /^\d+(\.\d+)?\s*(pt|px)?$/.test(string)) {
      const points = parseFloat(string) * (/px$/.test(string) ? 0.75 : 1);
      if (Number.isFinite(points) && points > 0 && points <= 4096) element.fontSizePt = points;
    }
    if (/^(color|颜色|文字颜色)$/i.test(key)) element.color = string;
    if (/^(background|backgroundColor|background-color|背景|背景色)$/i.test(key)) element.background = string;
    addDesignElement(design, page, element);
    if (/^(style|theme|风格|配色)$/i.test(key) && design.summary.length < 8) design.summary.push(`风格声明：${string}`);
    design.availability = "declared";
  };
  if (format === "json") {
    let visited = 0;
    const walk = (value: unknown, path: string, depth: number) => {
      if (!value || typeof value !== "object") return;
      if (depth > 12 || visited >= 5000) { design.structure.declarationScanLimited = 1; return; }
      for (const key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
        if (++visited > 5000) { design.structure.declarationScanLimited = 1; break; }
        const child: unknown = Reflect.get(value, key);
        const pointer = `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`;
        const styleContext = /\/(style|styles|theme|design|design_system|designSystem|tokens)(\/|$)/i.test(path);
        if (/^(style|theme|fontFamily|font-family|fontSize|font-size|风格|配色|字体|字号)$/i.test(key)
          || styleContext && /^(color|background|backgroundColor|background-color|背景色)$/i.test(key)) recordDeclaration(key, child, pointer);
        if (typeof child === "object") walk(child, pointer, depth + 1);
      }
    };
    walk(content.structuredData, "/structuredData", 0);
    design.structure.format = "JSON 键值/数组结构";
    if (design.structure.declarationScanLimited) design.limitations.push("JSON 风格声明扫描上限为 5000 个属性、12 层；完整数据仍在 structuredData 和原文件中。");
  } else if (format === "csv") {
    design.structure.format = "CSV 表格结构";
    design.summary.push(`表格结构：${content.metadata?.rows ?? "未知"} 行，${content.metadata?.columns ?? "未知"} 列`);
    const data = content.structuredData;
    if (data && typeof data === "object") {
      const headers: unknown = Reflect.get(data, "headers"); const records: unknown = Reflect.get(data, "records");
      if (Array.isArray(headers) && Array.isArray(records) && headers.some((key) => typeof key === "string" && /^(style|fontFamily|fontSize|字体|风格)$/i.test(key))) {
        for (let row = 1; row < Math.min(records.length, 2001); row++) {
          const record: unknown = records[row]; if (!Array.isArray(record)) continue;
          headers.forEach((key, column) => { if (typeof key === "string" && /^(style|theme|fontFamily|fontSize|color|background|背景色|字体|风格)$/i.test(key)) recordDeclaration(key, record[column], `/structuredData/records/${row}/${column}`); });
        }
        if (records.length > 2001) design.limitations.push("CSV 风格声明仅扫描前 2000 行，完整表格保留。");
      }
    }
  } else {
    const source = content.rawText ?? content.text;
    const codeRanges: Array<[number, number]> = [];
    const inCode = (offset: number) => {
      let low = 0; let high = codeRanges.length - 1;
      while (low <= high) { const middle = (low + high) >>> 1; const range = codeRanges[middle]!; if (offset < range[0]) high = middle - 1; else if (offset > range[1]) low = middle + 1; else return true; }
      return false;
    };
    if (format === "md") {
      const levels = new Map<number, number>();
      let fence: { marker: string; offset: number } | undefined;
      for (const match of source.matchAll(/^([^\r\n]*)/gm)) {
        const line = match[1] ?? "";
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
        if (marker) {
          if (!fence) fence = { marker: marker[1]!, offset: match.index };
          else if (marker[1]![0] === fence.marker[0] && marker[1]!.length >= fence.marker.length && !marker[2]!.trim()) { codeRanges.push([fence.offset, match.index + line.length]); fence = undefined; }
          continue;
        }
        if (fence) continue;
        const heading = line.match(/^\s{0,3}(#{1,6})\s+(.+)/);
        if (heading) levels.set(heading[1]!.length, (levels.get(heading[1]!.length) ?? 0) + 1);
      }
      if (fence) codeRanges.push([fence.offset, source.length]);
      for (const [level, count] of levels) design.structure[`headingLevel${level}`] = count;
      if (levels.size) design.summary.push(`标题结构：${[...levels].map(([level, count]) => `H${level} ${count} 处`).join("、")}`);
    }
    for (const match of source.matchAll(/^(?:风格|配色|字体|字号|背景色|style|theme|fontFamily|fontSize|font-family|font-size|background-color)\s*[:：]\s*([^\r\n]{1,400})/gmi)) {
      if (inCode(match.index)) continue;
      recordDeclaration(match[0].split(/[:：]/)[0]!, match[1], `text-offset:${match.index}`);
      if (Number(design.structure.inspectedElements) >= 2000) { design.limitations.push("文本风格声明仅记录前 2000 项。"); break; }
    }
    if (format === "md") {
      for (const match of source.matchAll(/\bstyle\s*=\s*(["'])([^"']{1,2000})\1/gi)) {
        if (inCode(match.index)) continue;
        for (const declaration of match[2]!.split(";")) {
          const pair = declaration.match(/^\s*(font-family|font-size|color|background-color)\s*:\s*(.+?)\s*$/i);
          if (pair) recordDeclaration(pair[1]!, pair[2], `text-offset:${match.index}`);
        }
        if (Number(design.structure.inspectedElements) >= 2000) break;
      }
      design.limitations.push("Markdown 的内联样式仅读取明确的字体、字号和颜色声明；未执行 HTML、加载外部 CSS 或计算 CSS 层叠。");
    }
    design.structure.format = format === "md" ? "Markdown 语义结构，渲染字体与颜色由模板决定" : "纯文本，无固定排版";
  }
  if (!design.summary.length && design.availability === "structure-only") design.summary.push("原文件未提供可确认的视觉风格，沿用所选模板样式。");
  return finishReferenceDesign(design);
}
