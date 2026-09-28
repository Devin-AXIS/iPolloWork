type ExtensionActionResponse = {
  ok: boolean;
  message: string;
  result?: unknown;
};

type ExtensionActionCaller = (
  action: string,
  args: Record<string, unknown>,
) => Promise<ExtensionActionResponse>;

type WechatChannelsAccount = {
  id: string;
  name?: string;
  channelId: string;
  browserProfileId: string;
  status?: string;
};

type WechatChannelsDraft = {
  id: string;
  accountId: string;
  operationKey?: string;
};

export type WechatChannelsJob = {
  id: string;
  status: string;
  evidence?: string;
  resultUrl?: string;
};

export type WechatChannelsPublicationCopy = {
  title: string;
  description: string;
  topics: string;
};

export type PreparedWechatChannelsPublication =
  | { status: "succeeded"; job: WechatChannelsJob }
  | {
      status: "browser";
      job: WechatChannelsJob;
      account: WechatChannelsAccount;
      profileId: string;
      targetUrl: string;
    };

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function resultRecord(response: ExtensionActionResponse, action: string) {
  if (!response.ok) throw new Error(response.message || `WeChat Channels ${action} failed.`);
  const result = record(response.result);
  if (!result) throw new Error(`WeChat Channels ${action} returned an unreadable result.`);
  return result;
}

function parseAccount(value: unknown): WechatChannelsAccount | null {
  const input = record(value);
  const id = text(input?.id);
  const channelId = text(input?.channelId);
  const browserProfileId = text(input?.browserProfileId);
  if (!input || !id || !browserProfileId) return null;
  return {
    id,
    channelId,
    browserProfileId,
    ...(text(input.name) ? { name: text(input.name) } : {}),
    ...(text(input.status) ? { status: text(input.status) } : {}),
  };
}

function publicationAccount(accounts: WechatChannelsAccount[]) {
  const verified = accounts.filter((account) => account.status === "verified");
  if (verified.length > 1) {
    throw new Error("视频号运营台存在多个已核对账号，无法安全判断本次发布目标；请先明确选择账号。");
  }
  if (verified.length === 1) return verified[0]!;

  const recoverable = accounts.filter((account) => !["conflict", "mismatch"].includes(account.status ?? ""));
  if (recoverable.length === 0) {
    throw new Error("请先在视频号运营台添加一个视频号账号，然后本任务会从已生成的 MP4 继续自动发布。");
  }
  if (recoverable.length > 1) {
    throw new Error("视频号运营台存在多个待核对账号，无法安全判断本次发布目标；请先明确选择账号。");
  }
  return recoverable[0]!;
}

function parseDraft(value: unknown): WechatChannelsDraft | null {
  const input = record(value);
  const id = text(input?.id);
  const accountId = text(input?.accountId);
  if (!input || !id || !accountId) return null;
  return {
    id,
    accountId,
    ...(text(input.operationKey) ? { operationKey: text(input.operationKey) } : {}),
  };
}

export function parseWechatChannelsJob(value: unknown): WechatChannelsJob | null {
  const input = record(value);
  const id = text(input?.id);
  const status = text(input?.status);
  if (!input || !id || !status) return null;
  return {
    id,
    status,
    ...(text(input.evidence) ? { evidence: text(input.evidence) } : {}),
    ...(text(input.resultUrl) ? { resultUrl: text(input.resultUrl) } : {}),
  };
}

function truncate(value: string, limit: number) {
  return Array.from(value).slice(0, limit).join("");
}

export function wechatChannelsPublicationCopyForPrompt(promptText: string): WechatChannelsPublicationCopy {
  const topic = promptText
    .replace(/(?:请|麻烦)?(?:给我|帮我)?(?:做|制作|生成|创建)(?:一个|一条)?/gi, "")
    .replace(/(?:然后|并且|并)?(?:发布|上传|发到|发至).{0,12}(?:微信)?视频号/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/ipollowork/i.test(topic || promptText)) {
    return {
      title: "iPolloWork：让项目协作更简单",
      description: "iPolloWork 把想法、素材、AI Agent 和交付流程放进同一个项目空间，从创作、校验到发布，一次需求持续推进。",
      topics: "#iPolloWork #AI工作流 #效率工具",
    };
  }
  const subject = topic || "本期短视频";
  return {
    title: truncate(subject, 100),
    description: truncate(`${subject}。由 iPolloWork 完成创作、校验与发布。`, 2000),
    topics: "#iPolloWork",
  };
}

function terminalJobError(job: WechatChannelsJob) {
  if (job.status === "failed" || job.status === "blocked") {
    return new Error(job.evidence || `WeChat Channels publication ended as ${job.status}.`);
  }
  if (job.status === "uncertain") {
    return new Error(job.evidence || "视频号发布结果待核对；为避免重复发布，本次不会自动重试。");
  }
  return null;
}

/**
 * Owns the deterministic media/draft/job setup for every engine. Browser page
 * semantics remain in the follow-up turn because account identity must be
 * verified from the visible WeChat Channels Assistant page immediately before
 * the job is claimed.
 */
export async function prepareWechatChannelsPublication(input: {
  call: ExtensionActionCaller;
  sourcePath: string;
  operationKey: string;
  copy: WechatChannelsPublicationCopy;
}): Promise<PreparedWechatChannelsPublication> {
  const draftRunKey = `${input.operationKey}:wechat-channels-draft`;
  const publishOperationKey = `${input.operationKey}:wechat-channels-publish`;
  const state = resultRecord(await input.call("studio-state", {}), "studio-state");
  const accounts = Array.isArray(state.accounts)
    ? state.accounts.map(parseAccount).filter((account): account is WechatChannelsAccount => Boolean(account))
    : [];
  const account = publicationAccount(accounts);
  const savedDrafts = Array.isArray(state.drafts)
    ? state.drafts.map(parseDraft).filter(Boolean) as WechatChannelsDraft[]
    : [];
  let draft = savedDrafts.find((item) => item.accountId === account.id && item.operationKey === draftRunKey) ?? null;

  if (!draft) {
    const imported = resultRecord(await input.call("import-media", { sourcePath: input.sourcePath }), "import-media");
    const asset = record(imported.asset);
    const assetId = text(asset?.id);
    if (!assetId) throw new Error("WeChat Channels import-media completed without an asset ID.");
    const saved = resultRecord(await input.call("save-draft", {
      accountId: account.id,
      title: input.copy.title,
      description: input.copy.description,
      topics: input.copy.topics,
      assetId,
      runKey: draftRunKey,
    }), "save-draft");
    draft = parseDraft(saved.draft);
    if (!draft) throw new Error("WeChat Channels save-draft completed without a draft ID.");
  }

  const prepared = resultRecord(await input.call("prepare-job", {
    accountId: account.id,
    type: "publish",
    draftId: draft.id,
    operationKey: publishOperationKey,
  }), "prepare-job");
  const job = parseWechatChannelsJob(prepared.job);
  if (!job) throw new Error("WeChat Channels prepare-job completed without a readable job.");
  if (["submitted", "reviewing", "published"].includes(job.status)) return { status: "succeeded", job };
  const jobError = terminalJobError(job);
  if (jobError) throw jobError;
  if (job.status !== "prepared") {
    throw new Error(job.evidence || `WeChat Channels publication stopped in ${job.status}; inspect the existing job before retrying.`);
  }

  const target = resultRecord(await input.call("browser-target", { accountId: account.id }), "browser-target");
  const profileId = text(target.profileId);
  const targetUrl = text(target.url);
  if (!profileId || !targetUrl) throw new Error("WeChat Channels browser-target returned an incomplete account browser target.");
  return { status: "browser", job, account, profileId, targetUrl };
}
