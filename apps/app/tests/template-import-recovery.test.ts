import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sessionPage = readFileSync(new URL("../src/react-app/domains/session/chat/session-page.tsx", import.meta.url), "utf8");
const marketDialog = readFileSync(new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url), "utf8");

describe("template import recovery", () => {
  test("keeps the selected package after failure and clears it only after success", () => {
    expect(sessionPage).toContain("if (await onImport(pendingImport, serverCategory)) setPendingImport(null)");
    expect(marketDialog).toContain("if (await props.onImport(pendingImport)) setPendingImport(null)");
    expect(sessionPage).not.toContain("onImport(pendingImport, serverCategory); setPendingImport(null)");
    expect(marketDialog).not.toContain("props.onImport(pendingImport, pendingImportCategory); setPendingImport(null)");
  });

  test("prevents duplicate imports and lets the server detect global-market categories", () => {
    expect(sessionPage).toContain("templateImportInFlightRef.current");
    expect(sessionPage).toContain("file.size > MAX_TEMPLATE_PACKAGE_BYTES");
    expect(marketDialog).not.toContain("pendingImportCategory");
    expect(marketDialog).toContain("disabled={props.busyId !== null}");
  });
});
