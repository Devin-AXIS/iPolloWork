import type {
  iPolloWorkAuthorizationService,
  iPolloWorkServerClient,
} from "../../../../app/lib/ipollowork-server";
import { readiPolloWorkEnvPendingChanges } from "../../../../app/lib/ipollowork-env-runtime";

const DEFAULT_CACHE_KEY = "__ipollowork_env_default__";
const MAX_CONTEXT_CACHE_ENTRIES = 100;

const envSystemContextCache = new Map<string, string | undefined>();

const LONG_RUNNING_PROCESS_CONTEXT = [
  "Long-running local process rule:",
  "- Never start a long-running development or preview server as a foreground shell command. A listening server does not exit, so the tool remains pending until its timeout even when the server is already ready.",
  "- Never stop all Node processes (`Stop-Process -Name node`, `taskkill /IM node.exe`, `pkill node`, or equivalents). The desktop app, agent runtime, and embedded previews may all use Node; terminate only a PID that this task started and recorded.",
  "- Do not restart an application-owned preview service. Save the source and let the embedded preview hot-reload it.",
  "- Prefer the application's built-in preview surface when one exists.",
  "- If a separate local server is genuinely required, start it as a detached/background process without attaching its output pipes, perform a bounded health check, report the URL, and return control immediately.",
].join("\n");

export function cleariPolloWorkEnvSystemContextCache(): void {
  envSystemContextCache.clear();
}

function normalizeEnvKeys(keys: string[]): string[] {
  return Array.from(
    new Set(
      keys.flatMap((key) => {
        const trimmed = key.trim();
        return /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed) ? [trimmed] : [];
      }),
    ),
  ).sort((a, b) => a.localeCompare(b));
}

function configuredAuthorizationServices(
  services: iPolloWorkAuthorizationService[],
): iPolloWorkAuthorizationService[] {
  return services.filter((service) =>
    service.configured &&
    service.fields.every((field) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(field.key)) &&
    Boolean(service.agent?.capability?.trim()) &&
    Boolean(service.agent?.useWhen?.trim()) &&
    Boolean(service.agent?.instruction?.trim()),
  );
}

function buildAuthorizationAgentContext(services: iPolloWorkAuthorizationService[]): string | undefined {
  const configured = configuredAuthorizationServices(services);
  if (configured.length === 0) return undefined;

  return [
    "iPolloWork global AI services already authorized for this runtime:",
    ...configured.flatMap((service) => [
      `- ${service.agent.capability} (${service.fields.map((field) => field.key).join(", ")}): ${service.agent.useWhen}`,
      `  ${service.agent.instruction}`,
    ]),
    "The credentials are available only as runtime environment variables. Never ask for, read, reveal, copy, or put their values in client-side code, URLs, generated files, or chat output.",
  ].join("\n");
}

export async function buildiPolloWorkEnvSystemContext(
  client: iPolloWorkServerClient | null,
  options: {
    cacheKey?: string;
    runtimeKey?: string | null;
    readPendingChanges?: () => boolean;
  } = {},
): Promise<string | undefined> {
  if (!client) return LONG_RUNNING_PROCESS_CONTEXT;
  const readPendingChanges = options.readPendingChanges ??
    (() => readiPolloWorkEnvPendingChanges(options.runtimeKey));
  if (readPendingChanges()) return LONG_RUNNING_PROCESS_CONTEXT;

  const cacheKey = `${client.baseUrl}:${options.cacheKey ?? DEFAULT_CACHE_KEY}`;
  if (envSystemContextCache.has(cacheKey)) {
    return envSystemContextCache.get(cacheKey);
  }

  try {
    // The generic key inventory and curated authorization catalog are both
    // intentionally secret-free. Together they let every agent select an
    // already configured service without receiving a credential value.
    const [envResponse, authorizationResponse] = await Promise.all([
      client.listUserEnvKeys(),
      client.listAuthorizationServices(),
    ]);
    const keys = normalizeEnvKeys(envResponse.keys ?? []);
    const authorizationContext = buildAuthorizationAgentContext(authorizationResponse.items ?? []);
    const context = [
      LONG_RUNNING_PROCESS_CONTEXT,
      authorizationContext,
      keys.length > 0
        ? [
            "iPolloWork environment variables configured:",
            keys.map((key) => `- ${key}`).join("\n"),
            "Only names are shown; values are secret. Use these names when relevant.",
          ].join("\n")
        : undefined,
    ].filter((value): value is string => Boolean(value)).join("\n\n");
    rememberEnvSystemContext(cacheKey, context);
    return context;
  } catch {
    return LONG_RUNNING_PROCESS_CONTEXT;
  }
}

function rememberEnvSystemContext(cacheKey: string, context: string | undefined): void {
  if (envSystemContextCache.size >= MAX_CONTEXT_CACHE_ENTRIES && !envSystemContextCache.has(cacheKey)) {
    const firstKey = envSystemContextCache.keys().next().value;
    if (firstKey) envSystemContextCache.delete(firstKey);
  }
  envSystemContextCache.set(cacheKey, context);
}
