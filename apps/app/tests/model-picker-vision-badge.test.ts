import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const typesSource = readFileSync(resolve(import.meta.dir, "../src/app/types.ts"), "utf8");
const hookSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/modals/use-model-picker.ts"),
  "utf8",
);
const modalSource = readFileSync(
  resolve(import.meta.dir, "../src/react-app/domains/session/modals/model-picker-modal.tsx"),
  "utf8",
);
const compactSelectSource = readFileSync(resolve(import.meta.dir, "../src/components/model-select.tsx"), "utf8");
const enSource = readFileSync(resolve(import.meta.dir, "../src/i18n/locales/en.ts"), "utf8");
const zhSource = readFileSync(resolve(import.meta.dir, "../src/i18n/locales/zh.ts"), "utf8");

describe("model picker vision badge", () => {
  test("tracks vision support separately from generic attachment support", () => {
    expect(typesSource).toContain("supportsVision?: boolean");
    expect(hookSource).toContain("resolveModelRuntime(");
    expect(hookSource).toContain("runtime?.capabilities?.vision === true");
  });

  test("renders the vision badge beside the model title and keeps the model id on its own line", () => {
    expect(modalSource).toContain("const visionBadgeLabel = opt.supportsVision ? t(\"model_picker.badge_vision\") : null");
    expect(modalSource).toContain("flex min-w-0 items-center gap-1.5");
    expect(modalSource).toContain("{visionBadgeLabel}");
    expect(modalSource).toContain("block truncate font-mono text-[10px]");
    expect(modalSource).not.toContain('<span className="ml-2 font-mono text-[10px] text-dls-secondary/60">{opt.modelID}</span>');
  });

  test("renders the vision badge in the compact composer model switcher", () => {
    expect(compactSelectSource).toContain("resolveModelRuntime(");
    expect(compactSelectSource).toContain("isConnected: true");
    expect(compactSelectSource).toContain("runtime?.capabilities?.vision === true");
    expect(compactSelectSource).toContain("const visionBadgeLabel = option.supportsVision ? t(\"model_picker.badge_vision\") : null");
    expect(compactSelectSource).toContain("{visionBadgeLabel}");
  });

  test("localizes the vision badge label", () => {
    expect(enSource).toContain('"model_picker.badge_vision": "Vision"');
    expect(zhSource).toContain('"model_picker.badge_vision": "视觉"');
  });

  test("keeps cached account models selectable while active-engine availability is discovered", () => {
    expect(compactSelectSource).toContain("useProviderListQuery({");
    expect(compactSelectSource).toContain("runtimePending");
    expect(compactSelectSource).toContain("disabled: false");
    expect(compactSelectSource).toContain("footer: undefined");
    expect(hookSource).toContain("useProviderListQuery({");
    expect(hookSource).toContain("runtimePending");
    expect(hookSource).toContain("disabled: false");
    expect(hookSource).toContain("footer: undefined");
  });
});
