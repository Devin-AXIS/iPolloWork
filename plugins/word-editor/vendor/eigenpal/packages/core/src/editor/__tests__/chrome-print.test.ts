import { afterEach, expect, test } from 'bun:test';
import { ChromeExportError } from '../chrome-export.ts';
import {
  ChromePrintError,
  initialChromePrintSettings,
  isChromePrintShortcut,
  CHROME_PRINT_DISPLAY_MODES,
  runChromePrint,
} from '../chrome-print.ts';

const PDF = new TextEncoder().encode('%PDF-1.7\n');
const editor = { save: async () => new ArrayBuffer(1) };

afterEach(() => {
  for (const frame of document.querySelectorAll('[data-docx-print-frame]')) frame.remove();
});

/** Finish loading the hidden frame with a window that records print calls. */
function loadFrame(calls: string[]): HTMLIFrameElement {
  const frame = document.querySelector<HTMLIFrameElement>('[data-docx-print-frame]')!;
  const target = { focus: () => calls.push('focus'), print: () => calls.push('print') };
  Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => target });
  frame.dispatchEvent(new Event('load'));
  return frame;
}

test('a missing PDF handler fails before the document is saved', async () => {
  let saves = 0;
  const counting = {
    save: async () => {
      saves++;
      return new ArrayBuffer(0);
    },
  };
  await expect(runChromePrint(counting)).rejects.toBeInstanceOf(ChromeExportError);
  expect(saves).toBe(0);
});

test('print rejects the same invalid PDF output as export', async () => {
  await expect(
    runChromePrint(editor, { pdf: async () => ({ bytes: new TextEncoder().encode('<html>') }) })
  ).rejects.toThrow('without a PDF header');
});

test('print loads one hidden frame and prints the PDF from it', async () => {
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  expect(job.url).toStartWith('blob:');
  // Converting does not print. The frame appears only when printing starts.
  expect(document.querySelector('[data-docx-print-frame]')).toBeNull();

  const calls: string[] = [];
  const first = job.print();
  const frame = loadFrame(calls);
  await first;
  expect(frame.getAttribute('src')).toBe(job.url);
  expect(frame.getAttribute('aria-hidden')).toBe('true');
  expect(frame.style.visibility).toBe('hidden');
  expect(calls).toEqual(['focus', 'print']);

  // A second print reuses the loaded frame.
  await job.print();
  expect(document.querySelectorAll('[data-docx-print-frame]')).toHaveLength(1);
  expect(calls).toEqual(['focus', 'print', 'focus', 'print']);

  job.dispose();
  expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
  await expect(job.print()).rejects.toMatchObject({ code: 'print-ended' });
});

test('a browser without a PDF viewer gets no frame, so it downloads nothing', async () => {
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  Object.defineProperty(navigator, 'pdfViewerEnabled', { configurable: true, value: false });
  try {
    const error = await job.print().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(ChromePrintError);
    expect((error as ChromePrintError).code).toBe('pdf-viewer-unavailable');
    expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
    // The PDF stays available for the Open PDF fallback until the job ends.
    expect(job.url).toStartWith('blob:');
  } finally {
    delete (navigator as { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
    job.dispose();
  }
});

test('disposing while the frame loads ends the pending print', async () => {
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  const pending = job.print();
  expect(document.querySelector('[data-docx-print-frame]')).not.toBeNull();
  job.dispose();
  await expect(pending).rejects.toMatchObject({ code: 'print-ended' });
  expect(document.querySelector('[data-docx-print-frame]')).toBeNull();
});

test('a refused print call reports a coded error', async () => {
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  const pending = job.print();
  const frame = document.querySelector<HTMLIFrameElement>('[data-docx-print-frame]')!;
  const target = {
    focus: () => undefined,
    print: () => {
      throw new Error('Permission denied to access property "print"');
    },
  };
  Object.defineProperty(frame, 'contentWindow', { configurable: true, get: () => target });
  frame.dispatchEvent(new Event('load'));
  await expect(pending).rejects.toMatchObject({ code: 'print-refused' });
  job.dispose();
});

test('a frame that never loads fails, and the next print starts a new frame', async () => {
  const timers: (() => void)[] = [];
  const original = window.setTimeout;
  // Capture only the 15-second load timeout; every other timer runs normally.
  window.setTimeout = ((callback: () => void, delay?: number) => {
    if (delay !== 15_000) return original(callback, delay);
    timers.push(callback);
    return 0;
  }) as unknown as typeof window.setTimeout;
  try {
    const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
    const first = job.print();
    const stale = document.querySelector('[data-docx-print-frame]');
    timers.at(-1)!();
    await expect(first).rejects.toMatchObject({ code: 'pdf-load-failed' });
    expect(document.querySelector('[data-docx-print-frame]')).toBeNull();

    const calls: string[] = [];
    const second = job.print();
    const frame = loadFrame(calls);
    await second;
    expect(frame).not.toBe(stale);
    expect(calls).toEqual(['focus', 'print']);
    job.dispose();
  } finally {
    window.setTimeout = original;
  }
});

test('the print shortcut is Cmd+P on Apple platforms and Ctrl+P elsewhere', () => {
  const press = (platform: string, keys: Partial<KeyboardEvent>) => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: platform });
    try {
      return isChromePrintShortcut({
        key: 'p',
        code: 'KeyP',
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        metaKey: false,
        ...keys,
      } as KeyboardEvent);
    } finally {
      delete (navigator as { platform?: string }).platform;
    }
  };
  expect(press('MacIntel', { metaKey: true })).toBe(true);
  // Ctrl+P moves the caret up one line on macOS.
  expect(press('MacIntel', { ctrlKey: true })).toBe(false);
  expect(press('Win32', { ctrlKey: true })).toBe(true);
  expect(press('Win32', { metaKey: true })).toBe(false);
  expect(press('Linux x86_64', { ctrlKey: true, key: 'P' })).toBe(true);
  // A Russian layout types "з" on the P key.
  expect(press('Win32', { ctrlKey: true, key: 'з' })).toBe(true);
  expect(press('Win32', { ctrlKey: true, shiftKey: true })).toBe(false);
  expect(press('Win32', { ctrlKey: true, key: 's', code: 'KeyS' })).toBe(false);
  // Dvorak types "l" on the P key, and Ctrl+L belongs to that letter.
  expect(press('Win32', { ctrlKey: true, key: 'l' })).toBe(false);
  expect(press('Win32', { ctrlKey: true, key: undefined })).toBe(false);
});

test('a frame that loads without a window fails, and the next print starts a new frame', async () => {
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  const first = job.print();
  const stale = document.querySelector<HTMLIFrameElement>('[data-docx-print-frame]')!;
  Object.defineProperty(stale, 'contentWindow', { configurable: true, get: () => null });
  stale.dispatchEvent(new Event('load'));
  await expect(first).rejects.toMatchObject({ code: 'pdf-load-failed' });
  expect(stale.isConnected).toBe(false);

  const calls: string[] = [];
  const second = job.print();
  loadFrame(calls);
  await second;
  expect(calls).toEqual(['focus', 'print']);
  job.dispose();
});

test('focus returns to the page after printing', async () => {
  const button = document.createElement('button');
  document.body.append(button);
  button.focus();
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  const pending = job.print();
  loadFrame([]);
  await pending;
  expect(document.activeElement).toBe(button);
  job.dispose();
  button.remove();
});

test('beforePrint runs after the PDF loads and before the print dialog opens', async () => {
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) });
  const calls: string[] = [];
  const pending = job.print({ beforePrint: () => void calls.push('before') });
  expect(calls).toEqual([]);
  loadFrame(calls);
  await pending;
  expect(calls).toEqual(['before', 'focus', 'print']);
  job.dispose();
});

test('the print frame goes into the given container', async () => {
  const container = document.createElement('div');
  document.body.append(container);
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: PDF }) }, container);
  const pending = job.print();
  const frame = loadFrame([]);
  await pending;
  expect(frame.parentElement).toBe(container);
  job.dispose();
  container.remove();
});

test('PDF bytes in shared memory still print', async () => {
  const shared = new Uint8Array(new SharedArrayBuffer(PDF.length));
  shared.set(PDF);
  const job = await runChromePrint(editor, { pdf: async () => ({ bytes: shared }) });
  expect(job.url).toStartWith('blob:');
  job.dispose();
});

test('print settings start from the current view with comments shown', () => {
  expect(initialChromePrintSettings({ reviewDisplayMode: 'all-markup' })).toEqual({
    displayMode: 'all-markup',
    comments: true,
  });
  // Comments print in every mode: as a pane in All Markup, as annotations elsewhere.
  expect(initialChromePrintSettings({ reviewDisplayMode: 'original' })).toEqual({
    displayMode: 'original',
    comments: true,
  });
  expect(initialChromePrintSettings(null)).toEqual({ displayMode: 'proposed', comments: true });
  // The form lists the modes in Review menu order.
  expect(CHROME_PRINT_DISPLAY_MODES.map(({ mode }) => mode)).toEqual([
    'simple-markup',
    'all-markup',
    'proposed',
    'original',
  ]);
});
