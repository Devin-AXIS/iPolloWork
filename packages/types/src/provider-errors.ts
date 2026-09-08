/** Safe, shared error vocabulary for provider boundaries and their UI consumers. */
export const providerFailureMessages = {
  provider_unavailable: "第三方服务暂时不可用，请稍后重试。",
  provider_timeout: "第三方服务响应超时，请稍后重试。",
  provider_network_error: "网络连接失败，请检查网络或代理设置后重试。",
  provider_auth_failed: "第三方服务授权已失效，请检查 API Key 或重新登录授权。",
  provider_access_denied: "当前账号无权使用该第三方服务或模型，请检查权限和服务开通情况。",
  provider_quota_exhausted: "第三方服务余额或额度不足，请检查余额、用量限制或等待额度恢复。",
  provider_rate_limited: "第三方服务请求过于频繁，请稍后重试。",
} satisfies Record<string, string>;

export type ProviderFailureCode = keyof typeof providerFailureMessages;
export type ProviderFailure = { code: ProviderFailureCode; message: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function serviceErrorInfo(value: unknown): { status?: number; code: string; message: string; name: string } {
  const root = record(value);
  const nested = record(root?.error) ?? record(root?.data) ?? record(root?.cause);
  const message = typeof value === "string" ? value : typeof root?.message === "string" ? root.message
    : typeof root?.errorMessage === "string" ? root.errorMessage : typeof root?.msg === "string" ? root.msg
    : typeof nested?.message === "string" ? nested.message : "";
  const code = typeof root?.code === "string" ? root.code : typeof root?.errorCode === "string" ? root.errorCode : typeof nested?.code === "string" ? nested.code : "";
  const status = root?.status ?? root?.statusCode ?? nested?.status ?? nested?.statusCode;
  return { status: typeof status === "number" ? status : undefined, code, message: message.slice(0, 4096), name: typeof root?.name === "string" ? root.name : "" };
}

/** Does not treat every error (e.g. invalid local input) as a provider outage. */
export function classifyProviderFailure(value: unknown): ProviderFailure | null {
  const info = serviceErrorInfo(value);
  const text = `${info.code} ${info.message}`;
  const status = info.status ?? Number(/(?:HTTP\s*|status(?:\s+code)?[\s:=]+|\()(\d{3})(?:\b|\))/.exec(text)?.[1] || 0);
  const failure = (code: ProviderFailureCode): ProviderFailure => ({ code, message: providerFailureMessages[code] });
  for (const code of Object.keys(providerFailureMessages)) {
    if (info.code === code) return failure(code as ProviderFailureCode);
  }
  if (status === 504 || status === 408 || /TimeoutError|AbortError/.test(info.name) || /\b(?:timed? out|timeout)\b/i.test(text)) return failure("provider_timeout");
  if (status >= 500 && status <= 599) return failure("provider_unavailable");
  // A billing-related 429 is not a request-rate limit; waiting seconds will not fix it.
  if (status === 402 || /insufficient[_\s-]*(?:quota|balance|credit)|quota[_\s-]*(?:exceeded|exhausted)|usageLimitExceeded|billing[_\s-]*(?:hard[_\s-]*)?limit|(?:余额|额度)不足|额度已用完/i.test(text)) return failure("provider_quota_exhausted");
  if (status === 401 || /invalid[_\s-]*(?:api[_\s-]*)?key|unauthorized|authentication[_\s-]*(?:failed|error)|(?:token|credential)[_\s-]*(?:expired|invalid)/i.test(text)) return failure("provider_auth_failed");
  if (status === 403) return failure("provider_access_denied");
  if (status === 429 || /too many requests|rate[_\s-]*limit/i.test(text)) return failure("provider_rate_limited");
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed|failed to fetch|network(?:error| error)|socket hang up|could not reach/i.test(text)) return failure("provider_network_error");
  if (/service unavailable|temporarily unavailable|bad gateway|overloaded|internal server error/i.test(text)) return failure("provider_unavailable");
  return null;
}

/** Keep actionable domain guidance; replace transport/parser jargon at the UI edge. */
export function serviceErrorMessage(value: unknown, fallback = "操作未完成，请稍后重试。") {
  const info = serviceErrorInfo(value);
  if (["unauthorized", "forbidden", "read_only", "approval_required", "host_token_required"].includes(info.code)) return info.message || fallback;
  if (/[\u3400-\u9fff]/.test(info.message)) return info.message;
  if (info.code === "internal_error" || /Unexpected server error|JSON Parse error|Unexpected (?:token|end of JSON|EOF)|is not valid JSON/.test(info.message)) return fallback;
  return classifyProviderFailure(value)?.message || info.message || fallback;
}
