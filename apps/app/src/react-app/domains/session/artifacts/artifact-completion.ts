import type { ArtifactCompletionTarget, PromptDispatchOutcome } from "@/app/types";

export type ArtifactCompletionCheck = {
  unchangedPaths: string[];
  unreportedPaths: string[];
  mediaIssues?: string[];
  previewIssues?: string[];
};

export function artifactMediaDeliveryIssues(response: unknown): string[] {
  if (!response || typeof response !== "object" || Reflect.get(response, "ok") !== true) return ["media_review_unavailable"];
  const result = Reflect.get(response, "result");
  if (!result || typeof result !== "object") return ["media_review_unavailable"];
  if (Reflect.get(result, "fileCanBeDelivered") === true) return [];
  const issues: unknown = Reflect.get(result, "issues");
  return Array.isArray(issues) && issues.length && issues.every((issue): issue is string => typeof issue === "string")
    ? issues : ["media_review_incomplete"];
}

export function artifactPreviewDeliveryIssues(response: unknown): string[] {
  if (!response || typeof response !== "object" || Reflect.get(response, "ok") !== true) return ["preview_review_unavailable"];
  const result = Reflect.get(response, "result");
  if (!result || typeof result !== "object") return ["preview_review_unavailable"];
  if (Reflect.get(result, "passed") === true) return [];
  const issues: unknown = Reflect.get(result, "issues");
  if (!Array.isArray(issues) || !issues.length) return ["preview_review_incomplete"];
  return issues.map((issue) => {
    if (!issue || typeof issue !== "object") return "preview_review_incomplete";
    const code = Reflect.get(issue, "code");
    const target = Reflect.get(issue, "target");
    const detail = Reflect.get(issue, "detail");
    return [target, code, detail].filter((value): value is string => typeof value === "string" && Boolean(value)).join(": ");
  });
}

export function artifactContentFingerprint(content: string) {
  let hash = 2_166_136_261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${content.length}:${(hash >>> 0).toString(16)}`;
}

export function promptWasDispatched(outcome: PromptDispatchOutcome) {
  return typeof outcome === "boolean" ? outcome : outcome.dispatched;
}

export function promptArtifactCompletionTargets(outcome: PromptDispatchOutcome) {
  return typeof outcome === "boolean" ? [] : outcome.artifactCompletionTargets ?? [];
}

function normalizedPath(value: string) {
  return value.replaceAll("\\", "/").toLocaleLowerCase();
}

export function checkArtifactCompletion(
  targets: ArtifactCompletionTarget[],
  currentContentByPath: ReadonlyMap<string, string | null>,
  assistantOutput: string,
): ArtifactCompletionCheck {
  const normalizedOutput = normalizedPath(assistantOutput);
  const unchangedPaths: string[] = [];
  const unreportedPaths: string[] = [];
  for (const target of targets) {
    const currentContent = currentContentByPath.get(target.sourcePath);
    if (currentContent === null || currentContent === undefined
      || artifactContentFingerprint(currentContent) === target.baselineFingerprint) {
      unchangedPaths.push(target.sourcePath);
    }
    if (!normalizedOutput.includes(normalizedPath(target.sourcePath))) {
      unreportedPaths.push(target.sourcePath);
    }
  }
  return { unchangedPaths, unreportedPaths };
}

export function artifactCompletionRecoveryInstruction(check: ArtifactCompletionCheck) {
  const lines = [
    "The preceding artifact run ended before every required output was delivered.",
    "Continue the same request now. Do not only plan, inspect, summarize, or explain.",
  ];
  if (check.unchangedPaths.length > 0) {
    lines.push(
      "Create or fully update each unfinished artifact target:",
      ...check.unchangedPaths.map((path) => `- ${path}`),
    );
  }
  if (check.unreportedPaths.length > 0) {
    lines.push(
      "In the final answer, mention each exact path below so iPolloWork can render its output card:",
      ...check.unreportedPaths.map((path) => `- ${path}`),
    );
  }
  if (check.mediaIssues?.length) {
    lines.push(
      "The host media checkpoint found unresolved work:", ...check.mediaIssues,
      "Use media/artifact_media_review phase=plan if missing, then resolve the planned visuals and call phase=check with every outcome. Follow the shared rules; do not discard useful imagery by choosing geometry. Ask once if model choice is unresolved. If unavailable/failed/declined, complete the file and record the specific fallback rather than retrying indefinitely.",
    );
  }
  if (check.previewIssues?.length) {
    lines.push(
      "The client preview checkpoint found rendered defects:", ...check.previewIssues,
      "Fix these issues together, then call media/artifact_preview_review once with the same sourcePath and type. Do not start a temporary server, create helper preview HTML, use generic browser screenshots, or capture slides one by one.",
    );
  }
  lines.push("Finish only after every target is updated and every exact path appears in the final answer.");
  return lines.join("\n");
}
