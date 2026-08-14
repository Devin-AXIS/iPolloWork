import type { EnvService } from "./env-file.js";
import { ApiError } from "./errors.js";

const OPENAI_FILE_PARSER_MODEL = "gpt-4.1-mini";
const OPENAI_FILE_PARSER_TIMEOUT_MS = 60_000;

export type AiFileAnalysis = {
  summary: string;
  userIntent: string;
  targetAudience: string;
  keyFacts: string[];
  designRequirements: string[];
  contentOutline: string[];
  brandHints: string[];
  dataFindings: string[];
  missingInfo: string[];
  confidence: "high" | "medium" | "low";
};

export type AiFileParserResult = {
  ok: true;
  source: "openai";
  model: string;
  fileName: string;
  mimeType: string;
  analysis: AiFileAnalysis;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function readStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.map((item) => readString(item)).filter(Boolean).slice(0, 20)
    : [];
}

function normalizeConfidence(value: unknown): AiFileAnalysis["confidence"] {
  return value === "high" || value === "low" ? value : "medium";
}

function normalizeAnalysis(value: unknown): AiFileAnalysis {
  const object = isRecord(value) ? value : {};
  return {
    summary: readString(object.summary),
    userIntent: readString(object.userIntent),
    targetAudience: readString(object.targetAudience),
    keyFacts: readStringArray(object.keyFacts),
    designRequirements: readStringArray(object.designRequirements),
    contentOutline: readStringArray(object.contentOutline),
    brandHints: readStringArray(object.brandHints),
    dataFindings: readStringArray(object.dataFindings),
    missingInfo: readStringArray(object.missingInfo),
    confidence: normalizeConfidence(object.confidence),
  };
}

function collectOutputText(payload: unknown): string {
  if (!isRecord(payload)) return "";
  const outputText = readString(payload.output_text);
  if (outputText) return outputText;

  const chunks: string[] = [];
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!isRecord(item)) continue;
    const content = Array.isArray(item.content) ? item.content : [];
    for (const part of content) {
      if (!isRecord(part)) continue;
      const text = readString(part.text);
      if (text) chunks.push(text);
    }
  }
  return chunks.join("\n");
}

function firstJsonObject(text: string) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new ApiError(502, "ai_file_parser_invalid_response", "AI parser did not return JSON.");
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new ApiError(502, "ai_file_parser_invalid_response", "AI parser returned invalid JSON.");
  }
}

export function parseOpenAiFileAnalysisPayload(payload: unknown): AiFileAnalysis {
  return normalizeAnalysis(firstJsonObject(collectOutputText(payload)));
}

async function resolveOpenAiApiKey(env: EnvService): Promise<string> {
  const records = await env.list();
  return records.find((entry) => entry.key === "OPENAI_API_KEY")?.value.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    "";
}

async function fileToDataUrl(file: File) {
  const bytes = Buffer.from(await file.arrayBuffer());
  return `data:${file.type || "application/octet-stream"};base64,${bytes.toString("base64")}`;
}

export async function analyzeFileWithOpenAi(env: EnvService, file: File): Promise<AiFileParserResult> {
  const apiKey = await resolveOpenAiApiKey(env);
  if (!apiKey) {
    throw new ApiError(400, "openai_api_key_missing", "OPENAI_API_KEY is required for AI file parsing.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), OPENAI_FILE_PARSER_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: OPENAI_FILE_PARSER_MODEL,
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: [
                "Analyze this uploaded reference file for an iPolloWork template generation task.",
                "Return only valid JSON with keys: summary, userIntent, targetAudience, keyFacts, designRequirements, contentOutline, brandHints, dataFindings, missingInfo, confidence.",
                "Use concise strings and arrays. confidence must be high, medium, or low.",
              ].join("\n"),
            },
            {
              type: "input_file",
              filename: file.name || "reference",
              file_data: await fileToDataUrl(file),
            },
          ],
        }],
      }),
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new ApiError(504, "ai_file_parser_timeout", "AI file parsing timed out.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const errorPayload = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message = readString(errorPayload?.message) || "AI file parsing failed.";
    throw new ApiError(response.status, "ai_file_parser_failed", message);
  }

  return {
    ok: true,
    source: "openai",
    model: OPENAI_FILE_PARSER_MODEL,
    fileName: file.name || "reference",
    mimeType: file.type || "application/octet-stream",
    analysis: parseOpenAiFileAnalysisPayload(payload),
  };
}
