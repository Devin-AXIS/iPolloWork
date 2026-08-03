import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

describe("application error boundary", () => {
  test("wraps the complete provider tree with a reload fallback", () => {
    const entrySource = readFileSync(new URL("../src/index.react.tsx", import.meta.url), "utf8");
    const boundarySource = readFileSync(
      new URL("../src/react-app/shell/app-error-boundary.tsx", import.meta.url),
      "utf8",
    );

    expect(entrySource.indexOf("<AppErrorBoundary>")).toBeLessThan(
      entrySource.indexOf("<QueryClientProvider"),
    );
    expect(boundarySource).toContain("static getDerivedStateFromError()");
    expect(boundarySource).toContain("componentDidCatch");
    expect(boundarySource).toContain("window.location.reload()");
    expect(boundarySource).toContain('role="alert"');
    expect(boundarySource).toContain('t("app.crash_description")');
  });
});
