/** iPolloWork identity in the page DSH serves, so the title and icons are right before any client plugin loads. */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Anonymous route for brand files; the page requests them before it is signed in, like DSH's own icons. */
export const BRAND_PATH = "/ipollowork-suite/brand";
const TITLE = "iPolloWork";
const FILES: Readonly<Record<string, string>> = {
  "favicon.svg": "image/svg+xml",
  "mark.svg": "image/svg+xml",
  "app-icon.png": "image/png",
  "apple-touch-icon.png": "image/png",
  "manifest.webmanifest": "application/manifest+json",
};

/**
 * Give the served page iPolloWork's title, tab icon, home-screen icon and install manifest.
 * @param html - the index document DSH renders for one page.
 * @returns the document with DSH's title, icons and manifest replaced.
 */
export function brandIndex(html: string): string {
  const head = [
    `<link rel="icon" type="image/svg+xml" href="${BRAND_PATH}/favicon.svg" />`,
    `<link rel="apple-touch-icon" href="${BRAND_PATH}/apple-touch-icon.png" />`,
    `<link rel="manifest" href="${BRAND_PATH}/manifest.webmanifest" />`,
  ].join("\n    ");
  return html
    .replace(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\s*/g, "")
    .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${TITLE}$2`)
    .replace("</head>", `  ${head}\n  </head>`);
}

/**
 * Answer one brand file request.
 * @param request - a GET under {@link BRAND_PATH}.
 * @param response - receives the file, or 404 for any other name or method.
 */
export async function serveBrand(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const name = new URL(request.url ?? "/", "http://localhost").pathname.slice(BRAND_PATH.length + 1);
  const type = Object.hasOwn(FILES, name) ? FILES[name] : undefined;
  if (request.method !== "GET" || type === undefined) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }
  const body = await readFile(new URL(`../../assets/${name}`, import.meta.url));
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(body);
}
