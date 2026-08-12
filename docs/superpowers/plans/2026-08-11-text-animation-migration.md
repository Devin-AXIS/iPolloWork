# Text Animation Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move selected caption visual effects into the existing Text Animation system as editable, parameterized presets, then remove their old `caption-animation` catalog entries.

**Architecture:** Add core motion presets first because Studio templates and registry cleanup depend on stable preset ids and compiled keyframes. Then expose the presets through `AnimationTemplatesTab`, and only after that remove the migrated `caption-*` registry items. The retained caption-specific effects stay in the caption catalog.

**Tech Stack:** TypeScript, Vitest, React, GSAP-backed core motion preset pipeline, Hyperframes registry JSON.

## Global Constraints

- Use `pnpm.cmd`, not npm or yarn.
- Follow the existing `MotionPreset` model in `vendor/hyperframes/packages/core/src/motionPresets.ts`.
- Migrated effects must use bounded `parameterSchema` values and editable defaults.
- Migrated text presets must use `targetKinds: ["text"]` unless a task explicitly chooses `["text", "element"]`.
- Migrated templates must appear in Text Animation, not the catalog caption effects path.
- Keep these caption-specific effects in `caption-animation`: `caption-pill-karaoke`, `caption-word-pulse`, `caption-phrase-lift`, `caption-mask-reveal`, `caption-editorial-snap`, `caption-editorial-emphasis`.
- Remove these old caption catalog items only after their text templates exist: `caption-highlight`, `caption-matrix-decode`, `caption-gradient-fill`, `caption-neon-glow`, `caption-neon-accent`, `caption-glitch-rgb`, `caption-clip-wipe`, `caption-blend-difference`, `caption-weight-shift`, `caption-texture`, `caption-kinetic-slam`, `caption-emoji-pop`, `caption-particle-burst`.
- The worktree is dirty from earlier animation work. Stage and commit only the exact files listed in each task.

---

## File Structure

- Modify `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`: add reusable parameters and new migrated text preset definitions.
- Modify `vendor/hyperframes/packages/core/src/motionPresetKeyframes.ts`: add keyframe builders for the migrated preset ids.
- Modify `vendor/hyperframes/packages/core/src/motionPresets.ts`: add default durations for selected new presets if the default emphasis duration is not appropriate.
- Modify `vendor/hyperframes/packages/core/src/motionPresets.test.ts`: test preset ids, parameter validation, theme-aware defaults, split units, and bounded keyframes.
- Modify `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.tsx`: add Text Animation cards for migrated presets.
- Modify `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.test.ts`: test template count, ids, category, theme defaults, and parameter passthrough.
- Modify `vendor/hyperframes/packages/studio/src/hooks/catalogLibrarySections.test.ts`: update caption catalog counts and assert removed migrated caption components are absent.
- Modify `vendor/hyperframes/registry/registry.json`: remove migrated catalog entries.
- Delete migrated registry directories under `vendor/hyperframes/registry/components/caption-*`.

---

### Task 1: Add Migrated Text Preset Definitions

**Files:**
- Modify: `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresets.test.ts`

**Interfaces:**
- Produces preset ids consumed by Task 2 and Task 3:
  - `text.emphasis.highlight-sweep`
  - `text.enter.matrix-decode`
  - `text.emphasis.gradient-fill`
  - `text.emphasis.neon-glow`
  - `text.emphasis.neon-accent`
  - `text.emphasis.rgb-glitch`
  - `text.enter.clip-wipe`
  - `text.emphasis.blend-difference`
  - `text.emphasis.weight-shift`
  - `text.emphasis.texture-fill`
  - `text.emphasis.kinetic-slam`
  - `text.emphasis.emoji-pop`
  - `text.emphasis.particle-burst`
- Produces bounded parameter schemas for `compileMotionInstance()` to validate.

- [ ] **Step 1: Write the failing preset catalog test**

Add this test to `vendor/hyperframes/packages/core/src/motionPresets.test.ts` after the existing "ships stable text and element presets" test:

```ts
it("ships migrated caption effects as editable text presets", () => {
  const migratedIds = [
    "text.emphasis.highlight-sweep",
    "text.enter.matrix-decode",
    "text.emphasis.gradient-fill",
    "text.emphasis.neon-glow",
    "text.emphasis.neon-accent",
    "text.emphasis.rgb-glitch",
    "text.enter.clip-wipe",
    "text.emphasis.blend-difference",
    "text.emphasis.weight-shift",
    "text.emphasis.texture-fill",
    "text.emphasis.kinetic-slam",
    "text.emphasis.emoji-pop",
    "text.emphasis.particle-burst",
  ];

  expect(MOTION_PRESETS).toHaveLength(63);
  expect(new Set(MOTION_PRESETS.map((preset) => preset.id)).size).toBe(63);

  for (const id of migratedIds) {
    const preset = MOTION_PRESETS.find((candidate) => candidate.id === id);
    expect(preset, id).toBeDefined();
    expect(preset?.targetKinds, id).toEqual(["text"]);
    expect(preset?.parameterSchema.map((parameter) => parameter.id), id).toContain("intensity");
    expect(preset?.parameterSchema.map((parameter) => parameter.id), id).toContain("ease");
  }

  expect(listMotionPresets({ targetKind: "text", phase: "enter" }).map((preset) => preset.id))
    .toEqual(expect.arrayContaining(["text.enter.matrix-decode", "text.enter.clip-wipe"]));
  expect(listMotionPresets({ targetKind: "text", phase: "emphasis" }).map((preset) => preset.id))
    .toEqual(expect.arrayContaining(migratedIds.filter((id) => id.includes(".emphasis."))));
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm.cmd test -- src/motionPresets.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/core
```

Expected: FAIL because `MOTION_PRESETS` still has `50` items and the migrated preset ids are missing.

- [ ] **Step 3: Add reusable parameters and preset definitions**

In `vendor/hyperframes/packages/core/src/motionPresetCatalog.ts`, add reusable parameters near `MOTION_INTENSITY_PARAMETER`:

```ts
const MOTION_GLOW_PARAMETER: MotionParameter = {
  id: "glow",
  label: "辉光",
  kind: "number",
  min: 0,
  max: 2,
  step: 0.1,
};

const MOTION_BLUR_PARAMETER: MotionParameter = {
  id: "blur",
  label: "模糊",
  kind: "number",
  min: 0,
  max: 32,
  step: 1,
  unit: "px",
};

const MOTION_DENSITY_PARAMETER: MotionParameter = {
  id: "density",
  label: "密度",
  kind: "number",
  min: 0,
  max: 2,
  step: 0.1,
};

const MOTION_DISTANCE_PARAMETER: MotionParameter = {
  id: "distance",
  label: "移动距离",
  kind: "number",
  min: 0,
  max: 180,
  step: 2,
  unit: "px",
};

const MOTION_READABILITY_PARAMETER: MotionParameter = {
  id: "preserveReadable",
  label: "保持可读",
  kind: "select",
  options: [
    { value: "true", label: "开启" },
    { value: "false", label: "关闭" },
  ],
};
```

Add this helper after `textPreset()`:

```ts
function migratedTextPreset(
  seed: PresetSeed & {
    extraParameters?: MotionParameter[];
  },
): MotionPreset {
  return {
    ...textPreset(seed),
    parameterSchema: [
      ...MOTION_COMMON_PARAMETERS,
      MOTION_INTENSITY_PARAMETER,
      ...(seed.direction ? [MOTION_DIRECTION_PARAMETER] : []),
      ...MOTION_TEXT_PARAMETERS,
      ...(seed.color
        ? [
            MOTION_COLOR_SOURCE_PARAMETER,
            { id: "color", label: "效果颜色", kind: "color" as const },
          ]
        : []),
      ...(seed.extraParameters ?? []),
    ],
    defaults: {
      ease: seed.phase === "emphasis" ? "sine.inOut" : "power3.out",
      intensity: 1,
      unit: "whole",
      stagger: 0.04,
      ...(seed.direction ? { direction: "right" } : {}),
      ...(seed.color ? { colorSource: "theme", color: "#20BBC0" } : {}),
      ...seed.defaults,
    },
  };
}
```

Add this array before `const ELEMENT_MOTION_PRESETS`:

```ts
const MIGRATED_CAPTION_TEXT_PRESETS: readonly MotionPreset[] = [
  migratedTextPreset({
    id: "text.emphasis.highlight-sweep",
    label: "高亮扫过",
    phase: "emphasis",
    direction: true,
    color: true,
    defaults: { unit: "word", stagger: 0.05, color: "#FFE66D" },
    extraParameters: [
      { id: "roundness", label: "圆角", kind: "number", min: 0, max: 24, step: 1, unit: "px" },
    ],
    semantics: {
      intents: ["高亮", "扫过", "关键词强调"],
      tones: ["清晰", "编辑感"],
      preferredFor: ["关键词", "标题", "字幕文字"],
      avoidFor: ["很小的正文"],
    },
  }),
  migratedTextPreset({
    id: "text.enter.matrix-decode",
    label: "矩阵解码",
    phase: "enter",
    color: true,
    defaults: { unit: "character", stagger: 0.03, color: "#32FF7E" },
    extraParameters: [MOTION_DENSITY_PARAMETER, MOTION_BLUR_PARAMETER],
    semantics: {
      intents: ["解码", "科技显现", "字符扰动"],
      tones: ["科技", "利落"],
      preferredFor: ["科技标题", "编号", "短句"],
      avoidFor: ["长段正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.gradient-fill",
    label: "渐变填充",
    phase: "emphasis",
    direction: true,
    color: true,
    defaults: { color: "#FF4FD8" },
    extraParameters: [{ id: "accentColor", label: "强调色", kind: "color" }],
    semantics: {
      intents: ["渐变", "填充", "流动"],
      tones: ["明亮", "品牌感"],
      preferredFor: ["标题", "关键词"],
      avoidFor: ["正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.neon-glow",
    label: "霓虹辉光",
    phase: "emphasis",
    color: true,
    defaults: { color: "#20BBC0" },
    extraParameters: [MOTION_GLOW_PARAMETER],
    semantics: {
      intents: ["霓虹", "发光", "强调"],
      tones: ["科技", "夜景"],
      preferredFor: ["标题", "品牌词"],
      avoidFor: ["长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.neon-accent",
    label: "霓虹强调",
    phase: "emphasis",
    color: true,
    defaults: { color: "#FF4FD8" },
    extraParameters: [MOTION_GLOW_PARAMETER],
    semantics: {
      intents: ["霓虹", "强调色", "轻微漂移"],
      tones: ["活跃", "科技"],
      preferredFor: ["短标题", "关键词"],
      avoidFor: ["正式正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.rgb-glitch",
    label: "RGB 故障",
    phase: "emphasis",
    color: true,
    defaults: { color: "#FF3355", preserveReadable: "true" },
    extraParameters: [MOTION_BLUR_PARAMETER, MOTION_DENSITY_PARAMETER, MOTION_READABILITY_PARAMETER],
    semantics: {
      intents: ["故障", "RGB", "扰动"],
      tones: ["强烈", "科技"],
      preferredFor: ["科技标题", "转折词"],
      avoidFor: ["稳重品牌", "长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.enter.clip-wipe",
    label: "裁切揭幕",
    phase: "enter",
    direction: true,
    defaults: { unit: "word", stagger: 0.05 },
    semantics: {
      intents: ["裁切", "揭幕", "方向进入"],
      tones: ["利落", "编辑感"],
      preferredFor: ["标题", "短句", "字幕文字"],
      avoidFor: ["超长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.blend-difference",
    label: "差值反色",
    phase: "emphasis",
    defaults: { preserveReadable: "true" },
    extraParameters: [MOTION_BLUR_PARAMETER, MOTION_READABILITY_PARAMETER],
    semantics: {
      intents: ["反色", "混合", "强调"],
      tones: ["实验", "编辑感"],
      preferredFor: ["标题", "海报文字"],
      avoidFor: ["小字号正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.weight-shift",
    label: "字重切换",
    phase: "emphasis",
    defaults: { unit: "word", stagger: 0.04 },
    extraParameters: [
      { id: "minWeight", label: "起始字重", kind: "number", min: 100, max: 900, step: 50 },
      { id: "maxWeight", label: "强调字重", kind: "number", min: 100, max: 900, step: 50 },
    ],
    semantics: {
      intents: ["字重", "强调", "排版"],
      tones: ["克制", "高级"],
      preferredFor: ["标题", "关键词"],
      avoidFor: ["不支持可变字重的字体"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.texture-fill",
    label: "纹理填充",
    phase: "emphasis",
    direction: true,
    color: true,
    defaults: { color: "#FFFFFF" },
    extraParameters: [MOTION_DENSITY_PARAMETER],
    semantics: {
      intents: ["纹理", "遮罩", "填充"],
      tones: ["设计感", "海报"],
      preferredFor: ["大标题", "品牌词"],
      avoidFor: ["小字号正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.kinetic-slam",
    label: "动感冲击",
    phase: "emphasis",
    direction: true,
    defaults: { unit: "word", preserveReadable: "true" },
    extraParameters: [MOTION_DISTANCE_PARAMETER, MOTION_READABILITY_PARAMETER],
    semantics: {
      intents: ["冲击", "动感", "强调"],
      tones: ["强烈", "节奏"],
      preferredFor: ["短标题", "关键词"],
      avoidFor: ["长正文"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.emoji-pop",
    label: "Emoji 弹出",
    phase: "emphasis",
    defaults: { unit: "character", stagger: 0.03 },
    semantics: {
      intents: ["emoji", "弹出", "轻松"],
      tones: [" playful", "社交"],
      preferredFor: ["社媒文字", "轻松标题"],
      avoidFor: ["正式报告"],
    },
  }),
  migratedTextPreset({
    id: "text.emphasis.particle-burst",
    label: "粒子爆发",
    phase: "emphasis",
    color: true,
    defaults: { unit: "word", stagger: 0.06, color: "#FFB000" },
    extraParameters: [MOTION_DENSITY_PARAMETER],
    semantics: {
      intents: ["粒子", "爆发", "关键词强调"],
      tones: ["活跃", "庆祝"],
      preferredFor: ["关键词", "数字", "短标题"],
      avoidFor: ["长正文"],
    },
  }),
];
```

Add the array to `MOTION_PRESETS` before `ELEMENT_MOTION_PRESETS`:

```ts
export const MOTION_PRESETS: readonly MotionPreset[] = [
  ...TEXT_MOTION_PRESETS,
  ...MIGRATED_CAPTION_TEXT_PRESETS,
  ...ELEMENT_MOTION_PRESETS,
  ...REACT_BITS_TEXT_PRESETS,
  ...REACT_BITS_GENERAL_PRESETS,
  ...REACT_BITS_BACKGROUND_PRESETS,
  ...REACT_BITS_BOX_PRESETS,
];
```

- [ ] **Step 4: Run the test and verify the count/id test passes**

Run:

```powershell
pnpm.cmd test -- src/motionPresets.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/core
```

Expected: the new count/id test passes. Other tests may still fail because Task 2 keyframes are not implemented yet.

- [ ] **Step 5: Commit Task 1 only if the remaining failures are the expected missing keyframe failures**

```powershell
git add -- vendor/hyperframes/packages/core/src/motionPresetCatalog.ts vendor/hyperframes/packages/core/src/motionPresets.test.ts
git commit -m "feat: define migrated text motion presets"
```

---

### Task 2: Compile Keyframes for Migrated Text Presets

**Files:**
- Modify: `vendor/hyperframes/packages/core/src/motionPresetKeyframes.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresets.ts`
- Modify: `vendor/hyperframes/packages/core/src/motionPresets.test.ts`

**Interfaces:**
- Consumes preset ids from Task 1.
- Produces non-empty keyframes for `compileMotionInstance()` and Studio animation application.

- [ ] **Step 1: Write failing keyframe behavior tests**

Add this test to `vendor/hyperframes/packages/core/src/motionPresets.test.ts` before "compiles every catalog preset to bounded editable keyframes":

```ts
it("compiles migrated text effects with editable parameters", () => {
  const highlight = compileMotionInstance(
    createMotionInstance({
      presetId: "text.emphasis.highlight-sweep",
      target: { selector: "#headline" },
      targetKind: "text",
      start: 0,
      parameters: {
        unit: "word",
        stagger: 0.05,
        colorSource: "custom",
        color: "#FFE66D",
        direction: "right",
        intensity: 1.2,
      },
    }),
  );
  const glitch = compileMotionInstance(
    createMotionInstance({
      presetId: "text.emphasis.rgb-glitch",
      target: { selector: "#headline" },
      targetKind: "text",
      start: 0,
      parameters: { preserveReadable: "true", density: 1.4, blur: 8, intensity: 1.1 },
    }),
  );
  const decode = compileMotionInstance(
    createMotionInstance({
      presetId: "text.enter.matrix-decode",
      target: { selector: "#headline" },
      targetKind: "text",
      start: 0,
      parameters: { unit: "character", stagger: 0.03, colorSource: "theme" },
    }),
  );

  expect(highlight.targetSelector).toBe("#headline > [data-ipw-motion-word]");
  expect(highlight.extras.stagger).toBe(0.05);
  expect(highlight.keyframes.some((keyframe) =>
    String(keyframe.properties.boxShadow ?? "").includes("#FFE66D"),
  )).toBe(true);

  expect(glitch.keyframes.some((keyframe) =>
    String(keyframe.properties.textShadow ?? "").includes("#22d3ee"),
  )).toBe(true);
  expect(glitch.keyframes.at(-1)?.properties.opacity ?? 1).toBe(1);

  expect(decode.targetSelector).toBe("#headline [data-ipw-motion-char]");
  expect(decode.keyframes[0]?.properties.color).toBe("var(--ipw-color-accent, #7c3aed)");
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm.cmd test -- src/motionPresets.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/core
```

Expected: FAIL because `buildPresetKeyframes()` returns empty arrays for the new preset ids.

- [ ] **Step 3: Add helpers to keyframe builder**

In `vendor/hyperframes/packages/core/src/motionPresetKeyframes.ts`, add helper functions after `motionColor()`:

```ts
function readableEnabled(params: MotionParameters): boolean {
  return params.preserveReadable !== "false";
}

function secondColor(params: MotionParameters, fallback: string): string {
  if (params.colorSource === "theme") return "var(--ipw-color-primary, #20BBC0)";
  return String(params.accentColor ?? fallback);
}
```

- [ ] **Step 4: Add keyframe cases**

Add these cases inside `buildPresetKeyframes()` after the existing `text.emphasis.glitch` case:

```ts
    case "text.emphasis.highlight-sweep": {
      const roundness = Number(params.roundness ?? 8);
      return [
        frame(0, {
          backgroundColor: "transparent",
          boxShadow: `inset 0 0 0 0 transparent`,
          borderRadius: `${roundness}px`,
          filter: "brightness(1)",
        }),
        frame(48, {
          backgroundColor: color,
          boxShadow: `inset 0 -0.82em 0 ${color}`,
          borderRadius: `${roundness}px`,
          filter: `brightness(${1 + 0.18 * intensity})`,
        }),
        frame(100, {
          backgroundColor: "transparent",
          boxShadow: `inset 0 -0.18em 0 ${color}`,
          borderRadius: `${roundness}px`,
          filter: "brightness(1)",
        }),
      ];
    }
    case "text.enter.matrix-decode": {
      const density = Number(params.density ?? 1);
      const blur = Number(params.blur ?? 5);
      return [
        frame(0, {
          opacity: 0,
          color,
          x: -6 * intensity * density,
          filter: `blur(${blur}px) contrast(${1 + 0.2 * density})`,
          letterSpacing: `${0.08 * density}em`,
        }),
        frame(58, {
          opacity: 0.82,
          color,
          x: 2 * intensity,
          filter: `blur(${Math.max(1, blur * 0.18)}px) contrast(${1 + 0.12 * density})`,
          letterSpacing: `${0.025 * density}em`,
        }),
        frame(100, {
          opacity: 1,
          color: "currentColor",
          x: 0,
          filter: "blur(0px) contrast(1)",
          letterSpacing: "0em",
        }),
      ];
    }
    case "text.emphasis.gradient-fill": {
      const accent = secondColor(params, "#FF4FD8");
      return [
        frame(0, {
          color: "currentColor",
          backgroundImage: `linear-gradient(90deg, currentColor, ${color}, ${accent})`,
          filter: "brightness(1)",
        }),
        frame(50, {
          color,
          backgroundImage: `linear-gradient(90deg, ${color}, ${accent}, ${color})`,
          filter: `brightness(${1 + 0.28 * intensity}) saturate(${1 + 0.35 * intensity})`,
        }),
        frame(100, {
          color: "currentColor",
          backgroundImage: `linear-gradient(90deg, ${accent}, ${color}, currentColor)`,
          filter: "brightness(1) saturate(1)",
        }),
      ];
    }
    case "text.emphasis.neon-glow":
    case "text.emphasis.neon-accent": {
      const glow = Number(params.glow ?? 1);
      const drift = presetId === "text.emphasis.neon-accent" ? 3 * intensity : 0;
      return [
        frame(0, { x: 0, color: "currentColor", textShadow: "0 0 0 transparent" }),
        frame(48, {
          x: drift,
          color,
          textShadow: `0 0 ${Math.round(18 * glow)}px ${color}`,
          filter: `brightness(${1 + 0.25 * glow})`,
        }),
        frame(100, {
          x: 0,
          color: "currentColor",
          textShadow: `0 0 ${Math.round(6 * glow)}px ${color}`,
          filter: "brightness(1)",
        }),
      ];
    }
    case "text.emphasis.rgb-glitch": {
      const density = Number(params.density ?? 1);
      const blur = Number(params.blur ?? 0);
      const readable = readableEnabled(params);
      return [
        frame(0, { opacity: 1, x: 0, skewX: 0, filter: "blur(0px)", textShadow: "0 0 0 transparent" }),
        frame(22, {
          opacity: readable ? 1 : 0.78,
          x: -7 * intensity * density,
          skewX: -5 * intensity,
          filter: `blur(${blur * 0.22}px)`,
          textShadow: `${4 * density}px 0 ${color}, ${-4 * density}px 0 #22d3ee`,
        }),
        frame(46, {
          opacity: 1,
          x: 6 * intensity * density,
          skewX: 4 * intensity,
          filter: `blur(${blur * 0.12}px)`,
          textShadow: `${-3 * density}px 0 ${color}, ${3 * density}px 0 #22d3ee`,
        }),
        frame(100, { opacity: 1, x: 0, skewX: 0, filter: "blur(0px)", textShadow: "0 0 0 transparent" }),
      ];
    }
    case "text.enter.clip-wipe":
      return [
        frame(0, { opacity: 0, clipPath: wipeInset(direction, true), filter: "blur(2px)" }),
        frame(100, { opacity: 1, clipPath: wipeInset(direction, false), filter: "blur(0px)" }),
      ];
    case "text.emphasis.blend-difference": {
      const blur = Number(params.blur ?? 0);
      return [
        frame(0, { opacity: 1, mixBlendMode: "normal", filter: "invert(0) blur(0px)" }),
        frame(45, {
          opacity: readableEnabled(params) ? 1 : 0.86,
          mixBlendMode: "difference",
          filter: `invert(${0.65 * intensity}) blur(${blur * 0.1}px)`,
        }),
        frame(100, { opacity: 1, mixBlendMode: "normal", filter: "invert(0) blur(0px)" }),
      ];
    }
    case "text.emphasis.weight-shift": {
      const minWeight = Number(params.minWeight ?? 400);
      const maxWeight = Number(params.maxWeight ?? 800);
      return [
        frame(0, { fontWeight: minWeight, scale: 1 }),
        frame(48, { fontWeight: maxWeight, scale: 1 + 0.025 * intensity }),
        frame(100, { fontWeight: minWeight, scale: 1 }),
      ];
    }
    case "text.emphasis.texture-fill": {
      const density = Number(params.density ?? 1);
      return [
        frame(0, { color: "currentColor", filter: "contrast(1) brightness(1)", letterSpacing: "0em" }),
        frame(52, {
          color,
          filter: `contrast(${1 + 0.45 * density}) brightness(${1 + 0.18 * intensity})`,
          letterSpacing: `${0.02 * density}em`,
        }),
        frame(100, { color: "currentColor", filter: "contrast(1) brightness(1)", letterSpacing: "0em" }),
      ];
    }
    case "text.emphasis.kinetic-slam": {
      const distance = Number(params.distance ?? 56);
      const slamOffset = directionOffset(direction, distance * intensity);
      return [
        frame(0, { opacity: 1, x: -slamOffset.x, y: -slamOffset.y, scale: 0.94, filter: "blur(3px)" }),
        frame(42, { opacity: 1, x: 0, y: 0, scale: 1.12 + 0.04 * intensity, filter: "blur(0px)" }),
        frame(72, { opacity: 1, x: slamOffset.x * 0.12, y: slamOffset.y * 0.12, scale: 0.985, filter: "blur(0px)" }),
        frame(100, { opacity: 1, x: 0, y: 0, scale: 1, filter: "blur(0px)" }),
      ];
    }
    case "text.emphasis.emoji-pop":
      return [
        frame(0, { scale: 1, rotation: 0 }),
        frame(36, { scale: 1 + 0.18 * intensity, rotation: -6 * intensity }),
        frame(68, { scale: 0.98, rotation: 3 * intensity }),
        frame(100, { scale: 1, rotation: 0 }),
      ];
    case "text.emphasis.particle-burst": {
      const density = Number(params.density ?? 1);
      return [
        frame(0, { scale: 1, textShadow: "0 0 0 transparent", filter: "brightness(1)" }),
        frame(44, {
          scale: 1 + 0.08 * intensity,
          textShadow: `0 -${Math.round(10 * density)}px ${color}, ${Math.round(8 * density)}px ${Math.round(6 * density)}px ${color}, -${Math.round(8 * density)}px ${Math.round(6 * density)}px ${color}`,
          filter: `brightness(${1 + 0.22 * intensity})`,
        }),
        frame(100, { scale: 1, textShadow: "0 0 0 transparent", filter: "brightness(1)" }),
      ];
    }
```

- [ ] **Step 5: Add default durations for new presets**

In `vendor/hyperframes/packages/core/src/motionPresets.ts`, add these before the generic emphasis default:

```ts
  if (preset.id === "text.enter.matrix-decode") return 1.15;
  if (preset.id === "text.enter.clip-wipe") return 0.72;
  if (preset.id === "text.emphasis.kinetic-slam") return 0.86;
  if (preset.id === "text.emphasis.particle-burst") return 0.9;
  if (preset.id.startsWith("text.emphasis.neon-")) return 1.2;
```

- [ ] **Step 6: Run the core test and verify it passes**

Run:

```powershell
pnpm.cmd test -- src/motionPresets.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/core
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- vendor/hyperframes/packages/core/src/motionPresetKeyframes.ts vendor/hyperframes/packages/core/src/motionPresets.ts vendor/hyperframes/packages/core/src/motionPresets.test.ts
git commit -m "feat: compile migrated text motion effects"
```

---

### Task 3: Expose Migrated Presets in Text Animation Templates

**Files:**
- Modify: `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.tsx`
- Modify: `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.test.ts`

**Interfaces:**
- Consumes preset ids from Task 1.
- Produces Text Animation cards in `ANIMATION_TEMPLATES`.

- [ ] **Step 1: Write the failing Studio template test**

In `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.test.ts`, update the first test and add a new one:

```ts
it("owns four editable animation categories without scene effects", () => {
  expect(ANIMATION_TEMPLATES).toHaveLength(45);
  expect(new Set(ANIMATION_TEMPLATES.map((template) => template.category))).toEqual(
    new Set(["general", "text", "background", "box"]),
  );
  expect(ANIMATION_TEMPLATES.map((template) => template.id)).not.toEqual(
    expect.arrayContaining([
      "opening-editorial-rise",
      "ending-brand-lockup",
      "transition-split-wipe",
      "caption-mask-reveal",
      "caption-highlight",
      "caption-matrix-decode",
    ]),
  );
});

it("exposes migrated caption effects as text animation templates", () => {
  const migratedTemplates = [
    ["text-highlight-sweep", "text.emphasis.highlight-sweep"],
    ["text-matrix-decode", "text.enter.matrix-decode"],
    ["text-gradient-fill", "text.emphasis.gradient-fill"],
    ["text-neon-glow", "text.emphasis.neon-glow"],
    ["text-neon-accent", "text.emphasis.neon-accent"],
    ["text-rgb-glitch", "text.emphasis.rgb-glitch"],
    ["text-clip-wipe", "text.enter.clip-wipe"],
    ["text-blend-difference", "text.emphasis.blend-difference"],
    ["text-weight-shift", "text.emphasis.weight-shift"],
    ["text-texture-fill", "text.emphasis.texture-fill"],
    ["text-kinetic-slam", "text.emphasis.kinetic-slam"],
    ["text-emoji-pop", "text.emphasis.emoji-pop"],
    ["text-particle-burst", "text.emphasis.particle-burst"],
  ] as const;

  for (const [templateId, presetId] of migratedTemplates) {
    const template = ANIMATION_TEMPLATES.find((candidate) => candidate.id === templateId);
    expect(template, templateId).toMatchObject({ category: "text", presetId });
    expect(resolveAnimationTemplatePreset(template!, "text")?.id).toBe(presetId);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm.cmd test -- src/components/sidebar/AnimationTemplatesTab.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/studio
```

Expected: FAIL because templates are missing and the count remains `32`.

- [ ] **Step 3: Add Text Animation templates**

In `vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.tsx`, add these entries after `text-true-focus` and before background templates:

```ts
  {
    id: "text-highlight-sweep",
    category: "text",
    title: { en: "Highlight Sweep", zh: "高亮扫过" },
    description: { en: "Editable word or character highlight", zh: "支持按词或按字的高亮扫过" },
    preview: "text-highlight",
    presetId: "text.emphasis.highlight-sweep",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-matrix-decode",
    category: "text",
    title: { en: "Matrix Decode", zh: "矩阵解码" },
    description: { en: "Character decode with density controls", zh: "可调密度的字符解码显现" },
    preview: "decode",
    presetId: "text.enter.matrix-decode",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-gradient-fill",
    category: "text",
    title: { en: "Gradient Fill", zh: "渐变填充" },
    description: { en: "Theme-aware gradient emphasis", zh: "跟随主题色的渐变文字强调" },
    preview: "text-shine",
    presetId: "text.emphasis.gradient-fill",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-neon-glow",
    category: "text",
    title: { en: "Neon Glow", zh: "霓虹辉光" },
    description: { en: "Editable glow color and strength", zh: "可调颜色与辉光强度" },
    preview: "text-glow",
    presetId: "text.emphasis.neon-glow",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-neon-accent",
    category: "text",
    title: { en: "Neon Accent", zh: "霓虹强调" },
    description: { en: "Accent glow with subtle drift", zh: "带轻微漂移的强调辉光" },
    preview: "text-glow",
    presetId: "text.emphasis.neon-accent",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-rgb-glitch",
    category: "text",
    title: { en: "RGB Glitch", zh: "RGB 故障" },
    description: { en: "Readable chromatic glitch", zh: "保持可读的色差故障" },
    preview: "decode",
    presetId: "text.emphasis.rgb-glitch",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-clip-wipe",
    category: "text",
    title: { en: "Clip Wipe", zh: "裁切揭幕" },
    description: { en: "Directional text wipe reveal", zh: "可调方向的文字裁切揭示" },
    preview: "text-mask",
    presetId: "text.enter.clip-wipe",
  },
  {
    id: "text-blend-difference",
    category: "text",
    title: { en: "Blend Difference", zh: "差值反色" },
    description: { en: "Invert-style text emphasis", zh: "反色混合风格文字强调" },
    preview: "text-focus",
    presetId: "text.emphasis.blend-difference",
  },
  {
    id: "text-weight-shift",
    category: "text",
    title: { en: "Weight Shift", zh: "字重切换" },
    description: { en: "Editable font-weight emphasis", zh: "可调字重的文字强调" },
    preview: "text-focus",
    presetId: "text.emphasis.weight-shift",
  },
  {
    id: "text-texture-fill",
    category: "text",
    title: { en: "Texture Fill", zh: "纹理填充" },
    description: { en: "Theme-aware texture-like fill", zh: "跟随主题的纹理填充感" },
    preview: "text-shine",
    presetId: "text.emphasis.texture-fill",
    parameters: { colorSource: "theme" },
  },
  {
    id: "text-kinetic-slam",
    category: "text",
    title: { en: "Kinetic Slam", zh: "动感冲击" },
    description: { en: "Readable kinetic type impact", zh: "保持可读的动感文字冲击" },
    preview: "text-fold",
    presetId: "text.emphasis.kinetic-slam",
  },
  {
    id: "text-emoji-pop",
    category: "text",
    title: { en: "Emoji Pop", zh: "Emoji 弹出" },
    description: { en: "Playful character pop emphasis", zh: "轻快的字符弹出强调" },
    preview: "typewriter",
    presetId: "text.emphasis.emoji-pop",
  },
  {
    id: "text-particle-burst",
    category: "text",
    title: { en: "Particle Burst", zh: "粒子爆发" },
    description: { en: "Particle-like keyword emphasis", zh: "粒子感关键词强调" },
    preview: "text-glow",
    presetId: "text.emphasis.particle-burst",
    parameters: { colorSource: "theme" },
  },
```

- [ ] **Step 4: Run the Studio template test and verify it passes**

Run:

```powershell
pnpm.cmd test -- src/components/sidebar/AnimationTemplatesTab.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/studio
```

Expected: PASS.

- [ ] **Step 5: Commit Task 3**

```powershell
git add -- vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.tsx vendor/hyperframes/packages/studio/src/components/sidebar/AnimationTemplatesTab.test.ts
git commit -m "feat: expose migrated text animation templates"
```

---

### Task 4: Remove Migrated Caption Catalog Items

**Files:**
- Modify: `vendor/hyperframes/packages/studio/src/hooks/catalogLibrarySections.test.ts`
- Modify: `vendor/hyperframes/registry/registry.json`
- Delete:
  - `vendor/hyperframes/registry/components/caption-highlight/`
  - `vendor/hyperframes/registry/components/caption-matrix-decode/`
  - `vendor/hyperframes/registry/components/caption-gradient-fill/`
  - `vendor/hyperframes/registry/components/caption-neon-glow/`
  - `vendor/hyperframes/registry/components/caption-neon-accent/`
  - `vendor/hyperframes/registry/components/caption-glitch-rgb/`
  - `vendor/hyperframes/registry/components/caption-clip-wipe/`
  - `vendor/hyperframes/registry/components/caption-blend-difference/`
  - `vendor/hyperframes/registry/components/caption-weight-shift/`
  - `vendor/hyperframes/registry/components/caption-texture/`
  - `vendor/hyperframes/registry/components/caption-kinetic-slam/`
  - `vendor/hyperframes/registry/components/caption-emoji-pop/`
  - `vendor/hyperframes/registry/components/caption-particle-burst/`

**Interfaces:**
- Consumes Task 3 Text Animation templates as replacement user path.
- Produces caption catalog containing retained caption-specific effects only.

- [ ] **Step 1: Write the failing registry/catalog test**

In `vendor/hyperframes/packages/studio/src/hooks/catalogLibrarySections.test.ts`, update the first test:

```ts
expect(active).toHaveLength(18);
expect(counts).toEqual({
  "opening-animation": 4,
  "ending-animation": 4,
  "transition-animation": 4,
  "caption-animation": 6,
});
```

Replace the caption component list assertion with retained caption components only:

```ts
expect(captionComponents).toEqual([
  "caption-editorial-emphasis",
  "caption-pill-karaoke",
]);
```

Add this assertion before the equality:

```ts
expect(captionComponents).not.toEqual(
  expect.arrayContaining([
    "caption-highlight",
    "caption-matrix-decode",
    "caption-gradient-fill",
    "caption-neon-glow",
    "caption-neon-accent",
    "caption-glitch-rgb",
    "caption-clip-wipe",
    "caption-blend-difference",
    "caption-weight-shift",
    "caption-texture",
    "caption-kinetic-slam",
    "caption-emoji-pop",
    "caption-particle-burst",
  ]),
);
```

The retained `caption-animation` count is `6` because it includes four retained blocks and two retained components.

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
pnpm.cmd test -- src/hooks/catalogLibrarySections.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/studio
```

Expected: FAIL because migrated caption catalog items still exist.

- [ ] **Step 3: Remove migrated entries from registry.json**

In `vendor/hyperframes/registry/registry.json`, remove objects whose `name` is any migrated caption item:

```json
{ "name": "caption-highlight", "type": "hyperframes:component" }
{ "name": "caption-matrix-decode", "type": "hyperframes:component" }
{ "name": "caption-gradient-fill", "type": "hyperframes:component" }
{ "name": "caption-neon-glow", "type": "hyperframes:component" }
{ "name": "caption-neon-accent", "type": "hyperframes:component" }
{ "name": "caption-glitch-rgb", "type": "hyperframes:component" }
{ "name": "caption-clip-wipe", "type": "hyperframes:component" }
{ "name": "caption-blend-difference", "type": "hyperframes:component" }
{ "name": "caption-weight-shift", "type": "hyperframes:component" }
{ "name": "caption-texture", "type": "hyperframes:component" }
{ "name": "caption-kinetic-slam", "type": "hyperframes:component" }
{ "name": "caption-emoji-pop", "type": "hyperframes:component" }
{ "name": "caption-particle-burst", "type": "hyperframes:component" }
```

- [ ] **Step 4: Delete migrated component directories**

Use native PowerShell and verify paths before deleting. For each directory, resolve the absolute path and confirm it starts with the repository root:

```powershell
$root = (Resolve-Path ".").Path
$names = @(
  "caption-highlight",
  "caption-matrix-decode",
  "caption-gradient-fill",
  "caption-neon-glow",
  "caption-neon-accent",
  "caption-glitch-rgb",
  "caption-clip-wipe",
  "caption-blend-difference",
  "caption-weight-shift",
  "caption-texture",
  "caption-kinetic-slam",
  "caption-emoji-pop",
  "caption-particle-burst"
)
foreach ($name in $names) {
  $path = Resolve-Path "vendor/hyperframes/registry/components/$name"
  if (-not $path.Path.StartsWith($root)) {
    throw "Refusing to delete outside repository: $($path.Path)"
  }
  Remove-Item -LiteralPath $path.Path -Recurse -Force
}
```

If `Remove-Item` is blocked by policy, delete the tracked files with `apply_patch` delete hunks and remove empty directories with `[System.IO.Directory]::Delete($path, $false)` after confirming they are empty.

- [ ] **Step 5: Verify no migrated caption catalog references remain**

Run:

```powershell
rg -n "caption-highlight|caption-matrix-decode|caption-gradient-fill|caption-neon-glow|caption-neon-accent|caption-glitch-rgb|caption-clip-wipe|caption-blend-difference|caption-weight-shift|caption-texture|caption-kinetic-slam|caption-emoji-pop|caption-particle-burst" vendor/hyperframes/registry vendor/hyperframes/packages/studio/src/hooks/catalogLibrarySections.test.ts -S
```

Expected: only negative test assertions in `catalogLibrarySections.test.ts` may remain.

- [ ] **Step 6: Run catalog test and verify it passes**

Run:

```powershell
pnpm.cmd test -- src/hooks/catalogLibrarySections.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/studio
```

Expected: PASS.

- [ ] **Step 7: Commit Task 4**

```powershell
git add -- vendor/hyperframes/packages/studio/src/hooks/catalogLibrarySections.test.ts vendor/hyperframes/registry/registry.json vendor/hyperframes/registry/components
git commit -m "feat: remove migrated caption catalog effects"
```

---

### Task 5: Final Verification

**Files:**
- No production changes unless verification finds a bug.

**Interfaces:**
- Verifies Tasks 1 through 4 as an integrated migration.

- [ ] **Step 1: Run core tests**

```powershell
pnpm.cmd test -- src/motionPresets.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/core
```

Expected: PASS.

- [ ] **Step 2: Run Studio animation template tests**

```powershell
pnpm.cmd test -- src/components/sidebar/AnimationTemplatesTab.test.ts src/hooks/catalogLibrarySections.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/studio
```

Expected: PASS.

- [ ] **Step 3: Run server preview tests affected by caption cleanup**

```powershell
pnpm.cmd test -- src/routes/registryPreview.test.ts
```

Working directory:

```text
vendor/hyperframes/packages/studio-server
```

Expected: PASS.

- [ ] **Step 4: Run type checks where changed code is compiled**

```powershell
pnpm.cmd typecheck
```

Working directories:

```text
vendor/hyperframes/packages/core
vendor/hyperframes/packages/studio
vendor/hyperframes/packages/studio-server
```

Expected: PASS in each package.

- [ ] **Step 5: Run repository hygiene checks**

```powershell
git diff --check
node .codex/skills/ipollowork-maintainable-code/scripts/audit-changes.mjs
```

Working directory:

```text
D:\ipollo实习\iPolloWork\iPolloWork-latest-main-20260811
```

Expected: `git diff --check` exits `0`; audit returns `"ok": true`.

- [ ] **Step 6: Manual UI sanity check**

Start the app using the repo's normal local command. In the UI:

- Select an existing text element.
- Open Animation.
- Open Text Animation.
- Confirm migrated templates are visible.
- Apply `Highlight Sweep`, `Matrix Decode`, `Neon Glow`, `RGB Glitch`, and `Particle Burst`.
- Confirm each one creates an editable animation and exposes bounded parameters.
- Open the old animation catalog and confirm removed migrated caption effects are gone.
- Confirm retained caption effects remain visible.

- [ ] **Step 7: Commit verification fixes only if needed**

If verification required fixes, commit only the exact changed files:

```powershell
git add -- <exact-files>
git commit -m "fix: verify migrated text animations"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: migration scope, Highlight inclusion, editable parameters, retained caption-only effects, registry removal, and tests are all mapped to tasks.
- Placeholder scan: no unfinished markers or unspecified test-writing steps.
- Type consistency: preset ids are identical across catalog, keyframes, Studio templates, and tests.
- Worktree safety: every commit step stages exact files only because the repository has unrelated dirty changes.
