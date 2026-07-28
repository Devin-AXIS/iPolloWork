import { describe, expect, test } from "bun:test";

const sonnerPath = new URL("../src/components/ui/sonner.tsx", import.meta.url);

describe("toast close button", () => {
  test("dismisses on pointer down before overlapping drag surfaces can capture click", async () => {
    const source = await Bun.file(sonnerPath).text();

    expect(source).toContain('aria-label="Close notification"');
    expect(source).toContain("onPointerDown={dismiss}");
    expect(source).toContain("onClick={dismiss}");
    expect(source).toContain("sonnerToast.dismiss(id)");
    expect(source).toContain("relative z-50");
  });
});
