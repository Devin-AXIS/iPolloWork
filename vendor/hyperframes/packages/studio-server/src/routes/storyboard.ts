import { existsSync, readFileSync, statSync } from "node:fs";
import type { Hono } from "hono";
import { parseHTML } from "linkedom";
import type { StudioApiAdapter } from "../types.js";
import { resolveWithinProject } from "../helpers/safePath.js";
import { resolveProjectAndSignature } from "../helpers/projectSignature.js";
import {
  parseStoryboard,
  SCRIPT_FILENAME,
  STORYBOARD_FILENAME,
  type StoryboardFrame,
} from "@hyperframes/core/storyboard";

/** A frame enriched with disk-resolution info the Studio needs to render tiles. */
interface ResolvedStoryboardFrame extends StoryboardFrame {
  /** Whether `src` resolves to an existing file inside the project. */
  srcExists: boolean;
  /** Static mounted-source evidence only; not a rendered quality verdict. */
  recipeMount?: { componentId: string; source: string };
}

function resolveFrames(projectDir: string, frames: StoryboardFrame[]): ResolvedStoryboardFrame[] {
  const entry = resolveWithinProject(projectDir, "index.html");
  let hosts: ReturnType<typeof parseHTML>["document"]["documentElement"][] = [];
  try {
    if (entry && statSync(entry).isFile() && statSync(entry).size <= 2 * 1024 * 1024) {
      hosts = Array.from(parseHTML(readFileSync(entry, "utf8")).document.querySelectorAll("[data-ipw-scene]"));
    }
  } catch { /* Missing or unreadable entry has no mount evidence. */ }
  const sourceComponents = new Map<string, string | null>();
  return frames.map((frame) => {
    let srcExists = false;
    if (frame.src) {
      const abs = resolveWithinProject(projectDir, frame.src);
      srcExists = abs ? existsSync(abs) : false;
    }
    const componentId = frame.extra.recipe?.trim().replace(/^component:/, "")
      || frame.camera?.match(/^component:([a-z0-9-]+)(?:#[a-z0-9-]+)?(?:\s*\|.*)?$/)?.[1];
    if (!componentId || !/^[a-z0-9-]+$/.test(componentId)) return { ...frame, srcExists };
    const sceneId = frame.extra.scene_id?.trim();
    const matching = hosts.filter((host) => sceneId
      ? host.getAttribute("id") === sceneId
      : Boolean(frame.src) && host.getAttribute("data-composition-src") === frame.src);
    if (matching.length !== 1) return { ...frame, srcExists };
    const host = matching[0]!;
    const source = host.getAttribute("data-composition-src");
    if (!source || host.getAttribute("data-ipw-registry-component") !== componentId
      || host.getAttribute("data-ipw-timing-owner") !== "host") return { ...frame, srcExists };
    if (!sourceComponents.has(source)) {
      let sourceComponent: string | null = null;
      try {
        const abs = resolveWithinProject(projectDir, source);
        if (abs && statSync(abs).isFile() && statSync(abs).size <= 2 * 1024 * 1024) {
          const document = parseHTML(readFileSync(abs, "utf8")).document;
          if (document.querySelector('script[data-ipw-motion-recipe="1"]')) {
            sourceComponent = document.querySelector("[data-composition-id]")?.getAttribute("data-composition-id") ?? null;
          }
        }
      } catch { /* Invalid source cannot prove the recipe is mounted. */ }
      sourceComponents.set(source, sourceComponent);
    }
    return {
      ...frame, srcExists,
      ...(sourceComponents.get(source) === componentId ? { recipeMount: { componentId, source } } : {}),
    };
  });
}

/** Read the companion SCRIPT.md narration doc if it exists alongside the storyboard. */
function readScript(projectDir: string): { exists: boolean; path: string; content: string } {
  const abs = resolveWithinProject(projectDir, SCRIPT_FILENAME);
  if (abs && existsSync(abs)) {
    try {
      return { exists: true, path: SCRIPT_FILENAME, content: readFileSync(abs, "utf-8") };
    } catch {
      /* fall through to absent */
    }
  }
  return { exists: false, path: SCRIPT_FILENAME, content: "" };
}

export function registerStoryboardRoutes(api: Hono, adapter: StudioApiAdapter): void {
  // Parsed storyboard manifest for a project. Markdown (STORYBOARD.md) stays
  // canonical on disk; this returns the derived, normalized structure. When the
  // file is absent we return `exists: false` with empty frames rather than 404,
  // so the Studio can render an opt-in empty state.
  api.get("/projects/:id/storyboard", async (c) => {
    // The signature lets the board bust poster caches and lets the client tell
    // whether this payload is already current (see /projects/:id/signature).
    const resolved = await resolveProjectAndSignature(adapter, c.req.param("id"));
    if (!resolved) return c.json({ error: "not found" }, 404);
    const { project, signature } = resolved;

    const abs = resolveWithinProject(project.dir, STORYBOARD_FILENAME);
    if (!abs || !existsSync(abs)) {
      return c.json({
        exists: false,
        path: STORYBOARD_FILENAME,
        source: null,
        globals: { extra: {} },
        frames: [],
        warnings: [],
        script: readScript(project.dir),
        signature,
      });
    }

    let source: string;
    try {
      source = readFileSync(abs, "utf-8");
    } catch {
      return c.json({ error: "failed to read storyboard" }, 500);
    }

    const manifest = parseStoryboard(source);
    return c.json({
      exists: true,
      path: STORYBOARD_FILENAME,
      source,
      globals: manifest.globals,
      frames: resolveFrames(project.dir, manifest.frames),
      warnings: manifest.warnings,
      script: readScript(project.dir),
      signature,
    });
  });
}
