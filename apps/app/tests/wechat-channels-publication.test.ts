import { describe, expect, test } from "bun:test";

import {
  prepareWechatChannelsPublication,
  wechatChannelsPublicationCopyForPrompt,
} from "../src/react-app/domains/session/video/wechat-channels-publication";

describe("host-managed WeChat Channels publication", () => {
  test("creates bounded publication copy from the original one-shot request", () => {
    const copy = wechatChannelsPublicationCopyForPrompt("给我做一个介绍ipollowork的短视频并发布到微信视频号");
    expect(copy.title).toBe("iPolloWork：让项目协作更简单");
    expect(copy.description).toContain("一次需求持续推进");
    expect(copy.topics).toContain("#iPolloWork");
    const namedCopy = wechatChannelsPublicationCopyForPrompt("制作 iPolloWork 短视频，作品标题《iPolloWork：多引擎协作》并发布到视频号");
    expect(namedCopy.title).toBe("iPolloWork：多引擎协作");
    expect(namedCopy.description).toContain("iPolloWork：多引擎协作");
  });

  test("reuses the generated-media draft and prepares one account-specific browser job", async () => {
    const actions: Array<{ action: string; args: Record<string, unknown> }> = [];
    const call = async (action: string, args: Record<string, unknown>) => {
      actions.push({ action, args });
      if (action === "studio-state") return {
        ok: true,
        message: "ok",
        result: {
          accounts: [{ id: "account-1", name: "测试视频号", channelId: "sph-1", browserProfileId: "profile-1", status: "verified" }],
          drafts: [{ id: "draft-1", accountId: "account-1", operationKey: "delivery-1:wechat-channels-draft" }],
        },
      };
      if (action === "prepare-job") return { ok: true, message: "ok", result: { job: { id: "job-1", status: "prepared" } } };
      if (action === "browser-target") return {
        ok: true,
        message: "ok",
        result: { url: "https://channels.weixin.qq.com/platform/", profileId: "wechat-channels-ops:profile-1" },
      };
      throw new Error(`Unexpected action ${action}`);
    };

    const result = await prepareWechatChannelsPublication({
      call,
      sourcePath: "video/render.mp4",
      operationKey: "delivery-1",
      copy: { title: "标题", description: "正文", topics: "#话题" },
    });

    expect(result.status).toBe("browser");
    expect(actions.map((item) => item.action)).toEqual(["studio-state", "prepare-job", "browser-target"]);
    expect(actions[1]?.args).toEqual({
      accountId: "account-1",
      type: "publish",
      draftId: "draft-1",
      operationKey: "delivery-1:wechat-channels-publish",
    });
  });

  test("imports the rendered MP4 once and persists idempotent copy", async () => {
    const actions: Array<{ action: string; args: Record<string, unknown> }> = [];
    const call = async (action: string, args: Record<string, unknown>) => {
      actions.push({ action, args });
      if (action === "studio-state") return {
        ok: true,
        message: "ok",
        result: {
          accounts: [{ id: "account-1", channelId: "sph-1", browserProfileId: "profile-1", status: "verified" }],
          drafts: [],
        },
      };
      if (action === "import-media") return { ok: true, message: "ok", result: { asset: { id: "asset-1" } } };
      if (action === "save-draft") return { ok: true, message: "ok", result: { draft: { id: "draft-1", accountId: "account-1" } } };
      if (action === "prepare-job") return { ok: true, message: "ok", result: { job: { id: "job-1", status: "prepared" } } };
      if (action === "browser-target") return {
        ok: true,
        message: "ok",
        result: { url: "https://channels.weixin.qq.com/platform/", profileId: "wechat-channels-ops:profile-1" },
      };
      throw new Error(`Unexpected action ${action}`);
    };

    await prepareWechatChannelsPublication({
      call,
      sourcePath: "video/render.mp4",
      operationKey: "delivery-2",
      copy: { title: "标题", description: "正文", topics: "#话题" },
    });

    expect(actions.map((item) => item.action)).toEqual([
      "studio-state", "import-media", "save-draft", "prepare-job", "browser-target",
    ]);
    expect(actions[2]?.args).toMatchObject({
      accountId: "account-1",
      assetId: "asset-1",
      runKey: "delivery-2:wechat-channels-draft",
    });
  });

  test("keeps the prepared job queued when another submission needs reconciliation", async () => {
    const actions: string[] = [];
    const call = async (action: string) => {
      actions.push(action);
      if (action === "studio-state") return {
        ok: true,
        message: "ok",
        result: {
          accounts: [{ id: "account-1", channelId: "sph-1", browserProfileId: "profile-1", status: "verified" }],
          drafts: [{ id: "draft-1", accountId: "account-1", operationKey: "delivery-queued:wechat-channels-draft" }],
          jobs: [{ id: "earlier-job", accountId: "account-1", status: "uncertain" }],
        },
      };
      if (action === "prepare-job") return { ok: true, message: "ok", result: { job: { id: "queued-job", status: "prepared" } } };
      throw new Error(`Unexpected action ${action}`);
    };

    await expect(prepareWechatChannelsPublication({
      call,
      sourcePath: "video/render.mp4",
      operationKey: "delivery-queued",
      copy: { title: "标题", description: "正文", topics: "#话题" },
    })).rejects.toThrow("待发布任务已保存");
    expect(actions).toEqual(["studio-state", "prepare-job"]);
  });

  test("continues through the one recoverable account browser when login needs revalidation", async () => {
    const actions: Array<{ action: string; args: Record<string, unknown> }> = [];
    const call = async (action: string, args: Record<string, unknown>) => {
      actions.push({ action, args });
      if (action === "studio-state") return {
        ok: true,
        message: "ok",
        result: {
          accounts: [
            { id: "account-recoverable", channelId: "", browserProfileId: "profile-1", status: "connecting" },
            { id: "account-conflict", channelId: "sph-1", browserProfileId: "profile-2", status: "conflict" },
          ],
          drafts: [],
        },
      };
      if (action === "import-media") return { ok: true, message: "ok", result: { asset: { id: "asset-1" } } };
      if (action === "save-draft") return { ok: true, message: "ok", result: { draft: { id: "draft-1", accountId: "account-recoverable" } } };
      if (action === "prepare-job") return { ok: true, message: "ok", result: { job: { id: "job-1", status: "prepared" } } };
      if (action === "browser-target") return {
        ok: true,
        message: "ok",
        result: { url: "https://channels.weixin.qq.com/platform/", profileId: "wechat-channels-ops:profile-1" },
      };
      throw new Error(`Unexpected action ${action}`);
    };

    const result = await prepareWechatChannelsPublication({
      call,
      sourcePath: "video/render.mp4",
      operationKey: "delivery-recoverable",
      copy: { title: "标题", description: "正文", topics: "#话题" },
    });

    expect(result).toMatchObject({
      status: "browser",
      account: { id: "account-recoverable", channelId: "", status: "connecting" },
      profileId: "wechat-channels-ops:profile-1",
    });
    expect(actions.map((item) => item.action)).toEqual([
      "studio-state", "import-media", "save-draft", "prepare-job", "browser-target",
    ]);
  });

  test("refuses conflicted or ambiguous account state", async () => {
    await expect(prepareWechatChannelsPublication({
      call: async () => ({
        ok: true,
        message: "ok",
        result: { accounts: [{ id: "account-1", channelId: "sph-1", browserProfileId: "profile-1", status: "conflict" }], drafts: [] },
      }),
      sourcePath: "video/render.mp4",
      operationKey: "delivery-3",
      copy: { title: "标题", description: "正文", topics: "" },
    })).rejects.toThrow("添加一个视频号账号");

    await expect(prepareWechatChannelsPublication({
      call: async () => ({
        ok: true,
        message: "ok",
        result: {
          accounts: [
            { id: "account-1", channelId: "sph-1", browserProfileId: "profile-1", status: "verified" },
            { id: "account-2", channelId: "sph-2", browserProfileId: "profile-2", status: "verified" },
          ],
          drafts: [],
        },
      }),
      sourcePath: "video/render.mp4",
      operationKey: "delivery-4",
      copy: { title: "标题", description: "正文", topics: "" },
    })).rejects.toThrow("多个已核对账号");

    await expect(prepareWechatChannelsPublication({
      call: async () => ({
        ok: true,
        message: "ok",
        result: {
          accounts: [
            { id: "account-1", channelId: "", browserProfileId: "profile-1", status: "connecting" },
            { id: "account-2", channelId: "", browserProfileId: "profile-2", status: "expired" },
          ],
          drafts: [],
        },
      }),
      sourcePath: "video/render.mp4",
      operationKey: "delivery-5",
      copy: { title: "标题", description: "正文", topics: "" },
    })).rejects.toThrow("多个待核对账号");
  });
});
