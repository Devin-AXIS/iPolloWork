import { writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadVoiceoverParagraphs } from "../runner/voiceover.mjs";

const vo = await loadVoiceoverParagraphs("slideshow-template-import");
const runKey = Date.now().toString(36);
const templateTitle = `Fraimz Native Deck ${runKey}`;
const validPackage = join(tmpdir(), `fraimz-native-deck-${runKey}.ipwt`);
const invalidPackage = join(tmpdir(), `fraimz-invalid-deck-${runKey}.ipwt`);

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let entry = value;
  for (let bit = 0; bit < 8; bit += 1) entry = entry & 1 ? 0xedb88320 ^ (entry >>> 1) : entry >>> 1;
  return entry >>> 0;
});

function crc32(data) {
  let checksum = 0xffffffff;
  for (const byte of data) checksum = CRC32_TABLE[(checksum ^ byte) & 0xff] ^ (checksum >>> 8);
  return (checksum ^ 0xffffffff) >>> 0;
}

function storedZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const [name, contents] of Object.entries(files)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(contents);
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localParts.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

const manifest = {
  schemaVersion: 1,
  id: `fraimz.native-deck-${runKey}`,
  version: "1.0.0",
  kind: "design",
  category: "slides",
  subcategory: "pitch",
  style: "minimal",
  tags: ["fraimz", "pitch"],
  pptxCompatibility: "native-editable",
  surface: "design",
  title: templateTitle,
  description: "A validated local presentation package used by the import proof.",
  cover: "cover.svg",
  entry: "entry.html",
  source: { name: "Fraimz", license: "MIT" },
  designSystem: { tokenVersion: 1, editableGroups: ["theme", "typography"] },
  applyChecklist: ["Update the presentation content"],
  minimumAppVersion: "0.17.0",
};

await writeFile(validPackage, storedZip({
  "manifest.json": JSON.stringify(manifest),
  "entry.html": "<!doctype html><section data-ipw-slide><h1 data-pptx-text>Fraimz Native Deck</h1></section>",
  "cover.svg": "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"960\" height=\"540\"><rect width=\"960\" height=\"540\" fill=\"#111827\"/><text x=\"72\" y=\"270\" fill=\"white\" font-size=\"48\">Fraimz Native Deck</text></svg>",
  LICENSE: "MIT",
}));
await writeFile(invalidPackage, "not a zip archive");

async function setEnglish(ctx) {
  const changed = await ctx.eval(`(() => {
    const key = "ipollowork.language";
    if (localStorage.getItem(key) === "en") return false;
    localStorage.setItem(key, "en");
    return true;
  })()`);
  if (changed) {
    await ctx.client.send("Page.reload", { ignoreCache: true });
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "reloaded English app" });
  }
}

async function openTemplateMarket(ctx) {
  await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
  await setEnglish(ctx);
  const opened = await ctx.eval(`(() => {
    const button = [...document.querySelectorAll("button")].find((item) => (item.textContent || "").trim() === "Templates" && !item.disabled);
    button?.click();
    return Boolean(button);
  })()`);
  ctx.assert(opened, "The Templates entry was not available.");
  await ctx.waitForText("Browse installed and bundled templates", { timeoutMs: 30_000 });
}

async function clickExactButton(ctx, text, containingText = "") {
  const clicked = await ctx.eval(`(() => {
    const target = [...document.querySelectorAll("button")].find((button) =>
      (button.textContent || "").trim() === ${JSON.stringify(text)} &&
      !button.disabled &&
      (!${JSON.stringify(containingText)} || (button.parentElement?.textContent || "").includes(${JSON.stringify(containingText)}))
    );
    target?.click();
    return Boolean(target);
  })()`);
  ctx.assert(clicked, `Button ${text} was not available.`);
}

async function choosePackage(ctx, file) {
  const { root } = await ctx.client.send("DOM.getDocument", { depth: 1, pierce: true });
  const { nodeId } = await ctx.client.send("DOM.querySelector", {
    nodeId: root.nodeId,
    selector: 'input[type="file"][accept=".ipwt"]',
  });
  ctx.assert(Boolean(nodeId), "The .ipwt file input was not found.");
  await ctx.client.send("DOM.setFileInputFiles", { nodeId, files: [file] });
}

async function installSelectedPackage(ctx, filename) {
  await clickExactButton(ctx, "Install", filename);
}

async function dismissToasts(ctx) {
  await ctx.eval(`(() => {
    const toasts = [...document.querySelectorAll("[data-sonner-toast]")];
    for (const toast of toasts) {
      const close = toast.querySelector("button[data-close-button]") || toast.querySelector("button");
      close?.click();
    }
    return toasts.length;
  })()`);
}

export default {
  id: "slideshow-template-import",
  title: "Import slideshow packages safely and recover from failures",
  kind: "user-facing",
  precondition: async (ctx) => {
    await ctx.waitFor("Boolean(window.__ipolloworkControl)", { timeoutMs: 60_000, label: "iPolloWork control API" });
    const route = await ctx.eval("window.__ipolloworkControl.snapshot().route");
    return route.startsWith("/welcome") || route.startsWith("/signin")
      ? "iPolloWork must have a local workspace before the template import flow can run."
      : null;
  },
  steps: [
    {
      name: "Choose a slideshow package",
      run: async (ctx) => {
        await ctx.prove("The template market accepts a standard .ipwt package from the Slides category", {
          voiceover: vo[0],
          action: async () => {
            await openTemplateMarket(ctx);
            await clickExactButton(ctx, "Slides");
            await choosePackage(ctx, validPackage);
            await ctx.waitForText(`fraimz-native-deck-${runKey}.ipwt`, { timeoutMs: 10_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              file: document.body.innerText.includes(${JSON.stringify(`fraimz-native-deck-${runKey}.ipwt`)}),
              install: [...document.querySelectorAll("button")].some((button) => (button.textContent || "").trim() === "Install" && !button.disabled),
              input: document.querySelector('input[type="file"][accept=".ipwt"]')?.getAttribute("accept"),
            }))()`);
            ctx.assert(state.file && state.install && state.input === ".ipwt", `The selected package state is incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "slides-package-selected", requireText: ["Templates", "Slides", `fraimz-native-deck-${runKey}.ipwt`, "Install"] },
        });
      },
    },
    {
      name: "Validate while installation is in progress",
      run: async (ctx) => {
        await ctx.prove("The selected filename stays visible while the package is validated and installed", {
          voiceover: vo[1],
          action: async () => {
            await ctx.eval(`(() => {
              window.__fraimzOriginalFetch = window.__fraimzOriginalFetch || window.fetch.bind(window);
              window.__fraimzImportCount = 0;
              window.fetch = async (...args) => {
                const input = args[0];
                const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
                if (url.includes("/templates/import")) {
                  window.__fraimzImportCount += 1;
                  await new Promise((resolve) => setTimeout(resolve, 1600));
                }
                return window.__fraimzOriginalFetch(...args);
              };
            })()`);
            await installSelectedPackage(ctx, `fraimz-native-deck-${runKey}.ipwt`);
            await ctx.waitFor(`(() => {
              const install = [...document.querySelectorAll("button")].find((button) => (button.textContent || "").trim() === "Install" && (button.parentElement?.textContent || "").includes(${JSON.stringify(`fraimz-native-deck-${runKey}.ipwt`)}));
              return install?.disabled && Boolean(install.querySelector(".animate-spin"));
            })()`, { timeoutMs: 5_000, label: "busy import state" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              file: document.body.innerText.includes(${JSON.stringify(`fraimz-native-deck-${runKey}.ipwt`)}),
              requests: window.__fraimzImportCount,
              searchEnabled: !document.querySelector('input[placeholder="Search templates"]')?.disabled,
            }))()`);
            ctx.assert(state.file && state.requests === 1 && state.searchEnabled, `The installation state is wrong: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "slides-package-installing", requireText: [`fraimz-native-deck-${runKey}.ipwt`, "Install"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Install exactly once with an honest PPTX badge",
      run: async (ctx) => {
        await ctx.prove("A valid native-editable deck appears once in Slides with the PPTX-compatible badge", {
          voiceover: vo[2],
          action: async () => {
            await ctx.waitForText(`Installed ${templateTitle}`, { timeoutMs: 30_000 });
            await ctx.eval("window.fetch = window.__fraimzOriginalFetch");
            await ctx.eval(`(() => {
              const search = document.querySelector('input[placeholder="Search templates"]');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(search, ${JSON.stringify(templateTitle)});
              search?.dispatchEvent(new Event("input", { bubbles: true }));
              return Boolean(search);
            })()`);
            await ctx.waitFor(`document.body.innerText.includes(${JSON.stringify(templateTitle)})`, { timeoutMs: 30_000, label: "imported deck card" });
            await ctx.waitFor(`(() => {
              const card = [...document.querySelectorAll("article")].find((item) => (item.textContent || "").includes(${JSON.stringify(templateTitle)}));
              const cover = card?.querySelector("img");
              return Boolean(cover?.complete && cover.naturalWidth > 0);
            })()`, { timeoutMs: 10_000, label: "imported deck cover" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => {
              const cards = [...document.querySelectorAll("article")].filter((card) => (card.textContent || "").includes(${JSON.stringify(templateTitle)}));
              return { count: cards.length, pptx: cards[0]?.textContent?.includes("PPTX-compatible") || false, slides: cards[0]?.textContent?.includes("Slides") || false };
            })()`);
            ctx.assert(state.count === 1 && state.pptx && state.slides, `The imported deck card is wrong: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "native-deck-installed", requireText: [templateTitle, "PPTX-compatible", "Slides", "Mine"] },
        });
      },
    },
    {
      name: "Reject malformed packages without partial installation",
      run: async (ctx) => {
        await ctx.prove("A malformed .ipwt package is rejected and no template card is created", {
          voiceover: vo[3],
          action: async () => {
            await dismissToasts(ctx);
            await choosePackage(ctx, invalidPackage);
            await ctx.waitForText(`fraimz-invalid-deck-${runKey}.ipwt`, { timeoutMs: 10_000 });
            await installSelectedPackage(ctx, `fraimz-invalid-deck-${runKey}.ipwt`);
            await ctx.waitForText("The .ipwt file is not a valid ZIP archive", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              selected: document.body.innerText.includes(${JSON.stringify(`fraimz-invalid-deck-${runKey}.ipwt`)}),
              partial: [...document.querySelectorAll("article")].some((card) => (card.textContent || "").includes("fraimz-invalid-deck")),
            }))()`);
            ctx.assert(state.selected && !state.partial, `Malformed import recovery is wrong: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "malformed-package-rejected", requireText: [`fraimz-invalid-deck-${runKey}.ipwt`, "The .ipwt file is not a valid ZIP archive"], rejectText: ["Something went wrong"] },
        });
      },
    },
    {
      name: "Keep the package available for retry or cancel",
      run: async (ctx) => {
        await ctx.prove("After failure, the same selected package can be retried without reopening the file picker", {
          voiceover: vo[4],
          action: async () => {
            await dismissToasts(ctx);
            await installSelectedPackage(ctx, `fraimz-invalid-deck-${runKey}.ipwt`);
            await ctx.waitForText("The .ipwt file is not a valid ZIP archive", { timeoutMs: 20_000 });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              file: document.body.innerText.includes(${JSON.stringify(`fraimz-invalid-deck-${runKey}.ipwt`)}),
              retry: [...document.querySelectorAll("button")].some((button) => (button.textContent || "").trim() === "Install" && !button.disabled && (button.parentElement?.textContent || "").includes(${JSON.stringify(`fraimz-invalid-deck-${runKey}.ipwt`)})),
              cancel: [...document.querySelectorAll("button")].some((button) => (button.textContent || "").trim() === "Cancel" && !button.disabled),
            }))()`);
            ctx.assert(state.file && state.retry && state.cancel, `Retry controls are incomplete: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "failed-package-retained", requireText: [`fraimz-invalid-deck-${runKey}.ipwt`, "Install", "Cancel"] },
        });
      },
    },
    {
      name: "Prevent duplicate submissions without freezing the market",
      run: async (ctx) => {
        await ctx.prove("An in-flight import accepts one request while search remains responsive", {
          voiceover: vo[5],
          action: async () => {
            await dismissToasts(ctx);
            await choosePackage(ctx, validPackage);
            await ctx.eval(`(() => {
              window.__fraimzOriginalFetch = window.__fraimzOriginalFetch || window.fetch.bind(window);
              window.__fraimzImportCount = 0;
              window.fetch = async (...args) => {
                const input = args[0];
                const url = typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
                if (url.includes("/templates/import")) {
                  window.__fraimzImportCount += 1;
                  await new Promise((resolve) => setTimeout(resolve, 1600));
                }
                return window.__fraimzOriginalFetch(...args);
              };
              const filename = ${JSON.stringify(`fraimz-native-deck-${runKey}.ipwt`)};
              const install = [...document.querySelectorAll("button")].find((button) => (button.textContent || "").trim() === "Install" && (button.parentElement?.textContent || "").includes(filename));
              install?.click();
              install?.click();
              const search = document.querySelector('input[placeholder="Search templates"]');
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(search, "Fraimz");
              search?.dispatchEvent(new Event("input", { bubbles: true }));
              return Boolean(install && search);
            })()`);
            await ctx.waitFor("window.__fraimzImportCount === 1", { timeoutMs: 5_000, label: "single import request" });
          },
          assert: async () => {
            const state = await ctx.eval(`(() => ({
              requests: window.__fraimzImportCount,
              query: document.querySelector('input[placeholder="Search templates"]')?.value || "",
              spinner: Boolean(document.querySelector("button[disabled] .animate-spin")),
            }))()`);
            ctx.assert(state.requests === 1 && state.query === "Fraimz" && state.spinner, `Duplicate protection or responsiveness failed: ${JSON.stringify(state)}`);
          },
          screenshot: { name: "duplicate-import-prevented", requireText: ["Fraimz", `fraimz-native-deck-${runKey}.ipwt`, "Install"], rejectText: ["Something went wrong"] },
        });
      },
    },
  ],
};
