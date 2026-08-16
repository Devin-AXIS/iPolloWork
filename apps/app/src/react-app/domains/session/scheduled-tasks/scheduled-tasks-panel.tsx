/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Clock, Loader2, Play, Plus, RefreshCw, Trash2, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { isElectronRuntime } from "../../../../app/utils";
import { isValidCron, nextRunAfter } from "./cron";
import { SCHEDULED_TASK_TEMPLATES, type ScheduledTaskTemplate } from "./scheduled-task-templates";
import type { ScheduledTask, ScheduledTaskLogEntry } from "./scheduled-task";

type ScheduledTasksPanelProps = {
  workspaceRoot: string;
  onClose?: () => void;
};

type Draft = {
  id: string | null;
  name: string;
  description: string;
  cron: string;
  prompt: string;
  templateId: string | null;
};

function emptyDraft(): Draft {
  return { id: null, name: "", description: "", cron: "", prompt: "", templateId: null };
}

function draftFromTemplate(template: ScheduledTaskTemplate): Draft {
  return {
    id: null,
    name: template.title,
    description: template.description,
    cron: template.cron,
    prompt: template.prompt,
    templateId: template.id,
  };
}

function draftFromTask(task: ScheduledTask): Draft {
  return {
    id: task.id,
    name: task.name,
    description: task.description,
    cron: task.cron,
    prompt: task.prompt,
    templateId: task.templateId,
  };
}

function formatTime(value: number | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function cronHint(expression: string): string {
  if (!expression.trim()) return "请输入 5 段 cron 表达式";
  if (!isValidCron(expression)) return "无效的 cron 表达式";
  const next = nextRunAfter(expression, new Date());
  return next ? `下次运行：${new Date(next).toLocaleString()}` : "无法计算下次运行时间";
}

export function ScheduledTasksPanel({ workspaceRoot, onClose }: ScheduledTasksPanelProps) {
  const bridge = typeof window !== "undefined" ? window.__IPOLLOWORK_ELECTRON__?.scheduledTasks : undefined;
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [logs, setLogs] = useState<ScheduledTaskLogEntry[]>([]);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!bridge?.list) {
      setTasks([]);
      setLoading(false);
      return;
    }
    try {
      const result = await bridge.list();
      setTasks(result ?? []);
    } finally {
      setLoading(false);
    }
  }, [bridge]);

  useEffect(() => {
    void refresh();
    const off = bridge?.onChanged?.(() => {
      void refresh();
    });
    return () => off?.();
  }, [bridge, refresh]);

  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === selectedId) ?? null,
    [tasks, selectedId],
  );

  useEffect(() => {
    if (!selectedTask || !bridge?.logs) {
      setLogs([]);
      return;
    }
    void bridge.logs(selectedTask.id).then((result) => setLogs(result ?? []));
  }, [selectedTask, bridge]);

  const openNew = () => {
    setSelectedId(null);
    setDraft(null);
    setLogs([]);
  };

  const openEdit = (task: ScheduledTask) => {
    setSelectedId(task.id);
    setDraft(draftFromTask(task));
  };

  const pickTemplate = (template: ScheduledTaskTemplate) => {
    setSelectedId(null);
    setDraft(draftFromTemplate(template));
  };

  const save = async () => {
    if (!draft || !bridge?.create || !bridge?.update) return;
    if (!draft.name.trim() || !isValidCron(draft.cron) || !draft.prompt.trim()) return;
    setBusy(true);
    try {
      const input = {
        name: draft.name,
        description: draft.description,
        cron: draft.cron,
        prompt: draft.prompt,
        workspaceId: workspaceRoot,
        templateId: draft.templateId,
      };
      const saved = draft.id
        ? await bridge.update(draft.id, input)
        : await bridge.create(input);
      await refresh();
      if (saved) {
        setSelectedId(saved.id);
        setDraft(draftFromTask(saved));
      }
    } finally {
      setBusy(false);
    }
  };

  const toggleEnabled = async (task: ScheduledTask, enabled: boolean) => {
    if (!bridge?.setEnabled) return;
    await bridge.setEnabled(task.id, enabled);
    void refresh();
  };

  const runNow = async (task: ScheduledTask) => {
    if (!bridge?.runNow) return;
    setBusy(true);
    try {
      await bridge.runNow(task.id);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const remove = async (task: ScheduledTask) => {
    if (!bridge?.remove) return;
    await bridge.remove(task.id);
    setSelectedId(null);
    setDraft(null);
    void refresh();
  };

  const available = Boolean(bridge);
  const cronValue = draft?.cron ?? "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-background" data-testid="scheduled-tasks-panel">
      <header className="flex h-11 shrink-0 items-center justify-between gap-3 border-b border-border px-4">
        <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
          <CalendarClock className="size-4 text-muted-foreground" />
          <span>定时任务</span>
          <span className="text-xs font-normal text-muted-foreground">{tasks.length} 个</span>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="刷新" onClick={() => void refresh()}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          {onClose ? (
            <Button variant="ghost" size="icon-sm" aria-label="关闭" onClick={onClose}>
              <X className="size-4" />
            </Button>
          ) : null}
        </div>
      </header>

      {!available ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          定时任务面板仅在桌面应用可用。
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="flex w-72 shrink-0 flex-col border-r border-border">
            <div className="p-3">
              <Button variant="default" className="w-full" onClick={openNew}>
                <Plus className="size-4" />
                <span>新建任务</span>
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
              {loading ? (
                <div className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" />
                  <span>加载中…</span>
                </div>
              ) : tasks.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">还没有定时任务，点击「新建任务」开始。</p>
              ) : (
                tasks.map((task) => (
                  <div
                    key={task.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-2 py-2 text-left transition-colors",
                      task.id === selectedId ? "bg-muted" : "hover:bg-muted/60",
                    )}
                  >
                    <Switch
                      size="sm"
                      checked={task.enabled}
                      onCheckedChange={(checked) => void toggleEnabled(task, checked)}
                      aria-label={`启用 ${task.name}`}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => openEdit(task)}
                    >
                      <div className="truncate text-sm text-foreground">{task.name}</div>
                      <div className="truncate font-mono text-[11px] text-muted-foreground">{task.cron || "无计划"}</div>
                      <div className="truncate text-[10px] text-muted-foreground">
                        下次：{formatTime(task.nextRunAt)}
                      </div>
                    </button>
                  </div>
                ))
              )}
            </div>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!draft ? (
              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                <h3 className="mb-3 text-sm font-semibold">选择模板</h3>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {SCHEDULED_TASK_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => pickTemplate(template)}
                      className="rounded-xl border border-border p-3 text-left transition-colors hover:bg-muted/60"
                    >
                      <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Clock className="size-3.5 text-muted-foreground" />
                        <span>{template.title}</span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-muted-foreground">{template.description}</div>
                      <div className="mt-2 inline-block rounded bg-muted px-1.5 py-px font-mono text-[11px] text-muted-foreground">
                        {template.cron}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">任务名称</label>
                    <Input
                      value={draft.name}
                      onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                      placeholder="例如：每日站会摘要"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Cron 表达式（分 时 日 月 周）</label>
                    <Input
                      value={draft.cron}
                      onChange={(event) => setDraft({ ...draft, cron: event.target.value })}
                      placeholder="0 9 * * 1-5"
                      className="font-mono"
                    />
                    <p className={cn("text-[11px]", isValidCron(cronValue) ? "text-muted-foreground" : "text-destructive")}>
                      {cronHint(cronValue)}
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">提示词</label>
                    <Textarea
                      value={draft.prompt}
                      onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
                      placeholder="描述这个定时任务要做什么…"
                      rows={6}
                    />
                  </div>

                  {draft.id ? (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-medium text-muted-foreground">运行日志</label>
                        <span className="text-[10px] text-muted-foreground">上次运行：{formatTime(selectedTask?.lastRunAt)}</span>
                      </div>
                      <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
                        {logs.length === 0 ? (
                          <p className="text-xs text-muted-foreground">暂无运行记录。</p>
                        ) : (
                          logs.map((entry, index) => (
                            <div key={index} className="flex items-start gap-2 text-xs">
                              <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                                {new Date(entry.at).toLocaleString()}
                              </span>
                              <span className="min-w-0 flex-1 text-muted-foreground">{entry.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-2 border-t border-border p-3">
                  <Button
                    variant="default"
                    onClick={() => void save()}
                    disabled={busy || !draft.name.trim() || !isValidCron(cronValue) || !draft.prompt.trim()}
                  >
                    {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                    <span>{draft.id ? "保存" : "创建"}</span>
                  </Button>
                  {draft.id ? (
                    <>
                      <Button variant="outline" onClick={() => selectedTask && void runNow(selectedTask)} disabled={busy}>
                        <Play className="size-4" />
                        <span>立即运行</span>
                      </Button>
                      <Button variant="ghost" onClick={() => selectedTask && void remove(selectedTask)} disabled={busy}>
                        <Trash2 className="size-4 text-destructive" />
                        <span className="text-destructive">删除</span>
                      </Button>
                    </>
                  ) : (
                    <Button variant="ghost" onClick={openNew}>
                      取消
                    </Button>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
