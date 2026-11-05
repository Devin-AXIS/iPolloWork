const studioLogos = [
  { id: "design-agent", source: "ext-design.png" },
  { id: "video-agent", source: "ext-video.png" },
  { id: "media-studio", source: "ext-image-studio.png" },
];

export default {
  id: "creative-studio-logos",
  title: "Creative studio plugins use distinct bitmap logos",
  kind: "user-facing",
  steps: [
    {
      name: "Show the three creative studio identities",
      run: async (ctx) => {
        await ctx.prove("Design, Video, and Media Studio are visually distinct", {
          claim: "The installed creative studio plugins use three distinct transparent black line icons with visual sizes matching adjacent brands.",
          voiceover: "在扩展插件页，设计、视频和素材工作台已换成透明底黑色线性图标，并与其他插件保持接近的视觉大小。",
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
                && image.naturalWidth === 1254 && image.naturalHeight === 1254))`, {
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
            const monochrome = await ctx.eval(`['ext-design.png', 'ext-video.png', 'ext-image-studio.png'].every((source) => {
              const image = [...document.querySelectorAll('[data-testid="plugin-installed-tile"] img')]
                .find((item) => item.getAttribute('src')?.includes(source));
              const canvas = document.createElement('canvas');
              canvas.width = canvas.height = 64;
              const context = canvas.getContext('2d');
              context.drawImage(image, 0, 0, 64, 64);
              const pixels = context.getImageData(0, 0, 64, 64).data;
              let dark = 0;
              let transparent = 0;
              let minX = 64, minY = 64, maxX = 0, maxY = 0;
              for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i + 3] < 10) { transparent++; continue; }
                if (pixels[i + 3] < 128) continue;
                const x = (i / 4) % 64, y = Math.floor(i / 4 / 64);
                minX = Math.min(minX, x); minY = Math.min(minY, y);
                maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                const channels = [pixels[i], pixels[i + 1], pixels[i + 2]];
                if (Math.max(...channels) - Math.min(...channels) > 12) return false;
                if (Math.max(...channels) < 70) dark++;
                if (Math.min(...channels) > 230) return false;
              }
              const rect = image.getBoundingClientRect();
              const visibleSize = Math.sqrt((maxX - minX + 1) * (maxY - minY + 1) / (64 * 64) * rect.width * rect.height);
              const reference = [...document.querySelectorAll('[data-testid="plugin-installed-tile"] img')]
                .find((item) => item.getAttribute('src')?.includes('ext-linear.svg'));
              const referenceSize = reference.getBoundingClientRect().width;
              return dark > 100 && transparent > 2000 && visibleSize / referenceSize > 0.9 && visibleSize / referenceSize < 1.1;
            })`);
            ctx.assert(monochrome, "All three logos must have transparent backgrounds, black strokes, and visible sizes within 10% of the adjacent Linear logo.");
          },
          screenshot: { name: "creative-studio-logos", hashIncludes: "/settings/extensions" },
        });
      },
    },
  ],
};
