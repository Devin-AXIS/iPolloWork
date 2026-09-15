const studioLogos = [
  { id: "design-agent", source: "ext-design.png" },
  { id: "video-agent", source: "ext-video.png" },
  { id: "image-studio", source: "ext-image-studio.png" },
];

export default {
  id: "creative-studio-logos",
  title: "Creative studio plugins use distinct bitmap logos",
  kind: "user-facing",
  steps: [
    {
      name: "Show the three creative studio identities",
      run: async (ctx) => {
        await ctx.prove("Design, Video, and Image Studio are visually distinct", {
          claim: "The installed creative studio plugins use the three supplied transparent PNG logos.",
          voiceover: "在扩展插件页，设计、视频和图片工作台已分别换成提供的 PNG 图标。",
          action: async () => {
            await ctx.navigateHash("/settings/extensions");
            await ctx.waitFor("Boolean(document.querySelector('[data-testid=\"plugin-installed-tile\"]'))", {
              timeoutMs: 30_000,
              label: "installed plugin previews",
            });
          },
          assert: async () => {
            await ctx.waitFor(`['ext-design.png', 'ext-video.png', 'ext-image-studio.png'].every((source) =>
              [...document.querySelectorAll('[data-testid="plugin-installed-tile"] img')].some((image) =>
                image.getAttribute('src')?.includes(source) && image.complete
                && image.naturalWidth === (source === 'ext-design.png' ? 1536 : 1254)))`, {
              label: "supplied PNG logos loaded",
            });
            const visibleSources = await ctx.eval(`[
              ...document.querySelectorAll('[data-testid="plugin-installed-tile"] img')
            ].map((image) => image.getAttribute('src') ?? '')`);
            const missing = studioLogos.filter(({ source }) =>
              !visibleSources.some((visibleSource) => visibleSource.includes(source)));
            ctx.assert(missing.length === 0, `Missing creative studio logos: ${missing.map(({ id }) => id).join(', ')}`);
            ctx.assert(new Set(visibleSources.filter((source) =>
              studioLogos.some((logo) => source.includes(logo.source)))).size === studioLogos.length,
            "Creative studio plugins should not share one logo asset.");
          },
          screenshot: { name: "creative-studio-logos", hashIncludes: "/settings/extensions" },
        });
      },
    },
  ],
};
