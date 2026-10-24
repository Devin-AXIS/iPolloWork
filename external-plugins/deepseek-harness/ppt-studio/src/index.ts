import { createDeepSeekDesignStudioPlugin } from "../../design-studio/src/index";

const plugin = createDeepSeekDesignStudioPlugin({
  mode: "slides",
  routeRoot: "/ipollowork-ppt",
  studioTitle: "DeepSeek iPPT",
  defaultTemplateId: "ipollowork.deepseek-harness.ppt",
  projectSuffix: "-ippt",
});

export const inject = plugin.inject;
export const apply = plugin.apply;
