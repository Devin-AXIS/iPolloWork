import { describe, expect, test } from "bun:test";

import {
  douyinPublicationCopyForPrompt,
  prepareDouyinPublication,
} from "../src/react-app/domains/session/video/douyin-publication";

describe("host-managed Douyin publication", () => {
  test("creates bounded publication copy from the original one-shot request", () => {
    const copy = douyinPublicationCopyForPrompt("给我做一个介绍ipollowork的短视频 发布到抖音");
    expect(copy.title).toBe("iPolloWork：让项目协作更简单");
    expect(Array.from(copy.title).length).toBeLessThanOrEqual(30);
    expect(copy.text).toContain("#iPolloWork");
  });

  test("reuses its saved draft and claims the browser job without re-importing media", async () => {
    const actions: Array<{ action: string; args: Record<string, unknown> }> = [];
    const call = async (action: string, args: Record<string, unknown>) => {
      actions.push({ action, args });
      if (action === "studio-state") return {
        ok: true,
        message: "ok",
        result: {
          accounts: [{ id: "account-1", nickname: "测试账号", browserProfileId: "profile-1", webIdentity: "douyin-1" }],
          drafts: [{ id: "draft-1", accountId: "account-1", operationKey: "delivery-1:douyin-draft", status: "draft" }],
        },
      };
      if (action === "publish-draft") return {
        ok: true,
        message: "ok",
        result: {
          job: { id: "job-1", status: "pending", targetUrl: "https://creator.douyin.com/" },
          browserTask: { jobId: "job-1" },
        },
      };
      if (action === "claim-browser-job") return {
        ok: true,
        message: "ok",
        result: {
          executionToken: "execution-secret",
          mediaPath: "C:/plugin/assets/video.mp4",
          extensionId: "douyin-ops",
        },
      };
      throw new Error(`Unexpected action ${action}`);
    };

    const result = await prepareDouyinPublication({
      call,
      sourcePath: "video/render.mp4",
      operationKey: "delivery-1",
      copy: { title: "标题", text: "正文" },
    });

    expect(result.status).toBe("browser");
    expect(actions.map((item) => item.action)).toEqual(["studio-state", "publish-draft", "claim-browser-job"]);
    expect(actions[1]?.args).toEqual({ accountId: "account-1", draftId: "draft-1", operationKey: "delivery-1:douyin-publish" });
    expect(actions[2]?.args).toEqual({ jobId: "job-1", actualProfileId: "douyin-ops:profile-1", actualAccount: "douyin-1" });
  });

  test("finishes immediately when the publisher returns a verified API receipt", async () => {
    const actions: string[] = [];
    const call = async (action: string) => {
      actions.push(action);
      if (action === "studio-state") return {
        ok: true,
        message: "ok",
        result: { accounts: [{ id: "account-1" }], drafts: [] },
      };
      if (action === "import-media") return { ok: true, message: "ok", result: { asset: { id: "asset-1" } } };
      if (action === "save-draft") return { ok: true, message: "ok", result: { draft: { id: "draft-1", accountId: "account-1" } } };
      if (action === "publish-draft") return { ok: true, message: "ok", result: { job: { id: "job-1", status: "succeeded" } } };
      throw new Error(`Unexpected action ${action}`);
    };

    const result = await prepareDouyinPublication({
      call,
      sourcePath: "video/render.mp4",
      operationKey: "delivery-2",
      copy: { title: "标题", text: "正文" },
    });

    expect(result.status).toBe("succeeded");
    expect(actions).toEqual(["studio-state", "import-media", "save-draft", "publish-draft"]);
  });

  test("does not guess when more than one publication account exists", async () => {
    await expect(prepareDouyinPublication({
      call: async () => ({
        ok: true,
        message: "ok",
        result: { accounts: [{ id: "account-1" }, { id: "account-2" }], drafts: [] },
      }),
      sourcePath: "video/render.mp4",
      operationKey: "delivery-3",
      copy: { title: "标题", text: "正文" },
    })).rejects.toThrow("多个账号");
  });
});
