import "vite/client";

declare global {
  const __DEEPSEEK_STUDIO_MODE__: "design" | "slides";
  const __DEEPSEEK_STUDIO_TITLE__: string;
}
