export type ScheduledTaskTemplate = {
  id: string;
  title: string;
  description: string;
  cron: string;
  prompt: string;
};

export const SCHEDULED_TASK_TEMPLATES: ScheduledTaskTemplate[] = [
  {
    id: "daily-standup",
    title: "每日站会摘要",
    description: "每个工作日汇总昨日进展、今日计划与风险项。",
    cron: "0 9 * * 1-5",
    prompt:
      "基于当前工作区最近的会话与提交记录，生成一份每日站会摘要：昨日完成的关键进展、今日计划、以及需要关注的风险或阻塞项。用简洁的要点列表呈现。",
  },
  {
    id: "weekly-report",
    title: "每周工作周报",
    description: "每周一生成结构化周报。",
    cron: "0 8 * * 1",
    prompt:
      "汇总过去 7 天的工作内容，生成一份结构化周报，包含：本周完成事项、关键数据或产出、下周计划、需要协作或支持的事项。",
  },
  {
    id: "daily-news",
    title: "每日新闻/行业简报",
    description: "每天抓取并整理当日资讯简报。",
    cron: "0 7 * * *",
    prompt:
      "收集并整理今日与所在行业相关的新闻与动态，生成一份精炼的每日简报：重要新闻标题与一句话摘要、对业务的潜在影响、值得关注的机会或风险。",
  },
  {
    id: "data-report",
    title: "数据日报",
    description: "定时汇总关键数据指标。",
    cron: "0 9 * * *",
    prompt:
      "汇总当前工作区可获取的关键数据指标，生成一份数据日报：核心指标数值、环比变化、异常波动说明、以及简要结论。",
  },
  {
    id: "meeting-followup",
    title: "会议纪要跟进",
    description: "定时提醒并跟进会议待办事项。",
    cron: "0 10 * * 1-5",
    prompt:
      "回顾最近的会议纪要，提取其中尚未完成的待办事项与责任人，生成一份跟进清单：待办事项、责任人、截止时间、当前状态与下一步建议。",
  },
  {
    id: "todo-scan",
    title: "提醒/待办巡检",
    description: "定时检查待办与到期事项并提醒。",
    cron: "0 */6 * * *",
    prompt:
      "巡检当前工作区内的待办事项与到期日程，找出即将到期或已逾期的事项，生成提醒清单并给出优先级建议。",
  },
];

export function templateById(id: string | null | undefined): ScheduledTaskTemplate | null {
  if (!id) return null;
  return SCHEDULED_TASK_TEMPLATES.find((t) => t.id === id) ?? null;
}
