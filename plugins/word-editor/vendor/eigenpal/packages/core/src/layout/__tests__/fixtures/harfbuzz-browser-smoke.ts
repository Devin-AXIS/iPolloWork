import {
  FontResolutionError,
  createFontResourceSnapshot,
  harfBuzzFontValidator,
  sha256FontBytes,
  type FontRequest,
} from '../../index.ts';
import { createHarfBuzzParityValue, type HarfBuzzParityValue } from './harfbuzz-parity-fixture.ts';
import { HARFBUZZ_PARITY_GOLDEN_JSON } from './harfbuzz-parity-golden.ts';
const request: FontRequest = { family: 'DejaVu Sans', weight: 400, style: 'normal' };
document.body.dataset.status = 'loading-font';

const bytes = new Uint8Array(
  await fetch(new URL('./fonts/DejaVuSans.ttf', import.meta.url)).then((response) =>
    response.arrayBuffer()
  )
);
const snapshot = createFontResourceSnapshot({
  epoch: 1,
  maxFontBytes: 2_000_000,
  resources: [
    {
      request,
      id: 'dejavu-sans-regular',
      bytes,
      hash: sha256FontBytes(bytes),
      faceIndex: 0,
    },
  ],
  validateFont: harfBuzzFontValidator,
});
const font = snapshot.resolve(request);
if (font instanceof FontResolutionError) throw font;
document.body.dataset.status = 'shaping-main';
const mainParity = createHarfBuzzParityValue(font);
document.body.dataset.status = 'shaping-worker';

const worker = new Worker(new URL('./harfbuzz-browser-worker.ts', import.meta.url), {
  type: 'module',
});
const workerResult = await new Promise<{
  status: 'complete';
  parity: HarfBuzzParityValue | null;
  error: string | null;
}>((resolve, reject) => {
  worker.onmessage = (event) => {
    if (event.data.status === 'ready') {
      const transferred = bytes.slice();
      worker.postMessage(transferred.buffer, [transferred.buffer]);
    } else {
      resolve(event.data);
    }
  };
  worker.onerror = reject;
});
worker.terminate();
const mainJson = JSON.stringify(mainParity);
const workerJson = JSON.stringify(workerResult.parity);
document.body.dataset.status = 'complete';
document.body.dataset.result =
  mainJson === HARFBUZZ_PARITY_GOLDEN_JSON &&
  workerJson === HARFBUZZ_PARITY_GOLDEN_JSON &&
  workerResult.error === null
    ? 'pass'
    : 'fail';
