/** @jsxImportSource react */
// Customer-edition training launcher; service implementations stay in their plugins.
import { ArrowRight, BookOpen, Clapperboard, Database, ImagePlus, Loader2, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TrainingProjectId = "short-film" | "ai-image" | "tutorial" | "data-annotation";

type TrainingProjectsProps = {
  busyProjectId: TrainingProjectId | null;
  onClose: () => void;
  onLaunch: (projectId: TrainingProjectId) => void;
};

const PROJECTS = [
  {
    id: "short-film" as const,
    title: "短片实训",
    description: "进入专业视频创作环境，完成脚本、画面与成片制作。",
    badge: "可开始",
    icon: Clapperboard,
    accent: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  {
    id: "ai-image" as const,
    title: "AI 图片生成",
    description: "进入即梦 AI 图片创作环境，完成素材生成、编辑与资产管理。",
    badge: "可开始",
    icon: ImagePlus,
    accent: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  },
  {
    id: "tutorial" as const,
    title: "实训教程",
    description: "课程内容和教程链接将在收到学校资料后统一接入。",
    badge: "待接入",
    icon: BookOpen,
    accent: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  {
    id: "data-annotation" as const,
    title: "数据标注实训",
    description: "通过独立插件进入图片、视频、音频和文字标注工作台。",
    badge: "独立插件",
    icon: Database,
    accent: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  },
] satisfies ReadonlyArray<{
  id: TrainingProjectId;
  title: string;
  description: string;
  badge: string;
  icon: typeof Clapperboard;
  accent: string;
}>;

export function TrainingProjects({ busyProjectId, onClose, onLaunch }: TrainingProjectsProps) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto bg-background" data-testid="training-projects-view">
      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col px-6 pb-12 pt-8 md:px-10 md:pt-12">
        <header className="flex items-start justify-between gap-6">
          <div className="max-w-2xl">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border bg-muted/45 px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" />
              智慧未来实训平台
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">实训项目</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              选择实训环境后，平台会在右侧直接打开对应工作台。账号状态会保留，无需重复登录。
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="关闭实训项目">
            <X />
          </Button>
        </header>

        <section className="mt-9 grid gap-4 md:grid-cols-2 xl:grid-cols-4" aria-label="实训项目列表">
          {PROJECTS.map((project) => {
            const Icon = project.icon;
            const busy = busyProjectId === project.id;
            const disabled = busyProjectId !== null || project.id === "tutorial";
            return (
              <article
                key={project.id}
                className="group flex min-h-64 flex-col rounded-2xl border border-border bg-card p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className={cn("grid size-10 place-items-center rounded-xl", project.accent)}>
                    <Icon className="size-5" />
                  </div>
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
                    {project.badge}
                  </span>
                </div>
                <h2 className="mt-7 text-base font-semibold text-foreground">{project.title}</h2>
                <p className="mt-2 flex-1 text-sm leading-6 text-muted-foreground">{project.description}</p>
                <Button
                  type="button"
                  className="mt-6 w-full justify-between rounded-xl"
                  variant={project.id === "tutorial" ? "outline" : "default"}
                  disabled={disabled}
                  onClick={() => onLaunch(project.id)}
                >
                  <span>{project.id === "tutorial" ? "等待接入" : "进入实训"}</span>
                  {busy ? <Loader2 className="animate-spin" /> : <ArrowRight />}
                </Button>
              </article>
            );
          })}
        </section>
      </div>
    </div>
  );
}
