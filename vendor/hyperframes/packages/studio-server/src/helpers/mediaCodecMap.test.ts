import { expect, it } from "vitest";
import { decideMediaProxyEligibility, probeAssetCodec } from "./mediaCodecMap";

it.each(["ALPHA_MODE", "alpha_mode"])("preserves WebM transparency reported by %s", async (tag) => {
  const facts = await probeAssetCodec("person.webm", (_command, args) => {
    expect(args.join(" ")).toContain("stream_tags=alpha_mode");
    return { status: 0, stderr: "", stdout: JSON.stringify({ streams: [{
      codec_type: "video", codec_name: "vp9", pix_fmt: "yuv420p", tags: { [tag]: "1" },
    }] }) };
  });
  expect(facts?.hasAlpha).toBe(true);
  expect(decideMediaProxyEligibility(facts)).toEqual({ eligible: false, reason: "alpha_source" });
});

it.each([["yuv420p", false], ["yuva420p", true]])("keeps pixel-format alpha detection for %s", async (pixelFormat, hasAlpha) => {
  const facts = await probeAssetCodec("video.webm", () => ({ status: 0, stderr: "", stdout: JSON.stringify({
    streams: [{ codec_type: "video", codec_name: "vp9", pix_fmt: pixelFormat }],
  }) }));
  expect(facts?.hasAlpha).toBe(hasAlpha);
});
