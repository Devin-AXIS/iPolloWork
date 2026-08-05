import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const studioSource = readFileSync(
  new URL("../../../vendor/hyperframes/packages/studio/src/components/sidebar/BlocksTab.tsx", import.meta.url),
  "utf8",
);
const videoPanelSource = readFileSync(
  new URL("../src/react-app/domains/session/video/video-panel.tsx", import.meta.url),
  "utf8",
);
const surfaceSource = readFileSync(
  new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
  "utf8",
);

describe("Video Studio animation reference handoff", () => {
  test("Ask AI sends a structured animation reference instead of opening a prompt modal", () => {
    expect(studioSource).toContain('type: "ipollowork:hyperframes:animation-reference"');
    expect(studioSource).toContain("agentPrompt: prompt");
    expect(studioSource).not.toContain("PromptPreviewModal");
  });

  test("the host turns the Studio reference into a hidden composer animation tag", () => {
    expect(videoPanelSource).toContain('event.data?.type !== "ipollowork:hyperframes:animation-reference"');
    expect(videoPanelSource).toContain('"ipollowork:add-animation-reference"');
    expect(surfaceSource).toContain('window.addEventListener("ipollowork:add-animation-reference"');
    expect(surfaceSource).toContain("item.agentPrompt");
    expect(surfaceSource).toContain("animation.item.title");
  });

  test("the animation reference uses the selected-element chip treatment and confirms the handoff", () => {
    expect(surfaceSource).toContain('data-composer-token="animation-reference"');
    expect(surfaceSource).toContain("border-violet-6/35 bg-violet-3/20");
    expect(surfaceSource).toContain('toast.success(t("new_conversation.animations.added_to_ai"))');
  });
});
