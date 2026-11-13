/** Safe, shared error vocabulary for provider boundaries and their UI consumers. */
export const providerFailureMessages = {
  provider_unavailable: "第三方服务暂时不可用，请稍后重试。",
  provider_timeout: "第三方服务响应超时，请稍后重试。",
  provider_network_error: "网络连接失败，请检查网络或代理设置后重试。",
  provider_auth_failed: "第三方服务授权已失效，请检查 API Key 或重新登录授权。",
  provider_client_restricted: "OpenCode 免费服务拒绝了当前请求（403）。请刷新模型配置后重试；若仍失败，可切换其他已授权的模型。",
  provider_region_restricted: "该模型暂不在当前地区提供服务，请切换其他模型或向服务商确认支持范围。",
  provider_access_denied: "当前账号无权使用该第三方服务或模型，请检查权限和服务开通情况。",
  provider_model_unavailable: "当前模型不可用，请切换其他模型后重试。",
  provider_invalid_request: "模型不接受本次请求，请调整输入或切换模型后重试。",
  provider_content_filtered: "模型服务拦截了本次内容，请调整输入后重试。",
  provider_context_overflow: "对话内容超过模型的上下文上限，请缩短输入或新建会话。",
  provider_output_limit: "模型达到输出上限，回复未完整生成。",
  provider_empty_response: "模型没有返回最终内容，请重试或切换模型。",
  provider_quota_exhausted: "第三方服务余额或额度不足，请检查余额、用量限制或等待额度恢复。",
  provider_rate_limited: "第三方服务请求过于频繁，请稍后重试。",
} satisfies Record<string, string>;

export type ProviderFailureCode = keyof typeof providerFailureMessages;
export type ProviderFailure = { code: ProviderFailureCode; message: string };

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

export function serviceErrorInfo(value: unknown): { status?: number; code: string; message: string; name: string } {
  const raw = typeof value === "string" ? value : record(value)?.message;
  const root = record(value) ?? {};
  let decoded: Record<string, unknown> | undefined;
  if (typeof raw === "string" && raw.trimStart().startsWith("{")) {
    try { decoded = record(JSON.parse(raw)); } catch { /* The classifier also accepts text errors. */ }
  }
  const entries = [root, decoded, record(root.error), record(root.data), record(root.cause), record(decoded?.error), record(decoded?.data)];
  const findString = (keys: string[]) => entries.flatMap((entry) => keys.map((key) => entry?.[key]))
    .find((entry): entry is string => typeof entry === "string" && entry.length > 0) ?? "";
  const status = entries.flatMap((entry) => [entry?.status, entry?.statusCode]).find((entry): entry is number => typeof entry === "number");
  const message = typeof value === "string" ? value : findString(["message", "errorMessage", "msg", "detail", "reason"]);
  return { status, code: findString(["code", "errorCode"]), message: message.slice(0, 4096), name: findString(["name", "type"]) };
}

/** Does not treat every error (e.g. invalid local input) as a provider outage. */
export function classifyProviderFailure(value: unknown): ProviderFailure | null {
  const info = serviceErrorInfo(value);
  const root = record(value);
  const responseBody = record(root?.data)?.responseBody ?? root?.responseBody;
  const text = `${info.code} ${info.message} ${typeof responseBody === "string" ? responseBody.slice(0, 4096) : ""}`;
  const status = info.status ?? Number(/(?:HTTP\s*|status(?:\s+code)?[\s:=]+|\()(\d{3})(?:\b|\))/.exec(text)?.[1] || 0);
  const failure = (code: ProviderFailureCode): ProviderFailure => ({ code, message: providerFailureMessages[code] });
  for (const code of Object.keys(providerFailureMessages)) {
    const knownCode = code as ProviderFailureCode;
    if (info.code === knownCode || info.message === providerFailureMessages[knownCode]) return failure(knownCode);
  }
  if (status === 504 || status === 408 || /TimeoutError|AbortError/.test(info.name) || /\b(?:timed? out|timeout)\b/i.test(text)) return failure("provider_timeout");
  if (status >= 500 && status <= 599) return failure("provider_unavailable");
  if (/free[_\s-]*usage[_\s-]*(?:exceeded|exhausted|limit(?:[_\s-]*(?:exceeded|reached))?)/i.test(text)) {
    return {
      code: "provider_quota_exhausted",
      message: "当前免费模型的可用额度暂时已用尽。请等待额度恢复，或手动选择其他免费模型后重试。",
    };
  }
  // A billing-related 429 is not a request-rate limit; waiting seconds will not fix it.
  if (status === 402 || /insufficient[_\s-]*(?:quota|balance|credit)|quota[_\s-]*(?:exceeded|exhausted)|usageLimitExceeded|(?:free[_\s-]*)?usage[_\s-]*limit(?:[_\s-]*(?:exceeded|reached))?|billing[_\s-]*(?:hard[_\s-]*)?limit|(?:余额|额度)不足|额度已用完/i.test(text)) return failure("provider_quota_exhausted");
  if (status === 401 || /invalid[_\s-]*(?:api[_\s-]*)?key|unauthorized|authentication[_\s-]*(?:failed|error)|(?:token|credential)[_\s-]*(?:expired|invalid)|no api key for provider route|missing[_ -]?credential|API Key.*then try again|模型登录凭证已过期|模型设置中添加.*API Key/i.test(text)) return failure("provider_auth_failed");
  // OpenCode reports free-tier and region rejections as 403 too; neither
  // alone establishes that the account is missing a model entitlement.
  if (/FreeTierError|OpenCode(?:['’]s)? free tier can only be used (?:from within|within|in) OpenCode/i.test(text)) return failure("provider_client_restricted");
  if (/RegionError|(?:model|service) is not available in your (?:country|region)|unsupported[_\s-]*(?:country|region)/i.test(text)) return failure("provider_region_restricted");
  if (/ProviderModelNotFoundError|model[_\s-]*not[_\s-]*(?:found|supported)|model[_ -]*(?:unavailable|deprecated|decommissioned|retired)|unsupported[_\s-]+model|\bmodel\b[^\n]{0,120}\b(?:does not exist|is not supported|is not available|not found|has been retired|has been deprecated)\b|模型(?:已下架|已下线|不存在)|当前模型不可用|This model is unavailable/i.test(`${info.name} ${text}`)) return failure("provider_model_unavailable");
  if (status === 403 || /ModelNotOpen|model[_\s-]*not[_\s-]*(?:activated|enabled)|has not activated (?:the )?model/i.test(text)) return failure("provider_access_denied");
  if (status === 429 || /too many requests|rate[_\s-]*limit|limit_requests/i.test(text)) return failure("provider_rate_limited");
  if (/ContextOverflowError|context[_ -]*length[_ -]*exceeded|maximum context length|context window.*(?:too large|exceed)|上下文上限/i.test(`${info.name} ${text}`)) return failure("provider_context_overflow");
  if (/MessageOutputLengthError|模型达到输出上限|model reached its output limit/i.test(`${info.name} ${text}`)) return failure("provider_output_limit");
  if (/ContentFilterError|content[_ -]*filter(?:ed|ing)?\b|data_inspection_failed|模型服务拦截/i.test(`${info.name} ${text}`)) return failure("provider_content_filtered");
  if (/invalid_parameter_error|StructuredOutputError|file part media type.*not supported|模型不接受本次请求/i.test(`${info.name} ${text}`)) return failure("provider_invalid_request");
  if (/没有返回(?:最终内容|最终结果)|no final (?:output|response)|model returned no (?:text|output)/i.test(text)) return failure("provider_empty_response");
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
