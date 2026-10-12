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

/** Locate a bounded visual intent in measured words; transcript text remains data. */
function cueIntent(cue: VideoEnhancementCue, words: VideoEnhancementResult["words"]) {
  const text = cue.detail?.trim() || cue.text;
  // A spoken location takes precedence over an earlier noun such as “图表”.
  const phrase = text.match(/这里|這裡|这儿|這兒|此处|这边|這邊|这个位置|这个地方|左边|左侧|右边|右侧|上方|下方|掌心|手上|托住|托着|手掌|双手|两只手|中间|\b(?:here|left|right|above|below)\b/iu)?.[0]
    ?? text.match(/展开|引导|对比|對比|两边|范围|数据图|数据表|图表|柱状图|折线图|饼图|\b(?:chart|compare|reveal)\b/iu)?.[0] ?? "";
  const nearby = words?.filter(word => word.start >= cue.start - .35 && word.start < cue.end) ?? [];
  const joined = nearby.map(word => word.text).join("");
  const offset = phrase ? joined.toLowerCase().indexOf(phrase.toLowerCase()) : -1;
  let chars = 0;
  const word = offset < 0 ? undefined : nearby.find(word => { chars += word.text.length; return chars > offset; });
  return { text, phrase, time: word?.start ?? cue.start, precision: word ? "word" : "segment", explicit: Boolean(phrase) } satisfies { text: string; phrase: string; time: number; precision: "word" | "segment"; explicit: boolean };
}

/** Interpolate the measured path at the spoken reference, never use its final target. */
function gestureTarget(gesture: VideoEnhancementResult["gestures"][number], time: number) {
  const path = gesture.path;
  if (!path?.length) return gesture.target;
  const after = path.findIndex(point => point.time >= time);
  if (after < 0) return path.at(-1)!;
  if (after === 0) return path[0]!;
  const a = path[after - 1]!, b = path[after]!, t = (time - a.time) / (b.time - a.time);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Pointing locks at the spoken reference; support follows only its measured window. */
export function placeEnhancementCues(cues: VideoEnhancementCue[], result: Pick<VideoEnhancementResult, "people" | "duration" | "width" | "height"> & Partial<Pick<VideoEnhancementResult, "hands" | "gestures" | "masks" | "layout" | "words">>): VideoEnhancementResult["cues"] {
  const geometry = enhancementGeometry(result);
  const project = (box: VideoEnhancementRect) => ({ x: geometry.source.x + box.x * geometry.source.width,
    y: geometry.source.y + box.y * geometry.source.height, width: box.width * geometry.source.width, height: box.height * geometry.source.height });
  const selected = cues.filter(cue => cue.enabled).sort((a, b) => a.start - b.start);
  if (selected.some((cue, index) => index > 0 && cue.start < selected[index - 1]!.end)) throw new Error("元素展示时间不能重叠，请调整时间后应用。");
  return cues.map(cue => {
    if (cue.end > result.duration + .001) throw new Error("元素时间超出原视频。");
    const intent = cueIntent(cue, result.words);
    const position = cue.placement === "gesture" ? "auto" : cue.placement && cue.placement !== "auto" ? cue.placement : geometry.layout.contentPosition;
    const matches = position !== "auto" || cue.anchor ? [] : (result.gestures ?? [])
      .filter(event => (!event.path || intent.explicit || cue.placement === "gesture") && (intent.precision === "word"
        ? event.end > intent.time - .35 && event.start < intent.time + .6
        : event.end > cue.start - .35 && event.start < cue.end - .5))
      .sort((a, b) => {
        const score = (event: typeof a) => {
          const target = gestureTarget(event, intent.time);
          const direction = /左|left/iu.test(intent.phrase) ? target.x : /右|right/iu.test(intent.phrase) ? 1 - target.x : 0;
          const content = intent.text;
          const compatible = /托|掌心|手掌/u.test(content) ? event.motion === "support" : /展开|引导|reveal/iu.test(content) ? event.motion === "guide" : event.kind !== "open_palm";
          return intent.precision === "word" ? Math.max(0, event.start - intent.time, intent.time - event.end) * 4 + direction - event.confidence * .1 - Number(compatible) * .15
            : -(Math.min(event.end, cue.end) - Math.max(event.start, cue.start)) - event.confidence * .1;
        };
        return score(a) - score(b);
      });
    const matched = matches[0];
    const paired = matched?.kind === "open_palm" && intent.explicit
      ? matches.find(event => event !== matched && event.kind === "open_palm" && event.handId !== matched.handId
        && Math.min(event.end, matched.end) >= Math.max(event.start, matched.start)
        && (intent.precision !== "word" || (event.start <= intent.time + .1 && event.end >= intent.time - .1 && matched.start <= intent.time + .1 && matched.end >= intent.time - .1))
        && Math.abs(gestureTarget(event, intent.time).x - gestureTarget(matched, intent.time).x) > .15
        && Math.abs(gestureTarget(event, intent.time).y - gestureTarget(matched, intent.time).y) < .22) : undefined;
    const frameSample = paired ? result.hands?.filter(sample => sample.boxes.length === 2 && Math.abs(sample.time - intent.time) <= .2)
      .sort((a, b) => Math.abs(a.time - intent.time) - Math.abs(b.time - intent.time))[0] : undefined;
    const frameHands = frameSample ? [...frameSample.boxes].sort((a, b) => a.x - b.x) : undefined;
    const gesture = matched && paired ? { ...matched, motion: "frame", region: frameHands ? {
      x: frameHands[0]!.x + frameHands[0]!.width / 2,
      y: Math.min(...frameHands.map(box => box.y)),
      width: frameHands[1]!.x + frameHands[1]!.width / 2 - frameHands[0]!.x - frameHands[0]!.width / 2,
      height: Math.max(...frameHands.map(box => box.y + box.height)) - Math.min(...frameHands.map(box => box.y)),
    } : {
      x: Math.min(gestureTarget(matched, intent.time).x, gestureTarget(paired, intent.time).x),
      y: Math.max(.06, Math.min(.75, (gestureTarget(matched, intent.time).y + gestureTarget(paired, intent.time).y) / 2 - .125)),
      width: Math.abs(gestureTarget(matched, intent.time).x - gestureTarget(paired, intent.time).x), height: .25,
    } } satisfies typeof matched : matched;
    const behavior = gesture?.motion === "frame" ? "frame" : gesture?.motion === "guide" ? "reveal" : gesture?.motion === "support" ? "follow" : "locked";
    const start = gesture ? Math.max(cue.start, gesture.start, intent.precision === "word" ? intent.time : 0) : cue.start;
    const binding = (rect: VideoEnhancementRect, region: VideoEnhancementRect, space: "source" | "content") => {
      if (!gesture || cue.end - start < .5) return undefined;
      const target = gestureTarget(gesture, intent.time);
      const scale = space === "source" ? geometry.source : region;
      const path = behavior === "follow" ? (gesture.path ?? []).filter(point => point.time > start && point.time < cue.end)
        .map(point => ({ time: point.time, x: Math.max(region.x, Math.min(region.x + region.width - rect.width, rect.x + (point.x - target.x) * scale.width)),
          y: Math.max(region.y, Math.min(region.y + region.height - rect.height, rect.y + (point.y - target.y) * scale.height)) })) : [];
      const clamp = (value: number) => Math.max(0, Math.min(1, value));
      const anchor = space === "source" ? { x: clamp((rect.x + rect.width / 2 - geometry.source.x) / geometry.source.width),
        y: clamp((rect.y + rect.height / 2 - geometry.source.y) / geometry.source.height) }
        : { x: region.width > rect.width ? clamp((rect.x - region.x) / (region.width - rect.width)) : .5,
          y: region.height > rect.height ? clamp((rect.y - region.y) / (region.height - rect.height)) : .5 };
      return { time: intent.time, precision: intent.precision, phrase: intent.phrase, behavior, space, anchor, path: [{ time: start, x: rect.x, y: rect.y }, ...path] } satisfies NonNullable<VideoEnhancementResult["cues"][number]["binding"]>;
    };
    if (cue.placement === "gesture" && !cue.anchor && !matches.length) return { ...cue, enabled: false, rect: null, reason: "此时段没有稳定手势，请调整时间或选择智能定位。" };
    if (geometry.layout.mode !== "background") {
      const rect = contentRegion(geometry.reserved, position);
      // Project the hand's relative target into the generated-content pane.
      // Keep the source inset intact while making pointing left/right meaningful.
      const width = rect ? Math.min(.44, rect.width) : 0, height = rect ? Math.min(.5, rect.height) : 0;
      const target = cue.anchor ?? (gesture?.region ? { x: gesture.region.x + gesture.region.width / 2, y: gesture.region.y + gesture.region.height / 2 } : gesture ? gestureTarget(gesture, intent.time) : undefined);
      const placed = rect && target ? { x: rect.x + (rect.width - width) * target.x,
        y: rect.y + (rect.height - height) * target.y, width, height } : rect;
      return placed ? { ...cue, start: cue.end - start >= .5 ? start : cue.start, rect: placed, avoidance: "source", ...(gesture ? { gesture, binding: binding(placed, rect!, "content"), reason: "依据手势定位到内容区域，保留原视频位置。" } : {}) }
        : { ...cue, enabled: false, rect: null, reason: "当前版式没有足够内容区域，请调整原视频大小或位置。" };
    }
    const dimensions = [.32, .26, .2].flatMap(width => {
      const font = Math.min(geometry.width * .028, geometry.height * .045);
      const characters = Array.from(cue.text + (cue.detail ?? "") + (cue.items ?? []).join("")).length;
      const lines = Math.max(1, Math.ceil(characters * font / (geometry.width * width - font)));
      const height = Math.max(cue.kind === "chart" ? .3 : .16, (lines * font * 1.35 + font * 2.2) / geometry.height);
      return height <= .7 ? [{ width, height }] : [];
    });
    if (cue.anchor && dimensions[0]) {
      const { width, height } = dimensions[0], target = cue.anchor;
      return { ...cue, rect: { x: Math.max(.04, Math.min(.96 - width, geometry.source.x + target.x * geometry.source.width - width / 2)),
        y: Math.max(.06, Math.min(.82 - height, geometry.source.y + target.y * geometry.source.height - height / 2)), width, height }, avoidance: "gesture", reason: "已锁定手动校正的位置。" };
    }
    if (gesture) {
      for (const { width, height } of dimensions) {
        const point = gestureTarget(gesture, intent.time);
        const target = { x: geometry.source.x + point.x * geometry.source.width, y: geometry.source.y + point.y * geometry.source.height };
        const framed = gesture.region ? project(gesture.region) : undefined;
        const rect = { x: Math.max(.04, Math.min(.96 - width, framed ? framed.x + (framed.width - width) / 2 : target.x - width / 2)),
          y: Math.max(.06, Math.min(.82 - height, framed ? framed.y + (framed.height - height) / 2 : target.y - height * (behavior === "follow" ? 1 : .5))), width, height };
        if (cue.end - start < .5) continue;
        // Gesture placement explicitly permits overlap. Do not decode and union
        // every person-mask sample merely to compute an unused avoidance result.
        return { ...cue, start, rect, gesture, binding: binding(rect, { x: .04, y: .06, width: .92, height: .76 }, "source"), avoidance: "gesture", reason: "优先依据手势目标展示，此区域允许覆盖人物。" };
      }
    }
    if (cue.placement === "gesture") return { ...cue, enabled: false, rect: null, gesture: matches[0], reason: "手势位置无法容纳当前文案，请缩短文字。" };
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
    // Keep the bottom 18% free for original subtitles. Smaller cards are tried
    // only while their text still has a useful minimum font size.
    for (const { width, height } of dimensions) {
      for (const y of position === "top" ? [.06] : position === "bottom" ? [.82 - height] : [.08, .32, .55]) {
        const positions = position === "left" ? [.04] : position === "right" ? [.96 - width] : position === "center" ? [(1 - width) / 2] : [.04, .96 - width];
        for (const x of positions) {
          const rect = { x, y, width, height };
          if (y + height <= .82 && !protectedRect(rect)) return { ...cue, rect, avoidance };
        }
      }
    }
    return { ...cue, enabled: false, rect: null, reason: "展示时段没有足够空白区域，已跳过。" };
  });
}

/** Preserve measured word boundaries, punctuation and the last (open-ended) ASR chunk. */
export function enhancementTranscriptWords(chunks: { text: string; timestamp: [number | null, number | null] }[], duration: number): NonNullable<VideoEnhancementResult["words"]> {
  const words: NonNullable<VideoEnhancementResult["words"]> = [];
  for (let index = 0; index < chunks.length; index++) {
    const chunk = chunks[index]!;
    const text = chunk.text;
    const previous = words.at(-1);
    const start = Math.max(0, chunk.timestamp[0] ?? previous?.end ?? 0);
    const end = Math.min(duration, chunk.timestamp[1] ?? chunks[index + 1]?.timestamp[0] ?? duration);
    // An overlapping chunk can repeat old words or pin hallucinated text to
    // padded audio beyond the source. Neither is usable word-level evidence.
    if (!text.trim() || end <= start || start >= duration || (chunk.timestamp[1] !== null && chunk.timestamp[1] > duration + .15)
      || (previous && start < previous.end - .001)) continue;
    words.push({ text, start, end });
  }
  return words.slice(0, 6000);
}

/** Reject alignment failures before clipping would hide their invalid timestamps. */
export function enhancementTranscriptNeedsRecovery(chunks: Parameters<typeof enhancementTranscriptWords>[0], duration: number) {
  return chunks.some((chunk, index) => {
    const [start, end] = chunk.timestamp;
    return (start !== null && (start < 0 || start >= duration)) || (end !== null && end > duration + .15)
      || (start !== null && end !== null && end <= start)
      || (start !== null && index > 0 && start < (chunks[index - 1]!.timestamp[1] ?? 0) - .001);
  });
}

/** Keep the first reliable observation; fill missing windows from one bounded retry. */
export function mergeEnhancementTranscriptWords(primary: NonNullable<VideoEnhancementResult["words"]>, recovered: NonNullable<VideoEnhancementResult["words"]>) {
  return [...primary, ...recovered.filter(word => !primary.some(before => before.start < word.end - .001 && before.end > word.start + .001))]
    .sort((a, b) => a.start - b.start).slice(0, 6000);
}

export function enhancementTranscriptSegments(chunks: { text: string; timestamp: [number | null, number | null] }[], duration: number): VideoEnhancementResult["segments"] {
  const segments: VideoEnhancementResult["segments"] = [];
  for (const { text, start, end } of enhancementTranscriptWords(chunks, duration)) {
    const previous = segments.at(-1);
    if (previous && start - previous.end < .45 && end - previous.start <= 6 && previous.text.length + text.length <= 300
      && !/[。！？.!?]$/u.test(previous.text.trim())) {
      previous.text += text; previous.end = end;
    } else segments.push({ text, start, end });
  }
  return segments;
}

/** Group complete speech clauses into visual beats; never invent facts or numbers. */
export function buildEnhancementCues(segments: VideoEnhancementResult["segments"], duration: number, words?: VideoEnhancementResult["words"]): VideoEnhancementCue[] {
  const cues: VideoEnhancementCue[] = [];
  const beats: VideoEnhancementResult["segments"] = [];
  for (const segment of segments) {
    const text = segment.text.trim().replace(/^[，。！？、,.!?\s]+|[，。！？、,.!?\s]+$/gu, "");
    if (!text) continue;
    const previous = beats.at(-1);
    const marker = /^(?:第[一二三四五六七八九十]|首先|其次|最后|一是|二是|三是|总之|總之|总结|總結)/u;
    const placementSuffix = /^(?:数据|數據|图片|圖片|我|把|将|將|请|請|再|有|就|它|在)*(?:放|摆|擺|加|展示|显示|顯示).{0,12}(?:这里|這裡|这边|這邊|此处)/u.test(text);
    if (previous && segment.start - previous.end < 1 && (previous.end - previous.start < 3.5 || placementSuffix)
      && segment.end - previous.start <= (placementSuffix ? 12 : 10) && previous.text.length + text.length < 150 && !marker.test(text)) {
      previous.text += "，" + text; previous.end = segment.end;
    } else beats.push({ ...segment, text });
  }
  for (const beat of beats) {
    // Split only at measured punctuation. Whole clauses retain their meaning;
    // within one ASR segment their timing is estimated in proportion to text.
    const clauses = beat.text.match(/[^，,。！？!?；;]+[，,。！？!?；;]?/gu) ?? [beat.text];
    const groups: string[] = [];
    for (const clause of clauses) {
      const suffix = /^(?:数据|數據|图片|圖片|我|把|将|將|请|請|再|有|就|它|在)*(?:放|摆|擺|加|展示|显示|顯示).{0,12}(?:这里|這裡|这边|這邊|此处)/u.test(clause);
      if (groups.length && groups.at(-1)!.length + clause.length <= 150 && (suffix || !/这里|這裡|左边|右边|掌心|双手|对比|展开/u.test(clause))) groups[groups.length - 1] += clause;
      else groups.push(clause);
    }
    let offset = 0;
    for (const group of groups) {
      const estimatedStart = beat.start + (beat.end - beat.start) * offset / beat.text.length;
      offset += group.length;
      const estimatedEnd = Math.min(beat.end, duration, beat.start + (beat.end - beat.start) * offset / beat.text.length);
      const measured = words?.filter(word => word.start >= beat.start && word.end <= beat.end);
      const joined = measured?.map(word => word.text).join("");
      const clean = (value: string) => value.replace(/[，,。！？!?；;\s]/gu, "");
      let consumed = 0;
      const groupStart = clean(beat.text.slice(0, offset - group.length)).length;
      const aligned = joined && clean(joined) === clean(beat.text) ? measured?.filter(word => {
        const begin = consumed; consumed += clean(word.text).length;
        return consumed > groupStart && begin < groupStart + clean(group).length;
      }) : undefined;
      const start = Math.max(aligned?.[0]?.start ?? estimatedStart, cues.at(-1)?.end ?? 0);
      const end = aligned?.at(-1)?.end ?? estimatedEnd;
      const text = group.replace(/[，。！？、,.!?；;\s]+$/gu, "");
      if (text.length < 3 || text.length > 160 || end - start < .5) continue;
      const numeric = text.match(/(?:(?:负|負|正|[+−-])?\d+(?:[.,]\d+)*\s*(?:%|％|万|亿|元|倍|秒|分钟|小时|天|年)|(?:负|負)?百分之[零〇一二两三四五六七八九十百千万点\d]+)/u);
      const items = text.split(/[，,；;。]|(?=其次|然后|然後|最后|最後|第二|第三)/u).map(value => value.trim()).filter(value => value.length >= 3 && value.length <= 160);
      const list = /^(?:第[一二三四五六七八九十]|首先|其次|最后|一是|二是|三是)/u.test(text);
      const comparison = /不是.+而是|相比|对比|對比|versus|\bvs\b|instead of/iu.test(text);
      const summary = /^(?:总之|總之|总结|總結|记住|記住|关键是|關鍵是|in summary|remember)/iu.test(text);
      const sequence = list || /然后|然後|接着|接著|变成|變成|转换|轉換|first.+then/iu.test(text);
      const chartRequested = /数据图|数据表|图表|柱状图|折线图|饼图|\bchart\b/iu.test(text);
      const imageRequested = /图片|圖片|照片|插图|插圖|示意图|\b(?:image|photo|picture)\b/iu.test(text);
      const kind = chartRequested ? "chart" : numeric ? "number" : comparison ? "comparison" : summary ? "summary" : sequence ? items.length > 1 ? "steps" : "list" : items.length >= 3 ? "list" : "keyword";
      const title = kind === "chart" ? "数据图" : imageRequested ? "图片" : numeric?.[0] ?? (kind === "keyword" && items.length > 1 ? items[0]! : text);
      // Accept only explicitly labeled values of one unit. Never guess chart data.
      const values = chartRequested ? [...text.matchAll(/([\p{L}]{1,12})\s*[:：]\s*(-?\d+(?:\.\d+)?)\s*(%|％|万|亿|元|倍)?/gu)] : [];
      const chart = values.length && values.every(value => value[3] === values[0]![3]) ? values.slice(0, 4).map(value => ({ label: value[1]!, value: Number(value[2]) })) : undefined;
      cues.push({ id: `enhance-${cues.length + 1}`, kind, text: title, start, end, enabled: true,
        ...(chart ? { chart } : {}),
        ...(title !== text ? { detail: text } : {}), ...((kind === "steps" || kind === "comparison" || kind === "list") && items.length > 1 ? { items: items.slice(0, 4) } : {}) });
      if (cues.length >= 60) break;
    }
    if (cues.length >= 60) break;
  }
  // A reference can be the last word in the sentence. Keep its graphic visible
  // long enough to read instead of silently discarding a <.5s binding.
  return cues.map((cue, index) => {
    const intent = cueIntent(cue, words);
    return intent.explicit && cue.end - intent.time < .5
      ? { ...cue, end: Math.min(duration, cues[index + 1]?.start ?? duration, Math.max(cue.end, intent.time + 1.25)) } : cue;
  });
}

export function enhancementHtml(result: VideoEnhancementResult, mediaPath: string, previewGsap?: string) {
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const { width, height, source, layout } = enhancementGeometry(result);
  const cues = result.cues.filter(cue => cue.enabled && cue.rect);
  const card = (cue: VideoEnhancementResult["cues"][number]) => {
    const labels = { keyword: "讲述重点", number: "关键数字", list: "行动要点", steps: "步骤流程", comparison: "内容对比", quote: "金句强调", summary: "重点总结", chart: "数据图" };
    if (cue.kind === "chart") {
      const limit = Math.max(1, ...(cue.chart ?? []).map(point => Math.abs(point.value)));
      return `<p class="eyebrow">${labels.chart}</p><div class="headline">${escape(cue.text)}</div>${cue.chart?.length
        ? `<svg class="chart" viewBox="0 0 400 210" role="img" aria-label="${escape(cue.text)}">${cue.chart.map((point, index) => {
          const x = 16 + index * 380 / cue.chart!.length, w = 280 / cue.chart!.length, h = Math.abs(point.value) / limit * 72;
          return `<rect x="${x}" y="${point.value < 0 ? 100 : 100 - h}" width="${w}" height="${h}" fill="#9ddbcc"/><text x="${x}" y="${point.value < 0 ? 115 + h : 90 - h}" fill="#f4db79" font-size="16">${point.value}</text><text x="${x}" y="198" fill="#f4f7fb" font-size="14">${escape(point.label)}</text>`;
        }).join("")}<path d="M8 100H392" stroke="#c6d1df"/></svg>`
        : '<div class="chart-placeholder" role="img" aria-label="数据图占位，待补充数据"><span>▥</span><p>待补充数据</p></div>'}${cue.detail ? `<p class="detail">${escape(cue.detail)}</p>` : ""}`;
    }
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
<style>@font-face{font-family:"Enhancement Chinese";src:local("Microsoft YaHei"),local("PingFang SC"),local("Noto Sans CJK SC")}*{box-sizing:border-box}body{margin:0;background:#111c2a;font-family:"Enhancement Chinese",sans-serif}#enhanced-video{position:relative;width:${width}px;height:${height}px;overflow:hidden;background:#111c2a;color:#f4f7fb}#original-video{position:absolute;object-fit:contain;z-index:1;${layout.mode === "pip" ? "border-radius:18px;box-shadow:0 8px 36px #0005;" : ""}}.enhancement-card{position:absolute;z-index:2;padding:1.2em;border-radius:.65em;background:${layout.mode === "background" ? "rgba(17,28,42,.94)" : "#182638"};overflow:hidden;overflow-wrap:anywhere;display:flex;flex-direction:column;justify-content:center;line-height:1.45}.chart{width:100%;min-height:6em;flex:1;margin-top:.5em}.chart-placeholder{display:grid;place-items:center;border:1px dashed #9ddbcc66;border-radius:.5em;margin-top:1em;padding:.7em;color:#9ddbcc}.chart-placeholder span{font-size:2em}.chart-placeholder p{font-size:.65em;margin:.2em 0}.eyebrow{color:#9ddbcc;font-size:.56em;letter-spacing:.12em;margin:0 0 1em}.headline{font-weight:700;font-size:1em;line-height:1.35}.stat{color:#f4db79;font-size:2.5em;font-variant-numeric:tabular-nums;line-height:1.1}.quotation{border-left:.1em solid #9ddbcc;padding-left:.7em}.detail{font-size:.64em;line-height:1.7;color:#c6d1df;margin:1em 0 0}.items{display:grid;gap:.6em}.item{display:flex;align-items:center;gap:.7em;border-top:1px solid #ffffff20;padding-top:.6em;font-size:.7em}.item-index{flex-shrink:0;font-size:.65em;color:#9ddbcc}.comparison{grid-template-columns:1fr 1fr;gap:1em}.comparison .item{display:block;border-top:2px solid #9ddbcc}.comparison .item-index{display:block;margin-bottom:1em}.steps .item+.item::before{content:"↓";color:#9ddbcc;flex-shrink:0}.steps.wide{grid-template-columns:repeat(var(--columns),minmax(0,1fr));gap:1em}.steps.wide .item{position:relative;display:flex;flex-direction:column;align-items:flex-start;justify-content:center;min-width:0;border:0;border-radius:.5em;padding:1em;background:#22354b;font-size:.8em}.steps.wide .item-index{display:grid;place-items:center;width:2em;height:2em;border:1px solid #9ddbcc66;border-radius:50%}.steps.wide .item+.item::before{content:"→";position:absolute;left:-.9em;top:50%;transform:translateY(-50%)}</style></head>
<body><div id="enhanced-video" data-composition-id="enhanced-video" data-width="${width}" data-height="${height}" data-duration="${result.duration}" data-enhancement-layout="${layout.mode}">
<video id="original-video" class="clip" src="${escape(mediaPath)}" data-start="0" data-duration="${result.duration}" data-track-index="0" data-volume="1" data-has-audio="true" style="left:${source.x * 100}%;top:${source.y * 100}%;width:${source.width * 100}%;height:${source.height * 100}%" playsinline preload="auto"></video>
${cues.map(cue => {
  const rect = cue.rect!;
  const characters = (cue.text + (cue.detail ?? "") + (cue.items ?? []).join("")).length;
  const font = Math.min(rect.width * width / (characters > 100 ? 14 : 11), rect.height * height / (characters > 100 ? 10 : 6), height * .065);
    return `<div id="${cue.id}" class="clip enhancement-card" data-kind="${cue.kind}" data-binding="${cue.binding?.behavior ?? "manual"}" data-anchor-time="${cue.binding?.time ?? cue.start}" data-start="${cue.start}" data-duration="${cue.end - cue.start}" data-track-index="1" style="left:${rect.x * 100}%;top:${rect.y * 100}%;width:${rect.width * 100}%;height:${rect.height * 100}%;font-size:${font}px">${card(cue)}</div>`;
}).join("\n")}
</div><script>for(const card of document.querySelectorAll(".enhancement-card")){let font=parseFloat(card.style.fontSize);for(let step=0;step<24&&font>14&&(card.scrollHeight>card.clientHeight+1||card.scrollWidth>card.clientWidth+1);step++){font=Math.max(14,font*.92);card.style.fontSize=font+"px"}}window.__timelines=window.__timelines||{};const tl=gsap.timeline({paused:true});
${cues.map(cue => {
  const fade = `tl.fromTo("#${cue.id}",{opacity:0},{opacity:1,duration:.2,ease:"power2.out"},${cue.start});tl.to("#${cue.id}",{opacity:0,duration:.18,ease:"none"},${cue.end - .18});`;
  const path = cue.binding?.path ?? [];
  if (cue.binding?.behavior === "follow") return fade + path.slice(1).map((point, index) => {
    const before = path[index]!;
    return `tl.fromTo("#${cue.id}",{left:"${before.x * 100}%",top:"${before.y * 100}%"},{left:"${point.x * 100}%",top:"${point.y * 100}%",duration:${point.time - before.time},ease:"none",immediateRender:false},${before.time});`;
  }).join("");
  if (cue.binding?.behavior === "reveal") {
    const measured = cue.gesture?.path ?? [], first = measured[0], last = measured.at(-1);
    const dx = first && last ? last.x - first.x : 1, dy = first && last ? last.y - first.y : 0;
    const inset = Math.abs(dx) >= Math.abs(dy) ? dx >= 0 ? "0 100% 0 0" : "0 0 0 100%" : dy >= 0 ? "0 0 100% 0" : "100% 0 0 0";
    return fade + `tl.fromTo("#${cue.id}",{clipPath:"inset(${inset})"},{clipPath:"inset(0% 0% 0% 0%)",duration:${Math.max(.2, Math.min(cue.end - cue.start, (cue.gesture?.end ?? cue.start + .6) - cue.start))},ease:"none"},${cue.start});`;
  }
  return fade;
}).join("\n")}
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
