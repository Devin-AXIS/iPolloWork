import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioToast } from "./StudioToast";

describe("StudioToast", () => {
  it.each([
    ["loading", "lucide-loader-circle"],
    ["success", "lucide-circle-check"],
    ["error", "lucide-triangle-alert"],
  ] as const)("uses the Lucide status icon for %s", (tone, iconClass) => {
    const markup = renderToStaticMarkup(
      <StudioToast message="Status" tone={tone} onDismiss={() => undefined} />,
    );

    expect(markup).toContain(iconClass);
    expect(markup).toContain("lucide-x");
    expect(markup).toContain(`data-tone="${tone}"`);
  });
});
