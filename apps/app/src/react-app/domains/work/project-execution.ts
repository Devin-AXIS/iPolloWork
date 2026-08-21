import type { ProjectSessionExecution } from "@ipollowork/types/work-items";

export function projectExecutionSystemContext(execution: ProjectSessionExecution): string {
  const resources = [
    execution.agent.pluginIds.length
      ? `Assigned plugins: ${execution.agent.pluginIds.join(", ")}`
      : null,
    execution.agent.skillIds.length
      ? `Assigned skills: ${execution.agent.skillIds.join(", ")}`
      : null,
  ].filter((value): value is string => Boolean(value));

  return [
    `You are ${execution.agent.name}, the project Agent bound to this task.`,
    execution.agent.role ? `Responsibility: ${execution.agent.role}` : null,
    execution.projectGoal ? `Project goal: ${execution.projectGoal}` : null,
    execution.agent.prompt ? `Agent instructions:\n${execution.agent.prompt}` : null,
    resources.length ? resources.join("\n") : null,
    "Keep this task within the assigned responsibility. Use the configured project resources when they are relevant, and preserve the task's bound runtime for this conversation.",
  ].filter((value): value is string => Boolean(value?.trim())).join("\n\n");
}
