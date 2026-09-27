import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaPreview } from "./MediaPreview";

describe("shared media preview", () => {
  it("encodes local image names without treating # as a URL fragment", () => {
    const html = renderToStaticMarkup(
      <MediaPreview projectId="test" filePath="assets/图片 #1.png" />,
    );
    expect(html).toContain("<img");
    expect(html).toContain(
      "/api/projects/test/preview/assets/%E5%9B%BE%E7%89%87%20%231.png",
    );
  });

  it.each(["image.png", "movie.mp4", "sound.wav"])(
    "recognizes signed URLs for %s",
    (name) => {
      const html = renderToStaticMarkup(
        <MediaPreview
          projectId="test"
          filePath={`https://example.com/${name}?version=2#preview`}
        />,
      );
      expect(html).toContain(
        `src="https://example.com/${name}?version=2#preview"`,
      );
      expect(html).not.toContain("/api/projects/");
      expect(html).not.toContain("autoPlay");
      expect(html).not.toContain("muted");
    },
  );

  it("does not crash on an unfinished external reference", () => {
    expect(() =>
      renderToStaticMarkup(
        <MediaPreview projectId="test" filePath="https://" />,
      ),
    ).not.toThrow();
  });
});
