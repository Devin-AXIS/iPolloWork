import {
  FRAME_HEADING_RE,
  SPEAKER_ALIASES,
  VOICEOVER_ALIASES,
} from "./parseStoryboard.js";
import type { FrameStatus } from "./types.js";

// Re-exported for back-compat: the canonical list now lives in parseStoryboard.ts.
export { VOICEOVER_ALIASES };
export { SPEAKER_ALIASES };

const GLOBAL_FIELDS = {
  format: "format",
  message: "message",
  arc: "arc",
  audience: "audience",
  theme: "theme",
  visual_style: "visual_style",
  music_prompt: "music_prompt",
  music_asset: "music_asset",
  template: "template",
  align_to_template: "align_to_template",
} as const;

/**
 * Surgical writers for `STORYBOARD.md`.
 *
 * These update a single frame's metadata in place — preserving all other
 * content, formatting, comments, and non-frame sections — rather than
 * re-serializing the parsed manifest (which would be lossy). Used by the
 * storyboard frame-focus editor to persist `voiceover` / `status` edits.
 *
 * Frame detection and the voiceover aliases are imported from `parseStoryboard.ts`
 * so the read and write sides share one definition and can't drift.
 */

const HEADING_LEVEL_RE = /^(#{1,6})[ \t]+/;
/**
 * `- key:` prefix — captures the bullet, key, and `:`-separator (incl. surrounding
 * spaces) so the line can be rewritten as `<prefix><new value>`. Deliberately stops
 * at the separator and captures no value/EOL: the old value is overwritten wholesale,
 * so there's nothing to capture, and dropping the trailing `[ \t]*…(.*)$` removes the
 * overlapping-quantifier polynomial backtracking CodeQL flags (js/polynomial-redos).
 */
const META_LINE_RE = /^([ \t]*[-*][ \t]+)([A-Za-z_][\w-]*)([ \t]*:[ \t]*)/;

interface FrameBounds {
  /** 0-based line index of the frame heading. */
  start: number;
  /** 0-based line index just past the frame's content (exclusive). */
  end: number;
  /** Heading depth (`#` count) that opened the frame. */
  level: number;
}

/** Locate every frame's line range, using the same boundary rules as the parser. */
// fallow-ignore-next-line complexity
function frameBounds(lines: string[]): FrameBounds[] {
  const bounds: FrameBounds[] = [];
  let current: FrameBounds | null = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const frameMatch = FRAME_HEADING_RE.exec(line);
    if (frameMatch) {
      if (current) current.end = i;
      current = {
        start: i,
        end: lines.length,
        level: (frameMatch[1] ?? "##").length,
      };
      bounds.push(current);
      continue;
    }
    const heading = HEADING_LEVEL_RE.exec(line);
    if (current && heading && (heading[1] ?? "").length <= current.level) {
      current.end = i;
      current = null;
    }
  }
  return bounds;
}

function formatValue(value: string, quote: boolean): string {
  // Metadata is a single line: collapse every whitespace run (incl. newlines from a
  // multi-line textarea) to one space so the value can't split the `- key:` line and
  // corrupt the file. A single linear `\s+` avoids the `\s*\r?\n\s*` polynomial
  // backtracking CodeQL flags (js/polynomial-redos) on long all-space input.
  const clean = value.replace(/\s+/g, " ").trim();
  // Always wrap when quoting. The parser's stripQuotes removes exactly one outer
  // pair, so wrapping round-trips losslessly even for empty values or values that
  // themselves contain quotes (`"foo"` → `""foo""` → parses back to `"foo"`).
  return quote ? `"${clean}"` : clean;
}

/**
 * Set (or insert) a metadata field on the frame at `frameIndex` (1-based).
 * Replaces an existing `- key: …` line (matching any alias) in place; otherwise
 * inserts a new line right after the frame heading.
 *
 * Throws when the frame doesn't exist, so a stale/raced index (e.g. the frame
 * was deleted on disk after render) surfaces as an error instead of a silent
 * no-op the UI would report as a successful save.
 */
export function setFrameField(
  source: string,
  frameIndex: number,
  key: string,
  value: string,
  opts: { aliases?: readonly string[]; quote?: boolean } = {},
): string {
  const lines = source.split(/\r?\n/);
  const target = frameBounds(lines)[frameIndex - 1];
  if (!target) throw new Error(`storyboard frame ${frameIndex} not found`);

  const aliases = new Set(
    [key, ...(opts.aliases ?? [])].map((k) => k.toLowerCase()),
  );
  const formatted = formatValue(value, opts.quote ?? false);
  let replaced = false;
  for (let i = target.end - 1; i > target.start; i--) {
    const match = META_LINE_RE.exec(lines[i] ?? "");
    if (match && aliases.has((match[2] ?? "").toLowerCase())) {
      // Collapse duplicate aliases: otherwise the parser's last value can hide an edit.
      if (replaced || (!value.trim() && !opts.quote)) lines.splice(i, 1);
      else lines[i] = `${match[1]}${match[2]}${match[3]}${formatted}`;
      replaced = true;
    }
  }
  if (!replaced && (value.trim() || opts.quote))
    lines.splice(target.start + 1, 0, `- ${key}: ${formatted}`);
  return lines.join("\n");
}

/** Set one known whole-video direction in STORYBOARD.md frontmatter. */
export function setStoryboardGlobal(
  source: string,
  key: keyof typeof GLOBAL_FIELDS,
  value: string | boolean,
): string {
  const markdownKey = GLOBAL_FIELDS[key];
  if (!markdownKey) throw new Error(`unsupported storyboard global: ${key}`);
  const lines = source.split(/\r?\n/);
  let start = 0;
  while (start < lines.length && (lines[start] ?? "").trim() === "") start++;

  if ((lines[start] ?? "").trim() !== "---") {
    if (value === "" && typeof value === "string") return source;
    const block = [
      "---",
      `${markdownKey}: ${formatGlobalValue(value)}`,
      "---",
      "",
    ];
    lines.splice(0, 0, ...block);
    return lines.join("\n");
  }

  let end = -1;
  for (let index = start + 1; index < lines.length; index++) {
    if ((lines[index] ?? "").trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) throw new Error("storyboard frontmatter is not closed");

  let replaced = false;
  const aliases = new Set(
    [key, markdownKey].map((item) => item.toLowerCase().replace(/_/g, "")),
  );
  for (let index = start + 1; index < end; index++) {
    const line = lines[index] ?? "";
    const colon = line.indexOf(":");
    const normalized = line
      .slice(0, colon)
      .trim()
      .toLowerCase()
      .replace(/_/g, "");
    if (colon === -1 || !aliases.has(normalized)) continue;
    if (replaced || (value === "" && typeof value === "string")) {
      lines.splice(index, 1);
      index--;
      end--;
    } else {
      lines[index] = `${line.slice(0, colon + 1)} ${formatGlobalValue(value)}`;
      replaced = true;
    }
  }
  if (!replaced && !(value === "" && typeof value === "string")) {
    lines.splice(end, 0, `${markdownKey}: ${formatGlobalValue(value)}`);
  }
  return lines.join("\n");
}

function formatGlobalValue(value: string | boolean): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return `"${value.replace(/\s+/g, " ").trim()}"`;
}

/** Set the speaker / voice identity for a frame, matching common aliases. */
export function setFrameSpeaker(
  source: string,
  frameIndex: number,
  value: string,
): string {
  return setFrameField(source, frameIndex, "speaker", value, {
    aliases: SPEAKER_ALIASES,
    quote: true,
  });
}

/** Store or clear the frame-specific voice selected from Work's sound library. */
export function setFrameVoiceSelection(
  source: string,
  frameIndex: number,
  selection: { voiceId: string; model: string; name: string },
): string {
  let next = setFrameField(source, frameIndex, "voice_id", selection.voiceId, {
    quote: Boolean(selection.voiceId.trim()),
  });
  next = setFrameField(next, frameIndex, "voice_model", selection.model, {
    quote: Boolean(selection.model.trim()),
  });
  return setFrameField(next, frameIndex, "voice_name", selection.name, {
    quote: Boolean(selection.name.trim()),
  });
}

/** Set the voiceover (guide) line for a frame, matching any voiceover alias. */
export function setFrameVoiceover(
  source: string,
  frameIndex: number,
  value: string,
): string {
  return setFrameField(source, frameIndex, "voiceover", value, {
    aliases: VOICEOVER_ALIASES,
    quote: true,
  });
}

/** Set the lifecycle status for a frame. */
export function setFrameStatus(
  source: string,
  frameIndex: number,
  status: FrameStatus,
): string {
  return setFrameField(source, frameIndex, "status", status);
}

/** Change only the heading; narrative, custom metadata and linked media remain intact. */
export function setFrameTitle(
  source: string,
  frameIndex: number,
  title: string,
): string {
  const lines = source.split(/\r?\n/);
  const frame = frameBounds(lines)[frameIndex - 1];
  if (!frame) throw new Error(`storyboard frame ${frameIndex} not found`);
  const clean = formatValue(title, false);
  lines[frame.start] =
    `${"#".repeat(frame.level)} Frame ${frameIndex}${clean ? ` — ${clean}` : ""}`;
  return lines.join("\n");
}

function renumberFrames(lines: string[]): string {
  for (const [index, frame] of frameBounds(lines).entries()) {
    const heading = lines[frame.start] ?? "";
    lines[frame.start] = heading
      .replace(
        /^(#{2,3}[ \t]+)(?:frame|beat|scene)\b(?:[ \t]+\d+)?[\s.:—-]*/i,
        `$1Frame ${index + 1} — `,
      )
      .replace(/[ \t—]+$/, "");
  }
  return lines.join("\n");
}

/** Append inside the existing frame section, before any following non-frame sections. */
export function appendStoryboardFrame(source: string, title: string): string {
  const lines = source.split(/\r?\n/);
  const frames = frameBounds(lines);
  const last = frames.at(-1);
  const level = last?.level ?? 2;
  const block = [
    "",
    `${"#".repeat(level)} Frame ${frames.length + 1} — ${formatValue(title, false)}`,
    "- duration: 5s",
    "- status: outline",
    "",
  ];
  lines.splice(last?.end ?? lines.length, 0, ...block);
  return lines.join("\n");
}

/** Delete the plan row only; never deletes composition files or assets. */
export function removeStoryboardFrame(
  source: string,
  frameIndex: number,
): string {
  const lines = source.split(/\r?\n/);
  const frame = frameBounds(lines)[frameIndex - 1];
  if (!frame) throw new Error(`storyboard frame ${frameIndex} not found`);
  lines.splice(frame.start, frame.end - frame.start);
  return renumberFrames(lines);
}

/** Reorder frame blocks without moving unrelated headings or rewriting their contents. */
export function moveStoryboardFrame(
  source: string,
  from: number,
  to: number,
): string {
  const lines = source.split(/\r?\n/);
  const bounds = frameBounds(lines);
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    !bounds[from - 1] ||
    !bounds[to - 1]
  ) {
    throw new Error("storyboard move indices out of range");
  }
  if (from === to) return source;
  const blocks = bounds.map((frame) => lines.slice(frame.start, frame.end));
  const [moved] = blocks.splice(from - 1, 1);
  if (!moved) throw new Error("storyboard frame not found");
  blocks.splice(to - 1, 0, moved);
  // Replace backwards so the original line offsets remain valid.
  for (let i = bounds.length - 1; i >= 0; i--) {
    const slot = bounds[i];
    const block = blocks[i];
    if (slot && block) {
      // Keep the destination section's heading depth, even across grouped scenes.
      const originalLevel =
        HEADING_LEVEL_RE.exec(block[0] ?? "")?.[1]?.length ?? slot.level;
      const adjusted = block.map((line) =>
        line.replace(HEADING_LEVEL_RE, (heading, hashes: string) => {
          if (hashes.length < originalLevel) return heading;
          return `${"#".repeat(Math.min(6, hashes.length + slot.level - originalLevel))} `;
        }),
      );
      lines.splice(slot.start, slot.end - slot.start, ...adjusted);
    }
  }
  return renumberFrames(lines);
}
