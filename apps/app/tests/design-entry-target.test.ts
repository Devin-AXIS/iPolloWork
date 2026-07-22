import { describe, expect, test } from "bun:test";

import {
  resolveTemplateEntrySurface,
  waitForTemplateEntrySurface,
} from "../src/react-app/domains/session/templates/template-entry-route";

describe("template entry surface routing", () => {
  test("routes website and Slides entries to Design", () => {
    expect(resolveTemplateEntrySurface(
      { kind: "file", value: "design/ses_site/entry.html" },
      { surface: "design", entry: "design/ses_site/entry.html" },
    )).toBe("design");
    expect(resolveTemplateEntrySurface(
      { kind: "file", value: "design/ses_slides/entry.html" },
      { surface: "design", entry: "design/ses_slides/entry.html" },
    )).toBe("design");
  });

  test("routes a Video entry to Studio", () => {
    expect(resolveTemplateEntrySurface(
      { kind: "file", value: "video/ses_video/index.html" },
      { surface: "video", entry: "video/ses_video/index.html" },
    )).toBe("video");
  });

  test("keeps ordinary HTML and non-entry files on the artifact route", () => {
    expect(resolveTemplateEntrySurface(
      { kind: "file", value: "reports/overview.html" },
      null,
    )).toBeNull();
    expect(resolveTemplateEntrySurface(
      { kind: "file", value: "design/ses_slides/brief.json" },
      { surface: "design", entry: "design/ses_slides/entry.html" },
    )).toBeNull();
  });

  test("waits for pending metadata before choosing the editor", async () => {
    let release!: (binding: { surface: "design"; entry: string } | null) => void;
    const metadata = new Promise<{ surface: "design"; entry: string } | null>((resolve) => {
      release = resolve;
    });
    const route = waitForTemplateEntrySurface(
      { kind: "file", value: "design/ses_slides/entry.html" },
      metadata,
    );

    let settled = false;
    void route.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);

    release({ surface: "design", entry: "design/ses_slides/entry.html" });
    expect(await route).toBe("design");
  });

  test("routes delayed Video metadata to Studio instead of an HTML artifact", async () => {
    let release!: (binding: { surface: "video"; entry: string } | null) => void;
    const metadata = new Promise<{ surface: "video"; entry: string } | null>((resolve) => {
      release = resolve;
    });
    const route = waitForTemplateEntrySurface(
      { kind: "file", value: "video/ses_video/index.html" },
      metadata,
    );

    release({ surface: "video", entry: "video/ses_video/index.html" });
    expect(await route).toBe("video");
  });
});
