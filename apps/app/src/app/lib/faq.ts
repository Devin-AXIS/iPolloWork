export type FaqSource = {
  label: string;
  path: string;
};

export type FaqItem = {
  id: string;
  number: number;
  category: string;
  question: string;
  answer: string;
  scope: string;
  sources: FaqSource[];
};

export type FaqDocument = {
  title: string;
  description: string;
  categories: string[];
  items: FaqItem[];
};

const FAQ_ID_PATTERN = /^<a id="(faq-\d{3})"><\/a>$/;
const FAQ_QUESTION_PATTERN = /^###\s+(\d{3})\.\s+(.+)$/;
const FAQ_SOURCE_PATTERN = /\[([^\]]+)]\(([^)]+)\)/g;
const CATEGORY_NUMBER_PATTERN = /^[一二三四五六七八九十]+、/;

const FAQ_SEARCH_ALIASES: Record<string, string> = {
  Work: "WWork 工作 办公 通用任务 文件 文档 演示文稿 工作流",
  Code: "代码 编程 开发 coding programmer",
  Create: "Design 设计 创作 网站 网页 演示文稿 PPT 海报 信息卡 模板",
  Video: "视频 动画 时间线 数字人 语音",
  "模型、MCP 与 Skills": "模型 LLM AI Provider MCP Skills 插件 扩展 连接",
  "开发者与技术栈": "开发者 技术栈 TypeScript React Electron OpenCode API 插件",
  "Cloud 与团队": "Cloud 云端 团队 企业 组织 协作 Worker",
  "安全、授权与支持": "安全 授权 权限 许可 排障 支持 隐私 license",
};

const FAQ_QUERY_CATEGORY_ALIASES: Record<string, string> = {
  wwork: "Work",
  design: "Create",
};

function frontmatterValue(source: string, key: string): string {
  const match = source.match(new RegExp(`^${key}:\\s*["']?(.+?)["']?\\s*$`, "m"));
  return match?.[1]?.trim() ?? "";
}

function fieldValue(block: string[], label: string): string {
  const prefix = `**${label}：**`;
  return block.find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function parseSources(value: string): FaqSource[] {
  return [...value.matchAll(FAQ_SOURCE_PATTERN)].map((match) => ({
    label: match[1]?.trim() ?? "",
    path: match[2]?.trim() ?? "",
  })).filter((source) => source.label.length > 0 && source.path.length > 0);
}

function categoryLabel(line: string): string {
  return line.slice(3).trim().replace(CATEGORY_NUMBER_PATTERN, "").trim();
}

export function parseFaqDocument(source: string): FaqDocument {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const categories: string[] = [];
  const items: FaqItem[] = [];
  const ids = new Set<string>();
  let category = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]?.trim() ?? "";
    if (line.startsWith("## ")) {
      category = categoryLabel(line);
      if (category && !categories.includes(category)) categories.push(category);
      continue;
    }

    const idMatch = line.match(FAQ_ID_PATTERN);
    if (!idMatch) continue;
    const id = idMatch[1] ?? "";
    const questionMatch = (lines[index + 1]?.trim() ?? "").match(FAQ_QUESTION_PATTERN);
    if (!id || !questionMatch || !category) {
      throw new Error(`Invalid FAQ entry near line ${index + 1}`);
    }
    if (ids.has(id)) throw new Error(`Duplicate FAQ id: ${id}`);

    const block: string[] = [];
    for (let cursor = index + 2; cursor < lines.length; cursor += 1) {
      const next = lines[cursor]?.trim() ?? "";
      if (FAQ_ID_PATTERN.test(next) || next.startsWith("## ")) break;
      block.push(next);
    }

    const number = Number(questionMatch[1]);
    if (!Number.isInteger(number)) throw new Error(`Invalid FAQ number: ${id}`);
    ids.add(id);
    items.push({
      id,
      number,
      category,
      question: questionMatch[2]?.trim() ?? "",
      answer: fieldValue(block, "简答"),
      scope: fieldValue(block, "范围 / 状态"),
      sources: parseSources(fieldValue(block, "依据")),
    });
  }

  return {
    title: frontmatterValue(source, "title"),
    description: frontmatterValue(source, "description"),
    categories,
    items,
  };
}

function normalizeSearch(value: string): string {
  return value.toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "");
}

function searchFragments(value: string): string[] {
  const normalized = normalizeSearch(value);
  if (!normalized) return [];
  if (normalized.length <= 2) return [normalized];
  return Array.from({ length: normalized.length - 1 }, (_, index) => normalized.slice(index, index + 2));
}

export function searchFaqItems(items: FaqItem[], query: string, category: string | null): FaqItem[] {
  const categoryItems = category ? items.filter((item) => item.category === category) : items;
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return categoryItems;
  const aliasCategory = FAQ_QUERY_CATEGORY_ALIASES[normalizedQuery];
  if (aliasCategory) return categoryItems.filter((item) => item.category === aliasCategory);
  const fragments = searchFragments(query);

  return categoryItems
    .map((item) => {
      const question = normalizeSearch(item.question);
      const answer = normalizeSearch(item.answer);
      const metadata = normalizeSearch(`${item.category} ${item.scope} ${FAQ_SEARCH_ALIASES[item.category] ?? ""}`);
      let score = question.includes(normalizedQuery) ? 120 : 0;
      if (answer.includes(normalizedQuery)) score += 60;
      if (metadata.includes(normalizedQuery)) score += 40;
      for (const fragment of fragments) {
        if (question.includes(fragment)) score += 12;
        if (metadata.includes(fragment)) score += 6;
        if (answer.includes(fragment)) score += 2;
      }
      return { item, score };
    })
    .filter((result) => result.score > 0)
    .sort((left, right) => right.score - left.score || left.item.number - right.item.number)
    .map((result) => result.item);
}
