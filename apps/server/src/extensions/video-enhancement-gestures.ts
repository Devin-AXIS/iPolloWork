import { join } from "node:path";
import { VIDEO_ENHANCEMENT_GESTURE_FPS, VIDEO_ENHANCEMENT_MAX_GESTURES, type VideoEnhancementGesture, type VideoEnhancementRect } from "@ipollowork/types/video-enhancement";

type Point = { x: number; y: number };
type SpatialPoint = Point & { z: number };
type Hand = { box: VideoEnhancementRect; confidence: number; handedness?: VideoEnhancementGesture["handedness"]; gesture: { kind: VideoEnhancementGesture["kind"]; target: Point; motion?: "support" } | null };
export type HandSample = { time: number; hands: Hand[] };
const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Geometric labels, not an interpretation of the speaker's intent. */
export function classifyEnhancementHand(points: Point[], width: number, height: number, world?: SpatialPoint[]): Hand["gesture"] {
  if (points.length !== 21 || width <= 0 || height <= 0 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;
  const p = points.map(point => ({ x: point.x * width, y: point.y * height }));
  const spatial = world?.length === 21 && world.every(point => [point.x, point.y, point.z].every(Number.isFinite));
  const joints = spatial ? world! : p.map(point => ({ ...point, z: 0 }));
  const distance3 = (a: SpatialPoint, b: SpatialPoint) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const extended = [5, 9, 13, 17].map(base => {
    const mcp = joints[base]!, pip = joints[base + 1]!, tip = joints[base + 3]!;
    const a = { x: pip.x - mcp.x, y: pip.y - mcp.y, z: pip.z - mcp.z }, b = { x: tip.x - pip.x, y: tip.y - pip.y, z: tip.z - pip.z };
    return (a.x * b.x + a.y * b.y + a.z * b.z) / Math.max(1e-9, Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z)) > .75
      && distance3(tip, joints[0]!) > distance3(pip, joints[0]!) * 1.15;
  });
  const fingers = [5, 9, 13, 17].filter((_, index) => extended[index]);
  const project = (kind: VideoEnhancementGesture["kind"], tip: Point, direction: Point, reach: number): Hand["gesture"] => {
    const length = Math.hypot(direction.x, direction.y);
    if (length < Math.min(width, height) * .012) return null;
    return { kind, target: { x: clamp((tip.x + direction.x / length * reach) / width),
      y: clamp((tip.y + direction.y / length * reach) / height) } };
  };
  if (fingers.length) {
    if (fingers.length === 4 && spatial) {
      const wrist = joints[0]!, index = joints[5]!, little = joints[17]!;
      const a = { x: index.x - wrist.x, y: index.y - wrist.y, z: index.z - wrist.z };
      const b = { x: little.x - wrist.x, y: little.y - wrist.y, z: little.z - wrist.z };
      const normal = { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
      const length = Math.hypot(normal.x, normal.y, normal.z);
      // A horizontal palm plane is evidence for support, not a claim about intent.
      if (length > 1e-9 && Math.abs(normal.y) / length > .7) {
        const center = [0, 5, 9, 13, 17].reduce((sum, i) => ({ x: sum.x + points[i]!.x / 5, y: sum.y + points[i]!.y / 5 }), { x: 0, y: 0 });
        return { kind: "open_palm", motion: "support", target: { x: clamp(center.x), y: clamp(center.y - .025) } };
      }
    }
    const average = (offset: number) => ({ x: fingers.reduce((sum, base) => sum + p[base + offset]!.x, 0) / fingers.length,
      y: fingers.reduce((sum, base) => sum + p[base + offset]!.y, 0) / fingers.length });
    const tip = average(3), joint = average(1), direction = { x: tip.x - joint.x, y: tip.y - joint.y };
    // Several raised fingers must share a direction; crossed/divergent fingers
    // do not establish a pointing target. An open palm uses its full fan axis.
    if (fingers.length < 4 && fingers.some(base => {
      const a = { x: p[base + 3]!.x - p[base + 1]!.x, y: p[base + 3]!.y - p[base + 1]!.y };
      return (a.x * direction.x + a.y * direction.y) / Math.max(1, Math.hypot(a.x, a.y) * Math.hypot(direction.x, direction.y)) < .7;
    })) return null;
    const kind = fingers.length === 4 ? "open_palm" : fingers.length === 3 ? "three_finger_point" : fingers.length === 2 ? "two_finger_point" : "point";
    return project(kind, tip, direction, Math.min(width, height) * (kind === "open_palm" ? .10 : .22));
  }
  const a = { x: p[3]!.x - p[2]!.x, y: p[3]!.y - p[2]!.y }, b = { x: p[4]!.x - p[3]!.x, y: p[4]!.y - p[3]!.y };
  if ((a.x * b.x + a.y * b.y) / Math.max(1, Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y)) > .8
    && distance(p[4]!, p[0]!) > distance(p[3]!, p[0]!) * 1.15
    && distance(p[4]!, p[5]!) > distance(p[5]!, p[17]!) * .65) {
    return project("thumb_point", p[4]!, { x: p[4]!.x - p[2]!.x, y: p[4]!.y - p[2]!.y }, Math.min(width, height) * .18);
  }
  return null;
}

/** Track hands one-to-one, retain a bounded smoothed path, and reject jumps/dropouts. */
export function buildEnhancementGestures(samples: HandSample[], duration: number): VideoEnhancementGesture[] {
  type Track = { kind: VideoEnhancementGesture["kind"]; start: number; last: number; confidence: number; target: Point; center: Point; count: number;
    handId: string; handedness: VideoEnhancementGesture["handedness"]; support: number; path: { time: number; x: number; y: number }[] };
  let active: Track[] = [];
  const complete: Track[] = [];
  let nextId = 1;
  for (const sample of samples) {
    const remaining = new Set(active);
    const next: Track[] = [];
    for (const hand of sample.hands) {
      if (!hand.gesture || hand.confidence < .65) continue;
      const gesture = hand.gesture;
      const center = { x: hand.box.x + hand.box.width / 2, y: hand.box.y + hand.box.height / 2 };
      const previous = [...remaining].filter(track => track.kind === gesture.kind && sample.time - track.last <= .3
        && (hand.handedness === undefined || hand.handedness === "unknown" || track.handedness === "unknown" || track.handedness === hand.handedness)
        && distance(track.target, gesture.target) < .18 && distance(track.center, center) < .18)
        .sort((a, b) => distance(a.center, center) - distance(b.center, center))[0];
      if (previous) {
        remaining.delete(previous);
        const target = { x: previous.target.x * .4 + gesture.target.x * .6, y: previous.target.y * .4 + gesture.target.y * .6 };
        const path = [...previous.path];
        if (sample.time - path.at(-1)!.time >= .25 - .001) path.push({ ...target, time: sample.time });
        next.push({ ...previous, last: sample.time, count: previous.count + 1,
          confidence: (previous.confidence * previous.count + hand.confidence) / (previous.count + 1),
          target, center, path, support: previous.support + Number(gesture.motion === "support") });
      } else if (hand.confidence >= .8) next.push({ kind: gesture.kind, start: sample.time, last: sample.time, confidence: hand.confidence,
        target: gesture.target, center, count: 1, handId: `hand-${nextId++}`, handedness: hand.handedness ?? "unknown",
        support: Number(gesture.motion === "support"), path: [{ ...gesture.target, time: sample.time }] });
    }
    for (const track of remaining) {
      if (sample.time - track.last <= .3) next.push(track);
      else complete.push(track);
    }
    active = next;
  }
  const frame = 1 / VIDEO_ENHANCEMENT_GESTURE_FPS;
  return [...complete, ...active].filter(track => track.count >= 2 && track.last - track.start >= frame - .001)
    .sort((a, b) => a.start - b.start).slice(0, VIDEO_ENHANCEMENT_MAX_GESTURES).map((track, index) => {
      const path = track.path.at(-1)!.time < track.last ? [...track.path, { ...track.target, time: track.last }] : track.path;
      const first = path[0]!, last = path.at(-1)!;
      const travel = path.slice(1).reduce((sum, point, i) => sum + distance(point, path[i]!), 0);
      const guide = track.kind === "open_palm" && track.last - track.start >= .4 && distance(first, last) > .12 && distance(first, last) / Math.max(.001, travel) > .75;
      return { id: `gesture-${index + 1}`, kind: track.kind, start: Math.max(0, track.start - frame),
        end: Math.min(duration, track.last + frame), confidence: track.confidence, target: track.target,
        handId: track.handId, handedness: track.handedness, path,
        motion: guide ? "guide" : track.support / track.count > .65 ? "support" : "hold" };
    });
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
  let searchWindow: VideoEnhancementRect | null = null;
  let sampleIndex = 0;
  return {
    async detect(file: string): Promise<Hand[]> {
      const { data: rgb, info } = await sharp(file).removeAlpha().toColourspace("srgb").raw().toBuffer({ resolveWithObject: true });
      const infer = async (rgb: Buffer, width: number, height: number, viewport = { x: 0, y: 0, width: 1, height: 1 }): Promise<Hand[]> => {
        const scale = Math.max(width, height);
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
          const spatial = output["Identity_3"]?.data;
          const sideScore = Number(output["Identity_2"]?.data[0]);
          if (!landmarks || landmarks.length !== 63 || !Number.isFinite(confidence) || confidence < .65) continue;
          const points = Array.from({ length: 21 }, (_, index) => {
            const point = toImage(centerX + (Number(landmarks[index * 3]) - 112) / 224 * side,
              centerY + (Number(landmarks[index * 3 + 1]) - 112) / 224 * side);
            return { x: point.x / width, y: point.y / height };
          });
          if (points.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
          const x = clamp(Math.min(...points.map(point => point.x)) - .015), y = clamp(Math.min(...points.map(point => point.y)) - .015);
          const w = clamp(Math.max(...points.map(point => point.x)) + .015) - x, h = clamp(Math.max(...points.map(point => point.y)) + .015) - y;
          if (w <= 0 || h <= 0) continue;
          const absolutePoints = points.map(point => ({ x: viewport.x + point.x * viewport.width, y: viewport.y + point.y * viewport.height }));
          const world = spatial?.length === 63 ? Array.from({ length: 21 }, (_, index) => {
            const x = Number(spatial[index * 3]), y = Number(spatial[index * 3 + 1]);
            return { x: right.x * x - up.x * y, y: right.y * x - up.y * y, z: Number(spatial[index * 3 + 2]) };
          }) : undefined;
          hands.push({ box: { x, y, width: w, height: h }, confidence,
            handedness: sideScore >= .8 ? "right" : sideScore <= .2 ? "left" : "unknown",
            gesture: classifyEnhancementHand(absolutePoints, width / viewport.width, height / viewport.height, world) });
        }
        return hands;
      };
      const width = info.width, height = info.height, sample = sampleIndex++;
      const inferWindow = async (rect: VideoEnhancementRect) => {
        const left = Math.floor(rect.x * width), top = Math.floor(rect.y * height);
        const w = Math.min(width - left, Math.ceil(rect.width * width)), h = Math.min(height - top, Math.ceil(rect.height * height));
        const crop = await sharp(rgb, { raw: { width, height, channels: 3 } }).extract({ left, top, width: w, height: h }).raw().toBuffer();
        return (await infer(crop, w, h, { x: left / width, y: top / height, width: w / width, height: h / height })).map(hand => ({ ...hand,
          box: { x: (left + hand.box.x * w) / width, y: (top + hand.box.y * h) / height, width: hand.box.width * w / width, height: hand.box.height * h / height },
        }));
      };
      // Reuse a successful close view; reset once per second to reacquire hands
      // outside it. Small/distant hands otherwise vanish in the 192px full frame.
      if (searchWindow && sample % VIDEO_ENHANCEMENT_GESTURE_FPS !== 0) {
        const hands = await inferWindow(searchWindow);
        if (hands.length) return hands;
        searchWindow = null;
      }
      const hands = await infer(rgb, width, height);
      if (hands.length || sample % 4 !== 0) return hands;
      // Bounded multiscale recovery on missed frames, using the same local models.
      // Square close views remove letterbox loss on portrait/landscape video.
      // At most four probes, only once per four missed samples.
      const square = width === height;
      const side = Math.min(width, height) * (square ? .75 : 1);
      const offsets = (size: number) => size === side ? [0] : square ? [0, (size - side) / size] : [0, (size - side) / size / 2, (size - side) / size];
      for (const y of offsets(height)) for (const x of offsets(width)) {
        const rect = { x, y, width: side / width, height: side / height };
        const recovered = await inferWindow(rect);
        if (recovered.length) { searchWindow = rect; return recovered; }
      }
      return [];
    },
    async dispose() { try { await palm.release(); } finally { await pose.release(); } },
  };
}
