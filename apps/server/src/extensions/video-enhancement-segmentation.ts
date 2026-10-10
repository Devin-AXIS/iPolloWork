import { join } from "node:path";
import { VIDEO_ENHANCEMENT_MASK_SIZE as SIZE, type VideoEnhancementMask, type VideoEnhancementRect } from "@ipollowork/types/video-enhancement";

const encode = (cells: Uint8Array) => Array.from({ length: cells.length / 4 }, (_, index) =>
  (cells[index * 4]! * 8 + cells[index * 4 + 1]! * 4 + cells[index * 4 + 2]! * 2 + cells[index * 4 + 3]!).toString(16)).join("");
const decode = (data: string) => Uint8Array.from({ length: SIZE * SIZE }, (_, index) =>
  Number.parseInt(data[Math.floor(index / 4)]!, 16) >> (3 - index % 4) & 1);

/** Keep uncertain edges (>=35% person probability), pool by maximum, never average them away. */
export function buildEnhancementMask(probabilities: ArrayLike<number>, width: number, height: number, boxes: VideoEnhancementRect[]): string | null {
  if (probabilities.length !== width * height || !boxes.length) return null;
  const cells = new Uint8Array(SIZE * SIZE);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = probabilities[y * width + x]!;
    if (!Number.isFinite(p) || p < 0 || p > 1) return null;
    if (p >= .35) cells[Math.floor(y * SIZE / height) * SIZE + Math.floor(x * SIZE / width)] = 1;
  }
  const occupied = cells.reduce((sum, cell) => sum + cell, 0);
  if (occupied < SIZE * SIZE * .005 || occupied > SIZE * SIZE * .9) return null;
  // A missed person, head or limb must not open up its entire detection box.
  for (const box of boxes) {
    let covered = 0, total = 0;
    for (let y = Math.floor(box.y * SIZE); y < Math.min(SIZE, Math.ceil((box.y + box.height) * SIZE)); y++) {
      for (let x = Math.floor(box.x * SIZE); x < Math.min(SIZE, Math.ceil((box.x + box.width) * SIZE)); x++) { covered += cells[y * SIZE + x]!; total++; }
    }
    if (covered < total * .15) return null;
  }
  return encode(cells);
}

/** Build one union for the whole display window; cards stay still as the person moves. */
export function enhancementMaskProtection(masks: VideoEnhancementMask[], start: number, end: number) {
  const samples = masks.filter(mask => mask.time >= Math.max(0, start - .25) && mask.time <= end + .25);
  if (!samples.length || samples[0]!.time > start + .26 || samples.at(-1)!.time < end - .26) return null;
  const union = new Uint8Array(SIZE * SIZE);
  let previous: Uint8Array | undefined;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    if (!sample.data || index > 0 && sample.time - samples[index - 1]!.time > .26) return null;
    const cells = decode(sample.data);
    if (previous) {
      let intersection = 0, total = 0;
      for (let cell = 0; cell < cells.length; cell++) { intersection += cells[cell]! & previous[cell]!; total += cells[cell]! | previous[cell]!; }
      // Rapid motion / changing silhouette uses conservative swept boxes.
      if (!total || intersection / total < .65) return null;
    }
    for (let cell = 0; cell < cells.length; cell++) union[cell] |= cells[cell]!;
    previous = cells;
  }
  const stride = SIZE + 1, sums = new Uint16Array(stride * stride);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
    sums[(y + 1) * stride + x + 1] = union[y * SIZE + x]! + sums[y * stride + x + 1]! + sums[(y + 1) * stride + x]! - sums[y * stride + x]!;
  }
  return (rect: VideoEnhancementRect) => {
    const left = Math.max(0, Math.floor((rect.x - .035) * SIZE)), top = Math.max(0, Math.floor((rect.y - .035) * SIZE));
    const right = Math.min(SIZE, Math.ceil((rect.x + rect.width + .035) * SIZE)), bottom = Math.min(SIZE, Math.ceil((rect.y + rect.height + .035) * SIZE));
    return sums[bottom * stride + right]! - sums[top * stride + right]! - sums[bottom * stride + left]! + sums[top * stride + left]! > 0;
  };
}

/** Official OpenCV Zoo PPHumanSeg: RGB, [-1,1], NCHW 192x192; two probability planes.
 * https://github.com/opencv/opencv_zoo/blob/main/models/human_segmentation_pphumanseg/pphumanseg.py
 * Uses existing CPU ONNX/Sharp only inside the offline analysis child.
 */
export async function createEnhancementSegmenter(modelRoot: string) {
  const { InferenceSession, Tensor } = await import("onnxruntime-node");
  const sharp = (await import("sharp")).default;
  const session = await InferenceSession.create(join(modelRoot, "opencv/opencv_zoo/models/human_segmentation_pphumanseg/human_segmentation_pphumanseg_2023mar.onnx"),
    { executionProviders: ["cpu"], intraOpNumThreads: 2, interOpNumThreads: 1 });
  return {
    async segment(file: string, boxes: VideoEnhancementRect[]) {
      const rgb = await sharp(file).removeAlpha().toColourspace("srgb").resize(192, 192, { fit: "fill" }).raw().toBuffer();
      const input = new Float32Array(3 * 192 * 192);
      for (let pixel = 0; pixel < 192 * 192; pixel++) for (let channel = 0; channel < 3; channel++) input[channel * 192 * 192 + pixel] = rgb[pixel * 3 + channel]! / 127.5 - 1;
      const output = await session.run({ [session.inputNames[0]!]: new Tensor("float32", input, [1, 3, 192, 192]) });
      const result = output[session.outputNames[0]!]!;
      if (result.dims.join(",") !== "1,2,192,192" || !(result.data instanceof Float32Array)) throw new Error("Invalid local segmentation output");
      return buildEnhancementMask(result.data.subarray(192 * 192), 192, 192, boxes);
    },
    dispose() { return session.release(); },
  };
}
