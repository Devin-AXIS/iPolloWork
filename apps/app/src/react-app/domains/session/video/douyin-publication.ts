type ExtensionActionResponse = {
  ok: boolean;
  message: string;
  result?: unknown;
};

type ExtensionActionCaller = (
  action: string,
  args: Record<string, unknown>,
) => Promise<ExtensionActionResponse>;

type DouyinAccount = {
  id: string;
  nickname?: string;
  browserProfileId?: string;
  webIdentity?: string;
};

type DouyinDraft = {
  id: string;
  accountId: string;
  operationKey?: string;
  status?: string;
};

type DouyinJob = {
  id: string;
  status: string;
  message?: string;
  targetUrl?: string;
  result?: Record<string, unknown>;
};

export type DouyinPublicationCopy = {
  title: string;
  text: string;
};

export type PreparedDouyinPublication =
  | { status: "succeeded"; job: DouyinJob }
  | {
      status: "browser";
      job: DouyinJob;
      account: DouyinAccount;
      executionToken: string;
      profileId: string;
      mediaPath: string;
      extensionId: string;
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
  if (!response.ok) throw new Error(response.message || `Douyin ${action} failed.`);
  const result = record(response.result);
  if (!result) throw new Error(`Douyin ${action} returned an unreadable result.`);
  return result;
}

function parseAccount(value: unknown): DouyinAccount | null {
  const input = record(value);
  const id = text(input?.id);
  if (!input || !id) return null;
  return {
    id,
    ...(text(input.nickname) ? { nickname: text(input.nickname) } : {}),
    ...(text(input.browserProfileId) ? { browserProfileId: text(input.browserProfileId) } : {}),
    ...(text(input.webIdentity) ? { webIdentity: text(input.webIdentity) } : {}),
  };
}

function parseDraft(value: unknown): DouyinDraft | null {
  const input = record(value);
  const id = text(input?.id);
  const accountId = text(input?.accountId);
  if (!input || !id || !accountId) return null;
  return {
    id,
    accountId,
    ...(text(input.operationKey) ? { operationKey: text(input.operationKey) } : {}),
    ...(text(input.status) ? { status: text(input.status) } : {}),
  };
}

export function parseDouyinJob(value: unknown): DouyinJob | null {
  const input = record(value);
  const id = text(input?.id);
  const status = text(input?.status);
  if (!input || !id || !status) return null;
  return {
    id,
    status,
    ...(text(input.message) ? { message: text(input.message) } : {}),
    ...(text(input.targetUrl) ? { targetUrl: text(input.targetUrl) } : {}),
    ...(record(input.result) ? { result: record(input.result)! } : {}),
  };
}

function truncate(value: string, limit: number) {
  return Array.from(value).slice(0, limit).join("");
}

/** Build usable publication copy when the model has authored video visuals but not social metadata. */
export function douyinPublicationCopyForPrompt(promptText: string): DouyinPublicationCopy {
  const topic = promptText
    .replace(/(?:请|麻烦)?(?:给我|帮我)?(?:做|制作|生成|创建)(?:一个|一条)?/gi, "")
    .replace(/(?:然后|并且|并)?(?:发布|上传|发到|发至).{0,12}抖音/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (/ipollowork/i.test(topic || promptText)) {
    return {
      title: "iPolloWork：让项目协作更简单",
      text: "iPolloWork 把想法、素材、AI Agent 和交付流程放进同一个项目空间，从创作、校验到发布，一次需求持续推进。#iPolloWork #AI工作流 #效率工具",
    };
  }
  const subject = topic || "本期短视频";
  return {
    title: truncate(subject, 30),
    text: truncate(`${subject}。由 iPolloWork 完成创作、校验与发布。#iPolloWork`, 1000),
  };
}

function terminalJobError(job: DouyinJob) {
  if (job.status === "failed") return new Error(job.message || "Douyin rejected the publication.");
  if (job.status === "uncertain") return new Error(job.message || "Douyin publication is uncertain; verify it before retrying.");
  return null;
}

/**
 * Deterministically performs the publisher steps that do not require page
 * semantics. The model receives only a claimed browser job, never the fragile
 * import/draft/publish plumbing or a reason to ask for a manual file picker.
 */
export async function prepareDouyinPublication(input: {
  call: ExtensionActionCaller;
  sourcePath: string;
  operationKey: string;
  copy: DouyinPublicationCopy;
}): Promise<PreparedDouyinPublication> {
  const draftRunKey = `${input.operationKey}:douyin-draft`;
  const publishOperationKey = `${input.operationKey}:douyin-publish`;
  const state = resultRecord(await input.call("studio-state", {}), "studio-state");
  const accounts = Array.isArray(state.accounts) ? state.accounts.map(parseAccount).filter(Boolean) as DouyinAccount[] : [];
  if (accounts.length === 0) throw new Error("请先在抖音运营台连接并核对一个抖音账号，然后本任务会继续自动发布。");
  if (accounts.length > 1) throw new Error("抖音运营台存在多个账号，无法安全判断本次发布目标；请先只保留或明确选择一个账号。");
  const account = accounts[0]!;
  const savedDrafts = Array.isArray(state.drafts) ? state.drafts.map(parseDraft).filter(Boolean) as DouyinDraft[] : [];
  let draft = savedDrafts.find((item) => item.accountId === account.id && item.operationKey === draftRunKey) ?? null;

  if (!draft) {
    const imported = resultRecord(await input.call("import-media", { sourcePath: input.sourcePath }), "import-media");
    const asset = record(imported.asset);
    const assetId = text(asset?.id);
    if (!assetId) throw new Error("Douyin import-media completed without an asset ID.");
    const saved = resultRecord(await input.call("save-draft", {
      accountId: account.id,
      title: input.copy.title,
      text: input.copy.text,
      assetId,
      runKey: draftRunKey,
    }), "save-draft");
    draft = parseDraft(saved.draft);
    if (!draft) throw new Error("Douyin save-draft completed without a draft ID.");
  }

  const publication = resultRecord(await input.call("publish-draft", {
    accountId: account.id,
    draftId: draft.id,
    operationKey: publishOperationKey,
  }), "publish-draft");
  const job = parseDouyinJob(publication.job);
  if (!job) throw new Error("Douyin publish-draft completed without a readable job.");
  if (job.status === "succeeded") return { status: "succeeded", job };
  const jobError = terminalJobError(job);
  if (jobError) throw jobError;
  if (!record(publication.browserTask)) {
    throw new Error(job.message || `Douyin publication stopped in ${job.status} without a browser task.`);
  }
  if (!account.browserProfileId || !account.webIdentity) {
    throw new Error("请先在抖音运营台完成网页登录和账号核对，然后本任务会继续自动发布。");
  }

  const profileId = `douyin-ops:${account.browserProfileId}`;
  const claimed = resultRecord(await input.call("claim-browser-job", {
    jobId: job.id,
    actualProfileId: profileId,
    actualAccount: account.webIdentity,
  }), "claim-browser-job");
  const executionToken = text(claimed.executionToken);
  const mediaPath = text(claimed.mediaPath);
  const extensionId = text(claimed.extensionId);
  if (!executionToken || !mediaPath || !extensionId) {
    throw new Error("Douyin browser job was claimed without its execution token or generated MP4 path.");
  }
  return {
    status: "browser",
    job,
    account,
    executionToken,
    profileId,
    mediaPath,
    extensionId,
    targetUrl: job.targetUrl || "https://creator.douyin.com/creator-micro/content/post/video?enter_from=publish_page",
  };
}
