import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sourceRoot = join(import.meta.dir, "../src/react-app");
const appSourceRoot = join(import.meta.dir, "../src");

function source(path: string) {
  return readFileSync(join(sourceRoot, path), "utf8");
}

describe("ordinary dialog close behavior", () => {
  test("keeps close controls available while background work continues", () => {
    const pluginImport = source("domains/settings/plugin-package-import-modal.tsx");
    const environment = source("domains/settings/pages/environment-view.tsx");
    const authorization = readFileSync(join(appSourceRoot, "components/authorization-form-dialog.tsx"), "utf8");

    expect(pluginImport).not.toContain("if (busy) return;\n    reset();");
    expect(pluginImport).toContain('DialogClose render={<Button variant="outline" />}');
    expect(environment).toContain('if (event.key === "Escape")');
    expect(environment).toContain('DialogClose render={<Button variant="outline" size="sm" />}');
    expect(authorization).toContain('DialogClose render={<Button size="sm" variant="outline" />}');
  });

  test("does not hide the close button on the custom skill repository dialog", () => {
    const skills = source("domains/settings/pages/skills-view.tsx");

    expect(skills).not.toContain("showCloseButton={false}");
    expect(skills).toContain('<DialogClose render={<Button variant="outline" />}>');
  });

  test("keeps forced permission approval separate from ordinary dialogs", () => {
    const permission = source("domains/session/chat/permission-approval-modal.tsx");

    expect(permission).toContain("<AlertDialogContent");
    expect(permission).not.toContain("<DialogContent");
  });
});
