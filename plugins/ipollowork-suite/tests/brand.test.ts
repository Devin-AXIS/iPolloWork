import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { BRAND_PATH, brandIndex, serveBrand } from "../src/host/brand.ts";

const DSH_INDEX = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <link rel="manifest" href="./manifest.webmanifest" />
    <link rel="apple-touch-icon" href="./apple-touch-icon.png" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="DSH" />
    <link rel="icon" type="image/svg+xml" href="./favicon-dark.svg" media="(prefers-color-scheme: dark)" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" media="(prefers-color-scheme: light)" />
    <title>DeepSeek Harness</title>
    <script type="module" crossorigin src="./assets/index.js"></script>
  </head>
  <body><div id="root"></div></body>
</html>`;

test("the served page carries iPolloWork's title, icons and manifest", () => {
  const html = brandIndex(DSH_INDEX);
  assert.match(html, /<title>iPolloWork<\/title>/);
  assert.match(html, /apple-mobile-web-app-title" content="iPolloWork"/);
  assert.doesNotMatch(html, /DeepSeek|favicon-dark|\.\/manifest|\.\/apple-touch/);
  assert.equal(html.match(/rel="icon"/g)?.length, 1);
  assert.match(html, new RegExp(`href="${BRAND_PATH}/favicon.svg"`));
  assert.match(html, new RegExp(`href="${BRAND_PATH}/manifest.webmanifest"`));
  assert.match(html, /<script type="module" crossorigin src="\.\/assets\/index\.js"><\/script>/);
});

test("brand files are served by name only", async () => {
  const server = createServer((request, response) => void serveBrand(request, response));
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const address = server.address();
  assert(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}${BRAND_PATH}`;
  try {
    const icon = await fetch(`${base}/favicon.svg`);
    assert.equal(icon.status, 200);
    assert.equal(icon.headers.get("content-type"), "image/svg+xml");
    const manifest = await fetch(`${base}/manifest.webmanifest`);
    assert.equal((await manifest.json()).name, "iPolloWork");
    assert.equal((await fetch(`${base}/app-icon.png`)).headers.get("content-type"), "image/png");
    for (const name of ["../package.json", "%2e%2e/package.json", "LICENSE", ""])
      assert.equal((await fetch(`${base}/${name}`)).status, 404);
    assert.equal((await fetch(`${base}/favicon.svg`, { method: "POST" })).status, 404);
  } finally {
    await new Promise<void>((done, reject) => server.close((error) => (error ? reject(error) : done())));
  }
});
