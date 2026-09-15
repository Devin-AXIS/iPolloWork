import type { ArtifactCompletionTarget, PromptDispatchOutcome } from "@/app/types";

export type ArtifactCompletionCheck = {
  unchangedPaths: string[];
  unreportedPaths: string[];
};

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
  lines.push("Finish only after every target is updated and every exact path appears in the final answer.");
  return lines.join("\n");
}
