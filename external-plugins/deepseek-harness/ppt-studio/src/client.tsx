import { createDeepSeekDesignStudioClient, inject } from "../../design-studio/src/client";

export { inject };
export const apply = createDeepSeekDesignStudioClient({
  routeRoot: "/ipollowork-ppt",
  viewId: "ipollowork-ppt-studio",
  label: "PPT",
  studioTitle: "DeepSeek iPPT",
  projectSuffix: "-ippt",
});
