import type { VideoEnhancementCue, VideoEnhancementRect, VideoEnhancementResult } from "@ipollowork/types/video-enhancement";

const overlaps = (a: VideoEnhancementRect, b: VideoEnhancementRect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

/** Freeze each card's position for its whole window; never chase the presenter. */
export function placeEnhancementCues(cues: VideoEnhancementCue[], result: Pick<VideoEnhancementResult, "people" | "duration" | "width" | "height"> & Partial<Pick<VideoEnhancementResult, "hands" | "gestures">>): VideoEnhancementResult["cues"] {
  const selected = cues.filter(cue => cue.enabled).sort((a, b) => a.start - b.start);
  if (selected.some((cue, index) => index > 0 && cue.start < selected[index - 1]!.end)) throw new Error("元素展示时间不能重叠，请调整时间后应用。");
  return cues.map(cue => {
    if (cue.end > result.duration + .001) throw new Error("元素时间超出原视频。");
    // Include adjoining samples and their conservative swept bounds. Missing
    // detections protect the center, rather than treating uncertainty as empty.
    const samples = result.people.filter(sample => sample.time >= Math.max(0, cue.start - .5) && sample.time <= cue.end + .5);
    const boxes = samples.flatMap(sample => sample.boxes.length ? sample.boxes : [{ x: .2, y: 0, width: .6, height: 1 }]);
    if (!samples.length) boxes.push({ x: .2, y: 0, width: .6, height: 1 });
    const blockers = [...boxes];
    if (boxes.length) {
      const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y));
      blockers.push({ x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x,
        height: Math.max(...boxes.map(box => box.y + box.height)) - y });
    }
    blockers.push(...(result.hands ?? []).filter(sample => sample.time >= Math.max(0, cue.start - .25) && sample.time <= cue.end + .25).flatMap(sample => sample.boxes));
    const padded = blockers.map(box => ({ x: box.x - .035, y: box.y - .035, width: box.width + .07, height: box.height + .07 }));
    const matches = cue.placement === "left" || cue.placement === "right" ? []
      : (result.gestures ?? []).filter(event => event.end > cue.start && event.start < cue.end)
        .sort((a, b) => (Math.min(b.end, cue.end) - Math.max(b.start, cue.start)) - (Math.min(a.end, cue.end) - Math.max(a.start, cue.start)) || b.confidence - a.confidence);
    if (cue.placement === "gesture" && !matches.length) return { ...cue, enabled: false, rect: null, reason: "此时段没有稳定手势，请调整时间或选择智能定位。" };
    const dimensions = [.32, .26, .2].flatMap(width => {
      const font = Math.min(result.width * .028, result.height * .045);
      const lines = Math.max(1, Math.ceil((Array.from(cue.text).length + (cue.kind === "list" ? 2 : 0)) * font / (result.width * width - font)));
      const height = Math.max(.09, (lines * font * 1.35 + font * 1.3) / result.height);
      return height <= .35 ? [{ width, height }] : [];
    });
    for (const gesture of matches) {
      for (const { width, height } of dimensions) {
        for (const [dx, dy] of [[0, 0], [0, -.1], [-.1, 0], [.1, 0], [0, .1]]) {
          const rect = { x: Math.max(.04, Math.min(.96 - width, gesture.target.x - width / 2 + dx!)),
            y: Math.max(.06, Math.min(.82 - height, gesture.target.y - height / 2 + dy!)), width, height };
          if (padded.some(box => overlaps(rect, box))) continue;
          const start = Math.max(cue.start, gesture.start);
          // Keep usable display time. The original speech window is never extended.
          if (cue.end - start < .5) continue;
          return { ...cue, start, rect, gesture, reason: gesture.kind === "point" ? "依据指向位置展示，已避让人物与手部。" : "依据张掌位置展示，已避让人物与手部。" };
        }
      }
    }
    const gesture = matches[0];
    if (cue.placement === "gesture") return { ...cue, enabled: false, rect: null, gesture, reason: "手势目标区域没有安全空白，已跳过；可改为智能定位。" };
    // Keep the bottom 18% free for original subtitles. Smaller cards are tried
    // only while their text still has a useful minimum font size.
    for (const { width, height } of dimensions) {
      for (const y of [.08, .32, .55]) {
        const positions = cue.placement === "left" ? [.04] : cue.placement === "right" ? [.96 - width] : [.04, .96 - width];
        for (const x of positions) {
          const rect = { x, y, width, height };
          if (y + height <= .82 && !padded.some(box => overlaps(rect, box))) return { ...cue, rect,
            ...(gesture ? { gesture, reason: "手势目标区域被占用，已改用安全空白位置。" } : {}) };
        }
      }
    }
    return { ...cue, enabled: false, rect: null, reason: "展示时段没有足够空白区域，已跳过。" };
  });
}

/** Only quote the measured transcript; no cloud model and no invented claims. */
export function buildEnhancementCues(segments: VideoEnhancementResult["segments"], duration: number): VideoEnhancementCue[] {
  const cues: VideoEnhancementCue[] = [];
  let previousEnd = 0;
  for (let index = 0; index < segments.length; index++) {
    let segment = segments[index]!;
    let text = segment.text.trim().replace(/^[，。！？、,.!?\s]+|[，。！？、,.!?\s]+$/gu, "");
    const next = segments[index + 1];
    if (/^(?:第[一二三四五六七八九十]|首先|其次|最后|一是|二是|三是)$/u.test(text) && next && next.start - segment.end < 1) {
      text += "，" + next.text.trim();
      segment = { ...segment, end: next.end };
      index++;
    }
    if (text.length < 3) continue;
    const start = Math.max(segment.start, previousEnd);
    const end = Math.min(segment.end, duration, start + 6);
    if (end - start < .8) continue;
    const numeric = text.match(/(?:(?:负|負|正|[+−-])?\d+(?:[.,]\d+)*\s*(?:%|％|万|亿|元|倍|秒|分钟|小时|天|年)|(?:负|負)?百分之[零〇一二两三四五六七八九十百千万点\d]+)/u);
    const list = /^(?:第[一二三四五六七八九十]|首先|其次|最后|一是|二是|三是)/u.test(text);
    const content = numeric?.[0] ?? text;
    // Skip long sentences instead of presenting a misleading truncated quote.
    if (Array.from(content).length > (list ? 48 : 24)) continue;
    cues.push({ id: `enhance-${cues.length + 1}`, kind: numeric ? "number" : list ? "list" : "keyword", text: content, start, end, enabled: true });
    previousEnd = end + .4;
    if (cues.length >= 60) break;
  }
  return cues;
}

export function enhancementHtml(result: VideoEnhancementResult, mediaPath: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const cues = result.cues.filter(cue => cue.enabled && cue.rect);
  const font = Math.min(result.width * .028, result.height * .045);
  return `<!doctype html>
<html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=${result.width}, height=${result.height}">
<title>视频智能增强</title><script src="assets/gsap.min.js"></script>
<style>@font-face{font-family:"Enhancement Chinese";src:local("Microsoft YaHei"),local("PingFang SC"),local("Noto Sans CJK SC")}body{margin:0;background:#101114;font-family:"Enhancement Chinese",sans-serif}#enhanced-video{position:relative;width:${result.width}px;height:${result.height}px;overflow:hidden}#original-video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}.enhancement-card{position:absolute;box-sizing:border-box;z-index:2;padding:${font * .6}px;border-radius:${font * .3}px;background:rgba(15,18,24,.92);color:#fff;font-size:${font}px;line-height:1.35;font-weight:600;overflow:hidden;overflow-wrap:anywhere;display:flex;align-items:center}.enhancement-card[data-kind=number]{color:#f4db79}</style></head>
<body><div id="enhanced-video" data-composition-id="enhanced-video" data-start="0" data-width="${result.width}" data-height="${result.height}" data-duration="${result.duration}">
<video id="original-video" class="clip" src="${escape(mediaPath)}" data-start="0" data-duration="${result.duration}" data-track-index="0" data-volume="1" data-has-audio="true" playsinline></video>
${cues.map(cue => `<div id="${cue.id}" class="clip enhancement-card" data-kind="${cue.kind}" data-start="${cue.start}" data-duration="${cue.end - cue.start}" data-track-index="1" style="left:${cue.rect!.x * 100}%;top:${cue.rect!.y * 100}%;width:${cue.rect!.width * 100}%;height:${cue.rect!.height * 100}%"><span id="${cue.id}-text">${escape(cue.kind === "list" ? "• " + cue.text : cue.text)}</span></div>`).join("\n")}
</div><script>window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
${cues.map(cue => `tl.fromTo("#${cue.id}",{opacity:0},{opacity:1,duration:.18,ease:"none"},${cue.start});tl.to("#${cue.id}",{opacity:0,duration:.18,ease:"none"},${cue.end - .18});`).join("\n")}
window.__timelines["enhanced-video"]=tl;</script></body></html>`;
}
