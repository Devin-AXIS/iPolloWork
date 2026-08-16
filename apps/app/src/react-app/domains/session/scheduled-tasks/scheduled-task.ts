export type ScheduledTaskStatus = "ok" | "error" | "skipped";

export type ScheduledTask = {
  id: string;
  name: string;
  description: string;
  cron: string;
  workspaceId: string;
  prompt: string;
  enabled: boolean;
  templateId: string | null;
  createdAt: number;
  lastRunAt: number | null;
  lastRunStatus: ScheduledTaskStatus | null;
  nextRunAt?: number | null;
};

export type ScheduledTaskLogEntry = {
  at: number;
  status: ScheduledTaskStatus;
  message: string;
};

export type ScheduledTaskCreateInput = {
  name?: string;
  description?: string;
  cron?: string;
  workspaceId?: string;
  prompt?: string;
  enabled?: boolean;
  templateId?: string | null;
};

export type ScheduledTaskUpdatePatch = Partial<
  Pick<ScheduledTask, "name" | "description" | "cron" | "workspaceId" | "prompt" | "enabled">
>;
