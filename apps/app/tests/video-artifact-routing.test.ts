import { describe, expect, test } from "bun:test";

const messageListUrl = new URL("../src/components/chat/message-list.tsx", import.meta.url);
const sessionSurfaceUrl = new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url);
const sessionPageUrl = new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url);

describe("Video artifact routing", () => {
  test("keeps inline video artifacts on the Video Studio path", async () => {
    const messageListSource = await Bun.file(messageListUrl).text();
    const sessionSurfaceSource = await Bun.file(sessionSurfaceUrl).text();
    const sessionPageSource = await Bun.file(sessionPageUrl).text();

    expect(messageListSource).toContain("<ArtifactList messages={[message]} onOpenDesignStudio={onOpenDesignStudio} onOpenVideoStudio={onOpenVideoStudio} />");
    expect(messageListSource).toContain("onOpenDesignStudio={onOpenDesignStudio}");
    expect(messageListSource).toContain("onOpenVideoStudio={onOpenVideoStudio}");
    expect(sessionSurfaceSource).toContain("onOpenDesignStudio?: () => void;");
    expect(sessionSurfaceSource).toContain("onOpenDesignStudio={props.onOpenDesignStudio}");
    expect(sessionSurfaceSource).toContain("onOpenVideoStudio?: () => void;");
    expect(sessionSurfaceSource).toContain("onOpenVideoStudio={props.onOpenVideoStudio}");
    expect(sessionPageSource).toContain("onOpenVideoStudio={openCurrentVideoStudio}");
  });
});
