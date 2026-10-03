import { describe, expect, test } from "bun:test";
import { listHyperframesCatalog, normalizeHyperframesCatalogItem, queryVideoRecipeCatalog } from "./hyperframes-catalog.js";

describe("HyperFrames catalog parameters", () => {
  test("indexes only locally installable cards and variants", async () => {
    const cards: Awaited<ReturnType<typeof queryVideoRecipeCatalog>>["cards"] = [];
    for (let offset = 0; offset < 23; offset += 20) {
      const page = await queryVideoRecipeCatalog({ offset, limit: 20 });
      expect(page.stats).toEqual({ cardCount: 23, styleCount: 30, executableVariantCount: 30, localRecipeCount: 30, availableRecipeCount: 81 });
      expect(page.categories).toEqual(["camera", "typography", "ui-entrance"]);
      expect(page.recipeCategories).toEqual([
        { name: "camera-journey", label: "空间运镜", count: 1 },
        { name: "compare", label: "并列对比", count: 1 },
        { name: "data-accumulation", label: "数据累积", count: 1 },
        { name: "focus-transfer", label: "焦点转移", count: 11 },
        { name: "kinetic-type", label: "动态文字", count: 32 },
        { name: "path-journey", label: "路径与流程", count: 4 },
        { name: "progressive-build", label: "逐步构建", count: 25 },
        { name: "state-transformation", label: "状态变换", count: 6 },
      ]);
      expect(page.cards.length).toBeLessThanOrEqual(20);
      cards.push(...page.cards);
    }
    expect(cards).toHaveLength(23);
    expect(new Set(cards.map(card => card.name)).size).toBe(23);
    const styles = cards.flatMap(card => card.styles);
    expect(styles).toHaveLength(30);
    expect(styles.every(style => style.executable)).toBe(true);
    for (const card of cards) {
      expect(card.sourceUrl).toContain("5ddbf521038b0a7accfb6dc1e0a9eb29c67277ab");
      expect(card).not.toHaveProperty("rules");
      for (const style of card.styles) {
        expect(style.previewStatus).toBe(200);
        expect(style.previewUrl).toContain("video-shotcraft/media/");
        expect(style.previewRevision).toBe("live-gallery-not-pinned");
        expect(style.executable).toBe(style.componentIds.length > 0);
        expect(style.migrationStatus).toBe("validated-local-recipe");
      }
    }
  });

  test("returns full selected executable rules, sources and adapted methodology on demand", async () => {
    const result = await queryVideoRecipeCatalog({ cardIds: ["type-entrance-moves", "depth-layer-moves", "card-stack"], includeMethodology: true });
    for (const card of result.cards) {
      expect("rules" in card && card.rules).toContain("## 参考实现");
      expect("rules" in card && card.rules).toContain("## 已知坑");
      expect("implementations" in card && card.implementations.length).toBeGreaterThan(0);
    }
    const drop = result.cards.find(card => card.name === "type-entrance-moves")?.styles.find(style => style.key === "letter-drop-physics");
    expect(drop).toMatchObject({ implementationPath: "demos/typography/type-entrance-moves/LetterDropPhysics.tsx", executable: true, componentIds: ["shotcraft-letter-drop"] });
    expect(result.cards.every(card => card.styles.every(style => style.executable))).toBe(true);
    expect(result.methodology?.rules).toContain("阶段 7");
    expect(result.methodology?.referenceOnly).toBe(true);
    expect(result.methodology?.adaptation).toContain("explicit script-review request");
  });

  test("bounds selection requests, rejects unknown cards and routes multilingual/category searches", async () => {
    await expect(queryVideoRecipeCatalog({ limit: 21 })).rejects.toThrow();
    await expect(queryVideoRecipeCatalog({ cardIds: ["a", "b", "c", "d"] })).rejects.toThrow();
    await expect(queryVideoRecipeCatalog({ cardIds: ["no-such-card"] })).rejects.toThrow("do not exist");
    await expect(queryVideoRecipeCatalog({ cardIds: ["shot-transitions"] })).rejects.toThrow("do not exist");
    await expect(queryVideoRecipeCatalog({ executableOnly: true })).rejects.toThrow();
    const selection = await queryVideoRecipeCatalog({ query: "乱码", category: "typography" });
    expect(selection.cards.some(card => card.name === "type-entrance-moves")).toBe(true);
    expect(selection.cards.every(card => card.category === "typography")).toBe(true);
    const camera = await queryVideoRecipeCatalog({ category: "camera" });
    expect(camera.cards).toHaveLength(1);
    expect(camera.cards[0]?.styles).toHaveLength(2);
    const kinetic = await queryVideoRecipeCatalog({ category: "kinetic-type" });
    expect(kinetic.cards).toEqual([]);
    expect(kinetic.recipeTotal).toBe(32);
    expect(kinetic.recipes.every(recipe => recipe.pattern === "kinetic-type" && recipe.componentId)).toBe(true);
  });
  test("exposes concise selection rules for authored and imported recipes without loading full usage", async () => {
    const recipes = (await listHyperframesCatalog()).filter(item => item.recipeSummary);
    expect(recipes).toHaveLength(81);
    expect(recipes.filter(item => item.source?.provider === "hyperframes-video-shotcraft")).toHaveLength(25);
    expect(recipes.filter(item => item.source?.provider === "video-shotcraft")).toHaveLength(5);
    for (const item of recipes) {
      expect(item.recipeSummary?.intent?.length).toBeGreaterThan(12);
      expect(item.recipeSummary?.useWhen.length).toBeGreaterThan(0);
      expect(item.recipeSummary?.avoidWhen.length).toBeGreaterThan(0);
      expect(item).not.toHaveProperty("motionRecipe");
      expect(item.recipeSummary).not.toHaveProperty("example");
    }
    const intentMatches = await queryVideoRecipeCatalog({ query: "结果回传" });
    expect(intentMatches.recipes.some(recipe => recipe.componentId === "feedback-loop" && recipe.intent?.includes("下一次行动"))).toBe(true);
  });

  test("normalizes legacy block params into composition variables", () => {
    const item = normalizeHyperframesCatalogItem({
      name: "legacy-effect",
      title: "Legacy effect",
      description: "Legacy parameter fixture",
      type: "hyperframes:block",
      tags: ["effect"],
      params: [
        {
          key: "--wave-intensity",
          label: "Wave intensity",
          type: "number",
          default: "1",
          min: 0,
          max: 3,
          step: 0.1,
        },
      ],
    });

    expect(item?.variables).toEqual([
      {
        id: "waveIntensity",
        label: "Wave intensity",
        type: "number",
        default: 1,
        min: 0,
        max: 3,
        step: 0.1,
        update: "live",
      },
    ]);
  });

  test("exposes the bundled GSAP effect variable contract", async () => {
    const item = (await listHyperframesCatalog()).find(
      (candidate) => candidate.name === "vfx-liquid-background",
    );

    expect(item?.engine).toEqual({ name: "gsap", version: "3.14.2", seekable: true });
    expect(item?.variables.map((variable) => variable.id)).toEqual([
      "backgroundColor",
      "textColor",
      "waveIntensity",
      "animationSpeed",
      "duration",
      "ease",
    ]);
    expect(item?.variables.find((variable) => variable.id === "duration")?.update).toBe("rebuild");
  });

  test("detects and classifies the complete bundled GSAP runtime catalog", async () => {
    const catalog = await listHyperframesCatalog();
    const gsapItems = catalog.filter((item) => item.engine?.name === "gsap");
    const animations = gsapItems.filter((item) => item.kind === "animation");
    const effects = gsapItems.filter((item) => item.kind === "effect");

    expect(gsapItems).toHaveLength(325);
    expect(animations).toHaveLength(245);
    expect(effects).toHaveLength(80);
    expect(gsapItems.filter((item) => item.source?.provider === "gsap-docs")).toHaveLength(25);
    expect(gsapItems.filter((item) => item.source?.provider === "hyperframes")).toHaveLength(236);
    expect(gsapItems.filter((item) => item.source?.provider === "video-shotcraft")).toHaveLength(5);
    expect(gsapItems.filter((item) => item.source?.provider === "ipollowork")).toHaveLength(18);
    expect(gsapItems.find((item) => item.name === "app-showcase")?.engine?.version).toBe("3.14.2");
    expect(
      gsapItems.find((item) => item.name === "gsap-scrolltrigger-story")?.engine?.plugins,
    ).toEqual(["ScrollTrigger"]);
    expect(
      gsapItems.find((item) => item.name === "gsap-splittext-reveal")?.engine?.plugins,
    ).toEqual(["SplitText"]);
    expect(gsapItems.find((item) => item.name === "gsap-morphsvg-shape")?.engine?.plugins).toEqual([
      "MorphSVGPlugin",
    ]);
    expect(
      gsapItems.find((item) => item.name === "gsap-gs-dev-tools-official")?.engine?.plugins,
    ).toEqual(["GSDevTools"]);
    expect(
      gsapItems.find((item) => item.name === "gsap-custom-wiggle-official")?.engine?.plugins,
    ).toEqual(["CustomWiggle", "CustomEase"]);
  });
});
