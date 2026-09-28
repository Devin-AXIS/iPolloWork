import { describe, expect, test } from "bun:test";

import {
  clearHostVideoDelivery,
  currentHostVideoDelivery,
  publishHostVideoDelivery,
} from "../src/react-app/domains/session/video/video-delivery-coordination";

describe("host video delivery coordination", () => {
  test("survives a conversation-surface replacement until the exact operation completes", () => {
    const signal = {
      workspaceId: "ws-1",
      sessionId: "session-1",
      sourcePath: "video/session-1-artifact-video/index.html",
      baselineFingerprint: "before",
      operationKey: "delivery-1",
      intent: "publish-douyin" as const,
      promptText: "发布到抖音",
    };
    publishHostVideoDelivery(signal);
    expect(currentHostVideoDelivery("ws-1", "session-1")).toEqual(signal);

    clearHostVideoDelivery("ws-1", "session-1", "another-delivery");
    expect(currentHostVideoDelivery("ws-1", "session-1")).toEqual(signal);

    clearHostVideoDelivery("ws-1", "session-1", "delivery-1");
    expect(currentHostVideoDelivery("ws-1", "session-1")).toBeNull();
  });

  test("carries WeChat Channels delivery across every engine-neutral surface", () => {
    const signal = {
      workspaceId: "ws-2",
      sessionId: "session-2",
      sourcePath: "video/session-2/index.html",
      baselineFingerprint: null,
      operationKey: "delivery-2",
      intent: "publish-wechat-channels" as const,
      promptText: "生成视频并发布到视频号",
      publicationCopy: { title: "标题", description: "正文", topics: "#话题" },
    };
    publishHostVideoDelivery(signal);
    expect(currentHostVideoDelivery("ws-2", "session-2")).toEqual(signal);
    clearHostVideoDelivery("ws-2", "session-2", "delivery-2");
  });
});
