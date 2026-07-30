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
    expect(source).toContain("const isLatestAssistantGroup = items.some");
    expect(source).toContain("artifactFiles={isLatestAssistantGroup ? artifactFiles : undefined}");
    expect(source).toContain('title={showLatestArtifactsTitle ? t("session.outputs.latest_turn") : undefined}');
  });

  test("video and presentation sessions recover scoped files with guarded activation", () => {
    const artifactSource = readFileSync(
      new URL("../src/components/chat/artifact.tsx", import.meta.url),
      "utf8",
    );
    const messageListSource = readFileSync(
      new URL("../src/components/chat/message-list.tsx", import.meta.url),
      "utf8",
    );
    const sessionPageSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    expect(artifactSource).toContain("canOpenArtifactInContext(artifact, artifactContext)");
    expect(messageListSource).toContain("artifactFiles={artifactFiles}");
    expect(sessionPageSource).toContain(".listWorkspaceFiles(props.runtimeWorkspaceId, artifactDirectory)");
    expect(sessionPageSource).toContain('selectedTemplate?.category === "slides"');
    expect(sessionPageSource).toContain('target.preview === "html"');
    expect(sessionPageSource).toContain("artifactPathMatchesTarget(target.value, currentVideoEntryPath)");
    expect(sessionPageSource).toContain('target.preview === "slides"');
    expect(sessionPageSource).toContain("openCurrentVideoStudio();");
  });

  test("template covers expose a retryable failure placeholder", () => {
    const marketSource = readFileSync(
      new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
      "utf8",
    );
    const starterSource = readFileSync(
      new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url),
      "utf8",
    );

    for (const source of [marketSource, starterSource]) {
      expect(source).toContain("TEMPLATE_COVER_TIMEOUT_MS");
      expect(source).toContain("setFailed(true)");
      expect(source).toContain("setRetry((value) => value + 1)");
      expect(source).toContain('t("template_market.cover_failed")');
      expect(source).toContain('t("template_market.retry_cover")');
      expect(source).toContain("window.clearTimeout(timeout)");
    }
  });

  test("template market exposes category counts and clean import separators", () => {
    const source = readFileSync(
      new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain("const categoryCounts = React.useMemo");
    expect(source).toContain("const allCount = React.useMemo");
    expect(source).toContain("categoryCounts.get(id) ?? 0");
    expect(source).toContain("{pendingImport.name} - {(pendingImport.size / 1024).toFixed(1)} KB");
  });
});
