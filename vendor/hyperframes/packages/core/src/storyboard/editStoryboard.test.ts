import { describe, expect, it } from "vitest";
import { parseStoryboard } from "./parseStoryboard.js";
import {
  appendStoryboardFrame,
  moveStoryboardFrame,
  removeStoryboardFrame,
  setFrameField,
  setFrameTitle,
  setFrameVoiceover,
  setFrameSpeaker,
  setFrameVoiceSelection,
  setStoryboardGlobal,
} from "./editStoryboard.js";

const source = `---
format: 1920x1080
message: Launch
---
# Storyboard

## Frame 7 — Intro
- duration: 3s
- src: compositions/intro.html
- custom: retain-me
- vo: "Hello"

An original note.
### Detail
Keep this nested content.

## Fonts
Keep the font list here.

## Scene 9 — Product
- duration: 6s
- status: built
- src: compositions/product.html

Second note.

## Credits
Keep these credits.
`;

describe("editable storyboard", () => {
  it("round-trips all production fields without replacing narrative or unknown metadata", () => {
    let next = setFrameTitle(source, 1, "New intro");
    for (const [key, value] of Object.entries({
      scene: "Layered city",
      camera: "Slow dolly in",
      asset_source: "generate",
      asset_kind: "image",
      asset_origin: "Generated illustration, not event footage",
      asset_brief: "Blue hour",
      asset_reference: "assets/city.png",
      music: "Ambient",
      sound_effects: "Click at 2s",
      sound_effect_reference: "assets/sfx/click.mp3",
      speaker: "Maya · calm narrator",
      transition_in: "crossfade",
    })) {
      next = setFrameField(next, 1, key, value, { quote: true });
    }
    next = setFrameVoiceover(next, 1, 'A "better" world');
    const frame = parseStoryboard(next).frames[0];
    expect(frame).toMatchObject({
      title: "New intro",
      scene: "Layered city",
      camera: "Slow dolly in",
      assetSource: "generate",
      assetKind: "image",
      assetOrigin: "Generated illustration, not event footage",
      assetBrief: "Blue hour",
      assetReference: "assets/city.png",
      music: "Ambient",
      soundEffects: "Click at 2s",
      soundEffectReference: "assets/sfx/click.mp3",
      transitionIn: "crossfade",
      voiceover: 'A "better" world',
      speaker: "Maya · calm narrator",
      extra: { custom: "retain-me" },
    });
    expect(frame?.narrative).toContain("### Detail\nKeep this nested content.");
    expect(next).toContain("## Fonts\nKeep the font list here.");
  });

  it("edits whole-video direction in frontmatter without losing existing values", () => {
    let next = setStoryboardGlobal(source, "theme", "Product launch");
    next = setStoryboardGlobal(
      next,
      "visual_style",
      "Warm editorial, clean data",
    );
    next = setStoryboardGlobal(next, "music_prompt", "Soft electronic pulse");
    next = setStoryboardGlobal(next, "music_asset", "assets/music/launch-bed.mp3");
    next = setStoryboardGlobal(
      next,
      "template",
      "ipollowork.hyperframes.vertical-social-story",
    );
    next = setStoryboardGlobal(next, "align_to_template", true);
    let globals = parseStoryboard(next).globals;
    expect(globals).toMatchObject({
      format: "1920x1080",
      message: "Launch",
      theme: "Product launch",
      visualStyle: "Warm editorial, clean data",
      musicPrompt: "Soft electronic pulse",
      musicAsset: "assets/music/launch-bed.mp3",
      template: "ipollowork.hyperframes.vertical-social-story",
      alignToTemplate: true,
    });

    next = setStoryboardGlobal(next, "theme", "");
    next = setStoryboardGlobal(next, "align_to_template", false);
    globals = parseStoryboard(next).globals;
    expect(globals.theme).toBeUndefined();
    expect(globals.alignToTemplate).toBe(false);
    expect(next).toContain("## Frame 7 — Intro");
    expect(next).toContain("custom: retain-me");
  });

  it("creates frontmatter when the script starts without global settings", () => {
    const next = setStoryboardGlobal(
      "## Frame 1 — Intro\n- duration: 3s\n",
      "theme",
      "Launch",
    );
    expect(parseStoryboard(next).globals.theme).toBe("Launch");
    expect(parseStoryboard(next).frames).toHaveLength(1);
  });

  it("normalizes speaker aliases to one editable voice identity", () => {
    const aliased = source.replace(
      '- vo: "Hello"',
      '- vo: "Hello"\n- character: "Maya"',
    );
    const changed = setFrameSpeaker(aliased, 1, "Alex");
    expect(parseStoryboard(changed).frames[0]?.speaker).toBe("Alex");
    expect(changed.match(/- (?:speaker|character):/g)).toHaveLength(1);
  });

  it("persists a selected sound-library voice per frame and can clear the override", () => {
    const chosen = setFrameVoiceSelection(source, 1, {
      voiceId: "custom-voice-42",
      model: "cosyvoice-v3-flash",
      name: "Warm Narrator",
    });
    expect(parseStoryboard(chosen).frames[0]).toMatchObject({
      voiceId: "custom-voice-42",
      voiceModel: "cosyvoice-v3-flash",
      voiceName: "Warm Narrator",
    });

    const cleared = setFrameVoiceSelection(chosen, 1, {
      voiceId: "",
      model: "",
      name: "",
    });
    expect(parseStoryboard(cleared).frames[0]).not.toHaveProperty("voiceId");
    expect(parseStoryboard(cleared).frames[0]).not.toHaveProperty("voiceModel");
    expect(parseStoryboard(cleared).frames[0]).not.toHaveProperty("voiceName");
  });

  it("clears fields and duplicate aliases instead of leaving hidden stale values", () => {
    const duplicate = source.replace(
      '- vo: "Hello"',
      '- vo: "Hello"\n- voiceover: "Old"',
    );
    const changed = setFrameVoiceover(duplicate, 1, "New");
    expect(parseStoryboard(changed).frames[0]?.voiceover).toBe("New");
    expect(changed.match(/- (?:vo|voiceover):/g)).toHaveLength(1);
    expect(
      parseStoryboard(setFrameVoiceover(changed, 1, "")).frames[0]?.voiceover,
    ).toBe("");
    expect(setFrameField(source, 1, "camera", "")).toBe(source);
  });

  it("adds, reorders and deletes complete rows, retaining unrelated sections and asset paths", () => {
    const appended = appendStoryboardFrame(source, "End");
    expect(parseStoryboard(appended).frames.map((f) => f.title)).toEqual([
      "Intro",
      "Product",
      "End",
    ]);
    expect(appended.indexOf("Frame 3")).toBeLessThan(
      appended.indexOf("## Credits"),
    );
    const moved = moveStoryboardFrame(appended, 3, 1);
    const frames = parseStoryboard(moved).frames;
    expect(frames.map((f) => f.title)).toEqual(["End", "Intro", "Product"]);
    expect(frames.map((f) => f.number)).toEqual([1, 2, 3]);
    expect(frames[1]?.src).toBe("compositions/intro.html");
    expect(frames[1]?.narrative).toContain("Keep this nested content.");
    const removed = removeStoryboardFrame(moved, 1);
    expect(parseStoryboard(removed).frames.map((f) => f.title)).toEqual([
      "Intro",
      "Product",
    ]);
    expect(removed).toContain("## Fonts\nKeep the font list here.");
    expect(removed).toContain("## Credits\nKeep these credits.");
  });

  it("creates from an empty file and can remove the last row", () => {
    const next = appendStoryboardFrame("", "First");
    expect(parseStoryboard(next).frames).toHaveLength(1);
    expect(parseStoryboard(removeStoryboardFrame(next, 1)).frames).toHaveLength(
      0,
    );
  });

  it("keeps nested shot notes attached when moving between differently nested groups", () => {
    const grouped =
      "## Frame 1 — A\n### Note\nKeep A\n## Group\n### Frame 2 — B\n#### Detail\nKeep B\n";
    const moved = parseStoryboard(moveStoryboardFrame(grouped, 1, 2));
    expect(moved.frames.map((frame) => frame.title)).toEqual(["B", "A"]);
    expect(moved.frames[0]?.narrative).toContain("Keep B");
    expect(moved.frames[1]?.narrative).toContain("Keep A");
  });

  it("rejects stale or invalid indices and leaves a no-op move byte-identical", () => {
    expect(() => moveStoryboardFrame(source, 0, 1)).toThrow();
    expect(() => moveStoryboardFrame(source, 1, 2.5)).toThrow();
    expect(() => removeStoryboardFrame(source, 3)).toThrow();
    expect(() => setFrameTitle(source, 3, "missing")).toThrow();
    expect(moveStoryboardFrame(source, 1, 1)).toBe(source);
  });
});
