import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { serveStaticProjectHtml, type StaticProjectServer } from "./staticProjectServer";

describe("serveStaticProjectHtml", () => {
  let server: StaticProjectServer | undefined;
  let projectDir: string | undefined;

  afterEach(async () => {
    await server?.close();
    if (projectDir) rmSync(projectDir, { recursive: true, force: true });
  });

  test("serves composition HTML as UTF-8", async () => {
    projectDir = mkdtempSync(join(tmpdir(), "hyperframes-static-project-"));
    const html =
      '<!doctype html><html data-composition-variables=\'[{"id":"title","default":"运河边的夜校"}]\'><body>运河边的夜校</body></html>';
    server = await serveStaticProjectHtml(projectDir, html);

    const response = await fetch(server.url);

    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe(html);
  });
});
