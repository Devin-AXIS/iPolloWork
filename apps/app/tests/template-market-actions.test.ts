import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  IPOLLOWORK_PACKAGE_MEDIA_TYPE,
  LEGACY_TEMPLATE_PACKAGE_MEDIA_TYPE,
  TEMPLATE_PACKAGE_FILE_ACCEPT,
  templatePackageMediaTypeForFilename,
} from "@ipollowork/types/templates";

const marketDialog = readFileSync(
  new URL("../src/react-app/domains/session/templates/template-market-dialog.tsx", import.meta.url),
  "utf8",
);

describe("template market actions", () => {
  test("keeps package import but hides save-current controls", () => {
    expect(marketDialog).toContain('t("template_market.import_package")');
    expect(marketDialog).toContain("accept={TEMPLATE_PACKAGE_FILE_ACCEPT}");
    expect(marketDialog).not.toContain('t("template_market.save_current")');
    expect(marketDialog).not.toContain("onSaveCurrent");
    expect(marketDialog).not.toContain("canSaveCurrent");
  });

  test("treats .ipwp as canonical while preserving the .ipwt import contract", () => {
    expect(TEMPLATE_PACKAGE_FILE_ACCEPT).toBe(".ipwp,.ipwt");
    expect(templatePackageMediaTypeForFilename("new-template.ipwp")).toBe(IPOLLOWORK_PACKAGE_MEDIA_TYPE);
    expect(templatePackageMediaTypeForFilename("legacy-template.IPWT")).toBe(LEGACY_TEMPLATE_PACKAGE_MEDIA_TYPE);
  });
});
