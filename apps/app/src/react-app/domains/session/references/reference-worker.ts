import { extractTableReference } from "./extractors/table";
import { extractTextReference } from "./extractors/text";

// Large text/table parsing runs off the renderer thread; no network or model calls.
self.onmessage = async (event: MessageEvent<{ file: File; table: boolean }>) => {
  try {
    const result = await (event.data.table ? extractTableReference(event.data.file) : extractTextReference(event.data.file));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
