import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("session output issue regressions", () => {
  test("session header offers full-session Markdown export", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("buildSessionMarkdown");
    expect(source).toContain("sessionMarkdownFilename");
    expect(source).toContain('t("session.export_markdown")');
    expect(source).toContain("downloadTextAsFile(");
    expect(source).toContain("sessionId={props.selectedSessionId ?? undefined}");
  });

  test("output files can seed a follow-up revision prompt", () => {
    const source = readFileSync(
      new URL("../src/components/chat/artifact.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("buildReviseFilePrompt");
    expect(source).toContain("useComposerStateStore");
    expect(source).toContain('t("session.outputs.revise_file")');
    expect(source).toContain('new Event("ipollowork:focusPrompt")');
  });

  test("latest-turn output label only renders for the latest artifact assistant message", () => {
    const source = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("showLatestArtifactsTitle={item.message.id === latestAssistantMessageId}");
    expect(source).toContain('title={showLatestArtifactsTitle ? t("session.outputs.latest_turn") : undefined}');
  });

  test("template covers expose a retryable failure placeholder", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("setFailed(true)");
    expect(source).toContain("setRetry((value) => value + 1)");
    expect(source).toContain('t("template_market.cover_failed")');
    expect(source).toContain('t("template_market.retry_cover")');
  });
});
