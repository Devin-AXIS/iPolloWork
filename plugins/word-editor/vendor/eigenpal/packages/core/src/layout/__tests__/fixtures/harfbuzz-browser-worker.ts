const request = { family: 'DejaVu Sans', weight: 400, style: 'normal' } as const;

globalThis.postMessage({ status: 'ready', parity: null, error: null });

globalThis.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const {
      FontResolutionError,
      createFontResourceSnapshot,
      harfBuzzFontValidator,
      sha256FontBytes,
    } = await import('../../index.ts');
    const { createHarfBuzzParityValue } = await import('./harfbuzz-parity-fixture.ts');
    const bytes = new Uint8Array(event.data);
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
    globalThis.postMessage({
      status: 'complete',
      parity: createHarfBuzzParityValue(font),
      error: null,
    });
  } catch (error) {
    globalThis.postMessage({
      status: 'complete',
      parity: null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
  }
};
