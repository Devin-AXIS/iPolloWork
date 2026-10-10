import { videoEnhancementLayoutSchema, type VideoEnhancementCue, type VideoEnhancementRect, type VideoEnhancementResult } from "@ipollowork/types/video-enhancement";
import { enhancementMaskProtection } from "./video-enhancement-segmentation.js";

/** Keep aspect ratio and even dimensions without newer FFmpeg scale options. */
export const enhancementScaleFilter = (maxSide: number) =>
  `scale=w='max(2,trunc(iw*min(1,${maxSide}/max(iw,ih))/2)*2)':h='max(2,trunc(ih*min(1,${maxSide}/max(iw,ih))/2)*2)'`;

const overlaps = (a: VideoEnhancementRect, b: VideoEnhancementRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Source pixels are contained, never cropped; all cue coordinates use the output canvas. */
export function enhancementGeometry(result: Pick<VideoEnhancementResult, "width" | "height" | "layout">) {
  // Saved first-stage jobs used the source canvas and must keep that interpretation.
  const layout = result.layout ?? videoEnhancementLayoutSchema.parse({ mode: "background", aspectRatio: "source" });
  const width = layout.aspectRatio === "source" ? result.width : layout.aspectRatio === "16:9" ? 1280 : 720;
  const height = layout.aspectRatio === "source" ? result.height : layout.aspectRatio === "16:9" ? 720 : 1280;
  const left = layout.sourcePosition.endsWith("left"), top = layout.sourcePosition.startsWith("top");
  const pane = layout.mode === "background" ? { x: 0, y: 0, width: 1, height: 1 }
    : layout.mode === "split" ? { x: left ? .04 : .64, y: .06, width: .32, height: .88 }
      : { x: .04, y: .06, width: { small: .28, medium: .42, large: .56 }[layout.sourceSize],
        height: { small: .28, medium: .42, large: .56 }[layout.sourceSize] };
  const scale = Math.min(pane.width * width / result.width, pane.height * height / result.height);
  const sourceWidth = result.width * scale / width, sourceHeight = result.height * scale / height;
  const source = { x: layout.mode === "pip" ? left ? .04 : .96 - sourceWidth : pane.x + (pane.width - sourceWidth) / 2,
    y: layout.mode === "pip" ? top ? .06 : .94 - sourceHeight : pane.y + (pane.height - sourceHeight) / 2,
    width: sourceWidth, height: sourceHeight };
  const reserved = layout.mode === "split" ? pane : source;
  return { width, height, layout, source, reserved };
}

function contentRegion(source: VideoEnhancementRect, position: string) {
  const wanted = position === "left" ? { x: .04, y: .06, width: .44, height: .88 }
    : position === "right" ? { x: .52, y: .06, width: .44, height: .88 }
      : position === "top" ? { x: .04, y: .06, width: .92, height: .42 }
        : position === "bottom" ? { x: .04, y: .52, width: .92, height: .42 }
          : position === "center" ? { x: .16, y: .18, width: .68, height: .64 } : { x: .04, y: .06, width: .92, height: .88 };
  const candidates = [
    { side: "left", x: .04, y: .06, width: source.x - .08, height: .88 },
    { side: "right", x: source.x + source.width + .04, y: .06, width: .92 - source.x - source.width, height: .88 },
    { side: "top", x: .04, y: .06, width: .92, height: source.y - .10 },
    { side: "bottom", x: .04, y: source.y + source.height + .04, width: .92, height: .90 - source.y - source.height },
  ].map(rect => {
    const x = Math.max(rect.x, wanted.x), y = Math.max(rect.y, wanted.y);
    return { x, y, width: Math.min(rect.x + rect.width, wanted.x + wanted.width) - x,
      height: Math.min(rect.y + rect.height, wanted.y + wanted.height) - y };
  }).filter(rect => rect.width >= .18 && rect.height >= .18)
    .sort((a, b) => b.width * b.height - a.width * a.height);
  return candidates[0] ?? null;
}

/** Freeze each card's position for its whole window; never chase the presenter. */
export function placeEnhancementCues(cues: VideoEnhancementCue[], result: Pick<VideoEnhancementResult, "people" | "duration" | "width" | "height"> & Partial<Pick<VideoEnhancementResult, "hands" | "gestures" | "masks" | "layout">>): VideoEnhancementResult["cues"] {
  const geometry = enhancementGeometry(result);
  const project = (box: VideoEnhancementRect) => ({ x: geometry.source.x + box.x * geometry.source.width,
    y: geometry.source.y + box.y * geometry.source.height, width: box.width * geometry.source.width, height: box.height * geometry.source.height });
  const selected = cues.filter(cue => cue.enabled).sort((a, b) => a.start - b.start);
  if (selected.some((cue, index) => index > 0 && cue.start < selected[index - 1]!.end)) throw new Error("元素展示时间不能重叠，请调整时间后应用。");
  return cues.map(cue => {
    if (cue.end > result.duration + .001) throw new Error("元素时间超出原视频。");
    const position = cue.placement === "gesture" ? "auto" : cue.placement && cue.placement !== "auto" ? cue.placement : geometry.layout.contentPosition;
    if (geometry.layout.mode !== "background") {
      const rect = contentRegion(geometry.reserved, position);
      const gesture = (result.gestures ?? []).find(event => event.end > cue.start && event.start < cue.end);
      return rect ? { ...cue, rect, avoidance: "source", ...(gesture ? { gesture } : {}) }
        : { ...cue, enabled: false, rect: null, reason: "当前版式没有足够内容区域，请调整原视频大小或位置。" };
    }
    const contour = enhancementMaskProtection(result.masks ?? [], cue.start, cue.end);
    const avoidance = contour ? "contour" : "box";
    // Include adjoining samples and their conservative swept bounds. Missing
    // detections protect the center, rather than treating uncertainty as empty.
    const samples = result.people.filter(sample => sample.time >= Math.max(0, cue.start - .5) && sample.time <= cue.end + .5);
    const boxes = samples.flatMap(sample => sample.boxes.length ? sample.boxes : [{ x: .2, y: 0, width: .6, height: 1 }]);
    if (!samples.length) boxes.push({ x: .2, y: 0, width: .6, height: 1 });
    const blockers = contour ? [] : [...boxes];
    if (!contour && boxes.length) {
      const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
      blockers.push({ x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x,
        height: Math.max(...boxes.map(box => box.y + box.height)) - y });
    }
    blockers.push(...(result.hands ?? []).filter(sample => sample.time >= Math.max(0, cue.start - .25) && sample.time <= cue.end + .25).flatMap(sample => sample.boxes));
    const padded = blockers.map(project).map(box => ({ x: box.x - .035, y: box.y - .035, width: box.width + .07, height: box.height + .07 }));
    const protectedRect = (rect: VideoEnhancementRect) => {
      if (contour && overlaps(rect, geometry.source)) {
        const x = Math.max(rect.x, geometry.source.x), y = Math.max(rect.y, geometry.source.y);
        const right = Math.min(rect.x + rect.width, geometry.source.x + geometry.source.width);
        const bottom = Math.min(rect.y + rect.height, geometry.source.y + geometry.source.height);
        if (contour({ x: (x - geometry.source.x) / geometry.source.width, y: (y - geometry.source.y) / geometry.source.height,
          width: (right - x) / geometry.source.width, height: (bottom - y) / geometry.source.height })) return true;
      }
      return padded.some(box => overlaps(rect, box));
    };
    const matches = position !== "auto" && position !== "center" ? []
      : (result.gestures ?? []).filter(event => event.end > cue.start && event.start < cue.end)
        .sort((a, b) => (Math.min(b.end, cue.end) - Math.max(b.start, cue.start)) - (Math.min(a.end, cue.end) - Math.max(a.start, cue.start)) || b.confidence - a.confidence);
    if (cue.placement === "gesture" && !matches.length) return { ...cue, enabled: false, rect: null, reason: "此时段没有稳定手势，请调整时间或选择智能定位。" };
    const dimensions = [.32, .26, .2].flatMap(width => {
      const font = Math.min(geometry.width * .028, geometry.height * .045);
      const characters = Array.from(cue.text + (cue.detail ?? "") + (cue.items ?? []).join("")).length;
      const lines = Math.max(1, Math.ceil(characters * font / (geometry.width * width - font)));
      const height = Math.max(.16, (lines * font * 1.35 + font * 2.2) / geometry.height);
      return height <= .7 ? [{ width, height }] : [];
    });
    for (const gesture of matches) {
      for (const { width, height } of dimensions) {
        for (const [dx, dy] of [[0, 0], [0, -.1], [-.1, 0], [.1, 0], [0, .1]]) {
          const target = { x: geometry.source.x + gesture.target.x * geometry.source.width, y: geometry.source.y + gesture.target.y * geometry.source.height };
          const rect = { x: Math.max(.04, Math.min(.96 - width, target.x - width / 2 + dx!)),
            y: Math.max(.06, Math.min(.82 - height, target.y - height / 2 + dy!)), width, height };
          if (protectedRect(rect)) continue;
          const start = Math.max(cue.start, gesture.start);
          // Keep usable display time. The original speech window is never extended.
          if (cue.end - start < .5) continue;
          return { ...cue, start, rect, gesture, avoidance, reason: gesture.kind === "point" ? "依据指向位置展示，已避让人物与手部。" : "依据张掌位置展示，已避让人物与手部。" };
        }
      }
    }
    const gesture = matches[0];
    if (cue.placement === "gesture") return { ...cue, enabled: false, rect: null, gesture, reason: "手势目标区域没有安全空白，已跳过；可改为智能定位。" };
    // Keep the bottom 18% free for original subtitles. Smaller cards are tried
    // only while their text still has a useful minimum font size.
    for (const { width, height } of dimensions) {
      for (const y of position === "top" ? [.06] : position === "bottom" ? [.82 - height] : [.08, .32, .55]) {
        const positions = position === "left" ? [.04] : position === "right" ? [.96 - width] : position === "center" ? [(1 - width) / 2] : [.04, .96 - width];
        for (const x of positions) {
          const rect = { x, y, width, height };
          if (y + height <= .82 && !protectedRect(rect)) return { ...cue, rect, avoidance,
            ...(gesture ? { gesture, reason: "手势目标区域被占用，已改用安全空白位置。" } : {}) };
        }
      }
    }
    return { ...cue, enabled: false, rect: null, reason: "展示时段没有足够空白区域，已跳过。" };
  });
}

/** Group complete speech clauses into visual beats; never invent facts or numbers. */
export function buildEnhancementCues(segments: VideoEnhancementResult["segments"], duration: number): VideoEnhancementCue[] {
  const cues: VideoEnhancementCue[] = [];
  const beats: VideoEnhancementResult["segments"] = [];
  for (const segment of segments) {
    const text = segment.text.trim().replace(/^[，。！？、,.!?\s]+|[，。！？、,.!?\s]+$/gu, "");
    if (!text) continue;
    const previous = beats.at(-1);
    const marker = /^(?:第[一二三四五六七八九十]|首先|其次|最后|一是|二是|三是|总之|總之|总结|總結)/u;
    if (previous && segment.start - previous.end < 1 && previous.end - previous.start < 3.5
      && segment.end - previous.start <= 10 && previous.text.length + text.length < 150 && !marker.test(text)) {
      previous.text += "，" + text; previous.end = segment.end;
    } else beats.push({ ...segment, text });
  }
  for (const beat of beats) {
    // Split only at measured punctuation. Whole clauses retain their meaning;
    // within one ASR segment their timing is estimated in proportion to text.
    const clauses = beat.text.match(/[^，,。！？!?；;]+[，,。！？!?；;]?/gu) ?? [beat.text];
    const groups: string[] = [];
    for (const clause of clauses) {
      if (groups.length && groups.at(-1)!.length + clause.length <= 150) groups[groups.length - 1] += clause;
      else groups.push(clause);
    }
    let offset = 0;
    for (const group of groups) {
      const start = Math.max(beat.start + (beat.end - beat.start) * offset / beat.text.length, cues.at(-1)?.end ?? 0);
      offset += group.length;
      const end = Math.min(beat.end, duration, beat.start + (beat.end - beat.start) * offset / beat.text.length);
      const text = group.replace(/[，。！？、,.!?；;\s]+$/gu, "");
      if (text.length < 3 || text.length > 160 || end - start < .5) continue;
      const numeric = text.match(/(?:(?:负|負|正|[+−-])?\d+(?:[.,]\d+)*\s*(?:%|％|万|亿|元|倍|秒|分钟|小时|天|年)|(?:负|負)?百分之[零〇一二两三四五六七八九十百千万点\d]+)/u);
      const items = text.split(/[，,；;。]|(?=其次|然后|然後|最后|最後|第二|第三)/u).map(value => value.trim()).filter(value => value.length >= 3 && value.length <= 160);
      const list = /^(?:第[一二三四五六七八九十]|首先|其次|最后|一是|二是|三是)/u.test(text);
      const comparison = /不是.+而是|相比|对比|對比|versus|\bvs\b|instead of/iu.test(text);
      const summary = /^(?:总之|總之|总结|總結|记住|記住|关键是|關鍵是|in summary|remember)/iu.test(text);
      const sequence = list || /然后|然後|接着|接著|变成|變成|转换|轉換|first.+then/iu.test(text);
      const kind = numeric ? "number" : comparison ? "comparison" : summary ? "summary" : sequence ? items.length > 1 ? "steps" : "list" : items.length >= 3 ? "list" : "keyword";
      const title = numeric?.[0] ?? (kind === "keyword" && items.length > 1 ? items[0]! : text);
      cues.push({ id: `enhance-${cues.length + 1}`, kind, text: title, start, end, enabled: true,
        ...(title !== text ? { detail: text } : {}), ...((kind === "steps" || kind === "comparison" || kind === "list") && items.length > 1 ? { items: items.slice(0, 4) } : {}) });
      if (cues.length >= 60) return cues;
    }
  }
  return cues;
}

export function enhancementHtml(result: VideoEnhancementResult, mediaPath: string, previewGsap?: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const { width, height, source, layout } = enhancementGeometry(result);
  const cues = result.cues.filter(cue => cue.enabled && cue.rect);
  const card = (cue: VideoEnhancementResult["cues"][number]) => {
    const labels = { keyword: "讲述重点", number: "关键数字", list: "行动要点", steps: "步骤流程", comparison: "内容对比", quote: "金句强调", summary: "重点总结" };
    const items = cue.items?.length ? cue.items : (cue.detail ?? cue.text).split(/[，,；;。]/u).filter(Boolean).slice(0, 4);
    const structured = cue.kind === "steps" || cue.kind === "comparison" || cue.kind === "list";
    const wide = cue.rect && cue.rect.width * width > cue.rect.height * height * 1.1 && items.length <= 3;
    const heading = cue.text.replace(/[，,；;。]/gu, "") === items.join("") ? "" : `<div id="${cue.id}-text" class="headline">${escape(cue.text)}</div>`;
    return `<p class="eyebrow">${labels[cue.kind]}</p>${structured ? `${heading}<div class="items ${cue.kind}${wide ? " wide" : ""}" style="--columns:${Math.min(3, items.length)}">${items.map((item, index) => `<div id="${cue.id}-item-${index}" class="item"><span class="item-index">${String(index + 1).padStart(2, "0")}</span><span>${escape(item)}</span></div>`).join("")}</div>`
      : `<div id="${cue.id}-text" class="headline ${cue.kind === "number" ? "stat" : cue.kind === "quote" ? "quotation" : ""}">${escape(cue.text)}</div>${cue.detail ? `<p class="detail">${escape(cue.detail)}</p>` : ""}`}`;
  };
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=${width}, height=${height}">
<title>视频智能增强</title>${previewGsap ? `<script>${previewGsap}</script>` : '<script src="assets/gsap.min.js"></script>'}
<style>@font-face{font-family:"Enhancement Chinese";src:local("Microsoft YaHei"),local("PingFang SC"),local("Noto Sans CJK SC")}*{box-sizing:border-box}body{margin:0;background:#111c2a;font-family:"Enhancement Chinese",sans-serif}#enhanced-video{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#111c2a;color:#f4f7fb}#original-video{position:absolute;object-fit:contain;z-index:1;${layout.mode === "pip" ? "border-radius:18px;box-shadow:0 8px 36px #0005;" : ""}}.enhancement-card{position:absolute;z-index:2;padding:1.2em;border-radius:.65em;background:${layout.mode === "background" ? "rgba(17,28,42,.94)" : "#182638"};overflow:hidden;overflow-wrap:anywhere;display:flex;flex-direction:column;justify-content:center;line-height:1.45}.eyebrow{color:#9ddbcc;font-size:.56em;letter-spacing:.12em;margin:0 0 1em}.headline{font-weight:700;font-size:1em;line-height:1.35}.stat{color:#f4db79;font-size:2.5em;font-variant-numeric:tabular-nums;line-height:1.1}.quotation{border-left:.1em solid #9ddbcc;padding-left:.7em}.detail{font-size:.64em;line-height:1.7;color:#c6d1df;margin:1em 0 0}.items{display:grid;gap:.6em}.item{display:flex;align-items:center;gap:.7em;border-top:1px solid #ffffff20;padding-top:.6em;font-size:.7em}.item-index{flex-shrink:0;font-size:.65em;color:#9ddbcc}.comparison{grid-template-columns:1fr 1fr;gap:1em}.comparison .item{display:block;border-top:2px solid #9ddbcc}.comparison .item-index{display:block;margin-bottom:1em}.steps .item+.item::before{content:"↓";color:#9ddbcc;flex-shrink:0}.steps.wide{grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:1em}.steps.wide .item{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-width:0;border:0;border-radius:.5em;padding:1em;background:#22354b;font-size:.8em}.steps.wide .item-index{display:grid;place-items:center;width:2em;height:2em;border:1px solid #9ddbcc66;border-radius:50%}.steps.wide .item+.item::before{content:"→";position:absolute;left:-.9em;top:50%;transform:translateY(-50%)}</style></head>
<body><div id="enhanced-video" data-composition-id="enhanced-video" data-width="${width}" data-height="${height}" data-duration="${result.duration}" data-enhancement-layout="${layout.mode}">
<video id="original-video" class="clip" src="${escape(mediaPath)}" data-start="0" data-duration="${result.duration}" data-track-index="0" data-volume="1" data-has-audio="true" style="left:${source.x * 100}%;top:${source.y * 100}%;width:${source.width * 100}%;height:${source.height * 100}%" playsinline preload="auto"></video>
${cues.map(cue => {
  const rect = cue.rect!;
  const characters = (cue.text + (cue.detail ?? "") + (cue.items ?? []).join("")).length;
  const font = Math.min(rect.width * width / (characters > 100 ? 14 : 11), rect.height * height / (characters > 100 ? 10 : 6), height * .065);
  return `<div id="${cue.id}" class="clip enhancement-card" data-kind="${cue.kind}" data-start="${cue.start}" data-duration="${cue.end - cue.start}" data-track-index="1" style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%;font-size:${font}px">${card(cue)}</div>`;
}).join("\n")}
</div><script>for(const card of document.querySelectorAll(".enhancement-card")){let font=parseFloat(card.style.fontSize);for(let step=0;step<24&&font>14&&(card.scrollHeight>card.clientHeight+1||card.scrollWidth>card.clientWidth+1);step++){font=Math.max(14,font*.92);card.style.fontSize=font+"px"}}window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
${cues.map(cue => `tl.fromTo("#${cue.id}",{opacity:0},{opacity:1,duration:.2,ease:"power2.out"},${cue.start});tl.to("#${cue.id}",{opacity:0,duration:.18,ease:"none"},${cue.end - .18});`).join("\n")}
window.__timelines["enhanced-video"]=tl;
${previewGsap ? `const media=document.getElementById("original-video"),root=document.getElementById("enhanced-video");
document.body.style.cssText="display:grid;place-items:center;width:100vw;height:100vh;overflow:hidden;background:transparent";
root.style.flexShrink="0";const fit=()=>{root.style.transform="scale("+Math.min(innerWidth/${width},innerHeight/${height})+")";root.style.transformOrigin="center";root.style.position="absolute";root.style.left="calc(50% - ${width / 2}px)";root.style.top="calc(50% - ${height / 2}px)"};new ResizeObserver(fit).observe(document.body);fit();
const update=()=>{tl.seek(media.currentTime,false);parent.postMessage({type:"enhancement-time",time:media.currentTime,paused:media.paused},"*")};
media.addEventListener("timeupdate",update);media.addEventListener("seeked",update);media.addEventListener("play",update);media.addEventListener("pause",update);
addEventListener("message",event=>{if(event.source!==parent)return;const d=event.data;if(d?.type==="enhancement-seek"&&Number.isFinite(d.time)){media.currentTime=Math.max(0,Math.min(${result.duration},d.time));tl.seek(media.currentTime,false)}if(d?.type==="enhancement-play"){if(d.playing)media.play().catch(()=>parent.postMessage({type:"enhancement-error",message:"预览播放未启动，请再次点击播放。"},"*"));else media.pause()}});
const ready=()=>parent.postMessage({type:"enhancement-ready"},"*");if(media.readyState>=1)ready();else media.addEventListener("loadedmetadata",ready,{once:true});media.addEventListener("error",()=>parent.postMessage({type:"enhancement-error",message:"无法播放原视频，请检查视频格式或重新上传。"},"*"));tl.seek(0,false);` : ""}
</script></body></html>`;
}
