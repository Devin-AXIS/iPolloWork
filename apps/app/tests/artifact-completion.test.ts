import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import type { ArtifactCompletionTarget } from "../src/app/types";
import {
  artifactCompletionRecoveryInstruction,
  artifactMediaDeliveryIssues,
  artifactPreviewDeliveryIssues,
  artifactContentFingerprint,
  checkArtifactCompletion,
  promptArtifactCompletionTargets,
  promptWasDispatched,
} from "../src/react-app/domains/session/artifacts/artifact-completion";

const targets: ArtifactCompletionTarget[] = [
  {
    sourcePath: "design/session-demo-slides/entry.html",
    baselineFingerprint: artifactContentFingerprint("initial slides"),
  },
  {
    sourcePath: "video/session-demo-video/index.html",
    baselineFingerprint: artifactContentFingerprint("initial video"),
  },
];

describe("artifact completion", () => {
  test("does not accept a process-only turn with unchanged artifact entries", () => {
    const check = checkArtifactCompletion(
      targets,
      new Map([
        [targets[0]!.sourcePath, "initial slides"],
        [targets[1]!.sourcePath, "initial video"],
      ]),
      "I inspected the prepared templates.",
    );

    expect(check.unchangedPaths).toEqual(targets.map((target) => target.sourcePath));
    expect(check.unreportedPaths).toEqual(targets.map((target) => target.sourcePath));
  });

  test("requires every changed artifact path in the final assistant text", () => {
    const check = checkArtifactCompletion(
      targets,
      new Map([
        [targets[0]!.sourcePath, "completed slides"],
        [targets[1]!.sourcePath, "completed video"],
      ]),
      `Completed ${targets[0]!.sourcePath}`,
    );

    expect(check.unchangedPaths).toEqual([]);
    expect(check.unreportedPaths).toEqual([targets[1]!.sourcePath]);
    expect(artifactCompletionRecoveryInstruction(check)).toContain(targets[1]!.sourcePath);
    expect(artifactCompletionRecoveryInstruction(check)).toContain("output card");
  });

  test("accepts dispatch metadata without changing boolean-only callers", () => {
    expect(promptWasDispatched(true)).toBe(true);
    expect(promptArtifactCompletionTargets(false)).toEqual([]);
    expect(promptWasDispatched({ dispatched: true, artifactCompletionTargets: targets })).toBe(true);
    expect(promptArtifactCompletionTargets({ dispatched: true, artifactCompletionTargets: targets })).toEqual(targets);
  });

  test("wires automatic multi-artifact routing into the shared completion gate", () => {
    const routeSource = readFileSync(
      new URL("../src/react-app/shell/session-route.tsx", import.meta.url),
      "utf8",
    );
    const surfaceSource = readFileSync(
      new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url),
      "utf8",
    );

    expect(routeSource).toContain("artifactCompletionTargets: ArtifactCompletionTarget[]");
    expect(routeSource).toContain("baselineFingerprint: artifactContentFingerprint(source.content)");
    expect(routeSource).toContain("explicitlyTargetedTemplateSessionIds.has(template.sessionId)");
    expect(routeSource).toContain('template.manifest.surface !== "video"');
    expect(surfaceSource).toContain("validatePendingArtifactCompletion");
    expect(surfaceSource).toContain("pending.requestOrdinal");
    expect(surfaceSource).toContain("artifactPathIsWithinDirectory(path, directory)");
    expect(surfaceSource).toContain("artifactCompletionRecoveryInstruction(check)");
    expect(surfaceSource).toContain("if (pendingArtifactCompletionRef.current || pendingVideoDeliveryRef.current) return;");
    expect(surfaceSource).toContain('const artifactRecoveryDraft = nextDraft.capability?.id === "artifact-delivery-recovery"');
    expect(surfaceSource).toContain("if (!artifactRecoveryDraft) pendingArtifactCompletionRef.current = null;");
  });
});


test("media completion accepts disclosed fallbacks but repairs unresolved or missing review", () => {
  expect(artifactMediaDeliveryIssues({ok:true,result:{fileCanBeDelivered:true,complete:false,reportedFallbacks:["not authorized"]}})).toEqual([]);
  expect(artifactMediaDeliveryIssues({ok:true,result:{fileCanBeDelivered:false,issues:["cover: pending"]}})).toEqual(["cover: pending"]);
  expect(artifactMediaDeliveryIssues(null)).toEqual(["media_review_unavailable"]);
  const recovery = artifactCompletionRecoveryInstruction({unchangedPaths:[],unreportedPaths:[],mediaIssues:["cover: pending"]});
  expect(recovery).toContain("media/artifact_media_review phase=plan");
  expect(recovery).toContain("do not discard useful imagery");
});

test("preview completion reports batched client defects without asking for ad hoc screenshots", () => {
  expect(artifactPreviewDeliveryIssues({ ok: true, result: { passed: true, pageCount: 8, issues: [] } })).toEqual([]);
  expect(artifactPreviewDeliveryIssues({
    ok: true,
    result: { passed: false, issues: [{ target: "slide-4", code: "blank_surface", detail: "No visible content." }] },
  })).toEqual(["slide-4: blank_surface: No visible content."]);
  expect(artifactPreviewDeliveryIssues(null)).toEqual(["preview_review_unavailable"]);
  const recovery = artifactCompletionRecoveryInstruction({
    unchangedPaths: [],
    unreportedPaths: [],
    previewIssues: ["slide-4: blank_surface"],
  });
  expect(recovery).toContain("media/artifact_preview_review");
  expect(recovery).toContain("Do not start a temporary server");
});
