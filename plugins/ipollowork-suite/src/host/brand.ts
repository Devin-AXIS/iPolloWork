/** iPolloWork identity in the page DSH serves, so the title and icons are right before any client plugin loads. */
import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { brandAttribute, logoAttribute } from "../../../custom-appearance/src/model.ts";

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
 * DSH's framework-free boot page shows before any client plugin loads; it carries iPolloWork's name and mark instead
 * of DSH's wordmark. The page exposes only data attributes: the wordmark is its card's first child. The desktop shell
 * applies the same rules to the page it serves.
 */
const BOOT_STYLE = [
  "[data-dsh-boot]>div>div:first-child{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:0;line-height:0;letter-spacing:0}",
  `[data-dsh-boot]>div>div:first-child::before{content:'';width:34px;height:36px;background:currentColor;-webkit-mask:url(${BRAND_PATH}/mark.svg) center/contain no-repeat;mask:url(${BRAND_PATH}/mark.svg) center/contain no-repeat}`,
  "[data-dsh-boot]>div>div:first-child::after{content:'iPolloWork';font-size:17px;line-height:24px;font-weight:600;letter-spacing:-.01em}",
  "[data-dsh-boot] [data-dsh-boot-spinner]+div{display:none}",
].join("");

/**
 * Give the served page iPolloWork's title, tab icon, home-screen icon, install manifest and boot page.
 * @param html - the index document DSH renders for one page.
 * @returns the document with DSH's title, icons, manifest and boot wordmark replaced.
 */
export function brandIndex(html: string): string {
  const hasLogo = html.includes("<link " + logoAttribute + " ");
  const head = [
    ...(!hasLogo ? [
      `<link rel="icon" type="image/svg+xml" href="${BRAND_PATH}/favicon.svg" />`,
      `<link rel="apple-touch-icon" href="${BRAND_PATH}/apple-touch-icon.png" />`,
    ] : []),
    `<link rel="manifest" href="${BRAND_PATH}/manifest.webmanifest" />`,
    `<style>${BOOT_STYLE}</style>`,
  ].join("\n    ");
  const branded = html.includes("<html " + brandAttribute + "=") ? html : html
    .replace(/<title>[^<]*<\/title>/, `<title>${TITLE}</title>`)
    .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, `$1${TITLE}$2`);
  return branded
    .replace(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*>\s*/g, "")
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
