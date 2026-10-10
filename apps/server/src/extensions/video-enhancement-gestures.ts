import { join } from "node:path";
import type { VideoEnhancementGesture, VideoEnhancementRect } from "@ipollowork/types/video-enhancement";

type Point = { x: number; y: number };
type Hand = { box: VideoEnhancementRect; confidence: number; gesture: { kind: VideoEnhancementGesture["kind"]; target: Point } | null };
export type HandSample = { time: number; hands: Hand[] };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Geometric labels, not an interpretation of the speaker's intent. */
export function classifyEnhancementHand(points: Point[], width: number, height: number): Hand["gesture"] {
  if (points.length !== 21 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const p = points.map(point => ({ x: point.x * width, y: point.y * height }));
  const extended = [5, 9, 13, 17].map(base => {
    const mcp = p[base]!, pip = p[base + 1]!, tip = p[base + 3]!;
    const a = { x: pip.x - mcp.x, y: pip.y - mcp.y }, b = { x: tip.x - pip.x, y: tip.y - pip.y };
    return (a.x * b.x + a.y * b.y) / Math.max(1, Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) > .75
      && distance(tip, p[0]!) > distance(pip, p[0]!) * 1.15;
  });
  if (extended[0] && extended.slice(1).every(value => !value)) {
    const tip = p[8]!, joint = p[6]!, length = distance(tip, joint);
    if (length < Math.min(width, height) * .012) return null;
    const reach = Math.min(width, height) * .22;
    return { kind: "point", target: { x: clamp((tip.x + (tip.x - joint.x) / length * reach) / width),
      y: clamp((tip.y + (tip.y - joint.y) / length * reach) / height) } };
  }
  if (extended.every(Boolean)) {
    const center = [0, 5, 9, 13, 17].map(index => points[index]!);
    return { kind: "open_palm", target: { x: clamp(center.reduce((sum, point) => sum + point.x, 0) / center.length),
      y: clamp(Math.min(...points.map(point => point.y)) - .10) } };
  }
  return null;
}

/** Two adjacent 4-fps samples are required; motion/disappearance ends an event. */
export function buildEnhancementGestures(samples: HandSample[], duration: number): VideoEnhancementGesture[] {
  type Track = { kind: VideoEnhancementGesture["kind"]; start: number; last: number; confidence: number; target: Point; count: number };
  let active: Track[] = [];
  const complete: Track[] = [];
  for (const sample of samples) {
    const remaining = new Set(active);
    const next: Track[] = [];
    for (const hand of sample.hands) {
      if (!hand.gesture || hand.confidence < .8) continue;
      const gesture = hand.gesture;
      const previous = [...remaining].filter(track => track.kind === gesture.kind && sample.time - track.last <= .3
        && distance(track.target, gesture.target) < .16).sort((a, b) => distance(a.target, gesture.target) - distance(b.target, gesture.target))[0];
      if (previous) {
        remaining.delete(previous);
        next.push({ ...previous, last: sample.time, count: previous.count + 1,
          confidence: Math.min(previous.confidence, hand.confidence),
          target: { x: (previous.target.x * previous.count + gesture.target.x) / (previous.count + 1),
            y: (previous.target.y * previous.count + gesture.target.y) / (previous.count + 1) } });
      } else next.push({ kind: gesture.kind, start: sample.time, last: sample.time, confidence: hand.confidence, target: gesture.target, count: 1 });
    }
    complete.push(...remaining);
    active = next;
  }
  return [...complete, ...active].filter(track => track.count >= 2 && track.last - track.start >= .24)
    .sort((a, b) => a.start - b.start).slice(0, 120).map((track, index) => ({
      id: `gesture-${index + 1}`, kind: track.kind, start: Math.max(0, track.start - .125),
      end: Math.min(duration, track.last + .125), confidence: track.confidence, target: track.target,
    }));
}

/** MediaPipe ONNX models distributed by OpenCV Zoo (Apache-2.0).
 * Input normalization, SSD anchor layout and rotated 3x palm ROI follow:
 * https://github.com/opencv/opencv_zoo/tree/main/models/handpose_estimation_mediapipe
 * ONNX and image decoding are loaded only inside the bounded analysis child.
 */
export async function createEnhancementHandDetector(modelRoot: string) {
  const { InferenceSession, Tensor } = await import("onnxruntime-node");
  const sharp = (await import("sharp")).default;
  const options: import("onnxruntime-node").InferenceSession.SessionOptions = { executionProviders: ["cpu"], intraOpNumThreads: 2, interOpNumThreads: 1 };
  const directory = join(modelRoot, "opencv/opencv_zoo/models");
  const palm = await InferenceSession.create(join(directory, "palm_detection_mediapipe/palm_detection_mediapipe_2023feb.onnx"), options);
  let pose: import("onnxruntime-node").InferenceSession;
  try { pose = await InferenceSession.create(join(directory, "handpose_estimation_mediapipe/handpose_estimation_mediapipe_2023feb.onnx"), options); }
  catch (error) { await palm.release(); throw error; }
  const anchors: Point[] = [];
  for (const [size, copies] of [[24, 2], [12, 6]]) {
    for (let y = 0; y < size!; y++) for (let x = 0; x < size!; x++) {
      for (let index = 0; index < copies!; index++) anchors.push({ x: (x + .5) / size!, y: (y + .5) / size! });
    }
  }
  return {
    async detect(file: string): Promise<Hand[]> {
      const { data: rgb, info } = await sharp(file).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
      const width = info.width, height = info.height, scale = Math.max(width, height);
      const resizedWidth = Math.max(1, Math.floor(width * 192 / scale)), resizedHeight = Math.max(1, Math.floor(height * 192 / scale));
      const left = Math.floor((192 - resizedWidth) / 2), top = Math.floor((192 - resizedHeight) / 2);
      const resized = await sharp(rgb, { raw: { width, height, channels: 3 } }).resize(resizedWidth, resizedHeight).raw().toBuffer();
      const input = new Float32Array(192 * 192 * 3);
      for (let y = 0; y < resizedHeight; y++) for (let x = 0; x < resizedWidth; x++) for (let c = 0; c < 3; c++) {
        input[((y + top) * 192 + x + left) * 3 + c] = resized[(y * resizedWidth + x) * 3 + c]! / 255;
      }
      const outputs = await palm.run({ [palm.inputNames[0]!]: new Tensor("float32", input, [1, 192, 192, 3]) });
      const deltas = Object.values(outputs).find(value => value.dims.at(-1) === 18)?.data;
      const scores = Object.values(outputs).find(value => value.dims.at(-1) === 1)?.data;
      if (!deltas || !scores || scores.length !== anchors.length) throw new Error("Invalid local palm model outputs");
      type Palm = { score: number; rect: VideoEnhancementRect; points: Point[] };
      const candidates: Palm[] = [];
      for (let index = 0; index < anchors.length; index++) {
        const score = 1 / (1 + Math.exp(-Number(scores[index])));
        if (score < .65) continue;
        const anchor = anchors[index]!, offset = index * 18;
        const cx = (Number(deltas[offset]) / 192 + anchor.x) * scale - left * scale / 192;
        const cy = (Number(deltas[offset + 1]) / 192 + anchor.y) * scale - top * scale / 192;
        const w = Number(deltas[offset + 2]) / 192 * scale, h = Number(deltas[offset + 3]) / 192 * scale;
        if (![cx, cy, w, h].every(Number.isFinite) || w < 8 || h < 8) continue;
        candidates.push({ score, rect: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
          points: Array.from({ length: 7 }, (_, point) => ({
            x: (Number(deltas[offset + 4 + point * 2]) / 192 + anchor.x) * scale - left * scale / 192,
            y: (Number(deltas[offset + 5 + point * 2]) / 192 + anchor.y) * scale - top * scale / 192,
          })) });
      }
      const kept: Palm[] = [];
      for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
        const a = candidate.rect;
        if (kept.some(({ rect: b }) => {
          const intersection = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x))
            * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
          return intersection / (a.width * a.height + b.width * b.height - intersection) > .3;
        })) continue;
        kept.push(candidate);
        if (kept.length === 2) break;
      }
      const hands: Hand[] = [];
      for (const candidate of kept) {
        const wrist = candidate.points[0]!, middle = candidate.points[2]!, length = distance(wrist, middle);
        if (length < 2) continue;
        const up = { x: (middle.x - wrist.x) / length, y: (middle.y - wrist.y) / length }, right = { x: -up.y, y: up.x };
        const projected = candidate.points.map(point => ({ x: point.x * right.x + point.y * right.y, y: -point.x * up.x - point.y * up.y }));
        const minX = Math.min(...projected.map(p => p.x)), maxX = Math.max(...projected.map(p => p.x));
        const minY = Math.min(...projected.map(p => p.y)), maxY = Math.max(...projected.map(p => p.y));
        const side = Math.max(maxX - minX, maxY - minY) * 3;
        if (!Number.isFinite(side) || side < 12 || side > scale * 2) continue;
        const centerX = (minX + maxX) / 2, centerY = (minY + maxY) / 2 - .4 * (maxY - minY);
        const toImage = (x: number, y: number) => ({ x: right.x * x - up.x * y, y: right.y * x - up.y * y });
        const crop = new Float32Array(224 * 224 * 3);
        for (let y = 0; y < 224; y++) for (let x = 0; x < 224; x++) {
          const source = toImage(centerX + (x + .5 - 112) / 224 * side, centerY + (y + .5 - 112) / 224 * side);
          if (source.x < 0 || source.y < 0 || source.x >= width - 1 || source.y >= height - 1) continue;
          const sx = Math.floor(source.x), sy = Math.floor(source.y), dx = source.x - sx, dy = source.y - sy;
          for (let c = 0; c < 3; c++) crop[(y * 224 + x) * 3 + c] = (
            rgb[(sy * width + sx) * 3 + c]! * (1 - dx) * (1 - dy) + rgb[(sy * width + sx + 1) * 3 + c]! * dx * (1 - dy)
            + rgb[((sy + 1) * width + sx) * 3 + c]! * (1 - dx) * dy + rgb[((sy + 1) * width + sx + 1) * 3 + c]! * dx * dy) / 255;
        }
        const output = await pose.run({ [pose.inputNames[0]!]: new Tensor("float32", crop, [1, 224, 224, 3]) });
        const confidence = Number(output["Identity_1"]?.data[0]);
        const landmarks = output["Identity"]?.data;
        if (!landmarks || landmarks.length !== 63 || !Number.isFinite(confidence) || confidence < .8) continue;
        const points = Array.from({ length: 21 }, (_, index) => {
          const point = toImage(centerX + (Number(landmarks[index * 3]) - 112) / 224 * side,
            centerY + (Number(landmarks[index * 3 + 1]) - 112) / 224 * side);
          return { x: point.x / width, y: point.y / height };
        });
        if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
        const x = clamp(Math.min(...points.map(point => point.x)) - .015), y = clamp(Math.min(...points.map(point => point.y)) - .015);
        const w = clamp(Math.max(...points.map(point => point.x)) + .015) - x, h = clamp(Math.max(...points.map(point => point.y)) + .015) - y;
        if (w <= 0 || h <= 0) continue;
        hands.push({ box: { x, y, width: w, height: h }, confidence, gesture: classifyEnhancementHand(points, width, height) });
      }
      return hands;
    },
    async dispose() { try { await palm.release(); } finally { await pose.release(); } },
  };
}
