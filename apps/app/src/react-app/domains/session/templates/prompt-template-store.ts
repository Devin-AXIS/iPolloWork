export type SavedPromptTemplate = {
  id: string;
  title: string;
  prompt: string;
  createdAt: number;
};

const STORAGE_KEY = "ipollowork.saved-prompt-templates.v1";
const LIMIT = 24;

function readRawTemplates(): SavedPromptTemplate[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is SavedPromptTemplate => (
      item &&
      typeof item.id === "string" &&
      typeof item.title === "string" &&
      typeof item.prompt === "string" &&
      typeof item.createdAt === "number"
    ));
  } catch {
    return [];
  }
}

function writeTemplates(templates: SavedPromptTemplate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(templates.slice(0, LIMIT)));
  window.dispatchEvent(new CustomEvent("ipollowork:saved-prompt-templates-changed"));
}

export function listSavedPromptTemplates(): SavedPromptTemplate[] {
  return readRawTemplates().sort((left, right) => right.createdAt - left.createdAt);
}

export function savePromptTemplate(input: { title: string; prompt: string }): SavedPromptTemplate {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  if (!title || !prompt) throw new Error("Prompt template requires a title and prompt.");
  const template: SavedPromptTemplate = {
    id: typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `template-${Date.now()}`,
    title,
    prompt,
    createdAt: Date.now(),
  };
  writeTemplates([template, ...readRawTemplates().filter((item) => item.title !== title)]);
  return template;
}
