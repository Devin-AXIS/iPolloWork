import { describe, expect, test } from "bun:test";

const entryUrls = [
  new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
  new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
  new URL("../src/components/chat/new-conversation-starter.tsx", import.meta.url),
];

describe("PPTX-compatible template entry labels", () => {
  test("labels native-editable templates at every template selection entry point", async () => {
    for (const url of entryUrls) {
      const source = await Bun.file(url).text();
      expect(source).toContain("isPptxCompatibleTemplate");
      expect(source).toContain("PPTX-compatible");
    }
  });
});
